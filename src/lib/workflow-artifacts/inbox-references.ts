import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { findProjectRoot } from '../io.js'
import {
  ARTIFACT_REFERENCE_PATTERN,
  artifactIdentity,
  collectInvocationIds,
  isClosedRunStatus,
  normalizedUuidSuffix,
  replaceMappings,
  textFileContent,
  workflowStageSlugs,
} from './identity.js'
import { exactRunInboxFiles } from './layout.js'
import { tryReadRunStatus } from './mutable-files.js'
import { currentRunDate } from './run-ids.js'

export interface WorkflowReferenceAmbiguity {
  path: string
  reference: string
  candidates: string[]
}

export interface WorkflowReferenceSkip {
  run_id: string
  reason: string
}

export interface WorkflowReferenceRepairSummary {
  changed_paths: string[]
  ambiguities: WorkflowReferenceAmbiguity[]
  /** Runs whose state file could not be read, so the pass passed them by. */
  skipped_runs: WorkflowReferenceSkip[]
}

/**
 * Return the sorted names of the subdirectories of `directory` that carry a
 * current temporal run id, excluding `archive`. Returns an empty list when the
 * directory does not exist.
 */
export function activeWorkflowDirectoryNames(directory: string): string[] {
  if (!existsSync(directory)) {
    return []
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== 'archive' &&
        currentRunDate(entry.name) !== null,
    )
    .map((entry) => entry.name)
    .sort()
}

function referenceCandidates(
  reference: string,
  stageSlugs: ReadonlySet<string>,
  finalInvocationIds: string[],
): string[] {
  const identity = artifactIdentity(reference, stageSlugs)

  if (!identity) {
    return []
  }

  const suffix = normalizedUuidSuffix(identity)

  return finalInvocationIds.filter((invocationId) => {
    const candidate = artifactIdentity(invocationId, stageSlugs)

    return (
      candidate !== null &&
      candidate.stageSlug === identity.stageSlug &&
      candidate.stageIteration === identity.stageIteration &&
      normalizedUuidSuffix(candidate) === suffix
    )
  })
}

/**
 * For each closed run, rewrite stale invocation ids quoted in the run's own
 * inbox items to the final sequenced ids and return a summary. A file with an
 * ambiguous reference is reported and left unchanged, and a run whose state
 * file cannot be read is skipped with its reason.
 */
export function repairWorkflowInboxReferences(
  root = findProjectRoot(),
): WorkflowReferenceRepairSummary {
  const logRoot = path.join(root, 'runtime', 'logs', 'workflows')
  const changedPaths: string[] = []
  const ambiguities: WorkflowReferenceAmbiguity[] = []
  const skippedRuns: WorkflowReferenceSkip[] = []

  for (const runId of activeWorkflowDirectoryNames(logRoot)) {
    const runDirectory = path.join(logRoot, runId)
    const { status, reason } = tryReadRunStatus(runDirectory)

    // One closed run with an unreadable state file used to abort the whole
    // pass. It is recorded and passed by instead.
    if (status === null) {
      skippedRuns.push({ run_id: runId, reason: reason ?? 'unknown' })
      continue
    }

    if (!isClosedRunStatus(status)) {
      continue
    }

    const stageSlugs = workflowStageSlugs(runDirectory)
    const finalInvocationIds = collectInvocationIds(runDirectory)

    for (const filePath of exactRunInboxFiles(root, runId)) {
      const content = textFileContent(filePath)

      if (content === null) {
        continue
      }

      const mappings = new Map<string, string>()
      const fileAmbiguities = new Map<string, WorkflowReferenceAmbiguity>()

      for (const reference of new Set(
        content.match(ARTIFACT_REFERENCE_PATTERN) ?? [],
      )) {
        const candidates = referenceCandidates(
          reference,
          stageSlugs,
          finalInvocationIds,
        )

        if (candidates.length === 1 && candidates[0] !== reference) {
          mappings.set(reference, candidates[0])
        } else if (candidates.length > 1) {
          const relativePath = path
            .relative(root, filePath)
            .split(path.sep)
            .join('/')

          fileAmbiguities.set(reference, {
            path: relativePath,
            reference,
            candidates: [...candidates].sort(),
          })
        }
      }

      if (fileAmbiguities.size > 0) {
        ambiguities.push(...fileAmbiguities.values())
        continue
      }

      const updated = replaceMappings(content, mappings)

      if (updated !== content) {
        writeFileSync(filePath, updated, 'utf8')
        changedPaths.push(
          path.relative(root, filePath).split(path.sep).join('/'),
        )
      }
    }
  }

  return {
    changed_paths: changedPaths.sort(),
    ambiguities: ambiguities.sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    skipped_runs: skippedRuns.sort((left, right) =>
      left.run_id.localeCompare(right.run_id),
    ),
  }
}
