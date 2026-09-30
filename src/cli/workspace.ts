/**
 * Workspace and runtime state commands: `worktree`, `status`, `list`,
 * `installs`, `inbox`, `observations`, `archive`, `quality`, `spend`,
 * and `cleanup`.
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { getRunStatus } from '../lib/engine/run-status.js'
import { invariant, PanError } from '../lib/errors.js'
import { harnessConfigName } from '../lib/project-config/files.js'
import { resolveRetentionDays } from '../lib/project-config/resolve.js'
import { registryHealthForRun } from '../lib/hypervisor.js'
import { listInbox, renderInbox, restoreInboxRequest } from '../lib/inbox.js'
import {
  listObservations,
  renderObservations,
  resolveObservation,
} from '../lib/observations.js'
import {
  archiveInstallationInboxItems,
  describeInstallations,
} from '../lib/installations.js'
import { fileExists, isRecord, readJson } from '../lib/io.js'
import type { RunState } from '../lib/types/run-state.js'
import { resolveRunLayout } from '../lib/run-layout.js'
import { resolveRunCitation } from '../lib/workflow-artifacts/aliases.js'
import { maintainWorkflowRuntime } from '../lib/workflow-artifacts/maintenance.js'
import { applyCleanup, planCleanup } from '../lib/cleanup.js'
import { generateTokenSpendReport } from '../lib/token-spend/report.js'
import { reportMultiInstanceSpend } from '../lib/spend-sync/report.js'
import { syncSpend } from '../lib/spend-sync/sync.js'
import { runDailyQuality } from '../lib/daily-quality.js'
import { writeSpendCanvas } from '../lib/spend-canvas.js'
import { writeRedlineRecord } from '../lib/watch/redline.js'
import {
  createWorktree,
  listWorktrees,
  readWorktreeIndex,
  reconcileWorktrees,
  removeWorktree,
  resolveOrCreateWorktree,
} from '../lib/worktrees.js'

import type { CliContext } from './context.js'
import {
  hasFlag,
  integerOption,
  noteOption,
  option,
  options,
  print,
  repeatedOption,
  requiredArgument,
  requiredPositional,
} from './args.js'

function parseRunState(value: unknown, source: string): RunState {
  if (
    !isRecord(value) ||
    typeof value.run_id !== 'string' ||
    typeof value.status !== 'string'
  ) {
    throw new PanError(`${source} does not contain a valid run state.`, {
      code: 'INVALID_STATE',
    })
  }

  return value as unknown as RunState
}

function listRuns(root: string): Array<Record<string, unknown>> {
  const base = path.join(root, 'runtime', 'logs', 'workflows')

  if (!fileExists(base)) {
    return []
  }

  return readdirSync(base, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fileExists(resolveRunLayout(root, entry.name).state.absolute),
    )
    .map((entry) => {
      const statePath = resolveRunLayout(root, entry.name).state.absolute

      return parseRunState(readJson(statePath), statePath)
    })
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .map((state) => ({
      ...(() => {
        const health = registryHealthForRun(
          root,
          state.run_id,
          state.current_invocation?.id,
        )

        return {
          agent_health: health?.health ?? 'unknown',
          health_evidence_at: health?.evidence_at ?? null,
          recovery_state: health?.recovery.step ?? null,
        }
      })(),
      run_id: state.run_id,
      title: state.title,
      status: state.status,
      stage: state.current_stage,
      pending_action: state.pending_action.type,
      updated_at: state.updated_at,
    }))
}

/** `pan worktree`. */
export function worktreeCommand({ root, args }: CliContext): void {
  const sub = args[0]
  const rest = args.slice(1)
  const asJson = hasFlag(args, '--json')

  if (sub === 'create') {
    const worktree = createWorktree(
      root,
      requiredArgument(rest[0], 'worktree-name'),
      {
        from: option(args, '--from'),
        description: option(args, '--description'),
      },
    )

    print({ status: 'created', worktree }, asJson)
    return
  }

  if (sub === 'resolve') {
    const name = requiredArgument(rest[0], 'worktree-name')
    const created = !readWorktreeIndex(root).worktrees.some(
      (entry) => entry.name === name,
    )
    const worktree = resolveOrCreateWorktree(
      root,
      name,
      option(args, '--description') ?? `Worktree '${name}'`,
    )

    print({ status: 'resolved', created, worktree }, asJson)
    return
  }

  if (sub === 'list') {
    print({ status: 'listed', worktrees: listWorktrees(root) }, asJson)
    return
  }

  if (sub === 'remove') {
    const removed = removeWorktree(
      root,
      requiredArgument(rest[0], 'worktree-name'),
      {
        force: hasFlag(args, '--force'),
        deleteBranch: hasFlag(args, '--delete-branch'),
      },
    )

    print({ status: 'removed', worktree: removed }, asJson)
    return
  }

  if (sub === 'reconcile') {
    const result = reconcileWorktrees(
      root,
      {
        into: option(args, '--into'),
        into_branch: option(args, '--into-branch'),
      },
      repeatedOption(args, '--source'),
    )

    print(result, asJson)

    if (result.status === 'conflict') {
      process.exitCode = 1
    }
    return
  }

  throw new PanError(`Unknown worktree subcommand: ${sub ?? '(missing)'}`, {
    code: 'UNKNOWN_COMMAND',
  })
}

