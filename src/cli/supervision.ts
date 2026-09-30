/**
 * Unattended supervision commands: `hypervisor` and `away`.
 */

import { quarantineRunForAgent } from '../lib/engine/pause-resume.js'
import { getRunState } from '../lib/engine/run-status.js'
import { maybeStartDelivery } from '../lib/cohorts/delivery.js'
import { maybeAdvanceCohort } from '../lib/cohorts/integration.js'
import { decideAwayAsSupervisor } from '../lib/away-orchestration.js'
import { PanError } from '../lib/errors.js'
import {
  AWAY_SUBCOMMAND_OPTIONS,
  awayModeTrigger,
  openOperatorQuestion,
  readAwayDecisionLedger,
  unknownAwayOption,
} from '../lib/away-mode.js'
import {
  hypervisorProcessStatus,
  runHypervisorDaemon,
  startHypervisorProcess,
  stopHypervisorProcess,
  tickHypervisor,
} from '../lib/hypervisor.js'

import type { CliContext } from './context.js'
import {
  deliveryRouteOptions,
  noteOption,
  option,
  print,
  requiredArgument,
} from './args.js'

function runHypervisorCycle(root: string): Record<string, unknown> {
  const tick = tickHypervisor(root)
  const quarantinedRuns = new Set<string>()

  for (const event of tick.quarantine_events) {
    const agent = tick.agents.find(
      (candidate) => candidate.agent_id === event.agent_id,
    )

    if (!agent || quarantinedRuns.has(agent.run_id)) {
      continue
    }

    const reason = `Agent '${agent.agent_id}' was quarantined. ${event.evidence}`

    quarantineRunForAgent(root, agent.run_id, agent.agent_id, reason)
    quarantinedRuns.add(agent.run_id)
  }

  return { tick }
}

/** `pan hypervisor`. */
export async function hypervisorCommand({
  root,
  args,
  json,
}: CliContext): Promise<void> {
  const subcommand = requiredArgument(args[0], 'hypervisor subcommand')

  if (subcommand === 'start') {
    print(
      startHypervisorProcess(
        root,
        requiredArgument(process.argv[1], 'CLI path'),
      ),
      json,
    )
    return
  }

  if (subcommand === 'run') {
    await runHypervisorDaemon(root, () => {
      runHypervisorCycle(root)
    })
    return
  }

  if (subcommand === 'tick') {
    print(runHypervisorCycle(root), json)
    return
  }

  if (subcommand === 'status') {
    print(hypervisorProcessStatus(root), json)
    return
  }

  if (subcommand === 'stop') {
    print(stopHypervisorProcess(root), json)
    return
  }

  throw new PanError(`Unknown hypervisor subcommand: ${subcommand}`, {
    code: 'UNKNOWN_COMMAND',
  })
}

/** `pan away`. */
export function awayCommand({ root, args, json }: CliContext): void {
  const subcommand = requiredArgument(args[0], 'away subcommand')
  const runId = requiredArgument(args[1], 'run-id')
  const rejected = unknownAwayOption(subcommand, args)

  if (rejected) {
    throw new PanError(
      `Unknown option for 'pan away ${subcommand}': ${rejected}. ` +
        `Accepted: ${(AWAY_SUBCOMMAND_OPTIONS[subcommand] ?? []).join(', ')}.`,
      { code: 'UNKNOWN_OPTION' },
    )
  }

  const state = getRunState(root, runId)

  if (subcommand === 'status') {
    const runDecisions = readAwayDecisionLedger(root).filter(
      (record) => record.run_id === runId,
    )

    print(
      {
        run_id: runId,
        enabled: state.away_mode?.enabled ?? false,
        blocker: awayModeTrigger(state, root),
        allowed_actions: state.away_mode?.guardrails.allowed_actions ?? [],
        open_operator_question: openOperatorQuestion(root, state),
        decisions: runDecisions.length,
      },
      json,
    )
    return
  }

  if (subcommand === 'decide') {
    const action = requiredArgument(option(args, '--action'), '--action')
    const note = noteOption(root, args)
    const stage = option(args, '--stage') ?? null

    const { state: next, record } = decideAwayAsSupervisor(root, state, {
      action,
      note,
      stage,
    })

    const autostart = maybeStartDelivery(
      root,
      next,
      { actor: 'away', action },
      deliveryRouteOptions(args),
    )
    const advance = maybeAdvanceCohort(root, next)

    print(
      {
        state: next,
        decision: record,
        ...(autostart ? { autostart } : {}),
        ...(advance ? { advance } : {}),
      },
      json,
    )
    return
  }

  throw new PanError(`Unknown away subcommand: ${subcommand}`, {
    code: 'UNKNOWN_COMMAND',
  })
}
