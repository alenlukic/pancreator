import path from 'node:path'

import { readAwayDecisionLedger } from '../away-mode.js'
import { errorMessage } from '../errors.js'
import { readAgentRegistry } from '../hypervisor.js'
import { isRecord } from '../io.js'
import { AWAY_MODE_ACTIONS } from '../project-config.js'
import type { HandlerInput, HandlerResult } from '../requirements/types.js'

const AGENT_HEALTH_VALUES = new Set([
  'running',
  'stalled',
  'dead',
  'completed',
  'unknown',
])

// The hypervisor now writes only `quarantine`, but registry records written
// before recovery was removed keep their steps and must stay readable.
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

const SUPERVISOR_DECISION_RESULTS = new Set(['applied', 'failed'])
const AWAY_BLOCKER_TYPES = new Set([
  'stage_blocked',
  'operator_decision',
  'operator_approval',
  'operator_question',
])

function isRepositoryRelative(reference: unknown): boolean {
  if (typeof reference !== 'string' || reference.length === 0) {
    return false
  }

  if (path.isAbsolute(reference) || reference.includes('\\')) {
    return false
  }

  const normalized = path.posix.normalize(reference)

  return normalized !== '..' && !normalized.startsWith('../')
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export function validateAwayDecisionLedger(input: HandlerInput): HandlerResult {
  try {
    const records = readAwayDecisionLedger(input.root)
    const issues: HandlerResult['issues'] = []
    const ids = new Set<string>()

    for (const [index, entry] of records.entries()) {
      const record: unknown = entry

      if (!isRecord(record)) {
        issues.push({
          code: 'away.decision.invalid',
          message: `Ledger record ${index} MUST be an object.`,
        })
        continue
      }

      if (!nonEmptyString(record.decision_id)) {
        issues.push({
          code: 'away.decision.identity',
          message: `Ledger record ${index} MUST have a non-empty decision_id.`,
        })
      } else if (ids.has(record.decision_id as string)) {
        issues.push({
          code: 'away.decision.duplicate',
          message: `Duplicate decision_id: ${String(record.decision_id)}`,
        })
      } else {
        ids.add(record.decision_id as string)
      }

      if (record.author !== 'supervisor') {
        issues.push({
          code: 'away.decision.author',
          message: `Ledger record ${index} MUST have author 'supervisor'.`,
        })
      }

      const allowedActions =
        isRecord(record.guardrails) &&
        Array.isArray(record.guardrails.allowed_actions)
          ? (record.guardrails.allowed_actions as unknown[])
          : null

      if (!allowedActions) {
        issues.push({
          code: 'away.decision.guardrails',
          message: `Ledger record ${index} MUST carry guardrails.allowed_actions.`,
        })
      }

      if (
        !(AWAY_MODE_ACTIONS as readonly unknown[]).includes(record.action) ||
        (allowedActions !== null && !allowedActions.includes(record.action))
      ) {
        issues.push({
          code: 'away.decision.action',
          message: `Ledger record ${index} MUST name an action its guardrails allow.`,
        })
      }

      if (!nonEmptyString(record.reason)) {
        issues.push({
          code: 'away.decision.reason',
          message: `Ledger record ${index} MUST have a non-empty reason.`,
        })
      }

      if (
        !isRecord(record.blocker) ||
        !AWAY_BLOCKER_TYPES.has(String(record.blocker.type))
      ) {
        issues.push({
          code: 'away.decision.blocker',
          message: `Ledger record ${index} MUST carry a blocker of a known type.`,
        })
      }

      if (!SUPERVISOR_DECISION_RESULTS.has(String(record.result))) {
        issues.push({
          code: 'away.decision.result',
          message: `Ledger record ${index} has an invalid result.`,
        })
      } else if (record.result === 'failed' && !nonEmptyString(record.error)) {
        issues.push({
          code: 'away.decision.error',
          message: `Failed ledger record ${index} MUST carry a non-empty error.`,
        })
      }

      if (
        !Array.isArray(record.evidence_references) ||
        !record.evidence_references.every(isRepositoryRelative)
      ) {
        issues.push({
          code: 'away.decision.evidence',
          message: `Ledger record ${index} MUST carry repository-relative evidence references.`,
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