/** `pan status`. */
export function statusCommand({ root, args, json }: CliContext): void {
  const runId = requiredArgument(args[0], 'run-id')
  const citation = option(args, '--resolve')

  if (citation !== null) {
    const resolution = resolveRunCitation(root, runId, citation)

    print(
      json
        ? resolution
        : resolution.path
          ? `${resolution.citation} resolves to ${resolution.path}.`
          : `${resolution.citation} resolves to ${resolution.resolved}, ` +
            'which names no file this run holds.',
      json,
    )
    return
  }

  if (hasFlag(args, '--redline')) {
    const record = writeRedlineRecord(
      root,
      runId,
      option(args, '--occasion') ?? 'session',
    )
    print(
      json
        ? record
        : `Platform-guidance redline recorded at ${record.record_path} ` +
            `(declaration ${record.declarations.length}).`,
      json,
    )
    return
  }

  print(getRunStatus(root, runId, { json }), json)
  return
}

/** `pan list`. */
export function listCommand({ root }: CliContext): void {
  print(listRuns(root), true)
  return
}

/** `pan installs`. */
export function installsCommand({ root, args, json }: CliContext): void {
  const sub = args[0]

  if (sub === 'list') {
    print(describeInstallations(root), json)
    return
  }

  if (sub === 'archive') {
    print(
      archiveInstallationInboxItems(root, {
        installId: requiredPositional(args[1], 'install-id'),
        intakePath: requiredArgument(option(args, '--intake'), '--intake'),
        items: options(args, '--item'),
      }),
      json,
    )
    return
  }

  throw new PanError(`Unknown installs subcommand: ${sub ?? '(missing)'}`, {
    code: 'UNKNOWN_COMMAND',
  })
}

/** `pan inbox`. */
export function inboxCommand({ root, pan, args, json }: CliContext): void {
  if (args[0] === 'restore') {
    const result = restoreInboxRequest(
      root,
      requiredPositional(args[1], 'inbox-file'),
    )

    print(
      {
        status: 'restored',
        ...result,
        next_command: `${pan} init --request ${result.to}`,
      },
      true,
    )
    return
  }

  const items = listInbox(root)

  if (json) {
    print(items, true)
  } else {
    print(renderInbox(items))
  }

  return
}

/** `pan observations`. */
export function observationsCommand({ root, args, json }: CliContext): void {
  // A `/pan-repair installs` sweep runs from the source checkout and reads
  // each installation's runs and ledger through `--root`. Its intakes stay
  // in the source checkout, so a relative `--intake` resolves there.
  const rootOption = option(args, '--root')
  const observationRoot = rootOption === null ? root : path.resolve(rootOption)

  if (rootOption !== null && harnessConfigName(observationRoot) === null) {
    throw new PanError(
      `--root does not name a Pancreator installation root: ${rootOption}`,
      { code: 'INVALID_ARGUMENT' },
    )
  }

  if (args[0] === 'resolve') {
    const resolution = resolveObservation(observationRoot, {
      runId: requiredPositional(args[1], 'run-id'),
      criterion: requiredPositional(args[2], 'criterion-id'),
      status: requiredArgument(option(args, '--status'), '--status'),
      note: requiredArgument(noteOption(root, args), '--note'),
      intake: option(args, '--intake'),
      intakeRoot: root,
    })

    print({ status: 'resolved', resolution }, true)
    return
  }

  if (args[0] !== undefined && !args[0].startsWith('--')) {
    throw new PanError(`Unknown observations subcommand: ${args[0]}`, {
      code: 'UNKNOWN_COMMAND',
    })
  }

  const items = listObservations(observationRoot, {
    all: hasFlag(args, '--all'),
  })

  if (json) {
    print(items, true)
  } else {
    print(renderObservations(items))
  }

  return
}

