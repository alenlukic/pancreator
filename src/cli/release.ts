/**
 * Harness maintenance commands: `release`, `tune`, and `debloat`.
 */

import { PanError } from '../lib/errors.js'
import {
  allocateReleaseVersion,
  isReleaseBump,
} from '../lib/release-allocation.js'
import { landRelease } from '../lib/release-landing.js'
import {
  continueLocalRelease,
  finalizeLocalRelease,
  syncLocalRelease,
} from '../lib/release-preparation.js'
import { validateAudit } from '../lib/test-tuning/audit.js'
import { finalizePreparedTuneSession } from '../lib/test-tuning/finalize.js'
import { prepareTuneSession } from '../lib/test-tuning/inventory.js'
import {
  computeDebloatImpact,
  recordDebloatAdjudication,
  scanDebloat,
  selectDebloatFacilities,
  verifyDebloat,
} from '../lib/debloat.js'

import type { CliContext } from './context.js'
import { hasFlag, option, options, print, requiredArgument } from './args.js'

/** `pan release`. */
export function releaseCommand({ root, args }: CliContext): void {
  const sub = requiredArgument(args[0], 'release subcommand')
  const worktreeName = requiredArgument(
    option(args, '--worktree'),
    '--worktree',
  )

  if (sub === 'sync') {
    const onto = option(args, '--onto')
    const result = syncLocalRelease(
      root,
      worktreeName,
      requiredArgument(option(args, '--message'), '--message'),
      option(args, '--run') ?? undefined,
      {
        ...(onto === null ? {} : { onto }),
        ...(hasFlag(args, '--no-rebase') ? { noRebase: true } : {}),
      },
    )

    print(result, hasFlag(args, '--json'))

    if (result.status === 'conflict') {
      process.exitCode = 1
    }

    return
  }

  if (sub === 'continue') {
    const result = continueLocalRelease(
      root,
      worktreeName,
      option(args, '--run') ?? undefined,
    )

    print(result, hasFlag(args, '--json'))

    if (result.status === 'conflict') {
      process.exitCode = 1
    }

    return
  }

  if (sub === 'finalize') {
    print(
      finalizeLocalRelease(
        root,
        worktreeName,
        requiredArgument(option(args, '--fetched-main'), '--fetched-main'),
        option(args, '--run') ?? undefined,
      ),
      hasFlag(args, '--json'),
    )
    return
  }

  if (sub === 'allocate') {
    print(
      allocateReleaseVersion(
        root,
        worktreeName,
        requiredArgument(option(args, '--bump'), '--bump'),
        { runId: option(args, '--run') },
      ),
      hasFlag(args, '--json'),
    )
    return
  }

  if (sub === 'land') {
    const bumpArg = option(args, '--bump')
    const bump = bumpArg !== null ? bumpArg : undefined
    const waitSecondsArg = option(args, '--wait-seconds')
    const verifyProfileArgs = options(args, '--verify-profile')
    const repairNote = option(args, '--repair')

    if (repairNote !== null && repairNote.trim().length === 0) {
      throw new PanError('--repair needs a non-empty note.', {
        code: 'LANDING_REPAIR_NOTE_REQUIRED',
      })
    }

    if (bump !== undefined && !isReleaseBump(bump)) {
      throw new PanError(
        `--bump must be major, minor, or patch, not '${bump}'.`,
        { code: 'INVALID_RELEASE_BUMP' },
      )
    }

    if (waitSecondsArg !== null && !/^\d+$/u.test(waitSecondsArg)) {
      throw new PanError(
        `--wait-seconds must be a non-negative whole number, not '${waitSecondsArg}'.`,
        { code: 'INVALID_WAIT_SECONDS' },
      )
    }

    const result = landRelease(root, {
      worktree: worktreeName,
      ...(bump !== undefined ? { bump } : {}),
      runId: option(args, '--run'),
      ...(verifyProfileArgs.length > 0
        ? { verifyProfiles: verifyProfileArgs }
        : {}),
      ...(repairNote !== null ? { repairNote } : {}),
      ...(waitSecondsArg !== null
        ? { waitSeconds: Number(waitSecondsArg) }
        : {}),
    })

    print(result, hasFlag(args, '--json'))

    if (result.status !== 'landed') {
      process.exitCode = 1
    }

    return
  }

  throw new PanError(`Unknown release subcommand: ${sub}`, {
    code: 'UNKNOWN_COMMAND',
  })
}

