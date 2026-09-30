/**
 * Stage worker commands: `context`, `pr-description`, `output`,
 * `assessment`, `spotfix`, and `worker`.
 */

import { rmSync } from 'node:fs'
import path from 'node:path'

import {
  describeDelegatedWorkers,
  recordDelegatedWorker,
  type DelegatedWorkerPathState,
} from '../lib/engine/delegated-workers.js'
import {
  outputValidateScratchPath,
  validateOutputForSubmission,
} from '../lib/engine/output-validation.js'
import { getRunState } from '../lib/engine/run-status.js'
import { materializeOutputSubmission } from '../lib/engine/submit-helpers.js'
import { PanError } from '../lib/errors.js'
import { configuredWorkspaceRoot } from '../lib/project-config/resolve.js'
import { resolvePolicies } from '../lib/policies.js'
import { renderRunInvocationCard } from '../lib/context-card.js'
import { resolvePrDescriptionContext } from '../lib/pr-description.js'
import {
  isFile,
  isRecord,
  readJson,
  readText,
  referenceContentSha256,
  resolveInside,
  writeJsonAtomic,
  writeTextAtomic,
} from '../lib/io.js'
import type { Invocation } from '../lib/types/invocation.js'
import type { ResolvedRequirement } from '../lib/types/requirements.js'
import type { DelegatedWorkerRecord } from '../lib/types/run-records.js'
import { loadRegistry } from '../lib/requirements/registry.js'
import {
  inferTargetKind,
  isPassingResult,
  registryAppliesToStage,
  resolveRequirementTargetPath,
  runRequirement,
} from '../lib/requirements/run.js'
import {
  readInvocationFromPath,
  scaffoldAssessment,
  scaffoldStageOutput,
} from '../lib/requirements/scaffold.js'
import { agentRepositoryCheckAdvisories } from '../lib/repository-checks/ledger.js'
import {
  formatWorkerProfileReport,
  generateWorkerProfileReport,
} from '../lib/worker-profile/report.js'

import type { CliContext } from './context.js'
import {
  hasFlag,
  integerOption,
  option,
  print,
  requiredArgument,
  requiredPositional,
  sharedWorktreeWorkspace,
} from './args.js'

function parseWorkerLaunchMode(
  value: string | null,
): DelegatedWorkerRecord['launch_mode'] {
  if (value === null) {
    return 'unknown'
  }

  if (value !== 'foreground' && value !== 'background') {
    throw new PanError(
      `--launch-mode MUST be 'foreground' or 'background', not '${value}'.`,
      { code: 'INVALID_ARGUMENT' },
    )
  }

  return value
}

/**
 * One declared path of a delegated worker, for the plain-text report.
 *
 * Every declared path is named, including one nobody has written, because a
 * missing report is the fact the supervisor came for. The producer is named
 * with it so a harness-written brief never reads as the worker's own output.
 */
function declaredPathState(item: DelegatedWorkerPathState): string {
  const producer = item.producer === 'harness' ? ' (harness-written)' : ''

  return item.exists
    ? `${item.path} ${item.size} bytes at ${item.modified_at}${producer}`
    : `${item.path} not written${producer}`
}

/** One required argument of a multi-argument command surface. */
interface RequiredArgument<Name extends string> {
  name: Name
  value: string | null | undefined
  /** A flag in a positional slot is a missing positional, never a value. */
  positional?: boolean
}

/**
 * Resolve every required argument of one command surface together.
 *
 * Validating each argument where it is read makes the first missing one throw
 * before the second is examined, so an operator discovers a three-argument
 * shape one failed call at a time. Collecting them reports the whole defect
 * on the first call.
 */
function requiredArguments<Name extends string>(
  entries: ReadonlyArray<RequiredArgument<Name>>,
): Record<Name, string> {
  const resolved = {} as Record<Name, string>
  const missing: string[] = []

  for (const entry of entries) {
    const usable =
      entry.value && !(entry.positional && entry.value.startsWith('--'))

    if (!usable) {
      missing.push(entry.name)
      continue
    }

    resolved[entry.name] = entry.value as string
  }

  if (missing.length > 0) {
    throw new PanError(
      `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required.`,
      { code: 'INVALID_ARGUMENT', details: { missing } },
    )
  }

  return resolved
}

/**
 * The requirements `pan output validate` runs before submission.
 *
 * Selection is by side-effect freedom, not by executor. The executor field
 * keeps a state-mutating validator out of an agent's hands, which is right
 * for a validator that costs a gate; it is wrong for a deterministic
 * read-only one. Filtering by executor made the claims validator — the check
 * this command exists to catch, and a harness-executor entry that declares
 * both `deterministic` and `side_effect_free` — unreachable by construction,
 * so a mechanical claim defect consumed a stage attempt behind a passing
 * suite. A requirement whose registry entry declares either property false
 * still stays out, whatever its executor.
 *
 * Exported so a test can hold the selection to the registry rather than to
 * the command's own prose.
 */
