/**
 * The directed reference graph over every harness facility.
 *
 * This file is a re-export facade. The implementation lives in the modules
 * under `graph/`; new source importers should import the specific module.
 */

export { ALWAYS_READ_PATHS } from './graph/model.js'
export type {
  ReferrerClass,
  Reference,
  ReferenceGraph,
  ReferenceGraphOptions,
} from './graph/model.js'
export {
  buildReferenceGraph,
  alwaysReadTargets,
  findReferences,
  reachableFrom,
} from './graph/build.js'
