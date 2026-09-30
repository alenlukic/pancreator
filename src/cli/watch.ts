/**
 * The `watch` command: every timer, agent, process, and run observation form.
 */

import { armWorkerWatch } from '../lib/engine/delegated-workers.js'
import { invariant, PanError } from '../lib/errors.js'
import {
  watchAgent,
  type WatchAgentSessionEntry,
  type WatchAgentWakeInfo,
} from '../lib/watch/agent.js'
import { watchAttach } from '../lib/watch/attach.js'
import { recordForegroundReturn } from '../lib/watch/completion.js'
import { launchRecordPath } from '../lib/watch/launch.js'
import {
  parseMultiplexedWatchTargets,
  watchInvocations,
} from '../lib/watch/multiplexed.js'
import {
  parseAgentState,
  parseCadenceSeconds,
  parsePositiveInteger,
  parseStallWakes,
  parseTimeoutSeconds,
} from '../lib/watch/options.js'
import { foregroundReturnRecordPath } from '../lib/watch/paths.js'
import {
  watchProcess,
  formatProcessWakeLines,
  type GenericWatchRecordEntry,
} from '../lib/watch/process.js'
import {
  formatGapLine,
  formatOpenCallSuffix,
  formatSessionStartLine,
  formatWakeLine,
} from '../lib/watch/record.js'
import { watchTimer } from '../lib/watch/timer.js'
import {
  DEFAULT_STALL_TIMEOUT_SECONDS,
  WATCH_EXIT_CODES,
  type WatchRecordEntry,
} from '../lib/watch/types.js'
import {
  formatEvidenceWatchResult,
  watchEvidenceCompletion,
} from '../lib/watch-evidence.js'
import { runWatchAudit } from '../lib/watch-audit.js'

import type { CliContext } from './context.js'
import { hasFlag, option, print, requiredArgument } from './args.js'

/**
 * Resolve the stall bound for a watch invocation: the duration flag, the
 * legacy wake-count flag converted against the resolved cadence, or the
 * five-minute default. The two spellings are exclusive so no call has to
 * choose between them.
 */
function resolveStallTimeoutSeconds(
  args: string[],
  cadenceSeconds: number,
): number {
  const duration = option(args, '--stall-timeout-seconds')
  const wakes = option(args, '--stall-wakes')

  if (duration !== null && wakes !== null) {
    throw new PanError(
      '--stall-wakes and --stall-timeout-seconds name the same bound; pass one.',
      { code: 'INVALID_ARGUMENT' },
    )
  }

  const converted = parseStallWakes(wakes, cadenceSeconds)

  if (converted !== null) {
    return converted
  }

  return parsePositiveInteger(
    duration,
    '--stall-timeout-seconds',
    DEFAULT_STALL_TIMEOUT_SECONDS,
  )
}

/**
 * A hint naming the agent-index hooks a stale `.cursor/hooks.json` is
 * missing, or null when there is nothing to report. `pan watch --agent`
 * surfaces this both at arming and on an `unregistered` verdict, because a
 * stale hook projection is the ordinary reason no subagent ever registers.
 */
function agentIndexHooksHint(
  status: WatchAgentSessionEntry['hooks_projection'],
): string | null {
  if (status === null || status.projected) {
    return null
  }

  return (
    `hooks: agent-index hooks missing from .cursor/hooks.json ` +
    `(${status.missing_events.join(', ')}); run ./bin/pan models --sync`
  )
}

