/**
 * Workspace check commands: `technologies`, `conform`, `style`,
 * `repository-check`, and `tests`.
 */

import path from 'node:path'

import { getRunState } from '../lib/engine/run-status.js'
import { PanError } from '../lib/errors.js'
import { configuredWorkspaceRoot } from '../lib/project-config/resolve.js'
import { gitWorkspaceSnapshot } from '../lib/git.js'
import { liveRunsBoundToWorktree } from '../lib/state.js'
import { assertRepositoryChecksValid } from '../lib/repository-checks/config.js'
import {
  agentGatePassSuiteProfile,
  nextAgentGatePassAttempt,
  recordProfileGatePass,
  reusableProfileExecution,
} from '../lib/repository-checks/gate-passes.js'
import {
  assertRepositoryCheckProfileAllowed,
  resolveRepositoryCheckInitiator,
} from '../lib/repository-checks/launch.js'
import {
  recordAgentRepositoryCheck,
  recordAgentRepositoryCheckForRuns,
} from '../lib/repository-checks/ledger.js'
import { repositoryChecksSourcePath } from '../lib/repository-checks/paths.js'
import {
  repositoryCheckWorkspaceRoot,
  runRepositoryCheckStreaming,
} from '../lib/repository-checks/runner.js'
import {
  checkOutputVerbose,
  renderRepositoryCheckSummary,
  repositoryCheckFailingTests,
  writeRepositoryCheckLog,
} from '../lib/check-output.js'
import { TEST_PROFILE_ENV } from '../lib/suite-profile.js'
import {
  appendFastWallRun,
  buildFastWallReport,
  FAST_WALL_AGENT_PHASE,
  FAST_WALL_CALLER_CLASS_ENV,
  FAST_WALL_PHASE_ENV,
  FAST_WALL_RUN_ID_ENV,
  FAST_WALL_SERIES_ROOT_ENV,
  FAST_WALL_STANDALONE_PHASE,
  formatFastWallReport,
} from '../lib/fast-wall-series.js'
import {
  detectObservabilityTools,
  detectWorkspaceTechnologies,
} from '../lib/technologies.js'
import { resolveWorkspacePathOrWorktree } from '../lib/worktrees.js'
import { runTestsImpacted } from '../lib/test-impact/run.js'
import {
  checkpointConformArtifacts,
  scanConformArtifacts,
} from '../lib/conform.js'
import {
  checkpointStyleArtifacts,
  scanStyleArtifacts,
} from '../lib/code-style.js'
import { runBenchmarkSession } from '../lib/test-tuning/benchmark.js'

import type { CliContext } from './context.js'
import {
  hasFlag,
  integerOption,
  option,
  print,
  requiredArgument,
  sharedWorktreeWorkspace,
} from './args.js'

/** `pan technologies`. */
export function technologiesCommand({ root, args }: CliContext): void {
  const subcommand = requiredArgument(args[0], 'technologies subcommand')

  if (subcommand !== 'detect') {
    throw new PanError(`Unknown technologies subcommand: ${subcommand}`, {
      code: 'UNKNOWN_COMMAND',
    })
  }

  const worktreeWorkspace = sharedWorktreeWorkspace(root, args)
  const detectOptions = worktreeWorkspace
    ? { workspace: worktreeWorkspace.path }
    : {}

  print(
    {
      ...detectWorkspaceTechnologies(root, detectOptions),
      observability: detectObservabilityTools(root, detectOptions),
    },
    true,
  )
  return
}

