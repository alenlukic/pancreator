/**
 * Graders for the delegation watch record and the platform-guidance conflict
 * record.
 */

import path from 'node:path'

import { fileExists, isRecord, readJson, readText } from '../../io.js'
import { outputStrings } from '../run-records.js'
import {
  config,
  type Grader,
  historyForInvocation,
  relativeEvidence,
} from './context.js'

// ---------------------------------------------------------------------------
// delegation-watch-record
// ---------------------------------------------------------------------------

const BACKGROUND_EVENT = /background|watch/iu

export const delegationWatchRecord: Grader = (context) => {
  const { records } = context
  const requireFor = config<'background' | 'all'>(
    context,
    'require_for',
    'background',
  )

  const invocationIds = [
    ...records.state.stage_history.map((item) => item.invocation_id),
    ...(records.state.current_invocation
      ? [records.state.current_invocation.id]
      : []),
  ]
  const unique = [...new Set(invocationIds)]

  const rows: Record<string, unknown>[] = []
  const failures: string[] = []
  const evidence: string[] = []

  for (const invocationId of unique) {
    const watchRelative = relativeEvidence(
      records,
      'evidence',
      `${invocationId}-watch.jsonl`,
    )
    const markerRelative = relativeEvidence(
      records,
      'evidence',
      `${invocationId}-delegation-background.json`,
    )
    const executionRelative = relativeEvidence(
      records,
      'invocations',
      `${invocationId}.delegation-execution.json`,
    )
    const returnRelative = relativeEvidence(
      records,
      'evidence',
      `${invocationId}-foreground-return.json`,
    )

    const watchAbsolute = path.join(records.root, watchRelative)

    let armings = 0
    let wakes = 0
    let entries = 0
    let parseErrors = 0

    let terminalState: string | null = null

    if (fileExists(watchAbsolute)) {
      evidence.push(watchRelative)

      for (const line of readText(watchAbsolute).split('\n')) {
        if (line.trim().length === 0) {
          continue
        }

        try {
          const entry = JSON.parse(line) as unknown

          entries += 1

          if (isRecord(entry)) {
            if (entry.event === 'armed') {
              armings += 1
            }

            if (entry.event === 'wake') {
              wakes += 1

              if (typeof entry.terminal_state === 'string') {
                terminalState = entry.terminal_state
              }
            }
          }
        } catch {
          parseErrors += 1
        }
      }
    }

    const backgroundSources: string[] = []

    if (fileExists(path.join(records.root, markerRelative))) {
      backgroundSources.push(markerRelative)
      evidence.push(markerRelative)
    }

    for (const event of records.events) {
      if (
        event.invocation_id === invocationId &&
        BACKGROUND_EVENT.test(event.type)
      ) {
        backgroundSources.push(`event:${event.type}`)
      }
    }

    // `pan delegate` writes the execution record for an external-executor
    // stage; that record is the harness's own delegation evidence.
    let externalExecution = false

    if (fileExists(path.join(records.root, executionRelative))) {
      try {
        const execution = readJson(path.join(records.root, executionRelative))

        externalExecution = isRecord(execution)
        evidence.push(executionRelative)

        if (
          isRecord(execution) &&
          typeof execution.delegation_kind === 'string' &&
          /background/iu.test(execution.delegation_kind)
        ) {
          backgroundSources.push(executionRelative)
        }
      } catch {
        // An unreadable execution record cannot prove a background delegation.
      }
    }

    // `pan watch --foreground-returned` writes the attestation with both
    // wall-clock times; one without them is not an attestation.
    let foregroundReturn = false

    if (fileExists(path.join(records.root, returnRelative))) {
      try {
        const attestation = readJson(path.join(records.root, returnRelative))

        foregroundReturn =
          isRecord(attestation) &&
          typeof attestation.launched_at === 'string' &&
          typeof attestation.returned_at === 'string'

        if (foregroundReturn) {
          evidence.push(returnRelative)
        }
      } catch {
        // An unreadable attestation proves nothing.
      }
    }

    if (entries > 0) {
      backgroundSources.push(watchRelative)
    }

    const history = historyForInvocation(records, invocationId)
    const backgroundObserved = backgroundSources.length > 0
    const required = requireFor === 'all' || backgroundObserved

    // A submitted stage needs a watch that saw the output land; a still-open
    // invocation only needs the record to exist.
    const needsCompletion = history !== undefined
    const watchSatisfied =
      entries > 0 &&
      parseErrors === 0 &&
      (!needsCompletion || terminalState === 'completed')

    const observedVia = watchSatisfied
      ? 'watch_completed'
      : foregroundReturn
        ? 'foreground_return'
        : externalExecution
          ? 'external_executor'
          : null
    const satisfied = observedVia !== null

    if (required && !satisfied) {
      failures.push(
        `${invocationId}: ${
          entries === 0
            ? `no watch record at ${watchRelative}`
            : parseErrors > 0
              ? `${parseErrors} unreadable watch line(s) in ${watchRelative}`
              : `watch record ${watchRelative} ends without a completed wake (${wakes} wake(s), last state ${terminalState ?? 'none'})`
        } and no foreground-return attestation at ${returnRelative}`,
      )
    }

    rows.push({
      invocation_id: invocationId,
      stage: history?.stage ?? records.state.current_stage,
      background_observed: backgroundObserved,
      background_sources: backgroundSources,
      watch_record: watchRelative,
      watch_entries: entries,
      armings,
      wakes,
      terminal_state: terminalState,
      watch_parse_errors: parseErrors,
      foreground_return_record: returnRelative,
      foreground_return: foregroundReturn,
      external_execution: externalExecution,
      observed_via: observedVia,
      required,
      satisfied,
    })
  }

  const observableBackground = rows.filter(
    (row) => row.background_observed,
  ).length

  return {
    passed: failures.length === 0,
    summary:
      failures.length === 0
        ? requireFor === 'all'
          ? `Every one of ${unique.length} delegation(s) has a completed watch record, a foreground-return attestation, or external-executor evidence.`
          : observableBackground === 0
            ? `No background delegation is observable in ${unique.length} delegation(s); nothing to check.`
            : `Every one of ${observableBackground} background delegation(s) has a completed watch record or a foreground-return attestation.`
        : `${failures.length} delegation(s) without a usable watch record or foreground-return attestation.`,
    evidence: [...new Set(evidence)],
    details: { require_for: requireFor, delegations: rows, failures },
    observability:
      'A watch record is agent/evidence/<invocation-id>-watch.jsonl, written by `pan watch`, one JSON line per arming (`event: armed`) or wake (`event: wake`, with a terminal_state once the output is present). ' +
      'A delegation counts as background when `pan watch --mark-background` wrote agent/evidence/<invocation-id>-delegation-background.json, when a watch record exists, when an events.jsonl entry for the invocation has a type containing background or watch, or when the delegation-execution record names a background delegation_kind. ' +
      'A submitted stage needs a wake with terminal_state completed, or the foreground-return attestation agent/evidence/<invocation-id>-foreground-return.json written by `pan watch --foreground-returned` with launched_at and returned_at, or the delegation-execution record `pan delegate` writes for an external-executor stage. ' +
      '`pan submit` refuses a Cursor worker submission without one of those records (DELEGATION_UNOBSERVED), so a submitted stage without one predates that rule. ' +
      'A launch the platform backgrounded without any harness record is not observable; set require_for to all to demand a record for every delegation.',
  }
}

