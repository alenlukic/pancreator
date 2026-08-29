/**
 * Impacted-test selection from static import analysis.
 *
 * `pan tests impacted` builds the TypeScript module graph of `src/` and
 * `tests/`, takes the change set from Git, and selects every test file in the
 * mainline lanes whose import closure reaches a changed module. The selection
 * is the deterministic blast radius a coder or remediator iterates on instead
 * of the whole `fast` profile. It is an iteration aid, never a gate.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { PanError } from './errors.js'
import { gitChangedPathsBetween, gitHead, isGitRepository } from './git.js'
import { appendJsonLine, sha256 } from './io.js'

export const TEST_LANES = [
  'tests/unit',
  'tests/integration',
  'tests/regression',
]

/** Repository files whose change invalidates every test in the lane. */
export const GLOBAL_FILES = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tests/reporters/failures-only.ts',
]

export const DEFAULT_ADVISORY_RATIO = 0.6
export const RECORD_RELATIVE_PATH = 'runtime/cache/test-impact.jsonl'
export const IMPACTED_COMMAND = './bin/pan tests impacted'

const TEST_REPORTER_ARGS = [
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
  /** Files at least one module imports only for types. */
  typeOnlyTargets: Set<string>
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
  depth?: number
  list?: boolean
  json?: boolean
  advisoryRatio?: number
}

export interface ImpactResult extends Selection {
  status: 'ran' | 'listed' | 'nothing_changed' | 'no_tests_reached'
  graph_build_ms: number
  parser: 'typescript' | 'regex'
  exit_code: number
  duration_ms: number
  record_path: string
}

// --- Graph ------------------------------------------------------------------

const IMPORT_PATTERN =
  /(?:import|export)(\s+type)?\s*(?:[\w*\s{},$]*?\s*from\s*)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/gu

export interface ParsedSpecifiers {
  /** Specifiers a runtime import, re-export, or dynamic import names. */
  runtime: string[]
  /** Specifiers only an `import type` or `export type` names. */
  typeOnly: string[]
}

/** Import and re-export specifiers of one module, by regex. */
export function parseSpecifiersByRegex(source: string): ParsedSpecifiers {
  const parsed: ParsedSpecifiers = { runtime: [], typeOnly: [] }

  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[2] ?? match[3]

    if (!specifier) {
      continue
    }

    if (match[1]) {
      parsed.typeOnly.push(specifier)
    } else {
      parsed.runtime.push(specifier)
    }
  }

  return parsed
}

type TypeScriptModule = typeof import('typescript')

let typescriptModule: TypeScriptModule | null | undefined

/** The `typescript` devDependency of the harness root, or null when absent. */
async function loadTypeScript(root: string): Promise<TypeScriptModule | null> {
  if (typescriptModule !== undefined) {
    return typescriptModule
  }

  // The scanned root resolves first so an installation uses its own
  // toolchain; the harness module location is the fallback for a root without
  // a node_modules tree, such as a synthetic fixture.
  for (const base of [path.join(root, 'package.json'), import.meta.url]) {
    try {
      const resolved = createRequire(base).resolve('typescript')
      const loaded = (await import(pathToFileURL(resolved).href)) as {
        default?: TypeScriptModule
      } & TypeScriptModule
      typescriptModule = loaded.default ?? loaded

      return typescriptModule
    } catch {
      // Try the next base.
    }
  }

  typescriptModule = null

  return typescriptModule
}

