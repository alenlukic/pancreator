/**
 * Import-specifier parsing, module resolution, and the bin, fixture, CLI, and
 * data references a test carries as string literals.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DATA_FILES, DATA_ROOTS, TEST_LANES } from './model.js'

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
export async function loadTypeScript(
  root: string,
): Promise<TypeScriptModule | null> {
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

export function listTypeScriptFiles(root: string, directory: string): string[] {
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

export function listBinScripts(root: string): string[] {
  const binDir = path.join(root, 'bin')

  if (!existsSync(binDir)) {
    return []
  }

  return readdirSync(binDir)
    .filter((name) => statSync(path.join(binDir, name)).isFile())
    .sort()
}

export function listFixtureDirectories(root: string): string[] {
  const fixturesDir = path.join(root, 'tests', 'fixtures')

  if (!existsSync(fixturesDir)) {
    return []
  }

  return readdirSync(fixturesDir, { withFileTypes: true })
    .map((entry) => entry.name)
    .sort()
}

export function escapeRegex(value: string): string {
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

export function isLaneTest(file: string, lanes = TEST_LANES): boolean {
  return (
    file.endsWith('.test.ts') &&
    lanes.some((lane) => file.startsWith(`${lane}/`))
  )
}

export interface SpecialReferences {
  bin: Set<string>
  fixtures: Set<string>
  data: Set<string>
  cli: boolean
}

const BIN_REFERENCE = /bin(?:\/|['"],\s*['"])([\w.-]+)/gu

const FIXTURE_REFERENCE = /fixtures(?:\/|['"],\s*['"])([\w.-]+)/gu

const CLI_REFERENCE = /dist\/src\/cli\.js|['"]cli\.js['"]/u

/** A quoted string literal, which is how a module names a data path or id. */
const STRING_LITERAL = /['"`]([^'"`\n]{1,200})['"`]/gu

/** A policy, criterion, or registry id such as `SPOT-001`. */
export const DATA_ID = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3}$/u

/** A bare data filename such as `implement.md`, which tests join to a root. */
const DATA_BASENAME = /^[\w.-]+\.(?:md|json|ya?ml)$/u

/** Whether a string literal names data under `DATA_ROOTS` or `DATA_FILES`. */
export function isDataReference(literal: string): boolean {
  if (
    DATA_FILES.includes(literal) ||
    DATA_ID.test(literal) ||
    DATA_BASENAME.test(literal)
  ) {
    return true
  }

  return DATA_ROOTS.some(
    (root) => literal === root || literal.startsWith(`${root}/`),
  )
}

/**
 * Extract every bin script, fixture directory, data reference, and CLI
 * reference from one source in a single pass per kind. The captured name must
 * be a known bin or fixture, which is the same test `referencesBinScript` and
 * `referencesFixture` apply one name at a time.
 */
export function extractSpecialReferences(
  source: string,
  binScripts: readonly string[],
  fixtureDirectories: readonly string[],
): SpecialReferences {
  const knownBins = new Set(binScripts)
  const knownFixtures = new Set(fixtureDirectories)

  const bin = new Set<string>()
  const fixtures = new Set<string>()
  const data = new Set<string>()

  for (const match of source.matchAll(STRING_LITERAL)) {
    const literal = match[1] ?? ''

    if (isDataReference(literal)) {
      data.add(literal)
    }
  }

  for (const match of source.matchAll(BIN_REFERENCE)) {
    const name = match[1] ?? ''

    if (knownBins.has(name)) {
      bin.add(name)
    }
  }

  for (const match of source.matchAll(FIXTURE_REFERENCE)) {
    const name = match[1] ?? ''

    if (knownFixtures.has(name)) {
      fixtures.add(name)
    }
  }

  return {
    bin,
    fixtures,
    data,
    cli: CLI_REFERENCE.test(source) || bin.has('pan'),
  }
}
