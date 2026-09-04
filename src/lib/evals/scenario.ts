import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { PanError } from '../errors.js'
import { fileExists, isRecord, readJson } from '../io.js'
import {
  EVAL_GRADER_IDS,
  EVAL_SCENARIO_SCHEMA_VERSION,
  EVAL_WORKFLOWS,
  type EvalScenario,
  type LoadedEvalScenario,
} from './types.js'

export const EVAL_SCENARIOS_DIR = 'evals/scenarios'
export const EVAL_FIXTURES_DIR = 'evals/fixtures'
export const EVAL_SCENARIO_SCHEMA_PATH =
  'library/schemas/eval-scenario.schema.json'

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u
const POLICY_ID_PATTERN = /^[A-Z]+-[0-9]{3}$/u
const POLICY_REFERENCE_PATTERN = /^[A-Z]+-[0-9]{3}(#[0-9]+)?$/u
const RUN_STATUSES = new Set([
  'running',
  'awaiting_supervisor',
  'awaiting_operator',
  'paused',
  'succeeded',
  'failed',
  'canceled',
])
const OUTCOMES = new Set(['success', 'failure', 'blocked'])
const DECISIONS = new Set(['approve', 'reject', 'revise'])
const TOP_LEVEL_KEYS = new Set([
  'schema_version',
  'name',
  'description',
  'policy_instructions',
  'fixture',
  'request',
  'workflow',
  'verification',
  'involvement',
  'pipeline_config',
  'cohort',
  'operator_decisions',
  'expected',
  'graders',
])
const EXPECTED_KEYS = new Set([
  'status',
  'current_stage',
  'pending_action',
  'stage_sequence',
  'output_assertions',
])

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Structural validation of one scenario document. The harness has no generic
 * JSON-schema engine, so this mirrors library/schemas/eval-scenario.schema.json
 * by hand; keep the two in step.
 */
export function validateEvalScenarioDocument(
  value: unknown,
  expectedName?: string,
): string[] {
  const errors: string[] = []

  if (!isRecord(value)) {
    return ['scenario MUST be a JSON object']
  }

  for (const key of Object.keys(value)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      errors.push(`unknown top-level field '${key}'`)
    }
  }

  if (value.schema_version !== EVAL_SCENARIO_SCHEMA_VERSION) {
    errors.push(`schema_version MUST be ${EVAL_SCENARIO_SCHEMA_VERSION}`)
  }

  if (!nonEmptyString(value.name) || !NAME_PATTERN.test(value.name)) {
    errors.push('name MUST be a lowercase kebab-case identifier')
  } else if (expectedName !== undefined && value.name !== expectedName) {
    errors.push(
      `name '${value.name}' MUST equal the file name '${expectedName}'`,
    )
  }

  if (!nonEmptyString(value.description)) {
    errors.push('description MUST be a non-empty string')
  }

  if (
    !Array.isArray(value.policy_instructions) ||
    value.policy_instructions.length === 0
  ) {
    errors.push('policy_instructions MUST be a non-empty array')
  } else {
    value.policy_instructions.forEach((item, index) => {
      const label = `policy_instructions[${index}]`

      if (!isRecord(item)) {
        errors.push(`${label} MUST be an object`)
        return
      }

      if (
        !nonEmptyString(item.policy_id) ||
        !POLICY_ID_PATTERN.test(item.policy_id)
      ) {
        errors.push(`${label}.policy_id MUST look like DEV-001`)
      }

      if (
        !Number.isInteger(item.instruction) ||
        (item.instruction as number) < 1
      ) {
        errors.push(`${label}.instruction MUST be a positive integer`)
      }

      if (!nonEmptyString(item.summary)) {
        errors.push(`${label}.summary MUST be a non-empty string`)
      }
    })
  }

  if (!nonEmptyString(value.fixture) || !NAME_PATTERN.test(value.fixture)) {
    errors.push('fixture MUST be a lowercase kebab-case directory name')
  }

  if (!nonEmptyString(value.request)) {
    errors.push('request MUST be a non-empty string')
  }

  if (
    typeof value.workflow !== 'string' ||
    !(EVAL_WORKFLOWS as readonly string[]).includes(value.workflow)
  ) {
    errors.push(`workflow MUST be one of ${EVAL_WORKFLOWS.join(', ')}`)
  }

  if (!nonEmptyString(value.verification)) {
    errors.push('verification MUST be a non-empty string')
  }

  if (value.involvement !== undefined && !nonEmptyString(value.involvement)) {
    errors.push('involvement MUST be a non-empty string when present')
  }

  if (
    value.pipeline_config !== undefined &&
    !nonEmptyString(value.pipeline_config)
  ) {
    errors.push('pipeline_config MUST be a non-empty string when present')
  }

  if (value.cohort !== undefined) {
    if (!isRecord(value.cohort)) {
      errors.push('cohort MUST be an object when present')
    } else {
      if (value.workflow !== 'planning') {
        errors.push("cohort is accepted only with the 'planning' workflow")
      }

      for (const key of Object.keys(value.cohort)) {
        if (key !== 'autostart' && key !== 'max_parallel') {
          errors.push(`unknown cohort field '${key}'`)
        }
      }

      if (typeof value.cohort.autostart !== 'boolean') {
        errors.push('cohort.autostart MUST be a boolean')
      }

      if (
        value.cohort.max_parallel !== undefined &&
        (!Number.isInteger(value.cohort.max_parallel) ||
          (value.cohort.max_parallel as number) < 1)
      ) {
        errors.push('cohort.max_parallel MUST be an integer of at least 1')
      }
    }
  }

  if (value.operator_decisions !== undefined) {
    if (!Array.isArray(value.operator_decisions)) {
      errors.push('operator_decisions MUST be an array')
    } else {
      value.operator_decisions.forEach((item, index) => {
        const label = `operator_decisions[${index}]`

        if (!isRecord(item)) {
          errors.push(`${label} MUST be an object`)
          return
        }

        if (!nonEmptyString(item.stage)) {
          errors.push(`${label}.stage MUST be a non-empty string`)
        }

        if (
          typeof item.decision !== 'string' ||
          !DECISIONS.has(item.decision)
        ) {
          errors.push(`${label}.decision MUST be approve, reject, or revise`)
        }

        if (item.note !== undefined && typeof item.note !== 'string') {
          errors.push(`${label}.note MUST be a string`)
        }
      })
    }
  }

  if (!isRecord(value.expected)) {
    errors.push('expected MUST be an object')
  } else {
    const expected = value.expected

    for (const key of Object.keys(expected)) {
      if (!EXPECTED_KEYS.has(key)) {
        errors.push(`unknown expected field '${key}'`)
      }
    }

    if (
      typeof expected.status !== 'string' ||
      !RUN_STATUSES.has(expected.status)
    ) {
      errors.push('expected.status MUST be a run status')
    }

    if (
      expected.current_stage !== undefined &&
      expected.current_stage !== null &&
      !nonEmptyString(expected.current_stage)
    ) {
      errors.push('expected.current_stage MUST be a string or null')
    }

    if (
      expected.pending_action !== undefined &&
      !nonEmptyString(expected.pending_action)
    ) {
      errors.push('expected.pending_action MUST be a non-empty string')
    }

    if (expected.stage_sequence !== undefined) {
      if (!Array.isArray(expected.stage_sequence)) {
        errors.push('expected.stage_sequence MUST be an array')
      } else {
        expected.stage_sequence.forEach((entry, index) => {
          const label = `expected.stage_sequence[${index}]`

          if (nonEmptyString(entry)) {
            return
          }

          if (!isRecord(entry) || !nonEmptyString(entry.stage)) {
            errors.push(`${label} MUST be a stage slug or {stage, outcome}`)
            return
          }

          if (
            entry.outcome !== undefined &&
            (typeof entry.outcome !== 'string' || !OUTCOMES.has(entry.outcome))
          ) {
            errors.push(`${label}.outcome MUST be success, failure, or blocked`)
          }
        })
      }
    }

    if (expected.output_assertions !== undefined) {
      if (!Array.isArray(expected.output_assertions)) {
        errors.push('expected.output_assertions MUST be an array')
      } else {
        expected.output_assertions.forEach((entry, index) => {
          const label = `expected.output_assertions[${index}]`

          if (
            !isRecord(entry) ||
            !nonEmptyString(entry.stage) ||
            !nonEmptyString(entry.path) ||
            !('equals' in entry)
          ) {
            errors.push(`${label} MUST carry stage, path, and equals`)
          }
        })
      }
    }
  }

  if (!Array.isArray(value.graders) || value.graders.length === 0) {
    errors.push('graders MUST be a non-empty array')
  } else {
    value.graders.forEach((item, index) => {
      const label = `graders[${index}]`

      if (!isRecord(item)) {
        errors.push(`${label} MUST be an object`)
        return
      }

      if (
        typeof item.id !== 'string' ||
        !(EVAL_GRADER_IDS as readonly string[]).includes(item.id)
      ) {
        errors.push(`${label}.id MUST be one of ${EVAL_GRADER_IDS.join(', ')}`)
      }

      if (
        item.policy !== undefined &&
        (typeof item.policy !== 'string' ||
          !POLICY_REFERENCE_PATTERN.test(item.policy))
      ) {
        errors.push(`${label}.policy MUST look like DEV-001#6`)
      }

      if (item.config !== undefined && !isRecord(item.config)) {
        errors.push(`${label}.config MUST be an object`)
      }

      for (const key of Object.keys(item)) {
        if (!['id', 'policy', 'config'].includes(key)) {
          errors.push(`${label} has unknown field '${key}'`)
        }
      }
    })
  }

  return errors
}

