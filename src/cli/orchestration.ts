/**
 * Multi-run supervision commands: `best-of-n`, `schedule`, `horizon`, and
 * `cohort`.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  abandonBestOfNCandidate,
  refreshBestOfNAgents,
} from '../lib/best-of-n/candidates.js'
import { cleanBestOfN, pruneBestOfN } from '../lib/best-of-n/cleanup.js'
import { consolidateBestOfN } from '../lib/best-of-n/consolidation.js'
import { initBestOfN } from '../lib/best-of-n/init.js'
import { bestOfNStatus } from '../lib/best-of-n/session.js'
import { abandonChunk, cleanCohortSession } from '../lib/cohorts/abandon.js'
import { retryDeliveryRoute } from '../lib/cohorts/delivery.js'
import { integrateCohort, releaseCohort } from '../lib/cohorts/integration.js'
import {
  cohortStatus,
  initCohortSession,
  startCohort,
} from '../lib/cohorts/start.js'
import {
  checkpointHorizonSession,
  reconcileHorizonSession,
} from '../lib/horizon/checkpoint.js'
import {
  addHorizonTask,
  initHorizonSession,
  startHorizonSession,
} from '../lib/horizon/lifecycle.js'
import { nextHorizonTask } from '../lib/horizon/next.js'
import {
  abandonHorizonSession,
  deferHorizonTask,
  reinstateHorizonTask,
} from '../lib/horizon/operator-actions.js'
import type { HorizonQueueTaskInput } from '../lib/horizon/session.js'
import { horizonStatus, latestHorizonHandoff } from '../lib/horizon/status.js'
import {
  ARBITER_ACTIONS,
  HORIZON_HARD_BLOCKS,
  type ArbiterActionType,
  type HorizonHardBlock,
} from '../lib/horizon-arbiter.js'
import {
  installScheduleAgent,
  resolveScheduleConfig,
  runScheduledJob,
  scheduleStatus,
  scheduleTick,
  uninstallScheduleAgent,
  validateSchedule,
} from '../lib/schedule.js'
import { PanError } from '../lib/errors.js'
import { readJson, resolveInside } from '../lib/io.js'

import type { CliContext } from './context.js'
import {
  deliveryRouteOptions,
  hasFlag,
  integerOption,
  option,
  print,
  repeatedOption,
  requiredArgument,
  requiredPositional,
} from './args.js'

/** `pan best-of-n`. */
export function bestOfNCommand({ root, pan, args }: CliContext): void {
  const sub = args[0]
  const rest = args.slice(1)
  const asJson = hasFlag(args, '--json')

  if (sub === 'init') {
    const state = initBestOfN(root, {
      requestPath: requiredArgument(option(args, '--request'), '--request'),
      configsPath: requiredArgument(option(args, '--configs'), '--configs'),
      ...(option(args, '--workflow')
        ? { candidateWorkflow: option(args, '--workflow') as string }
        : {}),
      ...(option(args, '--consolidation-workflow')
        ? {
            consolidationWorkflow: option(
              args,
              '--consolidation-workflow',
            ) as string,
          }
        : {}),
      operatorArtifacts: hasFlag(args, '--operator-artifacts'),
    })

    print(
      {
        status: 'created',
        bon_id: state.bon_id,
        candidate_workflow: state.candidate_workflow,
        candidates: state.candidates.map((candidate) => ({
          slot: candidate.slot,
          run_id: candidate.run_id,
          worktree_path: candidate.worktree_path,
        })),
        state_path: `runtime/logs/best-of-n/${state.bon_id}/state.json`,
      },
      asJson,
    )
    return
  }

  if (sub === 'status') {
    print(bestOfNStatus(root, requiredArgument(rest[0], 'bon-id')), asJson)
    return
  }

  if (sub === 'refresh-agents') {
    print(
      refreshBestOfNAgents(root, requiredArgument(rest[0], 'bon-id')),
      asJson,
    )
    return
  }

  if (sub === 'abandon') {
    const state = abandonBestOfNCandidate(
      root,
      requiredArgument(rest[0], 'bon-id'),
      requiredArgument(rest[1], 'run-id'),
      requiredArgument(option(args, '--note'), '--note'),
    )

    print({ status: 'abandoned', candidates: state.candidates }, asJson)
    return
  }

  if (sub === 'consolidate') {
    const state = consolidateBestOfN(root, requiredArgument(rest[0], 'bon-id'))

    print(
      {
        status: 'created',
        bon_id: state.bon_id,
        consolidation: state.consolidation,
        next_command: `${pan} status ${state.consolidation?.run_id}`,
      },
      asJson,
    )
    return
  }

  if (sub === 'clean') {
    print(
      cleanBestOfN(root, requiredArgument(rest[0], 'bon-id'), {
        force: hasFlag(args, '--force'),
      }),
      asJson,
    )
    return
  }

  if (sub === 'prune') {
    print(pruneBestOfN(root, { force: hasFlag(args, '--force') }), asJson)
    return
  }

  throw new PanError(`Unknown best-of-n subcommand: ${sub ?? '(missing)'}`, {
    code: 'UNKNOWN_COMMAND',
  })
}

