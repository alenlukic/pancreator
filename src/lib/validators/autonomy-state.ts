import { readAwayDecisionLedger } from '../away-mode.js'
import { errorMessage } from '../errors.js'
import { readAgentRegistry } from '../hypervisor.js'
import { isRecord } from '../io.js'
import type { HandlerInput, HandlerResult } from '../requirements/types.js'

const AGENT_HEALTH_VALUES = new Set([
  'running',
  'stalled',
  'dead',
  'completed',
  'unknown',
])
const AWAY_RESULTS = new Set(['accepted', 'rejected', 'applied', 'failed'])
const AWAY_DECISION_KINDS = new Set([
  'evaluated',
  'deterministic_ship_approval',
  'hypervisor_quarantine',
])
const RECOVERY_STEPS = new Set([
  'nudge',
  'resume',
  'redeliver',
  'reprepare',
  'quarantine',
])

export function validateHypervisorState(input: HandlerInput): HandlerResult {
  try {
    const registry = readAgentRegistry(input.root)
    const issues: HandlerResult['issues'] = []
    const ids = new Set<string>()

    for (const [index, agent] of registry.agents.entries()) {
      if (!isRecord(agent)) {
        issues.push({
          code: 'hypervisor.agent.invalid',
          message: `agents[${index}] MUST be an object.`,
        })
        continue
      }

      if (typeof agent.agent_id !== 'string' || agent.agent_id.length === 0) {
        issues.push({
          code: 'hypervisor.agent.identity',
          message: `agents[${index}].agent_id MUST be non-empty.`,
        })
      } else if (ids.has(agent.agent_id)) {
        issues.push({
          code: 'hypervisor.agent.duplicate',
          message: `Duplicate agent_id: ${agent.agent_id}`,
        })
      } else {
        ids.add(agent.agent_id)
      }

      if (!AGENT_HEALTH_VALUES.has(String(agent.health))) {
        issues.push({
          code: 'hypervisor.agent.health',
          message: `agents[${index}].health is invalid.`,
        })
      }

      if (!isRecord(agent.recovery)) {
        issues.push({
          code: 'hypervisor.agent.recovery',
          message: `agents[${index}].recovery MUST be an object.`,
        })
      } else if (
        !Number.isInteger(agent.recovery.attempts) ||
        (agent.recovery.attempts as number) < 0 ||
        !Number.isInteger(agent.recovery.consecutive_failures) ||
        (agent.recovery.consecutive_failures as number) < 0 ||
        typeof agent.recovery.quarantined !== 'boolean' ||
        (agent.recovery.step !== undefined &&
          !RECOVERY_STEPS.has(String(agent.recovery.step)))
      ) {
        issues.push({
          code: 'hypervisor.agent.recovery',
          message: `agents[${index}].recovery is invalid.`,
        })
      }
    }

    return {
      status: issues.length === 0 ? 'passed' : 'failed',
      issues,
    }
  } catch (error) {
    return {
      status: 'failed',
      issues: [
        {
          code: 'hypervisor.registry.invalid',
          message: errorMessage(error),
        },
      ],
    }
  }
}

export function validateAwayDecisionLedger(input: HandlerInput): HandlerResult {
  try {
    const records = readAwayDecisionLedger(input.root)
    const issues: HandlerResult['issues'] = []
    const ids = new Set<string>()

    for (const [index, record] of records.entries()) {
      const decisionKind = record.decision_kind ?? 'evaluated'

      if (ids.has(record.decision_id)) {
        issues.push({
          code: 'away.decision.duplicate',
          message: `Duplicate decision_id: ${record.decision_id}`,
        })
      } else {
        ids.add(record.decision_id)
      }

      if (!AWAY_RESULTS.has(record.result)) {
        issues.push({
          code: 'away.decision.result',
          message: `Ledger record ${index} has an invalid result.`,
        })
      }

      if (!AWAY_DECISION_KINDS.has(decisionKind)) {
        issues.push({
          code: 'away.decision.kind',
          message: `Ledger record ${index} has an invalid decision kind.`,
        })
      }

      if (!isRecord(record.blocker) || !isRecord(record.guardrails)) {
        issues.push({
          code: 'away.decision.contract',
          message: `Ledger record ${index} lacks blocker or guardrails data.`,
        })
      }

      if (
        record.result === 'accepted' &&
        (!record.selected_action ||
          !record.selected_action.feasible ||
          record.selected_action.rollback_plan.steps.length === 0 ||
          record.selected_action.rollback_plan.verification.trim().length === 0)
      ) {
        issues.push({
          code: 'away.decision.rollback',
          message: `Accepted ledger record ${index} lacks a rollback plan.`,
        })
      }

      if (
        decisionKind === 'deterministic_ship_approval' &&
        (record.blocker.type !== 'operator_approval' ||
          record.blocker.stage !== 'ship' ||
          record.selected_action?.action !== 'approve' ||
          !record.guardrails.allowed_actions.includes('approve'))
      ) {
        issues.push({
          code: 'away.decision.ship',
          message: `Ledger record ${index} is not a valid ship approval.`,
        })
      }

      if (
        decisionKind === 'hypervisor_quarantine' &&
        (record.blocker.type !== 'hypervisor_incident' ||
          record.result !== 'rejected')
      ) {
        issues.push({
          code: 'away.decision.quarantine',
          message: `Ledger record ${index} is not a valid quarantine record.`,
        })
      }

      if (
        (record.result === 'applied' || record.result === 'failed') &&
        typeof record.linked_decision_id !== 'string'
      ) {
        issues.push({
          code: 'away.decision.link',
          message: `Ledger record ${index} lacks its source decision link.`,
        })
      }
    }

    const byId = new Map(records.map((record) => [record.decision_id, record]))

    for (const [index, record] of records.entries()) {
      if (!record.linked_decision_id) {
        continue
      }

      const source = byId.get(record.linked_decision_id)
      const recordKind = record.decision_kind ?? 'evaluated'
      const sourceKind = source?.decision_kind ?? 'evaluated'

      if (
        !source ||
        source.run_id !== record.run_id ||
        sourceKind !== recordKind ||
        source.result !== 'accepted'
      ) {
        issues.push({
          code: 'away.decision.link',
          message: `Ledger record ${index} has an invalid source decision link.`,
        })
      }
    }

    return {
      status: issues.length === 0 ? 'passed' : 'failed',
      issues,
    }
  } catch (error) {
    return {
      status: 'failed',
      issues: [
        {
          code: 'away.ledger.invalid',
          message: errorMessage(error),
        },
      ],
    }
  }
}
