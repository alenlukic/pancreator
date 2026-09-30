/**
 * Shared stage field-contract lookups and the repository validation of that
 * contract.
 */

import path from 'node:path'

import { fileExists, readJson, isRecord } from '../../io.js'
import { invariant } from '../../errors.js'
import { loadRegistry } from '../../requirements/registry.js'
import type { HandlerResult, HandlerInput } from '../../requirements/types.js'
import type { ValidatorBlockingFields } from '../refusals.js'
import { VALIDATOR_BLOCKING_FIELDS } from './refusal-registry.js'
import { issue } from './evidence.js'

interface SharedFieldRequirement {
  path: string
  type: string
  enum?: string[]
  required?: string[]
  accepted_shapes?: string[]
}

export function sharedFieldRequirements(
  root: string,
  stageSlug: string,
): SharedFieldRequirement[] {
  const sourcePath = path.join(
    root,
    'library',
    'schemas',
    'stage-output-requirements.json',
  )
  // No process.cwd() fallback: in a broken installation it would silently
  // substitute the contract of whatever checkout started the run, and
  // validate the target's outputs against a foreign document.
  invariant(
    fileExists(sourcePath),
    `${sourcePath} is missing. The installation MUST ship the shared stage ` +
      `output contract document.`,
    { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
  )

  const canonicalSourcePath = sourcePath
  const source = readJson(canonicalSourcePath)

  invariant(
    isRecord(source) && isRecord(source.stages),
    `${canonicalSourcePath} MUST contain a stage map.`,
    { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
  )

  const stage = source.stages[stageSlug]

  invariant(
    isRecord(stage) && Array.isArray(stage.fields),
    `${canonicalSourcePath}.stages.${stageSlug} MUST declare fields.`,
    { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
  )

  return stage.fields.filter(
    (field): field is SharedFieldRequirement =>
      isRecord(field) &&
      typeof field.path === 'string' &&
      typeof field.type === 'string' &&
      (field.enum === undefined ||
        (Array.isArray(field.enum) &&
          field.enum.every((entry) => typeof entry === 'string'))) &&
      (field.required === undefined ||
        (Array.isArray(field.required) &&
          field.required.every((entry) => typeof entry === 'string'))) &&
      (field.accepted_shapes === undefined ||
        (Array.isArray(field.accepted_shapes) &&
          field.accepted_shapes.every((entry) => typeof entry === 'string'))),
  )
}

export function sharedEnum(
  root: string,
  stageSlug: string,
  fieldPath: string,
): Set<string> {
  const field = sharedFieldRequirements(root, stageSlug).find(
    (candidate) => candidate.path === fieldPath,
  )

  return new Set(field?.enum ?? [])
}

/**
 * Direct string-valued children of one declared field.
 *
 * The callers use these as the fields every item MUST carry as non-empty
 * text, so a child of another type is not one of them: an optional object
 * child would otherwise be demanded of every item as a string.
 */
export function sharedChildFields(
  root: string,
  stageSlug: string,
  fieldPrefix: string,
): string[] {
  return sharedFieldRequirements(root, stageSlug)
    .map((field) =>
      field.path.startsWith(fieldPrefix) && field.type === 'string'
        ? field.path.slice(fieldPrefix.length)
        : null,
    )
    .filter(
      (field): field is string =>
        field !== null && field.length > 0 && !field.includes('.'),
    )
}

export function sharedRequiredChildFields(
  root: string,
  stageSlug: string,
  parentPath: string,
): string[] {
  const parent = sharedFieldRequirements(root, stageSlug).find(
    (field) => field.path === parentPath,
  )

  return parent?.required ?? []
}

export function validEvidenceShape(
  entry: string,
  acceptedShapes: Set<string>,
): boolean {
  const value = entry.trim()
  const pathReference =
    acceptedShapes.has('path_reference') &&
    !/\s/u.test(value) &&
    /(?:^|\/)[^/]+\.[a-z0-9]+(?::\d+(?::\d+)?)?$/iu.test(value)
  const proseObservation =
    acceptedShapes.has('prose_observation') &&
    value.length >= 12 &&
    /\s/u.test(value)
  const pytestNodeId =
    acceptedShapes.has('pytest_node_id') &&
    !/\s/u.test(value) &&
    /^[^:]+::[^:]+(?:::[^:]+)*$/u.test(value)

  return pathReference || proseObservation || pytestNodeId
}

/**
 * Blocking fields a registry does not declare in its `enforced_fields`.
 *
 * Every refusal a stage validator can raise against a field has to be a field
 * the worker's card already declared. The enforced-field rule in
 * `validateSharedFieldContract` carries the second half: an enforced path
 * MUST also appear in `fields[]`, so one `enforced_fields` entry reaches the
 * card and the scaffold.
 *
 * `blocking` is a parameter so a test can prove the check is general by
 * passing a declaration it invented, rather than by mutating the exported
 * one and relying on a restore.
 */
export function undeclaredBlockingFieldIssues(
  source: Record<string, unknown>,
  blocking: readonly ValidatorBlockingFields[] = VALIDATOR_BLOCKING_FIELDS,
): HandlerResult['issues'] {
  const issues: HandlerResult['issues'] = []
  const stages = isRecord(source.stages) ? source.stages : {}

  for (const entry of blocking) {
    const stage = stages[entry.stage]
    const contract =
      isRecord(stage) && Array.isArray(stage.validators)
        ? stage.validators.find(
            (candidate) =>
              isRecord(candidate) &&
              candidate.registry_id === entry.registry_id,
          )
        : null
    const enforced = new Set(
      isRecord(contract) && Array.isArray(contract.enforced_fields)
        ? contract.enforced_fields.filter(
            (value): value is string => typeof value === 'string',
          )
        : [],
    )

    for (const fieldPath of entry.fields) {
      if (!enforced.has(fieldPath)) {
        issues.push(
          issue(
            'field_contract.validator_blocking_field',
            `Validator ${entry.registry_id} blocks the ${entry.stage} ` +
              `stage on ${fieldPath}, so its enforced_fields MUST declare it`,
          ),
        )
      }
    }
  }

  return issues
}

export function validateSharedFieldContract(
  input: HandlerInput,
): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const source = readJson(path.join(input.root, input.targetPath))

  if (
    !isRecord(source) ||
    source.schema_version !== 1 ||
    source.policy_id !== 'CONTRACT-001' ||
    source.validator_id !== 'FIELD-CONTRACT-VALIDATE-001' ||
    !isRecord(source.criterion_results) ||
    !isRecord(source.stages)
  ) {
    return {
      status: 'failed',
      issues: [
        issue(
          'field_contract.shape',
          'The shared field contract MUST declare its schema, policy, validator, and stages',
        ),
      ],
    }
  }

  for (const result of ['unevaluated', 'skipped', 'not_applicable']) {
    const meaning = source.criterion_results[result]

    if (typeof meaning !== 'string' || meaning.trim().length === 0) {
      issues.push(
        issue(
          'field_contract.criterion_result',
          `The shared field contract MUST explain criterion result ${result}`,
        ),
      )
    }
  }

  const registryIds = new Set(loadRegistry(input.root).entries.keys())

  for (const stageSlug of [
    'plan',
    'implement',
    'verify',
    'remediate',
    'ship',
    'prototype:intake',
    'approach',
    'build',
    'evaluate',
  ]) {
    const stage = source.stages[stageSlug]

    if (
      !isRecord(stage) ||
      !Array.isArray(stage.validators) ||
      !Array.isArray(stage.fields) ||
      stage.validators.length === 0 ||
      stage.fields.length === 0
    ) {
      issues.push(
        issue(
          'field_contract.stage',
          `The ${stageSlug} field contract MUST declare validators and fields`,
        ),
      )
      continue
    }

    const declaredPaths = new Set(
      stage.fields
        .filter(
          (field): field is Record<string, unknown> =>
            isRecord(field) && typeof field.path === 'string',
        )
        .map((field) => field.path as string),
    )
    const enforcedPaths = new Set<string>()

    for (const validator of stage.validators) {
      if (
        !isRecord(validator) ||
        typeof validator.registry_id !== 'string' ||
        !registryIds.has(validator.registry_id) ||
        (validator.enforcement !== 'blocks' &&
          validator.enforcement !== 'advises')
      ) {
        issues.push(
          issue(
            'field_contract.validator',
            `The ${stageSlug} field contract contains an invalid validator`,
          ),
        )
        continue
      }

      const enforcedFields = Array.isArray(validator.enforced_fields)
        ? validator.enforced_fields.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : []

      for (const fieldPath of enforcedFields) {
        enforcedPaths.add(fieldPath)

        if (!declaredPaths.has(fieldPath)) {
          issues.push(
            issue(
              'field_contract.enforced_field',
              `Validator ${validator.registry_id} enforces undeclared field ${fieldPath}`,
            ),
          )
        }
      }
    }

    // Every declared field that requires children, in every stage. The guard
    // once read the plan file contract alone, so a later stage that declared a
    // required child gained no coverage and no signal that it had none.
    for (const field of stage.fields) {
      if (
        !isRecord(field) ||
        typeof field.path !== 'string' ||
        !Array.isArray(field.required)
      ) {
        continue
      }

      for (const child of field.required) {
        if (typeof child !== 'string') {
          continue
        }

        const childPath = `${field.path}.${child}`
        // An array-valued child declares its item shape under the `[]` suffix,
        // which is the same declaration by another name.
        const declared = (paths: Set<string>): boolean =>
          paths.has(childPath) || paths.has(`${childPath}[]`)

        if (!declared(declaredPaths)) {
          issues.push(
            issue(
              'field_contract.required_child_shape',
              `Required child ${childPath} MUST declare its field shape`,
            ),
          )
        }

        if (!declared(enforcedPaths)) {
          issues.push(
            issue(
              'field_contract.required_child_enforcement',
              `Required child ${childPath} MUST name validator enforcement`,
            ),
          )
        }
      }
    }

    const fields = sharedFieldRequirements(input.root, stageSlug)

    if (fields.length !== stage.fields.length) {
      issues.push(
        issue(
          'field_contract.field',
          `The ${stageSlug} field contract contains an invalid field`,
        ),
      )
    }
  }

  issues.push(...undeclaredBlockingFieldIssues(source))

  const releaseChangeList = sharedFieldRequirements(input.root, 'ship').find(
    (field) => field.path === 'data.release.change_list[]',
  )

  if (
    !['path', 'kind', 'description'].every((field) =>
      releaseChangeList?.required?.includes(field),
    )
  ) {
    issues.push(
      issue(
        'field_contract.release_change_list',
        'The ship change list MUST require path, kind, and description',
      ),
    )
  }

  const expectedVerifyEnums: Record<string, string[]> = {
    'data.verify.verdict': [
      'pass',
      'pass_with_warnings',
      'fail_remedial',
      'fail_severe',
    ],
    'data.verify.findings[].severity': ['blocker', 'high', 'medium', 'low'],
    'data.verify.findings[].source': [
      'review',
      'qa',
      'design-review',
      'design-qa',
    ],
  }

  const expectedPrototypeEnums: Record<string, Record<string, string[]>> = {
    approach: {
      'data.technical_approach.preconditions[].status': [
        'ready',
        'unavailable',
        'unknown',
      ],
    },
    build: {
      'data.spike.precondition_checks[].status': [
        'ready',
        'unavailable',
        'unknown',
      ],
    },
    evaluate: {
      'data.evaluation.verdict': [
        'validated',
        'invalidated',
        'inconclusive',
        'environment_blocked',
      ],
      'data.evaluation.question_results[].cause': [
        'product',
        'environment',
        'mixed',
        'none',
      ],
    },
  }

  for (const [stageSlug, fields] of Object.entries(expectedPrototypeEnums)) {
    for (const [fieldPath, expected] of Object.entries(fields)) {
      const actual = sharedEnum(input.root, stageSlug, fieldPath)

      if (
        actual.size !== expected.length ||
        !expected.every((value) => actual.has(value))
      ) {
        issues.push(
          issue(
            'field_contract.prototype_enum',
            `The ${stageSlug} field ${fieldPath} MUST declare its canonical values`,
          ),
        )
      }
    }
  }

  for (const [fieldPath, expected] of Object.entries(expectedVerifyEnums)) {
    const actual = sharedEnum(input.root, 'verify', fieldPath)

    if (
      actual.size !== expected.length ||
      !expected.every((value) => actual.has(value))
    ) {
      issues.push(
        issue(
          'field_contract.verify_enum',
          `The verify field ${fieldPath} MUST declare its canonical values`,
        ),
      )
    }
  }

  const implementationEvidence = sharedFieldRequirements(
    input.root,
    'implement',
  ).find((field) => field.path === 'data.acceptance_results[].evidence[]')
  const evidenceShapes = new Set(implementationEvidence?.accepted_shapes ?? [])

  if (
    !['path_reference', 'prose_observation', 'pytest_node_id'].every((shape) =>
      evidenceShapes.has(shape),
    )
  ) {
    issues.push(
      issue(
        'field_contract.evidence_shapes',
        'Implementation evidence MUST accept path, prose, and pytest shapes',
      ),
    )
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}