/** Import, re-export, and dynamic import specifiers, by the TypeScript parser. */
export function parseSpecifiersByTypeScript(
  ts: TypeScriptModule,
  fileName: string,
  source: string,
): ParsedSpecifiers {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false,
  )
  const parsed: ParsedSpecifiers = { runtime: [], typeOnly: [] }

  const visit = (node: import('typescript').Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      // A type-only import is erased at runtime, so it carries no test
      // impact. The build type-checks it.
      const typeOnly = ts.isImportDeclaration(node)
        ? node.importClause?.isTypeOnly === true
        : node.isTypeOnly

      if (typeOnly) {
        parsed.typeOnly.push(node.moduleSpecifier.text)
      } else {
        parsed.runtime.push(node.moduleSpecifier.text)
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      parsed.runtime.push(node.arguments[0].text)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return parsed
}

/**
 * Resolve a relative specifier to a repository-relative `.ts` file.
 *
 * Returns null for `node:` builtins, bare package names, and paths that do not
 * exist in the scanned set.
 */
export function resolveSpecifier(
  fromFile: string,
  specifier: string,
  files: Set<string>,
): string | null {
  if (!specifier.startsWith('.')) {
    return null
  }

  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromFile), specifier),
  )
  const candidates = [
    base.replace(/\.(?:js|mjs|cjs)$/u, '.ts'),
    base.replace(/\.(?:js|mjs|cjs)$/u, '.tsx'),
    `${base}.ts`,
    `${base}/index.ts`,
    base,
  ]

  for (const candidate of candidates) {
    if (files.has(candidate)) {
      return candidate
    }
  }

  return null
}

function listTypeScriptFiles(root: string, directory: string): string[] {
  const absolute = path.join(root, directory)

  if (!existsSync(absolute)) {
    return []
  }

  const found: string[] = []
  const stack = [absolute]

  while (stack.length > 0) {
    const current = stack.pop() as string

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name)

      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') {
          stack.push(entryPath)
        }
      } else if (/\.tsx?$/u.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        found.push(path.relative(root, entryPath).split(path.sep).join('/'))
      }
    }
  }

  return found.sort()
}

function listBinScripts(root: string): string[] {
  const binDir = path.join(root, 'bin')

  if (!existsSync(binDir)) {
    return []
  }

  return readdirSync(binDir)
    .filter((name) => statSync(path.join(binDir, name)).isFile())
    .sort()
}

