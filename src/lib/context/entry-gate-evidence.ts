/** The failed entry gate's evidence a repairing stage reads (REMED-001). */

import { fileExists, resolveInside } from '../io.js'
import type { InvocationReference, StageDefinition } from '../types.js'
import { addReference, type InvocationContextOptions } from './references.js'

/**
 * The implementation record of a release run: the final integration record of
 * its cohort session and the latest verify output of every chunk run the
 * session fanned out. The release run itself has no implement stage, so
 * without these the verifier would grade an integrated tree with no account of
 * how it was built or checked.
 */
/**
 * When another stage's entry gate failed and routed the run here, the failed
 * gate's evidence is the input this stage repairs from (REMED-001). The run
 * returns to that gate on success, directly or along this stage's own success
 * path, so the evidence is required reading either way.
 */
export function selectEntryGateFailureEvidence(
  references: Map<string, InvocationReference>,
  missingRequired: string[],
  options: InvocationContextOptions,
  stage: StageDefinition,
): void {
  for (const [gateStage, record] of Object.entries(
    options.state.entry_gates ?? {},
  )) {
    if (
      record.repair_stage !== stage.slug ||
      record.last_result.passed ||
      record.last_result.disabled
    ) {
      continue
    }

    const result = record.last_result
    const route =
      record.routed_to === stage.slug
        ? `returns directly to '${gateStage}'`
        : `returns to '${gateStage}' along its own success path`
    const description =
      `Failed release gate \`${result.id}\` of stage '${gateStage}' ` +
      `(failure ${record.failures}). This stage repairs the recorded ` +
      `failure and ${route}, which runs the gate again.`

    if (!result.evidence_path) {
      continue
    }

    if (fileExists(resolveInside(options.root, result.evidence_path))) {
      addReference(references, {
        path: result.evidence_path,
        description,
        retrieval: 'required',
      })
    } else {
      missingRequired.push(result.evidence_path)
    }
  }
}
