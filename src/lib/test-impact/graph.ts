/**
 * The module graph assembly, re-export facade detection, and the reverse
 * import closure.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ALL_TEST_LANES, type ModuleGraph, TEST_LANES } from './model.js'
import {
  extractSpecialReferences,
  isLaneTest,
  listBinScripts,
  listFixtureDirectories,
  listTypeScriptFiles,
  loadTypeScript,
  type ParsedSpecifiers,
  parseSpecifiersByRegex,
  parseSpecifiersByTypeScript,
  resolveSpecifier,
  type SpecialReferences,
} from './parse.js'

/** The lane tests that are the module itself or import it, transitively. */
function laneTestsDependingOn(
  module: string,
  dependents: Map<string, Set<string>>,
): Set<string> {
  const seen = new Set<string>([module])
  const queue = [module]
  const tests = new Set<string>()

  while (queue.length > 0) {
    const current = queue.shift() as string

    if (isLaneTest(current, ALL_TEST_LANES)) {
      tests.add(current)
    }

    for (const dependent of dependents.get(current) ?? []) {
      if (!seen.has(dependent)) {
        seen.add(dependent)
        queue.push(dependent)
      }
    }
  }

  return tests
}

function addEdge(map: Map<string, Set<string>>, from: string, to: string) {
  const targets = map.get(from) ?? new Set<string>()
  targets.add(to)
  map.set(from, targets)
}

/** Build one graph with a selected parser implementation. */
function assembleModuleGraph(
  root: string,
  directories: string[],
  parse: (file: string, source: string) => ParsedSpecifiers,
  parser: ModuleGraph['parser'],
  started: number,
): ModuleGraph {
  const files = directories.flatMap((directory) =>
    listTypeScriptFiles(root, directory),
  )
  const fileSet = new Set(files)
  const binScripts = listBinScripts(root)
  const fixtureDirectories = listFixtureDirectories(root)

  const imports = new Map<string, Set<string>>()
  const dependents = new Map<string, Set<string>>()

  const binReferences = new Map<string, Set<string>>()
  const fixtureReferences = new Map<string, Set<string>>()
  const dataReferences = new Map<string, Set<string>>()

  const typeOnlyTargets = new Set<string>()
  const facades = new Set<string>()
  const specialReferences = new Map<string, SpecialReferences>()
  const cliSource = fileSet.has('src/cli.ts') ? 'src/cli.ts' : null

  for (const file of files) {
    const source = readFileSync(path.join(root, file), 'utf8')
    const parsed = parse(file, source)

    imports.set(file, new Set())

    if (file.startsWith('src/') && isReExportFacade(source)) {
      facades.add(file)
    }

    for (const specifier of parsed.runtime) {
      const resolved = resolveSpecifier(file, specifier, fileSet)

      if (resolved && resolved !== file) {
        addEdge(imports, file, resolved)
        addEdge(dependents, resolved, file)
      }
    }

    for (const specifier of parsed.typeOnly) {
      const resolved = resolveSpecifier(file, specifier, fileSet)

      if (resolved && resolved !== file) {
        typeOnlyTargets.add(resolved)
      }
    }

    const refs = extractSpecialReferences(
      source,
      binScripts,
      fixtureDirectories,
    )

    if (
      refs.bin.size > 0 ||
      refs.fixtures.size > 0 ||
      refs.data.size > 0 ||
      refs.cli
    ) {
      specialReferences.set(file, refs)
    }
  }

  for (const [module, refs] of specialReferences) {
    const tests = laneTestsDependingOn(module, dependents)

    for (const test of tests) {
      for (const name of refs.bin) {
        addEdge(binReferences, `bin/${name}`, test)
      }

      for (const name of refs.fixtures) {
        addEdge(fixtureReferences, `tests/fixtures/${name}`, test)
      }

      if (module.startsWith('tests/')) {
        for (const literal of refs.data) {
          addEdge(dataReferences, literal, test)
        }
      }

      // Only test-side code spawns the CLI. A source module that names
      // `./bin/pan` does so in operator-facing text, and treating that as a
      // spawn tied every test importing io.ts to the whole CLI closure.
      if (refs.cli && cliSource && module.startsWith('tests/')) {
        addEdge(imports, test, cliSource)
        addEdge(dependents, cliSource, test)
      }
    }
  }

  return {
    files,
    imports,
    dependents,
    binReferences,
    fixtureReferences,
    dataReferences,
    typeOnlyTargets,
    facades,
    parser,
    build_ms: Math.round(performance.now() - started),
  }
}