export function scenarioPath(root: string, name: string): string {
  return path.join(root, EVAL_SCENARIOS_DIR, `${name}.json`)
}

export function fixturePath(root: string, fixture: string): string {
  return path.join(root, EVAL_FIXTURES_DIR, fixture)
}

export function listEvalScenarioNames(root: string): string[] {
  const directory = path.join(root, EVAL_SCENARIOS_DIR)

  if (!existsSync(directory)) {
    return []
  }

  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => entry.slice(0, -'.json'.length))
    .sort()
}

export function loadEvalScenario(
  root: string,
  name: string,
): LoadedEvalScenario {
  if (!NAME_PATTERN.test(name)) {
    throw new PanError(`Invalid eval scenario name: ${name}`, {
      code: 'INVALID_ARGUMENT',
    })
  }

  const absolute = scenarioPath(root, name)

  if (!fileExists(absolute)) {
    throw new PanError(
      `Unknown eval scenario '${name}'. Available: ${
        listEvalScenarioNames(root).join(', ') || '(none)'
      }.`,
      { code: 'EVAL_SCENARIO_NOT_FOUND' },
    )
  }

  const value = readJson(absolute)
  const errors = validateEvalScenarioDocument(value, name)

  if (errors.length > 0) {
    throw new PanError(
      `Eval scenario '${name}' is invalid: ${errors.join('; ')}`,
      { code: 'INVALID_EVAL_SCENARIO', details: { errors } },
    )
  }

  return {
    scenario: value as EvalScenario,
    path: `${EVAL_SCENARIOS_DIR}/${name}.json`,
  }
}