/** `pan conform`. */
export function conformCommand({ root, args }: CliContext): void {
  const subcommand = requiredArgument(args[0], 'conform subcommand')
  const asJson = hasFlag(args, '--json')
  const sinceRef = option(args, '--since')
  const all = hasFlag(args, '--all')

  const worktreeWorkspace = sharedWorktreeWorkspace(root, args)
  const workspaceRoot = path.resolve(
    root,
    worktreeWorkspace?.path ?? configuredWorkspaceRoot(root),
  )

  function formatResultFiles(
    files: Array<{
      editable: boolean
      exists: boolean
      relative_path: string
      issues: Array<{ code: string }>
    }>,
  ): string {
    if (files.length === 0) {
      return 'No eligible conform artifacts were selected.'
    }

    const lines = files.map((file) => {
      const scope = file.editable ? 'editable' : 'report-only'
      const existence = file.exists ? '' : ' (deleted)'
      const issueCount = file.issues.length
      const issueLabel = issueCount === 1 ? '1 issue' : `${issueCount} issues`

      return `- ${scope}: ${file.relative_path}${existence} — ${issueLabel}`
    })

    return lines.join('\n')
  }

  if (subcommand === 'scan') {
    const result = scanConformArtifacts(root, {
      workspace_root: workspaceRoot,
      since_ref: sinceRef,
      all,
    })

    print(
      asJson
        ? result
        : [
            `Conform scan: ${result.status}`,
            `Base: ${result.base}`,
            `Head: ${result.head}`,
            `Files: ${result.summary.files}`,
            '',
            formatResultFiles(result.files),
          ].join('\n'),
      asJson,
    )

    if (result.status !== 'passed') {
      process.exitCode = 1
    }

    return
  }

  if (subcommand === 'checkpoint') {
    const result = checkpointConformArtifacts(root, {
      workspace_root: workspaceRoot,
      since_ref: sinceRef,
      all,
    })

    print(
      asJson
        ? result
        : [
            `Conform checkpoint: ${result.status}`,
            `Head: ${result.head}`,
            `Checkpoint: ${result.checkpoint_path}`,
            `Wrote checkpoint: ${result.wrote_checkpoint ? 'yes' : 'no'}`,
            '',
            formatResultFiles(result.files),
          ].join('\n'),
      asJson,
    )

    if (result.status !== 'passed') {
      process.exitCode = 1
    }

    return
  }

  throw new PanError(`Unknown conform subcommand: ${subcommand}`, {
    code: 'UNKNOWN_COMMAND',
  })
}

/** `pan style`. */
export function styleCommand({ root, args }: CliContext): void {
  const subcommand = requiredArgument(args[0], 'style subcommand')
  const asJson = hasFlag(args, '--json')
  const sinceRef = option(args, '--since')
  const all = hasFlag(args, '--all')

  const worktreeWorkspace = sharedWorktreeWorkspace(root, args)
  const workspaceRoot = path.resolve(
    root,
    worktreeWorkspace?.path ?? configuredWorkspaceRoot(root),
  )

  function formatStyleFiles(
    files: Array<{
      editable: boolean
      exists: boolean
      relative_path: string
      issues: Array<{ code: string }>
    }>,
  ): string {
    if (files.length === 0) {
      return 'No eligible style artifacts were selected.'
    }

    return files
      .map((file) => {
        const scope = file.editable ? 'editable' : 'report-only'
        const existence = file.exists ? '' : ' (deleted)'
        const issueCount = file.issues.length
        const issueLabel = issueCount === 1 ? '1 issue' : `${issueCount} issues`

        return `- ${scope}: ${file.relative_path}${existence} — ${issueLabel}`
      })
      .join('\n')
  }

  if (subcommand === 'scan') {
    const result = scanStyleArtifacts(root, {
      workspace_root: workspaceRoot,
      since_ref: sinceRef,
      all,
    })

    print(
      asJson
        ? result
        : [
            `Style scan: ${result.status}`,
            `Languages: ${result.languages.join(', ') || 'none detected'}`,
            `Base: ${result.base}`,
            `Head: ${result.head}`,
            `Files: ${result.summary.files}`,
            '',
            formatStyleFiles(result.files),
          ].join('\n'),
      asJson,
    )

    if (result.status !== 'passed') {
      process.exitCode = 1
    }

    return
  }

  if (subcommand === 'checkpoint') {
    const result = checkpointStyleArtifacts(root, {
      workspace_root: workspaceRoot,
      since_ref: sinceRef,
      all,
    })

    print(
      asJson
        ? result
        : [
            `Style checkpoint: ${result.status}`,
            `Head: ${result.head}`,
            `Checkpoint: ${result.checkpoint_path}`,
            `Wrote checkpoint: ${result.wrote_checkpoint ? 'yes' : 'no'}`,
            '',
            formatStyleFiles(result.files),
          ].join('\n'),
      asJson,
    )

    if (result.status !== 'passed') {
      process.exitCode = 1
    }

    return
  }

  throw new PanError(`Unknown style subcommand: ${subcommand}`, {
    code: 'UNKNOWN_COMMAND',
  })
}