export function preSubmitRequirements(
  root: string,
  invocation: Invocation,
): ResolvedRequirement[] {
  const catalog = loadRegistry(root)

  return [
    ...(invocation.requirements?.validation_requirements ?? []),
    ...(invocation.requirements?.automation_requirements ?? []),
  ].filter((item) => {
    if (
      (item.phase !== 'pre_submit' && item.phase !== 'before_operation') ||
      item.enforcement === 'advisory'
    ) {
      return false
    }

    const entry = catalog.entries.get(item.registry_id)

    return entry?.deterministic === true && entry.side_effect_free === true
  })
}

function runAgentPreSubmitValidators(
  root: string,
  runId: string,
  invocation: Record<string, unknown>,
  requirements: ResolvedRequirement[],
  filePath: string,
  submittedValue: Record<string, unknown>,
): Array<{
  requirement: ResolvedRequirement
  result: ReturnType<typeof runRequirement>
}> {
  const catalog = loadRegistry(root)
  const stageSlug =
    isRecord(invocation.stage) && typeof invocation.stage.slug === 'string'
      ? invocation.stage.slug
      : ''
  const declaredOutputPath =
    isRecord(invocation.output) && typeof invocation.output.path === 'string'
      ? invocation.output.path
      : null

  return requirements.flatMap((requirement) => {
    const entry = catalog.entries.get(requirement.registry_id)

    if (!entry) {
      return []
    }

    if (requirement.registry_id.includes('ASSESSMENT')) {
      return []
    }

    if (!registryAppliesToStage(requirement.registry_id, stageSlug)) {
      return []
    }

    const resolvedTargetPath = resolveRequirementTargetPath(
      requirement,
      filePath,
      {
        ...submittedValue,
        ...(isRecord(invocation.output) &&
        isRecord(invocation.output.artifact_targets)
          ? { artifact_targets: invocation.output.artifact_targets }
          : {}),
      },
    )
    const targetPath =
      resolvedTargetPath === declaredOutputPath ? filePath : resolvedTargetPath

    if (!targetPath) {
      return [
        {
          requirement,
          result: {
            schema_version: 1 as const,
            requirement_id: requirement.requirement_id,
            policy_id: requirement.policy_id,
            registry_id: requirement.registry_id,
            registry_version: requirement.registry_version,
            handler: 'unresolved-target',
            command: `pan output validate --registry ${requirement.registry_id}`,
            target_path: requirement.target,
            started_at: new Date().toISOString(),
            finished_at: new Date().toISOString(),
            exit_code: 1,
            status: 'failed' as const,
            executor: 'agent' as const,
            issues: [
              {
                code: 'target.unresolved',
                message: `Could not resolve target ${requirement.target}`,
              },
            ],
            evidence_paths: [],
          },
        },
      ]
    }

    const targetKind = inferTargetKind(targetPath)

    if (!entry.target_types.includes(targetKind)) {
      return []
    }

    return [
      {
        requirement,
        result: runRequirement({
          root,
          runId,
          requirement,
          targetPath,
          executor: 'agent',
          invocation,
          runState: getRunState(root, runId) as unknown as Record<
            string,
            unknown
          >,
          catalog,
          persist: true,
        }),
      },
    ]
  })
}

/** `pan context`. */
export function contextCommand({ root, args }: CliContext): void {
  const sub = args[0]

  if (sub === 'digest') {
    const relativePath = requiredPositional(args[1], 'repo-relative-file')
    const absolute = resolveInside(root, relativePath)

    // A directory exists but has no content to digest; naming the
    // repo-relative path keeps the absolute root out of the message.
    if (!isFile(absolute)) {
      throw new PanError(`File does not exist: ${relativePath}`, {
        code: 'CONTEXT_REFERENCE_NOT_FOUND',
        details: { path: relativePath },
      })
    }

    const digest = referenceContentSha256(readText(absolute))

    print(
      hasFlag(args, '--json')
        ? {
            source_path: relativePath,
            content_sha256: digest,
            basis:
              'sha256 of the text after leading and trailing whitespace is trimmed',
          }
        : digest,
      hasFlag(args, '--json'),
    )
    return
  }

  if (sub === 'card') {
    const runId = requiredPositional(args[1], 'run-id')
    const card = renderRunInvocationCard(
      root,
      runId,
      option(args, '--invocation') ?? undefined,
    )

    print(
      hasFlag(args, '--json') ? card : card.markdown,
      hasFlag(args, '--json'),
    )
    return
  }

  throw new PanError(`Unknown context subcommand: ${sub ?? '(missing)'}`, {
    code: 'UNKNOWN_COMMAND',
  })
}