/** `pan archive`. */
export function archiveCommand({ root, args }: CliContext): void {
  const daysValue = option(args, '--days')
  const retentionDays =
    daysValue === null
      ? resolveRetentionDays(root, 'workflow-runs')
      : Number(daysValue)
  const hasComplete = hasFlag(args, '--complete')
  const hasCanceled = hasFlag(args, '--canceled')

  print(
    maintainWorkflowRuntime(root, {
      retentionDays,
      inboxArchive: {
        complete: hasComplete || !hasCanceled,
        canceled: hasCanceled,
      },
      onProgress: ({ pass, phase, file_count: fileCount }) =>
        process.stderr.write(
          `[pan archive] ${pass} ${phase} (${fileCount} files)\n`,
        ),
    }),
    hasFlag(args, '--json'),
  )
  return
}

/** `pan quality`. */
export function qualityCommand({ root, args }: CliContext): void {
  const sub = args[0]
  const asJson = hasFlag(args, '--json')

  if (sub === 'daily') {
    const result = runDailyQuality(root)

    print(result, asJson)

    // The schedule records a job as failed only from a non-zero exit.
    if (result.status === 'failed') {
      process.exitCode = 1
    }

    return
  }

  throw new PanError(`Unknown quality subcommand: ${sub ?? '(missing)'}`, {
    code: 'UNKNOWN_COMMAND',
  })
}

/** `pan spend`. */
export async function spendCommand({ root, args }: CliContext): Promise<void> {
  const subcommand = args[0]

  if (subcommand === 'sync') {
    args.shift()
    const days = integerOption(args, '--days')

    invariant(
      days === null || (days >= 1 && days <= 365),
      '--days MUST be an integer from 1 to 365.',
      { code: 'INVALID_ARGUMENT' },
    )

    const result = await syncSpend(root, {
      ...(days === null ? {} : { days }),
    })

    print(result, hasFlag(args, '--json'))
    return
  }

  if (subcommand === 'report') {
    args.shift()
    const days = integerOption(args, '--days')

    invariant(
      days === null || (days >= 1 && days <= 365),
      '--days MUST be an integer from 1 to 365.',
      { code: 'INVALID_ARGUMENT' },
    )

    const canvas = option(args, '--canvas')
    const report = await reportMultiInstanceSpend(root, {
      ...(days === null ? {} : { days }),
    })

    print(
      canvas === null
        ? { status: 'reported', report }
        : writeSpendCanvas(root, canvas, report),
      hasFlag(args, '--json'),
    )
    return
  }

  if (subcommand !== undefined && !subcommand.startsWith('--')) {
    invariant(
      false,
      `Unknown spend subcommand: ${subcommand}. Use 'sync' or 'report'.`,
      { code: 'INVALID_ARGUMENT' },
    )
  }

  const days = integerOption(args, '--days')
  const canvas = option(args, '--canvas')
  const report = await generateTokenSpendReport(root, {
    ...(days === null ? {} : { days }),
  })

  print(
    canvas === null
      ? { status: 'reported', report }
      : writeSpendCanvas(root, canvas, report),
    true,
  )
  return
}

/** `pan cleanup`. */
export function cleanupCommand({ root, args }: CliContext): void {
  const daysValue = option(args, '--days')
  const selectedClasses = options(args, '--class')
  const cleanupOptions = {
    ...(daysValue === null ? {} : { days: Number(daysValue) }),
    ...(selectedClasses.length > 0 ? { classes: selectedClasses } : {}),
  }

  print(
    hasFlag(args, '--apply')
      ? applyCleanup(root, cleanupOptions)
      : planCleanup(root, cleanupOptions),
    hasFlag(args, '--json'),
  )
  return
}