/** `pan repository-check`. */
export async function repositoryCheckCommand({
  root,
  args,
}: CliContext): Promise<void> {
  const profile = requiredArgument(args[0], 'profile')

  if (profile === 'validate') {
    const config = assertRepositoryChecksValid(root)

    print(
      {
        status: 'valid',
        config_path: path
          .relative(root, repositoryChecksSourcePath(root))
          .split(path.sep)
          .join('/'),
        profiles: Object.keys(config.profiles).sort(),
      },
      hasFlag(args, '--json'),
    )
    return
  }

  const timeoutValue = option(args, '--timeout-ms')
  let timeoutMs: number | undefined

  if (timeoutValue !== null) {
    const parsedTimeout = Number(timeoutValue)

    if (!Number.isInteger(parsedTimeout) || parsedTimeout < 1_000) {
      throw new PanError('--timeout-ms MUST be an integer of at least 1000.', {
        code: 'INVALID_ARGUMENT',
      })
    }

    timeoutMs = parsedTimeout
  }

  const workspaceOption = option(args, '--workspace')

  if (workspaceOption && hasFlag(args, '--worktree')) {
    throw new PanError('--workspace and --worktree cannot be used together.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  // `--run` names the run the execution is evidence for, which a run
  // whose workspace is not a managed worktree (a release run in the base
  // checkout) cannot express through `--worktree`.
  const evidenceRunId = option(args, '--run')
  const evidenceRun = evidenceRunId ? getRunState(root, evidenceRunId) : null
  const worktreeWorkspace = sharedWorktreeWorkspace(root, args)
  const checkWorkspace = worktreeWorkspace
    ? worktreeWorkspace.path
    : workspaceOption
      ? resolveWorkspacePathOrWorktree(root, workspaceOption)
      : evidenceRun
        ? path.resolve(root, evidenceRun.workspace_root)
        : null

  // The harness starts this command for itself when it prefetches the
  // release profile, and that execution is not an agent spending its
  // allowance. It also has no terminal to stream to. Authority for the
  // claim comes from the launch token the harness put in this process's
  // environment rather than from argv, because a caller that grades its
  // own permission is not one.
  const initiator = resolveRepositoryCheckInitiator(
    root,
    evidenceRun?.run_id ?? null,
    hasFlag(args, '--harness-initiated'),
  )
  const harnessInitiated = initiator === 'harness'
  // Two evidence workers of one stage share an invocation id, so without
  // the role they would share one reuse key and the second worker would
  // be handed the first one's pass instead of producing its own log.
  const workerRole = option(args, '--role')

  const callerStages = evidenceRun
    ? [evidenceRun.current_stage]
    : worktreeWorkspace
      ? liveRunsBoundToWorktree(root, worktreeWorkspace.name).map(
          (bound) => bound.current_stage,
        )
      : [null]

  for (const callerStage of callerStages) {
    assertRepositoryCheckProfileAllowed(profile, callerStage, initiator)
  }

  const startedAt = new Date().toISOString()

  // DEV-001: a clean pass reaches a later gate only when the workspace
  // never moved, so the run is bracketed by the fingerprint the gate
  // itself would compare.
  const fingerprintBefore = gitWorkspaceSnapshot(
    repositoryCheckWorkspaceRoot(root, checkWorkspace ?? undefined),
  ).fingerprint
  // HR3-006: the run already paid for this profile at this fingerprint
  // under this invocation, and the ledger says so. Executing again buys
  // nothing, so the recorded pass answers the request. The harness
  // prefetch keeps executing: it exists to fill an empty cache.
  const forceRepeat = hasFlag(args, '--force-repeat')
  const reusable =
    evidenceRun && !forceRepeat && !harnessInitiated
      ? reusableProfileExecution(
          root,
          evidenceRun.run_id,
          evidenceRun.current_invocation?.id ?? null,
          profile,
          fingerprintBefore,
          workerRole,
        )
      : null

  const asJson = hasFlag(args, '--json')

  if (reusable) {
    process.stderr.write(
      `[repository-check:${profile}] reusing the pass recorded at ` +
        `${reusable.started_at} for invocation ` +
        `${reusable.invocation_id ?? '(none)'}; pass --force-repeat to ` +
        'execute the profile again.\n',
    )
    print(
      asJson
        ? {
            profile,
            status: 'passed',
            reused_execution: reusable,
          }
        : `[repository-check:${profile}] passed: reused the recorded pass` +
            (reusable.evidence_log ? ` (log: ${reusable.evidence_log})` : ''),
      asJson,
    )
    return
  }

  // A pass this command stores is reused by a later gate instead of
  // re-running the suite, so the execution writes the same profile that
  // gate would have written. Only a named run has a place to put it.
  // One ordinal for both artifacts this execution owns, resolved before
  // the run so a second permitted execution at the same fingerprint
  // cannot be handed the first one's log name.
  const gatePassAttempt = evidenceRun
    ? nextAgentGatePassAttempt(
        root,
        evidenceRun.run_id,
        profile,
        fingerprintBefore,
      )
    : 1
  const gatePassSuiteProfile = evidenceRun
    ? agentGatePassSuiteProfile(
        root,
        evidenceRun.run_id,
        profile,
        fingerprintBefore,
        gatePassAttempt,
      )
    : null
  const result = await runRepositoryCheckStreaming(root, profile, {
    ...(timeoutMs !== undefined ? { timeout_ms: timeoutMs } : {}),
    ...(checkWorkspace ? { workspace: checkWorkspace } : {}),
    env: {
      [FAST_WALL_SERIES_ROOT_ENV]: root,
      [FAST_WALL_PHASE_ENV]: FAST_WALL_AGENT_PHASE,
      [FAST_WALL_CALLER_CLASS_ENV]: harnessInitiated
        ? 'prefetch'
        : evidenceRun
          ? 'agent'
          : 'standalone',
      ...(evidenceRun ? { [FAST_WALL_RUN_ID_ENV]: evidenceRun.run_id } : {}),
      ...(gatePassSuiteProfile
        ? { [TEST_PROFILE_ENV]: gatePassSuiteProfile.absolute }
        : {}),
    },
    // The start line keeps a long wait visible. Command output stays in
    // the log this execution writes unless the caller asks to stream it.
    ...(harnessInitiated
      ? {}
      : {
          on_start: (kind, commandText) => {
            process.stderr.write(
              `[repository-check:${profile}] ${kind}: ${commandText}\n`,
            )
          },
          ...(checkOutputVerbose(args)
            ? {
                on_stdout: (chunk: string) => process.stderr.write(chunk),
                on_stderr: (chunk: string) => process.stderr.write(chunk),
              }
            : {}),
        }),
  })

  if (result.status === 'not_configured') {
    process.stderr.write('PANCREATOR_CHECK_SKIPPED=1\n')
  }

  // Every execution keeps its complete output, so a summary that shows
  // only the failing tests always names where the rest is.
  const logPath =
    result.status === 'not_configured'
      ? null
      : writeRepositoryCheckLog(
          root,
          result,
          startedAt,
          `pan repository-check ${profile}`,
        )

  // A worker runs a profile inside its run's worktree, and the run is the
  // only place a supervisor can audit that execution from harness records.
  // An explicit run wins over the worktree scan. A bare invocation names
  // no run and records nothing: an operator's own check from the base
  // checkout is not evidence of any run that happens to share it.
  // Only a clean pass can reach a gate, so the run lookup a store needs
  // is spent only when one is possible.
  const gatePassRunIds =
    result.status === 'passed'
      ? evidenceRun
        ? [evidenceRun.run_id]
        : worktreeWorkspace
          ? liveRunsBoundToWorktree(root, worktreeWorkspace.name).map(
              (bound) => bound.run_id,
            )
          : []
      : []
  // The store resolves the log this execution owns, so it runs before the
  // ledger entry that must name that log.
  const gatePass = recordProfileGatePass(root, profile, result, {
    run_ids: gatePassRunIds,
    fingerprint_before: fingerprintBefore,
    started_at: startedAt,
    attempt: gatePassAttempt,
    initiator,
  })
  const runEvidence = evidenceRun
    ? recordAgentRepositoryCheckForRuns(
        root,
        [evidenceRun.run_id],
        result,
        startedAt,
        initiator,
        gatePass?.evidence_path ?? null,
        forceRepeat,
        workerRole,
      )
    : worktreeWorkspace
      ? recordAgentRepositoryCheck(
          root,
          worktreeWorkspace.name,
          result,
          startedAt,
          initiator,
        )
      : []

  print(
    asJson || harnessInitiated
      ? {
          ...result,
          ...(runEvidence.length > 0
            ? { run_evidence_paths: runEvidence }
            : {}),
          ...(gatePass
            ? { gate_pass_evidence_path: gatePass.evidence_path }
            : {}),
          log_path: logPath,
          failing_tests: repositoryCheckFailingTests(result),
        }
      : // The gate-pass evidence is the durable record a worker cites;
        // the summary log is retention-bound scratch.
        renderRepositoryCheckSummary(result, logPath) +
          (gatePass ? `\nevidence: ${gatePass.evidence_path}` : ''),
    asJson,
  )

  if (result.status === 'failed') {
    process.exitCode = 1
  }
  return
}

/** `pan tests`. */
export async function testsCommand({ root, args }: CliContext): Promise<void> {
  const sub = args[0]

  if (sub === 'benchmark') {
    const populationTolerance = integerOption(args, '--population-tolerance')

    if (populationTolerance === null || populationTolerance < 0) {
      throw new PanError(
        '--population-tolerance is required and MUST be a non-negative integer.',
        { code: 'INVALID_ARGUMENT' },
      )
    }

    const benchmark = runBenchmarkSession({
      root,
      baseline_workspace: requiredArgument(
        option(args, '--baseline-workspace'),
        '--baseline-workspace',
      ),
      candidate_workspace: requiredArgument(
        option(args, '--candidate-workspace'),
        '--candidate-workspace',
      ),
      population_tolerance: populationTolerance,
      ...(option(args, '--profile')
        ? { profile: option(args, '--profile') as string }
        : {}),
      ...(option(args, '--output')
        ? { output_path: option(args, '--output') as string }
        : {}),
    })

    print(benchmark, hasFlag(args, '--json'))

    if (benchmark.record.comparison.status === 'refused') {
      process.exitCode = 1
    }
    return
  }

  if (sub === 'wall') {
    const report = buildFastWallReport(root)

    print(hasFlag(args, '--json') ? report : formatFastWallReport(report))
    return
  }

  if (sub === 'record-fast-wall') {
    const loadAverage = Number(
      requiredArgument(option(args, '--load-average'), '--load-average'),
    )
    const wrapperWall = Number(
      requiredArgument(option(args, '--wrapper-wall-ms'), '--wrapper-wall-ms'),
    )

    appendFastWallRun({
      series_root: requiredArgument(
        option(args, '--series-root'),
        '--series-root',
      ),
      workspace_fingerprint: gitWorkspaceSnapshot(
        requiredArgument(option(args, '--workspace-root'), '--workspace-root'),
      ).fingerprint,
      duration_record_path: requiredArgument(
        option(args, '--duration-record'),
        '--duration-record',
      ),
      worker_count:
        integerOption(args, '--worker-count') ??
        (() => {
          throw new PanError('--worker-count is required.', {
            code: 'INVALID_ARGUMENT',
          })
        })(),
      load_average: loadAverage,
      cpu_count:
        integerOption(args, '--cpu-count') ??
        (() => {
          throw new PanError('--cpu-count is required.', {
            code: 'INVALID_ARGUMENT',
          })
        })(),
      caller_class: requiredArgument(
        option(args, '--caller-class') ??
          process.env[FAST_WALL_CALLER_CLASS_ENV],
        '--caller-class',
      ) as 'agent' | 'harness_gate' | 'prefetch' | 'standalone',
      wrapper_wall_clock_ms: wrapperWall,
      invoker: requiredArgument(option(args, '--invoker'), '--invoker'),
      run_id:
        option(args, '--run-id') ??
        process.env[FAST_WALL_RUN_ID_ENV] ??
        'standalone',
      phase:
        option(args, '--phase') ??
        process.env[FAST_WALL_PHASE_ENV] ??
        FAST_WALL_STANDALONE_PHASE,
      exit_code:
        integerOption(args, '--exit-code') ??
        (() => {
          throw new PanError('--exit-code is required.', {
            code: 'INVALID_ARGUMENT',
          })
        })(),
    })
    return
  }

  if (sub === 'impacted') {
    const worktree = sharedWorktreeWorkspace(root, args)
    const impact = await runTestsImpacted(root, args.slice(1), {
      ...(worktree ? { workspace: path.resolve(root, worktree.path) } : {}),
    })

    process.exitCode = impact.exit_code
    return
  }

  throw new PanError(`Unknown tests subcommand: ${sub ?? '(missing)'}`, {
    code: 'UNKNOWN_COMMAND',
  })
}