/** `pan watch`. */
export async function watchCommand({
  root,
  args,
  json,
}: CliContext): Promise<void> {
  const interactive = process.stderr.isTTY
  const watchCallbacks = {
    // OUTPUT-001: repeated per-wake progress lines only on an interactive
    // terminal. Stdout carries the result either way.
    onWake: interactive
      ? (entry: WatchRecordEntry) =>
          process.stderr.write(`${formatWakeLine(entry)}\n`)
      : undefined,
    // The arming bound and a discovered gap print once per session on
    // every stderr: agent shells have no terminal, and they are the
    // supervisors that must see both. The gap line comes first.
    onSessionStart: (entry: WatchRecordEntry) =>
      process.stderr.write(`${formatSessionStartLine(entry)}\n`),
    onGap: (entry: WatchRecordEntry) =>
      process.stderr.write(`${formatGapLine(entry)}\n`),
  }

  if (args[0] === 'audit') {
    const report = runWatchAudit(root, {
      rootsFile: requiredArgument(option(args, '--roots-file'), '--roots-file'),
      from: requiredArgument(option(args, '--from'), '--from'),
      to: requiredArgument(option(args, '--to'), '--to'),
      output: requiredArgument(option(args, '--output'), '--output'),
    })

    print(
      json
        ? report
        : `watch audit: ${report.sessions.length} sessions across ` +
            `${report.roots.length} roots, ` +
            `${report.sub_cadence_sessions.length} sub-cadence, ` +
            `${report.cadence_exceptions.length} cadence exceptions, ` +
            `${report.errors.length} input errors; report ${report.output_path}` +
            (report.complete
              ? ''
              : ' (PARTIAL — named errors must be resolved before this audit is complete)'),
      json,
    )

    if (!report.complete) {
      process.exitCode = 1
    }
    return
  }

  const attachLedgers = option(args, '--attach')

  if (attachLedgers !== null) {
    const ledgerList = attachLedgers
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    invariant(
      ledgerList.length > 0,
      '--attach requires at least one ledger path.',
      { code: 'INVALID_ARGUMENT' },
    )

    const timeoutSec = parseTimeoutSeconds(option(args, '--timeout-seconds'))
    const attachAuthority = option(args, '--cadence-directed-by-operator')
    const result = await watchAttach(root, {
      ledgers: ledgerList,
      timeoutSeconds: timeoutSec,
      cadenceSeconds: parseCadenceSeconds(
        option(args, '--cadence-seconds'),
        attachAuthority,
      ),
      ...(attachAuthority?.trim()
        ? { cadenceAuthority: attachAuthority.trim() }
        : {}),
    })

    print(
      json
        ? result
        : `attach ${result.state}: ${result.ledgers.length} session(s) ` +
            `after ${result.elapsed_seconds.toFixed(1)}s\n` +
            result.ledgers
              .map(
                (s) =>
                  `  ${s.ledger}: ${s.state ?? 'pending'}` +
                  (s.session_terminal_state
                    ? ` (session: ${s.session_terminal_state})`
                    : ''),
              )
              .join('\n'),
      json,
    )
    process.exitCode = result.exit_code
    return
  }

  const processPid = option(args, '--process')
  const timerMode = hasFlag(args, '--timer')
  const agentId = option(args, '--agent')

  // Standalone --agent <id> form: no positional run id (Q-008 disposition).
  if (agentId !== null && (args[0] === undefined || args[0].startsWith('--'))) {
    const agentExclusive = [
      '--until-evidence-complete',
      '--targets',
      '--invocation',
      '--foreground-returned',
      '--mark-background',
      '--agent-state',
      '--agent-state-evidence',
      '--handle',
      '--launched-at',
      '--process',
    ]

    if (
      hasFlag(args, '--timer') ||
      agentExclusive.some(
        (name) => option(args, name) !== null || hasFlag(args, name),
      )
    ) {
      throw new PanError(
        '--agent (standalone) is exclusive with --process, --timer, ' +
          '--targets, --invocation, and delegation flags.',
        { code: 'INVALID_ARGUMENT' },
      )
    }

    const agentCadence = parseCadenceSeconds(
      option(args, '--cadence-seconds'),
      option(args, '--cadence-directed-by-operator'),
    )

    const agentCadenceAuthority =
      option(args, '--cadence-directed-by-operator')?.trim() || undefined
    let finalHooksProjection: WatchAgentSessionEntry['hooks_projection'] = null
    const result = await watchAgent(root, agentId, {
      cadenceSeconds: agentCadence,
      ...(agentCadenceAuthority
        ? { cadenceAuthority: agentCadenceAuthority }
        : {}),
      timeoutSeconds: parseTimeoutSeconds(option(args, '--timeout-seconds')),
      onSessionStart: (entry: WatchAgentSessionEntry) => {
        const indexed = entry.agent_entry
        finalHooksProjection = entry.hooks_projection
        const hooksHint = agentIndexHooksHint(entry.hooks_projection)
        process.stderr.write(
          `[pan watch:agent:${entry.subject}] armed ` +
            `${entry.cadence_seconds}s cadence, ` +
            `${entry.timeout_seconds}s bound; ` +
            (indexed
              ? `index: ${indexed.status}, last ${indexed.last_event_kind} ` +
                `at ${indexed.last_event_at}` +
                (entry.aliases.length > 0
                  ? `, aliases ${entry.aliases.join(', ')}`
                  : '')
              : 'index: not registered yet') +
            `; attach: ./bin/pan watch --attach ${entry.record_path}` +
            (hooksHint ? `; ${hooksHint}` : '') +
            '\n',
        )
      },
      onWake: interactive
        ? (info: WatchAgentWakeInfo) => {
            const activity = info.agent_activity
            const age =
              activity?.last_event_age_seconds != null
                ? ` (${activity.last_event_age_seconds.toFixed(0)}s ago)`
                : ''
            process.stderr.write(
              `[pan watch:agent:${info.subject}] wake ${info.wake}` +
                (activity ? '' : ' not registered') +
                formatOpenCallSuffix(activity) +
                (activity?.last_event_kind
                  ? ` last:${activity.last_event_kind}${age}`
                  : '') +
                (info.terminal_state ? ` -> ${info.terminal_state}` : '') +
                '\n',
            )
          }
        : undefined,
    })

    print(
      json
        ? result
        : result.state === 'unregistered'
          ? `agent watch unregistered: the index never registered ` +
            `'${result.agent_id}' after ${result.elapsed_seconds.toFixed(1)}s ` +
            `over ${result.wakes} wakes; this is not evidence of a stall. ` +
            `${agentIndexHooksHint(finalHooksProjection) ?? 'Confirm the agent id and rearm.'} ` +
            `record ${result.record_path}`
          : `agent watch ${result.state}: '${result.agent_id}' after ` +
            `${result.elapsed_seconds.toFixed(1)}s over ${result.wakes} wakes; ` +
            `record ${result.record_path}`,
      json,
    )
    process.exitCode =
      result.state === 'completed'
        ? 0
        : result.state === 'failed'
          ? 1
          : result.state === 'stalled'
            ? 2
            : result.state === 'timed_out'
              ? 3
              : result.state === 'unregistered'
                ? 6
                : 130
    return
  }

  if (processPid !== null || timerMode) {
    if (processPid !== null && timerMode) {
      throw new PanError('--process and --timer are exclusive.', {
        code: 'INVALID_ARGUMENT',
      })
    }

    const genericExclusive = [
      '--until-evidence-complete',
      '--targets',
      '--invocation',
      '--foreground-returned',
      '--mark-background',
      '--agent-state',
      '--agent-state-evidence',
      '--handle',
      '--launched-at',
    ]

    if (
      (args[0] !== undefined && !args[0].startsWith('--')) ||
      genericExclusive.some(
        (name) => option(args, name) !== null || hasFlag(args, name),
      )
    ) {
      throw new PanError(
        '--process/--timer are standalone forms: they take no run id, ' +
          '--targets, --invocation, or delegation flags.',
        { code: 'INVALID_ARGUMENT' },
      )
    }

    const genericCadence = parseCadenceSeconds(
      option(args, '--cadence-seconds'),
      option(args, '--cadence-directed-by-operator'),
    )
    const genericRecord = option(args, '--record') ?? undefined
    const genericOnWake = interactive
      ? (entry: GenericWatchRecordEntry) =>
          process.stderr.write(`${formatProcessWakeLines(entry)}\n`)
      : undefined

    if (timerMode) {
      const result = await watchTimer(root, {
        label: requiredArgument(option(args, '--label'), '--label'),
        ...(genericRecord ? { recordPath: genericRecord } : {}),
        cadenceSeconds: genericCadence,
        onWake: genericOnWake,
      })

      print(
        json
          ? result
          : `timer elapsed for '${result.label}' after ` +
              `${result.elapsed_seconds.toFixed(1)}s; inspect the subject ` +
              `now — record ${result.record_path}. This wake never ` +
              `satisfies delegation completion.`,
        json,
      )
      process.exitCode = 0
      return
    }

    const exitRecordArg = option(args, '--exit-record')

    const result = await watchProcess(root, {
      pid: Number(processPid),
      label: requiredArgument(option(args, '--label'), '--label'),
      ...(option(args, '--output')
        ? { outputPath: option(args, '--output') as string }
        : {}),
      ...(exitRecordArg !== null ? { exitRecordPath: exitRecordArg } : {}),
      ...(genericRecord ? { recordPath: genericRecord } : {}),
      cadenceSeconds: genericCadence,
      timeoutSeconds: parseTimeoutSeconds(option(args, '--timeout-seconds')),
      onWake: genericOnWake,
    })

    const exitStatusNote =
      result.state === 'exited'
        ? typeof result.exit_status === 'number'
          ? `; exit status ${result.exit_status} (from exit record)`
          : '; observed exit only — the exit status is unknown without authoritative completion evidence'
        : ''

    print(
      json
        ? result
        : `process watch ${result.state}: '${result.label}' (pid ` +
            `${result.subject}) after ${result.elapsed_seconds.toFixed(1)}s ` +
            `over ${result.wakes} wakes; record ${result.record_path}` +
            (result.state === 'timed_out' && result.rearm_command
              ? `\nre-arm with: ${result.rearm_command}`
              : exitStatusNote),
      json,
    )
    process.exitCode =
      result.state === 'exited'
        ? 0
        : result.state === 'timed_out'
          ? 3
          : result.state === 'unverified'
            ? 4
            : 130
    return
  }

  const targets = parseMultiplexedWatchTargets(option(args, '--targets'))

  if (targets) {
    if (
      (args[0] !== undefined && !args[0].startsWith('--')) ||
      hasFlag(args, '--foreground-returned') ||
      hasFlag(args, '--until-evidence-complete') ||
      option(args, '--invocation') !== null
    ) {
      throw new PanError(
        '--targets is exclusive with a positional run id, --invocation, --foreground-returned, and --until-evidence-complete.',
        { code: 'INVALID_ARGUMENT' },
      )
    }

    if (option(args, '--agent-state') !== null) {
      throw new PanError(
        '--agent-state reports the one launched agent you inspected, so ' +
          'it cannot speak for a group. Re-arm `pan watch <run-id> ' +
          '--agent-state ...` on the target you looked at.',
        { code: 'INVALID_ARGUMENT' },
      )
    }

    const multiplexCadence = parseCadenceSeconds(
      option(args, '--cadence-seconds'),
      option(args, '--cadence-directed-by-operator'),
    )
    const multiplexStallTimeout = resolveStallTimeoutSeconds(
      args,
      multiplexCadence,
    )
    const result = await watchInvocations(root, targets, {
      cadenceSeconds: multiplexCadence,
      ...(option(args, '--cadence-directed-by-operator')
        ? {
            cadenceAuthority: option(
              args,
              '--cadence-directed-by-operator',
            ) as string,
          }
        : {}),
      stallTimeoutSeconds: multiplexStallTimeout,
      timeoutSeconds: parseTimeoutSeconds(option(args, '--timeout-seconds')),
      markBackground: hasFlag(args, '--mark-background'),
      untilTerminal: hasFlag(args, '--until-terminal'),
      ...watchCallbacks,
    })
    const named = (items: typeof result.moved): string =>
      items.map((item) => `${item.run_id}:${item.invocation_id}`).join(', ')

    print(
      json
        ? result
        : `watch ${result.state}: ${result.moved.length} of ${result.targets} targets moved after ${result.wakes} wakes; ` +
            (result.moved.length > 0
              ? named(result.moved)
              : 'no target moved') +
            (result.stalled.length > 0
              ? `; needs inspection: ${named(result.stalled)}`
              : ''),
      json,
    )
    process.exitCode =
      result.state === 'changed' ? 0 : WATCH_EXIT_CODES[result.state]
    return
  }

  const runId = requiredArgument(args[0], 'run-id')
  const invocationId = option(args, '--invocation')

  if (hasFlag(args, '--until-evidence-complete')) {
    // The evidence watch observes the evidence reports only. Every flag
    // that records or reports the stage worker's own launch belongs to
    // the stage watch the supervisor arms after this one returns.
    const evidenceExclusive = [
      '--foreground-returned',
      '--mark-background',
      '--agent-state',
      '--agent-state-evidence',
      '--handle',
      '--launched-at',
      '--platform-returned-at',
      '--platform-detached-at',
      '--agent',
      '--model',
    ]
    const conflicting = evidenceExclusive.filter((name) => args.includes(name))

    if (conflicting.length > 0) {
      throw new PanError(
        `--until-evidence-complete is exclusive with ${conflicting.join(', ')}: ` +
          'it waits for the evidence reports and records no launch. Arm ' +
          '`pan watch <run-id> --mark-background` for the stage worker ' +
          'after it returns.',
        { code: 'INVALID_ARGUMENT' },
      )
    }

    const evidenceCadenceAuthority = option(
      args,
      '--cadence-directed-by-operator',
    )
    const evidenceCadence = parseCadenceSeconds(
      option(args, '--cadence-seconds'),
      evidenceCadenceAuthority,
    )
    const result = await watchEvidenceCompletion(root, runId, {
      ...(invocationId ? { invocationId } : {}),
      cadenceSeconds: evidenceCadence,
      ...(evidenceCadenceAuthority
        ? { cadenceAuthority: evidenceCadenceAuthority.trim() }
        : {}),
      stallTimeoutSeconds: resolveStallTimeoutSeconds(args, evidenceCadence),
      timeoutSeconds: parseTimeoutSeconds(option(args, '--timeout-seconds')),
      ...(watchCallbacks.onWake ? { onWake: watchCallbacks.onWake } : {}),
    })

    print(json ? result : formatEvidenceWatchResult(result), json)
    process.exitCode = WATCH_EXIT_CODES[result.state]
    return
  }

  if (hasFlag(args, '--foreground-returned')) {
    if (hasFlag(args, '--mark-background')) {
      throw new PanError(
        '--foreground-returned and --mark-background are exclusive: a ' +
          'launch returned in the foreground or it became a background ' +
          'subagent.',
        { code: 'INVALID_ARGUMENT' },
      )
    }

    const launchedAt = option(args, '--launched-at')
    const record = recordForegroundReturn(root, runId, {
      ...(invocationId ? { invocationId } : {}),
      ...(launchedAt ? { launchedAt } : {}),
    })

    print(
      json
        ? record
        : `foreground return recorded: invocation ${record.invocation_id}, ` +
            `launched ${record.launched_at} (${record.launched_at_source}), ` +
            `returned ${record.returned_at} after ` +
            `${record.elapsed_seconds.toFixed(1)}s, output ` +
            `${record.observation.output_present ? 'present' : 'absent'}, ` +
            `record ${foregroundReturnRecordPath(root, runId, record.invocation_id)}` +
            (record.elapsed_implausibility
              ? `\n${record.elapsed_implausibility}`
              : ''),
      json,
    )
    return
  }

  const agentState = parseAgentState(option(args, '--agent-state'))
  const agentStateEvidence = option(args, '--agent-state-evidence')

  const armLaunchedAt = option(args, '--launched-at')
  const platformReturnedAt = option(args, '--platform-returned-at')
  const platformDetachedAt = option(args, '--platform-detached-at')

  const workerHandle = option(args, '--handle')
  const workerAgent = option(args, '--agent')
  const workerModel = option(args, '--model')

  const cadenceAuthority = option(args, '--cadence-directed-by-operator')
  const cadenceSeconds = parseCadenceSeconds(
    option(args, '--cadence-seconds'),
    cadenceAuthority,
  )

  const result = await armWorkerWatch(root, runId, {
    ...(invocationId ? { invocationId } : {}),
    cadenceSeconds,
    ...(cadenceAuthority ? { cadenceAuthority } : {}),
    stallTimeoutSeconds: resolveStallTimeoutSeconds(args, cadenceSeconds),
    timeoutSeconds: parseTimeoutSeconds(option(args, '--timeout-seconds')),
    markBackground: hasFlag(args, '--mark-background'),
    ...(armLaunchedAt ? { launchedAt: armLaunchedAt } : {}),
    ...(platformReturnedAt ? { platformReturnedAt } : {}),
    ...(platformDetachedAt ? { platformDetachedAt } : {}),
    ...(workerHandle ? { workerHandle } : {}),
    ...(workerAgent ? { workerAgent } : {}),
    ...(workerModel ? { workerModel } : {}),
    ...(agentState ? { agentState } : {}),
    ...(agentStateEvidence ? { agentStateEvidence } : {}),
    ...watchCallbacks,
  })

  print(
    json
      ? result
      : `watch ${result.state}: invocation ${result.invocation_id}, ` +
          `${result.wakes} wakes over ${result.elapsed_seconds.toFixed(1)}s ` +
          `(timeout ${result.timeout_seconds}s), ` +
          (result.gaps.length > 0
            ? `${result.gaps.length} observation ` +
              `${result.gaps.length === 1 ? 'gap' : 'gaps'} recorded, `
            : '') +
          `record ${result.record_path}, launch ` +
          `${launchRecordPath(root, runId, result.invocation_id)}` +
          (result.rearm_command
            ? `; re-arm with: ${result.rearm_command}`
            : ''),
    json,
  )
  process.exitCode = WATCH_EXIT_CODES[result.state]
  return
}
