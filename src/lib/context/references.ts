/**
 * The context reference model: retrieval priority, reference construction,
 * read-status inspection, and the merge that adds one reference to a set.
 */

import { invariant } from '../errors.js'
import {
  resolveInside,
  fileExists,
  readText,
  referenceContentSha256,
} from '../io.js'
import type {
  InvocationReference,
  RunState,
  StageDefinition,
  WorkspaceSnapshot,
  PrDescriptionContext,
  InvocationReferenceRetrieval,
  ContextReference,
  ContextReferenceStatus,
} from '../types.js'

export interface AvailableReference extends InvocationReference {
  category: string
}

export interface InvocationContextOptions {
  root: string
  state: RunState
  stage: StageDefinition
  attempt: number
  invocationId: string
  workspaceFingerprint: string
  workspace?: WorkspaceSnapshot
  prDescription?: PrDescriptionContext
}

export interface ContextManifest {
  schema_version: 1
  invocation_id: string
  stage: string
  generated_at: string
  selected: InvocationReference[]
  omitted: AvailableReference[]
  missing_required: string[]
}

const RETRIEVAL_PRIORITY: Record<InvocationReferenceRetrieval, number> = {
  index_only: 0,
  conditional: 1,
  required: 2,
}

function normalizedRetrieval(
  reference: InvocationReference,
): InvocationReferenceRetrieval {
  return reference.retrieval ?? 'required'
}

export const DEFAULT_CONTEXT_REFERENCE_READ_TRIGGER =
  'Read this source before you decide anything that depends on scope outside your own work unit.'

/**
 * Build an audited pointer to one harness-relative document.
 *
 * The digest covers the trimmed file through `referenceContentSha256`, the
 * same basis `pan context digest` reports, so a digest a planner recorded with
 * that command agrees with the one the harness checks.
 */
export function buildContextReference(
  root: string,
  relativePath: string,
  readTrigger: string = DEFAULT_CONTEXT_REFERENCE_READ_TRIGGER,
): ContextReference {
  const absolute = resolveInside(root, relativePath)

  invariant(
    fileExists(absolute),
    `Context reference source does not exist: ${relativePath}`,
    { code: 'CONTEXT_REFERENCE_NOT_FOUND', details: { path: relativePath } },
  )

  const selected = readText(absolute).trim()

  return {
    source_path: relativePath,
    content_sha256: referenceContentSha256(selected),
    line_count: selected.split('\n').length,
    byte_length: Buffer.byteLength(selected, 'utf8'),
    read_trigger: readTrigger,
  }
}

/**
 * Compare a recorded context reference with the source on disk.
 *
 * Drift is reported rather than repaired. A silently refreshed digest would
 * hide an edit the run never read, and a hard failure would strand a run whose
 * parent specification gained an unrelated correction.
 */
export function contextReferenceStatus(
  root: string,
  reference: ContextReference,
): ContextReferenceStatus {
  return inspectContextReference(root, reference).status
}

export interface ContextReferenceInspection {
  status: ContextReferenceStatus
  /** Digest of the source on disk. Absent when the source is missing. */
  actual_content_sha256?: string
}

/**
 * Read the source a context reference points at and report how it compares
 * with the recorded digest. The actual digest travels with a drift report so
 * the card can print both values and a reader can tell an edit from a
 * substituted file.
 */
export function inspectContextReference(
  root: string,
  reference: ContextReference,
): ContextReferenceInspection {
  let absolute: string

  try {
    absolute = resolveInside(root, reference.source_path)
  } catch {
    return { status: 'missing' }
  }

  if (!fileExists(absolute)) {
    return { status: 'missing' }
  }

  const actual = referenceContentSha256(readText(absolute))

  return {
    status: actual === reference.content_sha256 ? 'current' : 'drifted',
    actual_content_sha256: actual,
  }
}

/**
 * Adds a reference to the map keyed by path. When the path is already present,
 * the entry with the stronger retrieval mode wins (`required` over
 * `conditional` over `index_only`); on a tie the existing entry is kept.
 */
export function addReference(
  references: Map<string, InvocationReference>,
  reference: InvocationReference,
): void {
  const existing = references.get(reference.path)

  if (!existing) {
    references.set(reference.path, reference)
    return
  }

  const existingPriority = RETRIEVAL_PRIORITY[normalizedRetrieval(existing)]
  const candidatePriority = RETRIEVAL_PRIORITY[normalizedRetrieval(reference)]

  if (candidatePriority > existingPriority) {
    references.set(reference.path, reference)
  }
}