export function listEvalScenarios(root: string): LoadedEvalScenario[] {
  return listEvalScenarioNames(root).map((name) => loadEvalScenario(root, name))
}

/**
 * `pan validate` hook. A checkout without evals/ (a target installation)
 * reports nothing. A checkout with scenarios needs the schema file, valid
 * documents, and an existing fixture directory per scenario.
 */
export function validateEvalScenarios(root: string): string[] {
  const errors: string[] = []
  const names = listEvalScenarioNames(root)

  if (names.length === 0) {
    return errors
  }

  if (!fileExists(path.join(root, EVAL_SCENARIO_SCHEMA_PATH))) {
    errors.push(`missing required file: ${EVAL_SCENARIO_SCHEMA_PATH}`)
  }

  for (const name of names) {
    const relative = `${EVAL_SCENARIOS_DIR}/${name}.json`
    let value: unknown

    try {
      value = readJson(scenarioPath(root, name))
    } catch (error) {
      errors.push(
        `${relative}: ${error instanceof Error ? error.message : String(error)}`,
      )
      continue
    }

    const documentErrors = validateEvalScenarioDocument(value, name)

    errors.push(...documentErrors.map((message) => `${relative}: ${message}`))

    if (documentErrors.length === 0) {
      const scenario = value as EvalScenario

      if (!existsSync(fixturePath(root, scenario.fixture))) {
        errors.push(
          `${relative}: fixture '${scenario.fixture}' is missing under ${EVAL_FIXTURES_DIR}/`,
        )
      }
    }
  }

  return errors
}
