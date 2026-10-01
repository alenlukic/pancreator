/** Lane, data-root, and record constants and the shared selection types. */

import type { FailingTest } from '../check-output.js'

/**
 * The fast lanes. Integration tests run only before release, in the `full`
 * profile, so iteration never selects them unless a caller names the
 * integration lane with `--lane integration`.
 */
export const TEST_LANES = ['tests/unit', 'tests/regression']

/**
 * Every lane `--lane` can name. The graph records bin, fixture, and data
 * references for all of them, and selection filters to the lanes in force, so
 * the default selection is unchanged by the wider graph.
 */
export const SELECTABLE_LANES: Record<string, string> = {
  unit: 'tests/unit',
  regression: 'tests/regression',
  integration: 'tests/integration',
}

export const ALL_TEST_LANES = Object.values(SELECTABLE_LANES)

/** Repository files whose change invalidates every test in the lane. */
export const GLOBAL_FILES = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tests/reporters/failures-only.ts',
]

/**
 * Directories of data the lane reads but no module imports. The import graph
 * cannot reach them, so a change under one selects tests by the literal
 * references those tests carry instead.
 */
export const DATA_ROOTS = ['governance', 'library', 'docs']

/** Single data files outside `DATA_ROOTS` that the lane reads the same way. */
export const DATA_FILES = ['config.json']

/**
 * Harness-generated trees. A change here is run state rather than a change
 * under test, so it is excluded from the unreached report. The rest of
 * `runtime/` is reported, because a hand-edited runtime file can break tests.
 */
export const GENERATED_ROOTS = ['runtime/logs/', 'runtime/cache/', 'dist/']

export const DEFAULT_ADVISORY_RATIO = 0.6

export const RECORD_RELATIVE_PATH = 'runtime/cache/test-impact.jsonl'

export const IMPACTED_COMMAND = './bin/pan tests impacted'

export const HARNESS_TESTS_SELF_DEVELOPMENT_ONLY =
  'Harness-internal test selection is available only in self-development. ' +
  'Use the target impacted profile in runtime/repository-checks.json, ' +
  "or select blast-radius tests from the target's documented entry points."

export const TEST_REPORTER_ARGS = [
  '--test-reporter=./dist/tests/reporters/failures-only.js',
  '--test-reporter-destination=stdout',
]

export interface ModuleGraph {
  /** Every `.ts` file under the scanned directories, repository-relative. */
  files: string[]
  /** file → files it imports (resolved, repository-relative). */
  imports: Map<string, Set<string>>
  /** file → files that import it. */
  dependents: Map<string, Set<string>>
  /** bin script (`bin/<name>`) → test files that name it. */
  binReferences: Map<string, Set<string>>
  /** fixture directory (`tests/fixtures/<name>`) → test files that name it. */
  fixtureReferences: Map<string, Set<string>>
  /** data path or id literal → test files that name it. */
  dataReferences: Map<string, Set<string>>
  /** Files at least one module imports only for types. */
  typeOnlyTargets: Set<string>
  /**
   * Source files that only re-export other modules. A facade adds no
   * behavior, so an import through one is not an extra hop.
   */
  facades?: Set<string>
  /** Parser that produced the specifiers. */
  parser: 'typescript' | 'regex'
  build_ms: number
}

export interface Selection {
  changed: string[]
  selected: string[]
  selected_count: number
  lane_count: number
  ratio: number
  advisory: string | null
  /** Changed files that no lane test reaches. */
  unreached: string[]
  /** Unreached changed files that other modules import only for types. */
  type_only: string[]
  /** Why each selected test was selected: test → changed file. */
  reasons: Record<string, string>
  /** Import hops from the changed file: test → depth. Non-import reasons are 0. */
  depths: Record<string, number>
  /** Selected-test count per depth, ascending. */
  by_depth: Record<string, number>
  /** The depth bound in force, or null for the full closure. */
  depth_limit: number | null
}

export interface ImpactOptions {
  changed?: string | null
  staged?: boolean
  worktreeDirty?: boolean
  files?: string[]
  include?: string[]
  /** Changed paths to drop from the change set before selection, repeatable. */
  ignore?: string[]
  depth?: number
  list?: boolean
  json?: boolean
  /** Stream the test run's output as well as logging it. */
  verbose?: boolean
  advisoryRatio?: number
  /** Lane directories to select from; `TEST_LANES` when absent. */
  lanes?: string[]
}

export interface ImpactResult extends Selection {
  status: 'ran' | 'listed' | 'nothing_changed' | 'no_tests_reached'
  graph_build_ms: number
  parser: 'typescript' | 'regex'
  exit_code: number
  duration_ms: number
  record_path: string
  /** Workspace the selection ran against, relative to the installation root. */
  workspace: string
  /**
   * Installation-relative log holding the run's complete output, or null when
   * nothing ran or an enclosing profile runner owns the output.
   */
  log_path?: string | null
  /** Failing tests the run's output names. */
  failing_tests?: FailingTest[]
}

/**
 * How a selected run reports. `summary` logs the output and prints a pass
 * line or the failing tests; `verbose` also streams it; `passthrough` hands
 * the output to the caller's streams untouched and prints the full selection,
 * which is what an enclosing repository-check runner captures.
 */
export type ImpactOutputMode = 'summary' | 'verbose' | 'passthrough'

export interface RunTestsImpactedOptions {
  /**
   * Workspace the selection runs against. The command still runs from the
   * installation root, so a worktree-bound run selects against its own tree
   * instead of the base checkout.
   */
  workspace?: string
  write?: (text: string) => void
  /** Progress lines written while the run is under way. */
  progress?: (text: string) => void
  /**
   * Reporting mode. Absent, `--verbose` or `PAN_VERBOSE` selects `verbose`,
   * a repository-check profile command selects `passthrough`, and anything
   * else is `summary`.
   */
  output?: ImpactOutputMode
}
