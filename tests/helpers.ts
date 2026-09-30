// `perf HR-005`: this helper reaches no engine module, so a change to the
// engine or to one of its dependencies no longer selects every test that
// builds a fixture or an output. The two functions that drive a run live in
// tests/run-helpers.ts, and a test that needs them imports that surface.

// The fixture template and its clones live in tests/fixture-template.ts,
// which reaches no engine module either. They are re-exported here so a test
// that also drives runs keeps one import.
export {
  cloneTree,
  createFixture,
  createTestTempDirectory,
  pinFixturePersonaModel,
  sharedFixture,
} from './fixture-template.js'

export type { CloneTreeOptions } from './fixture-template.js'

export {
  read,
  writeJson,
  writeInspectionWorkflow,
  PLANNING_FIXTURE_SPECS,
  childSpecificationMarkdown,
  writePlanningFixtureSpecs,
  writeFixtureCursorCatalog,
} from './helpers/fixture-helpers.js'

export { makeOutput } from './helpers/output-helpers.js'

export {
  writeCanonicalDelegation,
  attachTargetInstructionEvidence,
  attestRunCard,
  attestForegroundReturn,
  makeAttestation,
  writeEvidenceReports,
} from './helpers/attestation-helpers.js'