/** `pan schedule`. */
export function scheduleCommand({ root, args }: CliContext): void {
  const sub = args[0]
  const rest = args.slice(1)
  const asJson = hasFlag(args, '--json')

  if (sub === 'list') {
    print(resolveScheduleConfig(root), asJson)
    return
  }

  if (sub === 'status') {
    print(scheduleStatus(root), asJson)
    return
  }

  if (sub === 'tick') {
    print(scheduleTick(root), asJson)
    return
  }

  if (sub === 'run') {
    print(runScheduledJob(root, requiredPositional(rest[0], 'job-id')), asJson)
    return
  }

  if (sub === 'validate') {
    print(validateSchedule(root), asJson)
    return
  }

  if (sub === 'install-agent') {
    print(installScheduleAgent(root), asJson)
    return
  }

  if (sub === 'uninstall-agent') {
    print(uninstallScheduleAgent(root), asJson)
    return
  }

  throw new PanError(`Unknown schedule subcommand: ${sub ?? '(missing)'}`, {
    code: 'UNKNOWN_COMMAND',
  })
}

/** `pan horizon`. */
export function horizonCommand({ root, args }: CliContext): void {
  const sub = args[0]
  const rest = args.slice(1)
  const asJson = hasFlag(args, '--json')

  if (sub === 'init') {
    print(
      initHorizonSession(
        root,
        requiredArgument(option(args, '--queue'), '--queue'),
        {
          ...(option(args, '--session')
            ? { sessionId: option(args, '--session') as string }
            : {}),
          ...(option(args, '--involvement')
            ? { involvement: option(args, '--involvement') as string }
            : {}),
          ...(option(args, '--worktree')
            ? { worktree: option(args, '--worktree') as string }
            : {}),
        },
      ),
      asJson,
    )
    return
  }

  if (sub === 'add') {
    const taskPath = requiredArgument(option(args, '--task'), '--task')
    print(
      addHorizonTask(
        root,
        requiredPositional(rest[0], 'session-id'),
        readJson(resolveInside(root, taskPath)) as HorizonQueueTaskInput,
      ),
      asJson,
    )
    return
  }

  if (sub === 'start') {
    const sessionId = requiredPositional(rest[0], 'session-id')
    let state = startHorizonSession(root, sessionId, {
      attestSupervisorCard: hasFlag(args, '--attest-supervisor-card'),
    })

    // The operator's chat session is the supervisor by default: start
    // arms the session and hands back, and the chat opens and advances
    // each task itself. Only a scheduled job with no chat open drives the
    // session in harness-owned processes.
    if (!hasFlag(args, '--headless')) {
      print(horizonStatus(root, sessionId), asJson)
      return
    }

    let childCount = 0

    while (state.status === 'running' && childCount < 10_000) {
      const child = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL('../cli.js', import.meta.url)),
          'horizon',
          'next',
          sessionId,
          '--driver-child',
          '--json',
        ],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 86_400_000,
          maxBuffer: 16 * 1024 * 1024,
        },
      )

      if (child.error || child.status !== 0) {
        throw new PanError(
          `Horizon driver process failed: ${child.error?.message ?? child.stderr ?? `exit ${String(child.status)}`}`,
          { code: 'HORIZON_DRIVER_FAILED' },
        )
      }

      state = horizonStatus(root, sessionId)
      childCount += 1
    }

    if (childCount >= 10_000) {
      throw new PanError(
        'Horizon session exceeded its 10000-task driver bound.',
        {
          code: 'HORIZON_DRIVER_LIMIT',
        },
      )
    }

    print(state, asJson)
    return
  }

  if (sub === 'next') {
    const sessionId = requiredPositional(rest[0], 'session-id')
    const result = nextHorizonTask(root, sessionId)

    if (hasFlag(args, '--driver-child') && result.run) {
      let state = result.session
      let checkpoints = 0

      while (state.active_task_id && checkpoints < 100) {
        state = checkpointHorizonSession(root, sessionId).session
        checkpoints += 1
      }

      if (checkpoints >= 100) {
        throw new PanError('Horizon task exceeded its 100-checkpoint bound.', {
          code: 'HORIZON_TASK_DRIVER_LIMIT',
        })
      }

      print(state, asJson)
      return
    }

    print(result, asJson)
    return
  }

  if (sub === 'status') {
    print(
      horizonStatus(root, requiredPositional(rest[0], 'session-id')),
      asJson,
    )
    return
  }

  if (sub === 'checkpoint') {
    print(
      checkpointHorizonSession(root, requiredPositional(rest[0], 'session-id')),
      asJson,
    )
    return
  }

  if (sub === 'reconcile') {
    print(
      reconcileHorizonSession(root, requiredPositional(rest[0], 'session-id')),
      asJson,
    )
    return
  }

  if (sub === 'resume') {
    print(
      latestHorizonHandoff(root, requiredPositional(rest[0], 'session-id')),
      asJson,
    )
    return
  }

  if (sub === 'reinstate') {
    const actionType = requiredArgument(option(args, '--action'), '--action')

    if (!(ARBITER_ACTIONS as readonly string[]).includes(actionType)) {
      throw new PanError(
        `Unknown reinstate action '${actionType}'. Known: ${ARBITER_ACTIONS.join(', ')}.`,
        { code: 'INVALID_ARGUMENT' },
      )
    }

    const decision = option(args, '--decision')

    if (
      decision !== undefined &&
      decision !== null &&
      decision !== 'approve' &&
      decision !== 'reject' &&
      decision !== 'revise'
    ) {
      throw new PanError(
        `--decision must be approve, reject, or revise, not '${decision}'.`,
        { code: 'INVALID_ARGUMENT' },
      )
    }

    const stage = option(args, '--stage')
    print(
      reinstateHorizonTask(
        root,
        requiredPositional(rest[0], 'session-id'),
        requiredArgument(option(args, '--task'), '--task'),
        {
          type: actionType as ArbiterActionType,
          note: requiredArgument(option(args, '--note'), '--note'),
          ...(stage ? { stage } : {}),
          ...(decision ? { decision } : {}),
        },
        requiredArgument(option(args, '--reason'), '--reason'),
      ),
      asJson,
    )
    return
  }

  if (sub === 'defer') {
    const hardBlock = option(args, '--hard-block')
    const operatorDirective = hasFlag(args, '--operator-directive')

    if (!hardBlock && !operatorDirective) {
      throw new PanError(
        'horizon defer requires --hard-block <LH-H1|LH-H2|LH-H3|LH-H4> naming the hard block you confirmed, or --operator-directive when the operator asked for the deferral. No other authority ends a long-horizon task (HORIZON-001).',
        { code: 'HORIZON_DEFER_UNAUTHORIZED' },
      )
    }

    if (
      hardBlock &&
      !(HORIZON_HARD_BLOCKS as readonly string[]).includes(hardBlock)
    ) {
      throw new PanError(
        `Unknown hard block '${hardBlock}'. Known: ${HORIZON_HARD_BLOCKS.join(', ')}.`,
        { code: 'INVALID_ARGUMENT' },
      )
    }

    print(
      deferHorizonTask(
        root,
        requiredPositional(rest[0], 'session-id'),
        requiredArgument(option(args, '--task'), '--task'),
        requiredArgument(option(args, '--reason'), '--reason'),
        repeatedOption(args, '--evidence'),
        hardBlock
          ? {
              kind: 'hard_block',
              hard_block: hardBlock as HorizonHardBlock,
            }
          : { kind: 'operator_directive' },
      ),
      asJson,
    )
    return
  }

  if (sub === 'abandon') {
    print(
      abandonHorizonSession(
        root,
        requiredPositional(rest[0], 'session-id'),
        requiredArgument(option(args, '--reason'), '--reason'),
      ),
      asJson,
    )
    return
  }

  throw new PanError(`Unknown horizon subcommand: ${sub ?? '(missing)'}`, {
    code: 'UNKNOWN_COMMAND',
  })
}