/** Build the module graph synchronously with the dependency-free parser. */
export function buildModuleGraphByRegex(
  root: string,
  options: { directories?: string[] } = {},
): ModuleGraph {
  const started = performance.now()

  return assembleModuleGraph(
    root,
    options.directories ?? ['src', 'tests'],
    (_file, source) => parseSpecifiersByRegex(source),
    'regex',
    started,
  )
}

/** Build the module graph of `src/**` and `tests/**`. */
export async function buildModuleGraph(
  root: string,
  options: { directories?: string[]; parser?: 'typescript' | 'regex' } = {},
): Promise<ModuleGraph> {
  const started = performance.now()
  const ts = options.parser === 'regex' ? null : await loadTypeScript(root)

  return assembleModuleGraph(
    root,
    options.directories ?? ['src', 'tests'],
    ts
      ? (file, source) => parseSpecifiersByTypeScript(ts, file, source)
      : (_file, source) => parseSpecifiersByRegex(source),
    ts ? 'typescript' : 'regex',
    started,
  )
}

export interface Reach {
  /** The changed file that reached this node. */
  seed: string
  /** Import hops from the seed. A direct importer sits at depth 1. */
  depth: number
}

const RE_EXPORT_PATTERN =
  /export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"][^'"]+['"];?/gu

/**
 * Whether a module holds nothing but re-exports. Comments and blank lines are
 * ignored, and at least one re-export must be present.
 */
export function isReExportFacade(source: string): boolean {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '')

  if (code.match(RE_EXPORT_PATTERN) === null) {
    return false
  }

  return code.replace(RE_EXPORT_PATTERN, '').trim().length === 0
}

/**
 * Every file that transitively imports one of the seeds, plus the seeds.
 *
 * `maxDepth` bounds the hops. Depth 1 keeps only direct importers. An import
 * through a re-export facade costs no hop, so a test that imports a split
 * module through its facade stays a direct importer of the sub-module.
 */
export function reverseClosure(
  graph: ModuleGraph,
  seeds: Iterable<string>,
  maxDepth = Number.POSITIVE_INFINITY,
): Map<string, Reach> {
  const reached = new Map<string, Reach>()
  const queue: string[] = []

  for (const seed of seeds) {
    if (!reached.has(seed)) {
      reached.set(seed, { seed, depth: 0 })
      queue.push(seed)
    }
  }

  while (queue.length > 0) {
    const file = queue.shift() as string
    const reach = reached.get(file) as Reach

    if (reach.depth >= maxDepth) {
      continue
    }

    for (const dependent of graph.dependents.get(file) ?? []) {
      if (reached.has(dependent)) {
        continue
      }

      // Zero-cost edges go to the front, so the walk stays breadth-first by
      // hop count and every node keeps its shortest depth.
      if (graph.facades?.has(dependent) === true) {
        reached.set(dependent, { seed: reach.seed, depth: reach.depth })
        queue.unshift(dependent)
      } else {
        reached.set(dependent, { seed: reach.seed, depth: reach.depth + 1 })
        queue.push(dependent)
      }
    }
  }

  return reached
}

export function laneTests(graph: ModuleGraph, lanes = TEST_LANES): string[] {
  return graph.files.filter((file) => isLaneTest(file, lanes))
}
