/**
 * Every refusal a stage-output validator can raise, and the declared field
 * each one blocks on.
 *
 * A worker learns a required shape from its rendered card, not from the
 * refusal it gets for breaking it. That only holds while the fields a
 * validator blocks on are the fields its stage contract declares, and the two
 * were separately maintained until the completeness proof below existed: the
 * verify handler shipped three fields short of its declaration, the ship
 * declaration named two of the thirty-three fields the release handler
 * refuses on, and the claims handler refused implement and remediate workers
 * on acceptance ids the contract never mentioned. Each round repaired the one
 * validator a verifier had named, so the next round found the next one.
 *
 * This module closes that by enumerating every validator the shared field
 * contract binds to a stage, rather than the one currently under review.
 * `tests/integration/validators-stage-validators-refusals.test.ts` reads each
 * handler's own source, and fails when a handler raises a refusal this
 * declaration does not carry or blocks on a path the stage contract does not
 * declare. A new refusal therefore fails a test rather than a worker.
 *
 * The declaration lives in `./refusals/`: the shapes, the delivery and
 * prototype refusal tables, and the source registry that binds each table
 * to the handler raising it. This module re-exports their public surface.
 */

export type {
  StageRefusal,
  RefusalSource,
  GeneratedRefusalCodes,
  StageValidatorRefusals,
  ValidatorBlockingFields,
} from './refusals/shapes.js'
export {
  CLAIMS_REFUSALS,
  PLAN_REFUSALS,
  RELEASE_REFUSALS,
  PR_DESCRIPTION_REFUSALS,
  TARGET_INSTRUCTION_REFUSALS,
} from './refusals/delivery.js'
export {
  PROTOTYPE_INTAKE_REFUSALS,
  APPROACH_REFUSALS,
  BUILD_REFUSALS,
  EVALUATE_REFUSALS,
} from './refusals/prototype.js'
export {
  UNCOVERED_REFUSAL_SOURCES,
  stageValidatorRefusals,
} from './refusals/sources.js'