/** `pan cohort`. */
export function cohortCommand({ root, pan, args }: CliContext): void {
  const sub = args[0]
  const rest = args.slice(1)
  const asJson = hasFlag(args, '--json')

  if (sub === 'init') {
    const state = initCohortSession(root, {
      planRunId: requiredArgument(option(args, '--plan-run'), '--plan-run'),
      from: option(args, '--from'),
      maxParallel: integerOption(args, '--max-parallel'),
    })

    print(
      {
        status: 'created',
        cohort_id: state.cohort_id,
        plan_run_id: state.plan_run_id,
        parent_spec_path: state.parent_spec_path,
        base_branch: state.base_branch,
        max_parallel: state.max_parallel,
        cohorts: state.cohorts,
        next_command: `${pan} cohort start ${state.cohort_id}`,
        state_path: `runtime/logs/cohorts/${state.cohort_id}/state.json`,
      },
      asJson,
    )
    return
  }

  if (sub === 'start') {
    const cohortOption = option(rest, '--cohort')
    const cohortIndex = cohortOption === null ? undefined : Number(cohortOption)

    if (cohortIndex !== undefined && !Number.isInteger(cohortIndex)) {
      throw new PanError('--cohort requires an integer cohort index.', {
        code: 'INVALID_ARGUMENT',
      })
    }

    print(
      {
        status: 'started',
        ...startCohort(root, requiredPositional(rest[0], 'cohort-id'), {
          cohortIndex,
        }),
      },
      asJson,
    )
    return
  }

  if (sub === 'status') {
    print(cohortStatus(root, requiredPositional(rest[0], 'cohort-id')), asJson)
    return
  }

  if (sub === 'integrate') {
    print(
      {
        status: 'integrated',
        ...integrateCohort(root, requiredPositional(rest[0], 'cohort-id'), {
          intoBranch: option(rest, '--into-branch'),
        }),
      },
      asJson,
    )
    return
  }

  if (sub === 'release') {
    const result = releaseCohort(root, requiredPositional(rest[0], 'cohort-id'))

    print(result, asJson)

    if (result.status === 'failed') {
      process.exitCode = 1
    }
    return
  }

  if (sub === 'abandon') {
    const state = abandonChunk(
      root,
      requiredPositional(rest[0], 'cohort-id'),
      requiredArgument(option(args, '--chunk'), '--chunk'),
      requiredArgument(option(args, '--note'), '--note'),
    )

    print({ status: 'abandoned', chunks: state.chunks }, asJson)
    return
  }

  if (sub === 'clean') {
    print(
      cleanCohortSession(root, requiredPositional(rest[0], 'cohort-id'), {
        force: hasFlag(args, '--force'),
      }),
      asJson,
    )
    return
  }

  if (sub === 'route') {
    const result = retryDeliveryRoute(
      root,
      requiredArgument(option(args, '--plan-run'), '--plan-run'),
      deliveryRouteOptions(args),
    )

    print(result, asJson)

    if (result.status === 'failed') {
      process.exitCode = 1
    }
    return
  }

  throw new PanError(`Unknown cohort subcommand: ${sub ?? '(missing)'}`, {
    code: 'UNKNOWN_COMMAND',
  })
}