/** `pan pr-description`. */
export function prDescriptionCommand({ root, args }: CliContext): void {
  const sub = args[0]

  if (sub === 'context') {
    const worktreeWorkspace = sharedWorktreeWorkspace(root, args)
    const workspaceRoot = path.resolve(
      root,
      worktreeWorkspace?.path ?? configuredWorkspaceRoot(root),
    )
    const policies = resolvePolicies(root, {
      persona: 'release-steward',
      workflow: 'standalone',
      stage: 'write-pr',
      operator_artifacts: 'requested',
    })

    print(
      resolvePrDescriptionContext(workspaceRoot, policies),
      hasFlag(args, '--json'),
    )
    return
  }

  throw new PanError(
    `Unknown pr-description subcommand: ${sub ?? '(missing)'}`,
    { code: 'UNKNOWN_COMMAND' },
  )
}

/** `pan output`. */
export function outputCommand({ root, args }: CliContext): void {
  const sub = args[0]

  if (sub === 'scaffold') {
    requiredArgument(args[1], 'run-id')
    const invocationPath = requiredArgument(
      option(args, '--invocation'),
      '--invocation',
    )
    const outputPath = requiredArgument(option(args, '--output'), '--output')
    const invocation = readInvocationFromPath(root, invocationPath)
    print(
      scaffoldStageOutput(
        root,
        invocation,
        outputPath,
        hasFlag(args, '--force'),
      ),
      true,
    )
    return
  }

  if (sub === 'validate') {
    // Three arguments, each knowable on the first call. `--run` exists so
    // a flag in the positional slot cannot be read as a run id.
    const {
      'run-id': runId,
      '--file': filePath,
      '--invocation': invocationPath,
    } = requiredArguments([
      {
        name: 'run-id' as const,
        value: option(args, '--run') ?? args[1],
        positional: true,
      },
      { name: '--file' as const, value: option(args, '--file') },
      {
        name: '--invocation' as const,
        value: option(args, '--invocation'),
      },
    ])
    const invocation = readInvocationFromPath(root, invocationPath)
    const submittedValue = readJson(resolveInside(root, filePath))
    const materialized = materializeOutputSubmission(
      root,
      getRunState(root, runId),
      submittedValue,
      invocation.invocation_id,
    )

    const effectiveValue = materialized.value
    const effectiveRecord = isRecord(effectiveValue) ? effectiveValue : {}
    const scratchPath =
      materialized.revisedFrom === undefined
        ? null
        : outputValidateScratchPath(
            runId,
            invocation.output.path,
            'output-validate',
          )
    const effectivePath = scratchPath ?? filePath

    if (scratchPath !== null) {
      writeJsonAtomic(resolveInside(root, scratchPath), effectiveValue)
    }

    const agentRequirements = preSubmitRequirements(root, invocation)

    let submission: ReturnType<typeof validateOutputForSubmission>
    let results: ReturnType<typeof runAgentPreSubmitValidators>

    try {
      // Always run the submission mirror. A mechanical defect that reaches
      // submit time consumes a stage attempt.
      submission = validateOutputForSubmission(
        root,
        runId,
        invocation,
        effectiveValue,
        { submittedPath: effectivePath },
      )
      results =
        agentRequirements.length === 0
          ? []
          : runAgentPreSubmitValidators(
              root,
              runId,
              invocation as unknown as Record<string, unknown>,
              agentRequirements,
              effectivePath,
              effectiveRecord,
            )
    } finally {
      if (scratchPath !== null) {
        rmSync(path.dirname(resolveInside(root, scratchPath)), {
          recursive: true,
          force: true,
        })
      }
    }
    const passed =
      submission.passed && results.every((item) => isPassingResult(item.result))
    // Advisory only: a repeated agent-run `fast` profile is reported by
    // name for the supervisor's audit and never fails the validation.
    const advisories = agentRepositoryCheckAdvisories(
      root,
      runId,
      invocation.invocation_id,
    )

    print(
      hasFlag(args, '--json')
        ? {
            passed,
            submission_checks: submission.checks,
            results,
            advisories,
          }
        : [
            ...submission.checks
              .filter(
                (check) => !check.passed && !check.id.startsWith('validator.'),
              )
              .map((check) => `${check.id}: FAIL ${check.message}`),
            ...submission.checks
              .filter((check) => check.id.startsWith('validator.'))
              .map(
                (check) =>
                  `${check.id}: ${check.passed ? 'PASS' : 'FAIL'} ` +
                  check.message,
              ),
            `submission checks: ${
              submission.passed
                ? `pass (${submission.checks.length} checks)`
                : 'fail'
            }`,
            ...results.map(
              (item) =>
                `${item.requirement.registry_id}: ${item.result.status}`,
            ),
            ...advisories.map((item) => `advisory ${item.id}: ${item.message}`),
          ].join('\n'),
      hasFlag(args, '--json'),
    )

    if (!passed) {
      process.exitCode = 1
    }

    return
  }

  throw new PanError(`Unknown output subcommand: ${sub ?? '(missing)'}`, {
    code: 'UNKNOWN_COMMAND',
  })
}