// ---------------------------------------------------------------------------
// platform-guidance-conflict-recorded
// ---------------------------------------------------------------------------

const GUIDANCE_MENTION =
  /platform[- ](guidance|instruction|injected)|session[- ]mode|platform-injected/iu

const REDLINE_FILE = 'platform-guidance-redline.json'

export const platformGuidanceConflictRecorded: Grader = (context) => {
  const { records } = context
  const minRecorded = config<number>(context, 'min_recorded', 0)

  const redlineRelative = relativeEvidence(records, 'evidence', REDLINE_FILE)
  const redlineExists = fileExists(path.join(records.root, redlineRelative))

  const advisoryInvocations = new Set(
    (records.state.advisories ?? [])
      .filter((advisory) => advisory.kind === 'platform_guidance')
      .map((advisory) => advisory.invocation_id ?? ''),
  )
  const eventInvocations = new Set(
    records.events
      .filter((event) => /platform_guidance/u.test(event.type))
      .map((event) => String(event.invocation_id ?? '')),
  )

  const evidence: string[] = []
  const failures: string[] = []
  let recorded = 0
  const rows: Record<string, unknown>[] = []

  // The redline is a pre-declaration, not a conflict record. OPERATOR-001:
  // a later conflict with redlined guidance MUST still be recorded. It is
  // reported, never counted toward min_recorded, and never excuses a mention.
  if (redlineExists) {
    evidence.push(redlineRelative)
  }

  for (const record of records.outputs) {
    const conflicts = record.output.platform_guidance_conflicts ?? []
    const mentions = outputStrings(record.output).filter((text) =>
      GUIDANCE_MENTION.test(text),
    )
    const recordedHere =
      conflicts.length > 0 ||
      advisoryInvocations.has(record.invocation_id) ||
      eventInvocations.has(record.invocation_id)

    recorded += conflicts.length

    if (conflicts.length > 0) {
      evidence.push(record.path)
    }

    if (mentions.length > 0 && !recordedHere) {
      failures.push(
        `${record.invocation_id}: ${mentions.length} platform guidance mention(s) in ${record.path} without a platform_guidance_conflicts entry or redline record`,
      )
    }

    rows.push({
      invocation_id: record.invocation_id,
      output: record.path,
      mentions: mentions.length,
      conflicts_recorded: conflicts.length,
      recorded: recordedHere,
    })
  }

  for (const relative of records.decision_paths) {
    try {
      const decision = readJson(path.join(records.root, relative))
      const text = JSON.stringify(decision)

      if (GUIDANCE_MENTION.test(text) && recorded === 0) {
        failures.push(
          `${relative} mentions platform guidance but the run has no conflict record`,
        )
      }
    } catch {
      // A decision that cannot be read cannot mention anything.
    }
  }

  if (recorded < minRecorded) {
    failures.push(
      `${recorded} conflict record(s) found, scenario needs at least ${minRecorded}`,
    )
  }

  return {
    passed: failures.length === 0,
    summary:
      failures.length === 0
        ? `${recorded} platform guidance conflict record(s); every mention is recorded.`
        : `${failures.length} platform guidance conflict(s) mentioned without a record.`,
    evidence,
    details: {
      min_recorded: minRecorded,
      recorded,
      redline_record: redlineExists ? redlineRelative : null,
      outputs: rows,
      failures,
    },
    observability:
      'Records are platform_guidance_conflicts[] entries in a submitted output, platform_guidance advisories in state.json, platform_guidance_conflict events, and agent/evidence/platform-guidance-redline.json. ' +
      'Mentions are matched in output strings and decision records by the phrases platform guidance, platform instruction, platform-injected, and session mode. ' +
      'A conflict the supervisor met in chat and never wrote into a run record is not observable.',
  }
}
