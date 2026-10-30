import path from 'node:path'

import { invariant } from '../errors.js'
import {
  fileExists,
  readJson,
  readText,
  resolveInside,
  sha256,
  toRepoRelative,
  writeJsonAtomic,
} from '../io.js'
import { isSelfDevelopmentInstallation } from '../project-config/resolve.js'
import {
  classifyIntake,
  SELF_DEVELOPMENT_LAYERS,
  TARGET_LAYERS,
  type IntakeClassification,
  type IntakeEstimate,
  type RouteStep,
} from './classification.js'

export const INTAKE_RECORD_SCHEMA_VERSION = 1

/** Workflow a route step starts while its own workflow is not installed. */
export const BOOTSTRAP_FALLBACK_WORKFLOW = 'planning'

export type IntakeStart =
  | {
      kind: 'workflow'
      workflow: string
      source: 'route' | 'fallback' | 'operator'
      reason: string | null
    }
  | { kind: 'decompose'; command: '/pan-decompose' }

export interface IntakeClassificationEntry {
  classified_at: string
  installation: 'self_development' | 'target'
  estimate: {
    sloc: number
    tssrfs: number
    modules: number
    layers: string[]
  }
  size_class: IntakeClassification['sizeClass']
  integration: boolean
  new_integration_points: boolean
  rationale: string
  route: RouteStep[]
  start: IntakeStart
  reclassification_reason: string | null
}

export interface IntakeRecord {
  schema_version: number
  request: string
  request_sha256: string
  augmented_request: { path: string; sha256: string } | null
  current: IntakeClassificationEntry
  history: IntakeClassificationEntry[]
}

export interface RecordIntakeOptions {
  root: string
  request: string
  estimate: IntakeEstimate
  rationale: string
  augmented?: string
  operatorWorkflow?: string
  reason?: string
  now?: Date
}

/** Layer names an estimate may use in this installation. */
export function intakeLayerVocabulary(root: string): readonly string[] {
  return isSelfDevelopmentInstallation(root)
    ? SELF_DEVELOPMENT_LAYERS
    : TARGET_LAYERS
}

/**
 * Record path for a request, keyed by its file stem so the record survives
 * `pan init` moving the request from the queue.
 */
export function intakeRecordPath(root: string, request: string): string {
  const stem = path.basename(request, path.extname(request))

  return path.join(root, 'runtime', 'intake', stem, 'classification.json')
}

export function readIntakeRecord(
  root: string,
  request: string,
): IntakeRecord | null {
  const recordPath = intakeRecordPath(root, request)

  return fileExists(recordPath) ? (readJson(recordPath) as IntakeRecord) : null
}

/**
 * First step the supervisor takes. An operator workflow wins; a route step
 * whose workflow is absent falls back to the bootstrap workflow.
 */
export function resolveIntakeStart(
  route: readonly RouteStep[],
  isInstalled: (workflow: string) => boolean,
  operatorWorkflow?: string,
): IntakeStart {
  if (operatorWorkflow) {
    invariant(
      isInstalled(operatorWorkflow),
      `Operator workflow ${operatorWorkflow} is not installed.`,
      { code: 'UNKNOWN_WORKFLOW' },
    )

    return {
      kind: 'workflow',
      workflow: operatorWorkflow,
      source: 'operator',
      reason: null,
    }
  }

  const [first] = route

  invariant(first, 'An intake route needs at least one step.')

  if (first === 'decompose') {
    return { kind: 'decompose', command: '/pan-decompose' }
  }

  if (isInstalled(first)) {
    return { kind: 'workflow', workflow: first, source: 'route', reason: null }
  }

  return {
    kind: 'workflow',
    workflow: BOOTSTRAP_FALLBACK_WORKFLOW,
    source: 'fallback',
    reason: `The ${first} workflow is not installed yet.`,
  }
}

/**
 * Classifies a request and appends the result to its durable record. A
 * request that already holds a record needs a reclassification reason.
 */
export function recordIntakeClassification(
  options: RecordIntakeOptions,
): IntakeRecord {
  const { root } = options
  const request = toRepoRelative(root, options.request)
  const requestPath = resolveInside(root, request)

  invariant(fileExists(requestPath), `Request file not found: ${request}`, {
    code: 'REQUEST_NOT_FOUND',
  })

  const rationale = options.rationale.trim()

  invariant(rationale.length > 0, 'Intake classification needs a rationale.', {
    code: 'INVALID_INTAKE_ESTIMATE',
  })

  const existing = readIntakeRecord(root, request)
  const reason = options.reason?.trim() || null

  invariant(
    existing === null || reason !== null,
    `Request ${request} is already classified; pass --reason to reclassify it.`,
    { code: 'RECLASSIFY_REASON_REQUIRED' },
  )

  const classification = classifyIntake(
    options.estimate,
    intakeLayerVocabulary(root),
  )
  const start = resolveIntakeStart(
    classification.route,
    (workflow) =>
      fileExists(
        path.join(root, 'library', 'workflows', workflow, 'workflow.json'),
      ),
    options.operatorWorkflow,
  )
  const entry: IntakeClassificationEntry = {
    classified_at: (options.now ?? new Date()).toISOString(),
    installation: isSelfDevelopmentInstallation(root)
      ? 'self_development'
      : 'target',
    estimate: {
      sloc: options.estimate.sloc,
      tssrfs: options.estimate.tssrfs,
      modules: options.estimate.modules,
      layers: [...new Set(options.estimate.layers)],
    },
    size_class: classification.sizeClass,
    integration: classification.integration,
    new_integration_points: classification.newIntegrationPoints,
    rationale,
    route: classification.route,
    start,
    reclassification_reason: existing === null ? null : reason,
  }
  const record: IntakeRecord = {
    schema_version: INTAKE_RECORD_SCHEMA_VERSION,
    request,
    request_sha256: sha256(readText(requestPath)),
    augmented_request: options.augmented
      ? augmentedReference(root, options.augmented)
      : (existing?.augmented_request ?? null),
    current: entry,
    history: [...(existing?.history ?? []), entry],
  }

  writeJsonAtomic(intakeRecordPath(root, request), record)

  return record
}

function augmentedReference(
  root: string,
  augmented: string,
): NonNullable<IntakeRecord['augmented_request']> {
  const relative = toRepoRelative(root, augmented)
  const absolute = resolveInside(root, relative)

  invariant(fileExists(absolute), `Augmented request not found: ${relative}`, {
    code: 'REQUEST_NOT_FOUND',
  })

  return { path: relative, sha256: sha256(readText(absolute)) }
}