function listFixtureDirectories(root: string): string[] {
  const fixturesDir = path.join(root, 'tests', 'fixtures')

  if (!existsSync(fixturesDir)) {
    return []
  }

  return readdirSync(fixturesDir, { withFileTypes: true })
    .map((entry) => entry.name)
    .sort()
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/** True when a test's text names the bin script by path or path segments. */
export function referencesBinScript(source: string, name: string): boolean {
  const pattern = new RegExp(
    `bin(?:/|['"],\\s*['"])${escapeRegex(name)}(?![\\w-])`,
    'u',
  )

  return pattern.test(source)
}

/** True when a test's text names the fixture directory. */
export function referencesFixture(source: string, name: string): boolean {
  const pattern = new RegExp(
    `fixtures(?:/|['"],\\s*['"])${escapeRegex(name)}(?![\\w-])`,
    'u',
  )

  return pattern.test(source)
}

function referencesCli(source: string): boolean {
  return (
    /dist\/src\/cli\.js|['"]cli\.js['"]/u.test(source) ||
    referencesBinScript(source, 'pan')
  )
}

export function isLaneTest(file: string): boolean {
  return (
    file.endsWith('.test.ts') &&
    TEST_LANES.some((lane) => file.startsWith(`${lane}/`))
  )
}

function addEdge(map: Map<string, Set<string>>, from: string, to: string) {
  const targets = map.get(from) ?? new Set<string>()
  targets.add(to)
  map.set(from, targets)
}

/** Build the module graph of `src/**` and `tests/**`. */
export async function buildModuleGraph(
  root: string,
  options: { directories?: string[]; parser?: 'typescript' | 'regex' } = {},
): Promise<ModuleGraph> {
  const started = performance.now()
  const directories = options.directories ?? ['src', 'tests']
  const files = directories.flatMap((directory) =>
    listTypeScriptFiles(root, directory),
  )
  const fileSet = new Set(files)
  const ts = options.parser === 'regex' ? null : await loadTypeScript(root)
  const binScripts = listBinScripts(root)
  const fixtureDirectories = listFixtureDirectories(root)
  const imports = new Map<string, Set<string>>()
  const dependents = new Map<string, Set<string>>()
  const binReferences = new Map<string, Set<string>>()
  const fixtureReferences = new Map<string, Set<string>>()
  const typeOnlyTargets = new Set<string>()
  const cliSource = fileSet.has('src/cli.ts') ? 'src/cli.ts' : null

  for (const file of files) {
    const source = readFileSync(path.join(root, file), 'utf8')
    const parsed = ts
      ? parseSpecifiersByTypeScript(ts, file, source)
      : parseSpecifiersByRegex(source)

    imports.set(file, new Set())

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

    if (!isLaneTest(file)) {
      continue
    }

    for (const name of binScripts) {
      if (referencesBinScript(source, name)) {
        addEdge(binReferences, `bin/${name}`, file)
      }
    }

    for (const name of fixtureDirectories) {
      if (referencesFixture(source, name)) {
        addEdge(fixtureReferences, `tests/fixtures/${name}`, file)
      }
    }

    // A test that spawns the CLI depends on the whole CLI program.
    if (cliSource && referencesCli(source)) {
      addEdge(imports, file, cliSource)
      addEdge(dependents, cliSource, file)
    }
  }

  return {
    files,
    imports,
    dependents,
    binReferences,
    fixtureReferences,
    typeOnlyTargets,
    parser: ts ? 'typescript' : 'regex',
    build_ms: Math.round(performance.now() - started),
  }
}

export interface Reach {
  /** The changed file that reached this node. */
  seed: string
  /** Import hops from the seed. A direct importer sits at depth 1. */
  depth: number
}

/**
 * Every file that transitively imports one of the seeds, plus the seeds.
 *
 * `maxDepth` bounds the hops. Depth 1 keeps only direct importers.
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
      if (!reached.has(dependent)) {
        reached.set(dependent, { seed: reach.seed, depth: reach.depth + 1 })
        queue.push(dependent)
      }
    }
  }

  return reached
}

export function laneTests(graph: ModuleGraph): string[] {
  return graph.files.filter(isLaneTest)
}

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

/** Select the lane tests a change set impacts. */
export function selectImpactedTests(
  graph: ModuleGraph,
  changed: string[],
  options: { include?: string[]; advisoryRatio?: number; depth?: number } = {},
): Selection {
  const lane = laneTests(graph)
  const laneSet = new Set(lane)
  const reasons = new Map<string, string>()
  const depths = new Map<string, number>()
  const reachedBy = new Set<string>()
  const normalizedChanged = [...new Set(changed)].sort()
  const maxDepth = options.depth ?? Number.POSITIVE_INFINITY

  const select = (test: string, reason: string, depth = 0): void => {
    if (laneSet.has(test) && !reasons.has(test)) {
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
  const advisory =
    selected.length > 0 && ratio >= threshold
      ? `The change reaches ${selected.length} of ${lane.length} lane tests ` +
        `(${Math.round(ratio * 100)}%). The fast profile is the cheaper choice. ` +
        `Iterate on the ${directCount} direct tests with --depth 1, then run fast once.`
      : null
  const unreached = normalizedChanged.filter(
    (file) =>
      !reachedBy.has(file) &&
      !(globalChange && GLOBAL_FILES.includes(file)) &&
      !file.startsWith('runtime/'),
  )

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

// --- Change set -------------------------------------------------------------

function gitLines(root: string, args: string[]): string[] {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })

  if (result.status !== 0) {
    throw new PanError(`git ${args.join(' ')} failed: ${result.stderr}`, {
      code: 'GIT_FAILED',
    })
  }

  return result.stdout.split('\0').filter((line) => line.length > 0)
}

/** Paths with staged, unstaged, or untracked changes against HEAD. */
export function dirtyPaths(root: string): string[] {
  if (!isGitRepository(root)) {
    return []
  }

  const entries = gitLines(root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--no-renames',
  ])

  return entries
    .map((entry) => (entry.length >= 4 ? entry.slice(3) : entry))
    .filter((entry) => entry.length > 0 && !entry.endsWith('/'))
}

export function stagedPaths(root: string): string[] {
  if (!isGitRepository(root)) {
    return []
  }

  return gitLines(root, ['diff', '--name-only', '--cached', '-z'])
}

/** Resolve the change set the options describe. */
export function resolveChangeSet(
  root: string,
  options: ImpactOptions,
): string[] {
  const changed = new Set<string>(options.files ?? [])

  if (options.staged) {
    for (const file of stagedPaths(root)) {
      changed.add(file)
    }
  } else if (options.changed) {
    const head = gitHead(root)

    if (!head) {
      throw new PanError('--changed needs a Git repository with a HEAD.', {
        code: 'GIT_FAILED',
      })
    }

    for (const file of gitChangedPathsBetween(root, options.changed, 'HEAD')) {
      changed.add(file)
    }

    for (const file of dirtyPaths(root)) {
      changed.add(file)
    }
  } else if (options.worktreeDirty || (options.files ?? []).length === 0) {
    for (const file of dirtyPaths(root)) {
      changed.add(file)
    }
  }

  return [...changed].sort()
}

// --- Command ----------------------------------------------------------------

function distPath(file: string): string {
  return `dist/${file.replace(/\.tsx?$/u, '.js')}`
}

/** Argument vector for the node test run of the selected files. */
export function testCommandArgs(selected: string[]): string[] {
  return ['node', '--test', ...TEST_REPORTER_ARGS, ...selected.map(distPath)]
}

function runSelected(root: string, selected: string[]): number {
  const runBuilt = path.join(root, 'bin', 'run-built')
  const result = spawnSync(runBuilt, ['--', ...testCommandArgs(selected)], {
    cwd: root,
    stdio: 'inherit',
  })

  if (result.error) {
    throw new PanError(
      `Failed to start the test run: ${result.error.message}`,
      {
        code: 'TEST_RUN_FAILED',
      },
    )
  }

  return result.status ?? 1
}

function readNumberOption(value: string | null, name: string): number | null {
  if (value === null) {
    return null
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new PanError(`${name} must be a number between 0 and 1.`, {
      code: 'INVALID_ARGUMENT',
    })
  }

  return parsed
}

/** Parse `pan tests impacted` arguments. */
export function parseImpactArgs(args: string[]): ImpactOptions {
  const options: ImpactOptions = { files: [], include: [] }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string
    const valueOf = (): string => {
      const value = args[index + 1]

      if (!value || value.startsWith('--')) {
        throw new PanError(`${arg} requires a value.`, {
          code: 'INVALID_ARGUMENT',
        })
      }

      index += 1

      return value
    }

    switch (arg) {
      case '--changed':
        options.changed = valueOf()
        break
      case '--staged':
        options.staged = true
        break
      case '--worktree-dirty':
        options.worktreeDirty = true
        break
      case '--file':
        options.files?.push(valueOf().replace(/^\.\//u, ''))
        break
      case '--include':
        options.include?.push(valueOf())
        break
      case '--list':
        options.list = true
        break
      case '--json':
        options.json = true
        break
      case '--depth': {
        const depth = Number(valueOf())

        if (!Number.isInteger(depth) || depth < 1) {
          throw new PanError('--depth must be a positive integer.', {
            code: 'INVALID_ARGUMENT',
          })
        }

        options.depth = depth
        break
      }
      case '--advisory-ratio':
        options.advisoryRatio =
          readNumberOption(valueOf(), '--advisory-ratio') ?? undefined
        break
      default:
        throw new PanError(`Unknown option for tests impacted: ${arg}`, {
          code: 'INVALID_ARGUMENT',
        })
    }
  }

  if (options.staged && options.changed) {
    throw new PanError('--staged and --changed are mutually exclusive.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  return options
}

function describeUnreached(result: Selection, file: string): string {
  return result.type_only.includes(file)
    ? `  ${file}  (type-only imports; the build verifies it)`
    : `  ${file}`
}

function renderText(result: ImpactResult): string {
  const lines: string[] = []

  if (result.status === 'nothing_changed') {
    lines.push('No changed files. No test selected.')
  } else if (result.status === 'no_tests_reached') {
    lines.push(
      `No lane test reaches the ${result.changed.length} changed file(s). Add a test for the change.`,
    )
    lines.push(...result.changed.map((file) => describeUnreached(result, file)))
  } else {
    lines.push(
      `Selected ${result.selected_count} of ${result.lane_count} lane tests for ${result.changed.length} changed file(s).`,
    )
    lines.push(
      ...result.selected.map(
        (test) =>
          `  ${test}  <- ${result.reasons[test] ?? ''} (depth ${result.depths[test] ?? 0})`,
      ),
    )
    lines.push(
      `By depth: ${Object.entries(result.by_depth)
        .map(([depth, count]) => `${depth}:${count}`)
        .join(' ')}` +
        (result.depth_limit === null ? '' : ` (limit ${result.depth_limit})`),
    )

    if (result.unreached.length > 0) {
      lines.push('Changed files no lane test reaches:')
      lines.push(
        ...result.unreached.map((file) => describeUnreached(result, file)),
      )
    }
  }

  if (result.advisory) {
    lines.push(`Advisory: ${result.advisory}`)
  }

  lines.push(
    `Graph: ${result.parser} parser, ${result.graph_build_ms} ms. Total ${result.duration_ms} ms.`,
  )

  return lines.join('\n')
}

/**
 * Run `pan tests impacted`.
 *
 * Writes the result to `write`, appends one record to the impact ledger, and
 * returns the process exit code the caller sets.
 */
export async function runTestsImpacted(
  root: string,
  args: string[],
  write: (text: string) => void = (text) => process.stdout.write(text),
): Promise<ImpactResult> {
  const started = performance.now()
  const options = parseImpactArgs(args)
  const graph = await buildModuleGraph(root)
  const changed = resolveChangeSet(root, options)
  const selection = selectImpactedTests(graph, changed, {
    include: options.include,
    advisoryRatio: options.advisoryRatio,
    depth: options.depth,
  })
  const recordPath = path.join(root, RECORD_RELATIVE_PATH)

  let status: ImpactResult['status']
  let exitCode = 0

  if (changed.length === 0 && selection.selected_count === 0) {
    status = 'nothing_changed'
  } else if (selection.selected_count === 0) {
    status = 'no_tests_reached'
  } else if (options.list) {
    status = 'listed'
  } else {
    status = 'ran'
    exitCode = runSelected(root, selection.selected)
  }

  const result: ImpactResult = {
    status,
    ...selection,
    graph_build_ms: graph.build_ms,
    parser: graph.parser,
    exit_code: exitCode,
    duration_ms: Math.round(performance.now() - started),
    record_path: RECORD_RELATIVE_PATH,
  }

  appendJsonLine(recordPath, {
    timestamp: new Date().toISOString(),
    fingerprint: sha256({ head: gitHead(root), changed: selection.changed }),
    status,
    changed_count: selection.changed.length,
    selected_count: selection.selected_count,
    lane_count: selection.lane_count,
    ratio: selection.ratio,
    advisory: selection.advisory !== null,
    graph_build_ms: graph.build_ms,
    duration_ms: result.duration_ms,
    result: status === 'ran' ? (exitCode === 0 ? 'pass' : 'fail') : 'none',
  })

  write(
    options.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : `${renderText(result)}\n`,
  )

  return result
}
