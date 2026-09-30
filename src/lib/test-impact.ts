/**
 * Impacted-test selection from static import analysis.
 *
 * `pan tests impacted` builds the TypeScript module graph of `src/` and
 * `tests/`, takes the change set from Git, and selects every test file in the
 * mainline lanes whose import closure reaches a changed module. The selection
 * is the deterministic blast radius a coder or remediator iterates on instead
 * of the whole `fast` profile. It is a self-development iteration aid, never a
 * gate, and it refuses in embedded and detached installations.
 *
 * This file is a re-export facade. The implementation lives in the modules
 * under `test-impact/`; new source importers should import the specific module.
 */

export {
  TEST_LANES,
  SELECTABLE_LANES,
  GLOBAL_FILES,
  DATA_ROOTS,
  DATA_FILES,
  GENERATED_ROOTS,
  DEFAULT_ADVISORY_RATIO,
  RECORD_RELATIVE_PATH,
  IMPACTED_COMMAND,
  HARNESS_TESTS_SELF_DEVELOPMENT_ONLY,
} from './test-impact/model.js'
export type {
  ModuleGraph,
  Selection,
  ImpactOptions,
  ImpactResult,
  ImpactOutputMode,
  RunTestsImpactedOptions,
} from './test-impact/model.js'
export {
  parseSpecifiersByRegex,
  loadTypeScript,
  parseSpecifiersByTypeScript,
  resolveSpecifier,
  referencesBinScript,
  referencesFixture,
  isLaneTest,
  DATA_ID,
  isDataReference,
  extractSpecialReferences,
} from './test-impact/parse.js'
export type { ParsedSpecifiers } from './test-impact/parse.js'
export {
  buildModuleGraphByRegex,
  buildModuleGraph,
  isReExportFacade,
  reverseClosure,
  laneTests,
} from './test-impact/graph.js'
export type { Reach } from './test-impact/graph.js'
export { dataSeedKeys, selectImpactedTests } from './test-impact/select.js'
export {
  dirtyPaths,
  stagedPaths,
  resolveChangeSet,
} from './test-impact/changes.js'
export {
  testCommandArgs,
  parseImpactArgs,
  runTestsImpacted,
} from './test-impact/run.js'
