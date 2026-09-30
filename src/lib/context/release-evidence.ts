/**
 * The implementation record of a release run: its cohort session's final
 * integration record and the verify output of every chunk run.
 */

import path from 'node:path'

import { fileExists, resolveInside, readJson, isRecord } from '../io.js'
import { statePath, loadState } from '../state.js'
import type { InvocationReference, RunState } from '../types.js'
import { addReference } from './references.js'
import { addStageHistoryReference } from './stage-outputs.js'

/**
 * On a cohort release run, adds the implementation record that replaces an
 * implement output: the cohort session's final integration record, each
 * non-abandoned chunk's child specification, and each chunk run's latest verify
 * output, all as required references. Appends each one that is absent to
 * `missingRequired`. Does nothing on any other run.
 */
export function selectReleaseEvidence(
  references: Map<string, InvocationReference>,
  missingRequired: string[],
  root: string,
  state: RunState,
): void {
  const binding = state.cohort

  if (binding?.role !== 'release') {
    return
  }

  if (fileExists(resolveInside(root, binding.integration_record))) {
    addReference(references, {
      path: binding.integration_record,
      description:
        `Final integration record of cohort session ${binding.cohort_id}. ` +
        "On a release run this record and the chunk runs' verify outputs " +
        'listed here are the implementation record; no implement stage ' +
        'output exists.',
      retrieval: 'required',
    })
  } else {
    missingRequired.push(binding.integration_record)
  }

  for (const chunk of cohortChunks(root, binding.cohort_id)) {
    // The child specification holds the acceptance criteria and validation
    // cases of the chunk. The release run has no plan output of its own, so
    // these are what its verify grades against.
    if (fileExists(resolveInside(root, chunk.child_spec_path))) {
      addReference(references, {
        path: chunk.child_spec_path,
        description:
          `Child specification of chunk '${chunk.id}': the acceptance ` +
          'criteria and validation cases this release verify grades',
        retrieval: 'required',
      })
    } else {
      missingRequired.push(chunk.child_spec_path)
    }

    if (!chunk.state) {
      continue
    }

    const verify = [...chunk.state.stage_history]
      .reverse()
      .find((item) => item.stage === 'verify')

    if (!verify) {
      missingRequired.push(
        `verify output of chunk '${chunk.id}' run ${chunk.state.run_id}`,
      )
      continue
    }

    addStageHistoryReference(
      references,
      verify,
      `Chunk '${chunk.id}' verify stage output (${verify.outcome}), run ${chunk.state.run_id}`,
      'required',
    )
  }
}

/**
 * Non-abandoned chunks a cohort session records, with the run each one
 * started when that run's record exists. The session file is read directly
 * rather than through the cohort module, which imports the engine that
 * imports this module.
 */
function cohortChunks(
  root: string,
  cohortId: string,
): Array<{ id: string; child_spec_path: string; state: RunState | null }> {
  const sessionPath = path.join(
    root,
    'runtime',
    'logs',
    'cohorts',
    cohortId,
    'state.json',
  )

  if (!fileExists(sessionPath)) {
    return []
  }

  const session = readJson(sessionPath)

  if (!isRecord(session) || !Array.isArray(session.chunks)) {
    return []
  }

  const chunks: Array<{
    id: string
    child_spec_path: string
    state: RunState | null
  }> = []

  for (const chunk of session.chunks) {
    if (
      !isRecord(chunk) ||
      typeof chunk.id !== 'string' ||
      typeof chunk.child_spec_path !== 'string' ||
      chunk.abandoned !== undefined
    ) {
      continue
    }

    chunks.push({
      id: chunk.id,
      child_spec_path: chunk.child_spec_path,
      state:
        typeof chunk.run_id === 'string' &&
        fileExists(statePath(root, chunk.run_id))
          ? loadState(root, chunk.run_id)
          : null,
    })
  }

  return chunks
}
