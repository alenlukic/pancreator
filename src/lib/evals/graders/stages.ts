/**
 * Graders for attempts spent on harness mechanics and for stage order and the
 * terminal state.
 */

import path from 'node:path'

import { isRecord } from '../../io.js'
import type { DeterministicResult } from '../../types.js'
import {
  latestHistoryForStage,
  outputForInvocation,
  readDotPath,
  type RunRecords,
} from '../run-records.js'
import type { EvalExpectedState } from '../types.js'
import { config, type Grader } from './context.js'

// ---------------------------------------------------------------------------
// attempts-not-spent-on-mechanics
// ---------------------------------------------------------------------------

const HARNESS_VALIDATOR_ERROR = /harness validator ([A-Z0-9-]+) failed/u

function validationRecordsFor(
  records: RunRecords,
  registryId: string,
): string[] {
  const handlerSlug = registryId.replace(/-\d{3}$/u, '').toLowerCase()

  return records.validation_paths.filter((relative) =>
    relative.toLowerCase().includes(handlerSlug),
  )
}

export const attemptsNotSpentOnMechanics: Grader = (context) => {
  const { records } = context
  const maxMechanical = config<number>(context, 'max_mechanical_attempts', 0)
  const mechanical: Record<string, unknown>[] = []
  const evidence: string[] = []

  for (const item of records.state.stage_history) {
    if (item.outcome !== 'failure') {
      continue
    }

    const output = outputForInvocation(records, item.invocation_id)
    const workerClaimedSuccess = output?.output.result === 'success'

    const gates = (item.deterministic ?? []) as DeterministicResult[]
    const gateFailed = gates.some((gate) => gate.hard && !gate.passed)

    const selfCriteria = (item.self_criteria ?? []) as { result?: string }[]
    const selfFailed = selfCriteria.some(
      (criterion) => criterion.result === 'fail',
    )

    const validationErrors = item.validation_errors ?? []

    if (
      !workerClaimedSuccess ||
      gateFailed ||
      selfFailed ||
      validationErrors.length === 0
    ) {
      continue
    }

    const validators = [
      ...new Set(
        validationErrors
          .map((message) => HARNESS_VALIDATOR_ERROR.exec(message)?.[1])
          .filter((value): value is string => typeof value === 'string'),
      ),
    ]
    const validationRecords = validators.flatMap((registryId) =>
      validationRecordsFor(records, registryId),
    )
    const rowEvidence = [
      ...(item.record_path ? [item.record_path] : []),
      ...(output ? [output.path] : []),
      ...validationRecords,
      ...records.artifact_json_paths.filter((relative) =>
        relative.endsWith('governance-artifact-issues.json'),
      ),
    ]

    evidence.push(...rowEvidence)
    mechanical.push({
      stage: item.stage,
      attempt: item.attempt,
      invocation_id: item.invocation_id,
      validators,
      validation_errors: validationErrors,
      evidence: rowEvidence,
    })
  }

  return {
    passed: mechanical.length <= maxMechanical,
    summary:
      mechanical.length === 0
        ? 'No stage attempt was consumed by a pre-submit validator alone.'
        : `${mechanical.length} stage attempt(s) consumed by a pre-submit validator that \`pan output validate\` could have run first.`,
    evidence: [...new Set(evidence)],
    details: {
      max_mechanical_attempts: maxMechanical,
      mechanical_attempts: mechanical,
    },
    observability:
      'A mechanical attempt is a stage_history entry with outcome failure whose worker output declared success, whose hard deterministic gates all passed, whose self-criteria did not fail, and whose validation_errors are non-empty. ' +
      'Every such error comes from the submission mirror or a pre-submit policy validator, which `pan output validate` runs before submission. ' +
      'Validation records under agent/validations/ are per policy requirement, so a later attempt overwrites the failing record; the stage_history entry keeps the error text.',
  }
}

// ---------------------------------------------------------------------------
// stage-order-and-terminal-state
// ---------------------------------------------------------------------------

export const stageOrderAndTerminalState: Grader = (context) => {
  const { records, scenario } = context
  const expected: EvalExpectedState = {
    ...scenario.expected,
    ...(isRecord(context.spec.config)
      ? (context.spec.config as Partial<EvalExpectedState>)
      : {}),
  }

  const failures: string[] = []
  const state = records.state
  const statePath = path
    .relative(records.root, records.layout.state.absolute)
    .split(path.sep)
    .join('/')

  if (state.status !== expected.status) {
    failures.push(`status is '${state.status}', expected '${expected.status}'`)
  }

  if (
    expected.current_stage !== undefined &&
    state.current_stage !== expected.current_stage
  ) {
    failures.push(
      `current_stage is '${String(state.current_stage)}', expected '${String(expected.current_stage)}'`,
    )
  }

  if (
    expected.pending_action !== undefined &&
    state.pending_action.type !== expected.pending_action
  ) {
    failures.push(
      `pending_action is '${state.pending_action.type}', expected '${expected.pending_action}'`,
    )
  }

  const sequence = expected.stage_sequence ?? []

  sequence.forEach((entry, index) => {
    const wanted = typeof entry === 'string' ? { stage: entry } : entry
    const actual = state.stage_history[index]

    if (!actual) {
      failures.push(
        `stage_history[${index}] is missing, expected '${wanted.stage}'`,
      )
      return
    }

    if (actual.stage !== wanted.stage) {
      failures.push(
        `stage_history[${index}] is '${actual.stage}', expected '${wanted.stage}'`,
      )
    }

    if (wanted.outcome !== undefined && actual.outcome !== wanted.outcome) {
      failures.push(
        `stage_history[${index}] outcome is '${actual.outcome}', expected '${wanted.outcome}'`,
      )
    }
  })

  const evidence = [statePath]

  for (const assertion of expected.output_assertions ?? []) {
    const history = latestHistoryForStage(records, assertion.stage)
    const output = history
      ? outputForInvocation(records, history.invocation_id)
      : undefined

    if (!output) {
      failures.push(`no submitted output for stage '${assertion.stage}'`)
      continue
    }

    evidence.push(output.path)

    const actual = readDotPath(output.output.data, assertion.path)

    if (JSON.stringify(actual) !== JSON.stringify(assertion.equals)) {
      failures.push(
        `${assertion.stage} output data.${assertion.path} is ${JSON.stringify(actual)}, expected ${JSON.stringify(assertion.equals)}`,
      )
    }
  }

  return {
    passed: failures.length === 0,
    summary:
      failures.length === 0
        ? `Run is '${state.status}' at '${String(state.current_stage)}' with the expected stage order.`
        : failures.join('; '),
    evidence,
    details: {
      expected,
      actual: {
        status: state.status,
        current_stage: state.current_stage,
        pending_action: state.pending_action.type,
        stage_sequence: state.stage_history.map((item) => ({
          stage: item.stage,
          outcome: item.outcome,
        })),
      },
      failures,
    },
    observability:
      'Compares state.json status, current_stage, pending_action.type, and the stage_history prefix with the scenario expectation, and dot-path assertions with the latest submitted output of a stage.',
  }
}
