/** Impacted-test selection from a module graph and a change set. */

import {
  ALL_TEST_LANES,
  DATA_FILES,
  DATA_ROOTS,
  DEFAULT_ADVISORY_RATIO,
  GENERATED_ROOTS,
  GLOBAL_FILES,
  type ModuleGraph,
  type Selection,
  TEST_LANES,
} from './model.js'
import { DATA_ID, escapeRegex, isLaneTest } from './parse.js'
import { laneTests, reverseClosure } from './graph.js'

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .split('**')
    .map((segment) =>
      segment
        .split('*')
        .map((piece) => escapeRegex(piece))
        .join('[^/]*'),
    )
    .join('.*')

  return new RegExp(`^${escaped}$`, 'u')
}

/**
 * The literals a lane test could carry for one changed data file: its exact
 * path, each ancestor directory a test may read whole, and its id when the
 * basename is one. A test that names any of them reads what changed.
 */
export function dataSeedKeys(file: string): string[] {
  if (DATA_FILES.includes(file)) {
    return [file]
  }

  const segments = file.split('/')

  if (!DATA_ROOTS.includes(segments[0] ?? '')) {
    return []
  }

  const keys = [file]

  // Ancestors start below the root. A bare `governance` or `library` literal
  // appears in almost every test, so it selects the lane instead of narrowing
  // it. `governance/policies` is specific enough to mean something.
  for (let depth = 2; depth < segments.length; depth += 1) {
    keys.push(segments.slice(0, depth).join('/'))
  }

  const filename = segments.at(-1) ?? ''
  const basename = filename.replace(/\.[^.]+$/u, '')

  keys.push(filename)

  if (DATA_ID.test(basename)) {
    keys.push(basename)
  }

  return keys
}

/** Select the lane tests a change set impacts. */
export function selectImpactedTests(
  graph: ModuleGraph,
  changed: string[],
  options: {
    include?: string[]
    advisoryRatio?: number
    depth?: number
    lanes?: string[]
  } = {},
): Selection {
  const lanes = options.lanes ?? TEST_LANES
  const lane = laneTests(graph, lanes)
  const laneSet = new Set(lane)

  const reasons = new Map<string, string>()
  const depths = new Map<string, number>()
  const reachedBy = new Set<string>()

  const normalizedChanged = [...new Set(changed)].sort()
  const maxDepth = options.depth ?? Number.POSITIVE_INFINITY

  const select = (test: string, reason: string, depth = 0): void => {
    // The reference maps span every lane, so a test outside the lanes in
    // force neither selects nor credits its reason as reached.
    if (!laneSet.has(test)) {
      return
    }

    if (!reasons.has(test)) {
      reasons.set(test, reason)
      depths.set(test, depth)
    }

    reachedBy.add(reason)
  }

  const globalChange = normalizedChanged.find((file) =>
    GLOBAL_FILES.includes(file),
  )

  if (globalChange) {
    for (const test of lane) {
      select(test, globalChange)
    }
  }

  const moduleSeeds = normalizedChanged.filter((file) =>
    graph.imports.has(file),
  )

  for (const [file, reach] of reverseClosure(graph, moduleSeeds, maxDepth)) {
    if (laneSet.has(file)) {
      select(file, reach.seed, reach.depth)
    }
  }

  // The multi-source walk enters every seed at depth 0, so a seed that imports
  // another seed is never credited to it. A changed test that imports a
  // changed source is the common case: the test is selected because it
  // changed, and the source would otherwise be reported as unreached. Walk
  // each uncredited module alone and credit it when a selected test reaches it.
  for (const seed of moduleSeeds) {
    if (reachedBy.has(seed)) {
      continue
    }

    for (const file of reverseClosure(graph, [seed], maxDepth).keys()) {
      if (reasons.has(file)) {
        reachedBy.add(seed)
        break
      }
    }
  }

  for (const file of normalizedChanged) {
    if (file.startsWith('bin/')) {
      for (const test of graph.binReferences.get(file) ?? []) {
        select(test, file)
      }
    }

    if (file.startsWith('tests/fixtures/')) {
      const segments = file.split('/')
      const fixtureDir = segments.slice(0, 3).join('/')

      for (const test of graph.fixtureReferences.get(fixtureDir) ?? []) {
        select(test, file)
      }
    }

    for (const key of dataSeedKeys(file)) {
      for (const test of graph.dataReferences.get(key) ?? []) {
        select(test, file)
      }
    }
  }

  for (const glob of options.include ?? []) {
    const pattern = globToRegex(glob)

    for (const test of lane) {
      if (pattern.test(test)) {
        select(test, `--include ${glob}`)
      }
    }
  }

  const selected = [...reasons.keys()].sort()
  const ratio = lane.length === 0 ? 0 : selected.length / lane.length
  const threshold = options.advisoryRatio ?? DEFAULT_ADVISORY_RATIO
  const byDepth: Record<string, number> = {}

  for (const depth of [...depths.values()].sort(
    (left, right) => left - right,
  )) {
    byDepth[String(depth)] = (byDepth[String(depth)] ?? 0) + 1
  }

  const directCount = (byDepth['0'] ?? 0) + (byDepth['1'] ?? 0)
  const unreached = normalizedChanged.filter(
    (file) =>
      !reachedBy.has(file) &&
      !(globalChange && GLOBAL_FILES.includes(file)) &&
      !GENERATED_ROOTS.some((root) => file.startsWith(root)) &&
      // A changed test of a lane outside this selection is that lane's
      // business, not a file this selection failed to cover.
      !(isLaneTest(file, ALL_TEST_LANES) && !isLaneTest(file, lanes)),
  )
  // The fast profile covers only the default lanes, so recommending it for a
  // selection that includes another lane would drop that lane's tests.
  const fastCovers = lanes.every((entry) => TEST_LANES.includes(entry))
  const advisory =
    fastCovers && selected.length > 0 && ratio >= threshold
      ? `The change reaches ${selected.length} of ${lane.length} lane tests ` +
        `(${Math.round(ratio * 100)}%). The fast profile is the cheaper choice. ` +
        `Iterate on the ${directCount} direct tests with --depth 1. The implement ` +
        'and remediate gates run fast, and an evidence worker may run it once.'
      : unreached.length > 0
        ? `${unreached.length} of ${normalizedChanged.length} changed files ` +
          `reach no test: ${unreached.slice(0, 5).join(', ')}` +
          `${unreached.length > 5 ? ', …' : ''}. ` +
          'This selection does not cover them. Choose a judgment cohort for ' +
          'each one and run it alongside the selection.'
        : null

  const typeOnly = unreached.filter((file) => graph.typeOnlyTargets.has(file))

  return {
    changed: normalizedChanged,
    selected,
    selected_count: selected.length,
    lane_count: lane.length,
    ratio: Number(ratio.toFixed(4)),
    advisory,
    unreached,
    type_only: typeOnly,
    reasons: Object.fromEntries(reasons),
    depths: Object.fromEntries(depths),
    by_depth: byDepth,
    depth_limit: Number.isFinite(maxDepth) ? maxDepth : null,
  }
}