/** `pan tune`. */
export function tuneCommand({ root, args }: CliContext): void {
  const sub = args[0]
  const asJson = hasFlag(args, '--json')

  if (sub === 'prepare') {
    const baselineRef = option(args, '--baseline')
    const prepared = prepareTuneSession(root, {
      ...(baselineRef ? { baselineRef } : {}),
    })

    print({ status: 'prepared', ...prepared }, asJson)
    return
  }

  if (sub === 'finalize') {
    const sessionId = requiredArgument(option(args, '--session'), '--session')
    const result = finalizePreparedTuneSession(root, sessionId)

    print({ status: 'finalized', ...result }, asJson)
    return
  }

  if (sub === 'validate-audit') {
    const result = validateAudit(root, {
      recordPath: requiredArgument(option(args, '--record'), '--record'),
      baselineRef: requiredArgument(option(args, '--baseline'), '--baseline'),
      targetRef: requiredArgument(option(args, '--target'), '--target'),
      json: asJson,
    })

    print({ status: result.complete ? 'valid' : 'invalid', ...result }, asJson)

    if (!result.complete) {
      process.exitCode = 1
    }

    return
  }

  throw new PanError(`Unknown tune subcommand: ${sub ?? '(missing)'}`, {
    code: 'UNKNOWN_COMMAND',
  })
}

/** `pan debloat`. */
export async function debloatCommand({
  root,
  args,
}: CliContext): Promise<void> {
  const sub = args[0]
  const asJson = hasFlag(args, '--json')

  if (sub === 'scan') {
    const days = option(args, '--days')
    const transcripts = option(args, '--transcripts')

    print(
      {
        status: 'scanned',
        ...(await scanDebloat(root, {
          ...(days === null ? {} : { windowDays: Number(days) }),
          worktreeName: option(args, '--worktree'),
          ...(transcripts === null ? {} : { transcriptsRoot: transcripts }),
        })),
      },
      asJson,
    )
    return
  }

  if (sub === 'adjudicate') {
    print(
      {
        status: 'adjudicated',
        ...recordDebloatAdjudication(
          root,
          requiredArgument(option(args, '--session'), '--session'),
          requiredArgument(option(args, '--facility'), '--facility'),
          requiredArgument(option(args, '--verdict'), '--verdict') as
            | 'remove'
            | 'keep',
          requiredArgument(option(args, '--reason'), '--reason'),
          options(args, '--evidence'),
        ),
      },
      asJson,
    )
    return
  }

  if (sub === 'select') {
    print(
      {
        status: 'selected',
        ...selectDebloatFacilities(
          root,
          requiredArgument(option(args, '--session'), '--session'),
          options(args, '--facility'),
          new Date(),
          { replace: hasFlag(args, '--replace') },
        ),
      },
      asJson,
    )
    return
  }

  if (sub === 'impact') {
    print(
      {
        status: 'computed',
        ...(await computeDebloatImpact(
          root,
          requiredArgument(option(args, '--session'), '--session'),
        )),
      },
      asJson,
    )
    return
  }

  if (sub === 'verify') {
    const result = await verifyDebloat(
      root,
      requiredArgument(option(args, '--session'), '--session'),
    )

    print(result, asJson)

    // A surviving path or a dangling reference means the removal is not
    // finished, so the exit code has to fail the step that ran it.
    if (result.status !== 'clean') {
      process.exitCode = 1
    }

    return
  }

  throw new PanError(`Unknown debloat subcommand: ${sub ?? '(missing)'}`, {
    code: 'UNKNOWN_COMMAND',
  })
}