/** `pan assessment`. */
export function assessmentCommand({ root, args }: CliContext): void {
  const sub = args[0]

  if (sub === 'scaffold') {
    const invocationPath = requiredArgument(
      option(args, '--invocation'),
      '--invocation',
    )
    const outputPath = requiredArgument(option(args, '--output'), '--output')
    const invocation = readInvocationFromPath(root, invocationPath)

    print(
      scaffoldAssessment(
        root,
        invocation.invocation_id,
        outputPath,
        invocation.rubric.map((item) => item.id),
        hasFlag(args, '--force'),
      ),
      true,
    )
    return
  }

  throw new PanError(`Unknown assessment subcommand: ${sub ?? '(missing)'}`, {
    code: 'UNKNOWN_COMMAND',
  })
}

/** `pan spotfix`. */
export function spotfixCommand({ root, args }: CliContext): void {
  const sub = args[0]

  if (sub === 'scaffold-escalation') {
    const inputPath = requiredArgument(option(args, '--input'), '--input')
    const outputPath = requiredArgument(option(args, '--output'), '--output')
    const content = readText(resolveInside(root, inputPath))
    writeTextAtomic(
      resolveInside(root, outputPath),
      `# Escalation\n\n${content}\n`,
    )
    print({ path: outputPath, status: 'scaffolded' }, true)
    return
  }

  throw new PanError(`Unknown spotfix subcommand: ${sub ?? '(missing)'}`, {
    code: 'UNKNOWN_COMMAND',
  })
}

/** `pan worker`. */
export function workerCommand({ root, args, json }: CliContext): void {
  const subcommand = requiredArgument(args[0], 'worker subcommand')

  if (subcommand === 'profile') {
    const days = integerOption(args, '--days')
    const report = generateWorkerProfileReport(root, {
      ...(days === null ? {} : { days }),
    })

    print(json ? report : formatWorkerProfileReport(report), json)
    return
  }

  const runId = requiredArgument(args[1], 'run-id')
  const invocationId = option(args, '--invocation')
  const role = option(args, '--role')

  if (subcommand === 'record') {
    const agent = option(args, '--agent')
    const model = option(args, '--model')
    const launch = recordDelegatedWorker(root, runId, {
      handle: requiredArgument(option(args, '--handle'), '--handle'),
      ...(invocationId ? { invocationId } : {}),
      ...(role ? { role } : {}),
      ...(agent ? { agent } : {}),
      ...(model ? { model } : {}),
      launchMode: parseWorkerLaunchMode(option(args, '--launch-mode')),
      ...(hasFlag(args, '--new-attempt') ? { newAttempt: true } : {}),
    })

    print(
      json
        ? launch
        : `worker recorded: ${launch.record.role} attempt ` +
            `${launch.record.attempt} of invocation ` +
            `${launch.record.invocation_id}, handle ${launch.record.handle}` +
            (launch.evidence_attempt
              ? `, brief ${launch.evidence_attempt.brief_path}, evidence ` +
                `${launch.evidence_attempt.evidence_path}`
              : '') +
            (launch.warnings?.length
              ? `\nWarning: ${launch.warnings.join('\nWarning: ')}`
              : ''),
      json,
    )
    return
  }

  if (subcommand === 'state') {
    const workers = describeDelegatedWorkers(root, runId, {
      ...(invocationId ? { invocationId } : {}),
      ...(role ? { role } : {}),
    })

    print(
      json
        ? { run_id: runId, workers }
        : workers.length === 0
          ? `No delegated worker is recorded for run ${runId}. A launch ` +
            `records one with 'pan worker record'.`
          : workers
              .map(
                (worker) =>
                  `${worker.role} attempt ${worker.attempt} of ` +
                  `${worker.invocation_id}: handle ${worker.handle}, ` +
                  `launched ${worker.launched_at} ` +
                  `(${worker.seconds_since_launch.toFixed(0)}s ago), ` +
                  (worker.wrote_nothing ? 'wrote nothing yet' : 'has written') +
                  (worker.evidence_ready ? ', evidence ready' : '') +
                  `: ${worker.declared_paths.map(declaredPathState).join('; ')}`,
              )
              .join('\n'),
      json,
    )
    return
  }

  throw new PanError(`Unknown worker subcommand: ${subcommand}`, {
    code: 'UNKNOWN_COMMAND',
  })
}
