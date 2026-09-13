import {
  createRun as createEngineRun,
  submitOutput,
} from '../src/lib/engine.js'
import type { OperationProgressOptions } from '../src/lib/engine.js'
import { loadState } from '../src/lib/state.js'

import { attestForegroundReturn, attestRunCard } from './helpers.js'

import type { RunState } from '../src/lib/types.js'

/**
 * The engine-driving half of the shared test helpers.
 *
 * `perf HR-005`: `tests/helpers.ts` is imported by most of the suite, and its
 * static import of the engine put that module in every importer's closure.
 * The impacted profile then selected almost the whole lane for a change to
 * any engine dependency. A test that genuinely drives a run imports these two
 * functions from here; a test that only builds fixtures or outputs no longer
 * pays for the engine.
 */

/**
 * Create a run and attest its supervisor card. Tests drive runs as the
 * supervisor, so they carry the supervisor's attestation duty; the engine
 * function itself renders the card and leaves it unattested.
 */
export function createRun(
  root: string,
  options: Parameters<typeof createEngineRun>[1],
): RunState {
  const state = createEngineRun(root, options)

  attestRunCard(root, state.run_id)

  // The attestation advanced the persisted revision, so hand back the state
  // the disk holds rather than the pre-attestation object.
  return loadState(root, state.run_id)
}

/**
 * Submit a stage output the way a supervisor does: attest the foreground
 * return of the current worker launch, then run the submission. Tests that
 * drive a run through submit MUST use this helper; a test of the
 * `DELEGATION_UNOBSERVED` refusal itself calls `submitOutput` directly.
 */
export function submitAsSupervisor(
  root: string,
  runId: string,
  outputPath: string,
  options: OperationProgressOptions = {},
): ReturnType<typeof submitOutput> {
  attestForegroundReturn(root, runId)

  return submitOutput(root, runId, outputPath, options)
}
