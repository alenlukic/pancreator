import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { invariant } from '../errors.js'
import { isDirectory, isFile, readText } from '../io.js'
import {
  buildModuleGraph,
  loadTypeScript,
  resolveSpecifier,
  type ModuleGraph,
} from '../test-impact.js'
import { facilitiesByPath, type Facility } from './inventory.js'

export type ExportedSymbolKind =
  | 'class'
  | 'enum'
  | 'function'
  | 'interface'
  | 'type'
  | 'variable'

export interface ExportedSymbol {
  id: string
  file: string
  name: string
  kind: ExportedSymbolKind
  line: number
}

export interface CrossModuleSymbolUse {
  symbol_id: string
  from: string
  kind: 'import' | 'namespace' | 'reexport'
}

export interface SymbolIndex {
  graph: ModuleGraph
  declarations: ExportedSymbol[]
  uses: CrossModuleSymbolUse[]
  /** Source files a consumer outside the TypeScript module graph names. */
  entrypoints: Set<string>
}

function symbolId(file: string, name: string): string {
  return `${file}#${name}`
}

/**
 * Trees that run a built module instead of importing its source.
 *
 * The module graph holds only `src/` and `tests/` TypeScript, so a shell
 * script, an extensionless JavaScript file, and a `package.json` script are
 * all invisible to it. Every CLI entrypoint is reached exactly this way, so
 * without this scan each one reports itself as an unused file.
 */
const EXTERNAL_SCAN_ROOTS = ['bin']

const EXTERNAL_SCAN_FILES = ['package.json']

/** A path or a bare filename that names a JavaScript or TypeScript module. */
const MODULE_PATH_PATTERN = /[\w@.-]+(?:\/[\w@.-]+)*\.(?:js|ts)(?![\w-])/gu

/** Files under the external scan roots, repository-relative. */
function externalConsumerFiles(root: string): string[] {
  const found: string[] = []

  const walk = (relative: string): void => {
    const absolute = path.join(root, relative)

    if (!isDirectory(absolute)) {
      return
    }

    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`

      if (entry.isDirectory()) {
        walk(child)
      } else if (entry.isFile()) {
        found.push(child)
      }
    }
  }

  for (const base of EXTERNAL_SCAN_ROOTS) {
    walk(base)
  }

  for (const file of EXTERNAL_SCAN_FILES) {
    if (isFile(path.join(root, file))) {
      found.push(file)
    }
  }

  return found.sort()
}

/**
 * Source file each unambiguous basename belongs to.
 *
 * A bare filename is the only shape a run-time path expression leaves behind:
 * `src/lib/engine.ts` holds `'openai-agent-cli.js'` and joins it to a
 * directory computed elsewhere. A basename two sources share proves nothing
 * about either, so only a unique one resolves.
 */
function sourceByBasename(files: readonly string[]): Map<string, string> {
  const owners = new Map<string, string | null>()

  for (const file of files) {
    if (!file.startsWith('src/')) {
      continue
    }

    const base = path.posix.basename(file)

    owners.set(base, owners.has(base) ? null : file)
  }

  return new Map(
    [...owners].filter((entry): entry is [string, string] => entry[1] !== null),
  )
}

/**
 * Source file a referenced module path names, or `null`.
 *
 * A built path drops its `dist/` prefix and regains its `.ts` extension. The
 * token itself often carries a prefix the repository does not own, because a
 * script writes `"$ROOT/dist/src/cli.js"`, so each suffix is tried in turn
 * and only an exact source path resolves. That exactness is what keeps a
 * sibling specifier such as `./errors.js` out: it names a module relative to
 * its own file rather than to the repository root.
 */
function sourceForModulePath(
  token: string,
  files: ReadonlySet<string>,
  byBasename: ReadonlyMap<string, string>,
): string | null {
  const segments = token.split('/')

  if (segments.length === 1) {
    const base = token.endsWith('.js')
      ? `${token.slice(0, -'.js'.length)}.ts`
      : token

    return byBasename.get(base) ?? null
  }

  for (let index = 0; index < segments.length - 1; index += 1) {
    const suffix = segments.slice(index).join('/')
    const relative = suffix.startsWith('dist/')
      ? suffix.slice('dist/'.length)
      : suffix
    const candidate = relative.endsWith('.js')
      ? `${relative.slice(0, -'.js'.length)}.ts`
      : relative

    if (files.has(candidate)) {
      return candidate
    }
  }

  return null
}

/** Whether a string literal is the module specifier of an import or export. */
function isModuleSpecifier(
  ts: NonNullable<Awaited<ReturnType<typeof loadTypeScript>>>,
  node: import('typescript').Node,
): boolean {
  const parent = node.parent

  if (!parent) {
    return false
  }

  return (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isImportTypeNode(parent) ||
    ts.isExternalModuleReference(parent) ||
    (ts.isCallExpression(parent) &&
      parent.expression.kind === ts.SyntaxKind.ImportKeyword)
  )
}

/**
 * Source files something outside the TypeScript module graph reaches.
 *
 * Two shapes exist and neither is an import. A tracked script or a
 * `package.json` entry runs a built `dist/**\/*.js` path, and a source string
 * literal names a built file the harness spawns at run time. A module
 * specifier is skipped because the graph already carries that edge, and
 * counting it here would keep a dead module alive through the dead barrel
 * that re-exports it.
 */
function collectEntrypoints(
  root: string,
  ts: NonNullable<Awaited<ReturnType<typeof loadTypeScript>>>,
  files: ReadonlySet<string>,
  sourceFiles: ReadonlyMap<string, import('typescript').SourceFile>,
): Set<string> {
  const byBasename = sourceByBasename([...files])
  const entrypoints = new Set<string>()
  const addNamed = (content: string, self: string | null): void => {
    for (const match of content.matchAll(MODULE_PATH_PATTERN)) {
      const target = sourceForModulePath(match[0], files, byBasename)

      if (target && target !== self) {
        entrypoints.add(target)
      }
    }
  }

  for (const relative of externalConsumerFiles(root)) {
    try {
      addNamed(readText(path.join(root, relative)), null)
    } catch {
      // A file the scan cannot read names nothing. A binary under `bin/`
      // reaches here, and so does one a concurrent edit removed.
      continue
    }
  }

  for (const [file, sourceFile] of sourceFiles) {
    if (!file.startsWith('src/')) {
      continue
    }

    const visit = (node: import('typescript').Node): void => {
      if (
        (ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node)) &&
        !isModuleSpecifier(ts, node)
      ) {
        addNamed(node.text, file)
      }

      node.forEachChild(visit)
    }

    visit(sourceFile)
  }

  return entrypoints
}

/**
 * Build exported-declaration and cross-module-use indexes with the same
 * TypeScript loader and module graph used by impacted-test selection.
 */
export async function buildSymbolIndex(root: string): Promise<SymbolIndex> {
  const [graph, ts] = await Promise.all([
    buildModuleGraph(root),
    loadTypeScript(root),
  ])

  invariant(ts, 'TypeScript is required for debloat symbol analysis.', {
    code: 'DEBLOAT_TYPESCRIPT_UNAVAILABLE',
  })

  const declarations: ExportedSymbol[] = []
  const sourceFiles = new Map<string, import('typescript').SourceFile>()
  const hasExport = (node: import('typescript').Node): boolean =>
    ts
      .getModifiers(node as import('typescript').HasModifiers)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
    true
  const add = (
    file: string,
    sourceFile: import('typescript').SourceFile,
    name: string,
    kind: ExportedSymbolKind,
    node: import('typescript').Node,
  ): void => {
    const line =
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1

    declarations.push({
      id: symbolId(file, name),
      file,
      name,
      kind,
      line,
    })
  }

  for (const file of graph.files) {
    const source = readFileSync(path.join(root, file), 'utf8')
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
    )

    sourceFiles.set(file, sourceFile)

    if (!file.startsWith('src/')) {
      continue
    }

    for (const statement of sourceFile.statements) {
      if (!hasExport(statement)) {
        continue
      }

      if (ts.isFunctionDeclaration(statement) && statement.name) {
        add(file, sourceFile, statement.name.text, 'function', statement)
      } else if (ts.isClassDeclaration(statement) && statement.name) {
        add(file, sourceFile, statement.name.text, 'class', statement)
      } else if (ts.isInterfaceDeclaration(statement)) {
        add(file, sourceFile, statement.name.text, 'interface', statement)
      } else if (ts.isTypeAliasDeclaration(statement)) {
        add(file, sourceFile, statement.name.text, 'type', statement)
      } else if (ts.isEnumDeclaration(statement)) {
        add(file, sourceFile, statement.name.text, 'enum', statement)
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            add(
              file,
              sourceFile,
              declaration.name.text,
              'variable',
              declaration,
            )
          }
        }
      }
    }
  }

  const declarationIds = new Set(declarations.map((entry) => entry.id))
  const fileSet = new Set(graph.files)
  const entrypoints = collectEntrypoints(root, ts, fileSet, sourceFiles)

  const uses: CrossModuleSymbolUse[] = []
  const record = (
    target: string,
    name: string,
    from: string,
    kind: CrossModuleSymbolUse['kind'],
  ): void => {
    const id = symbolId(target, name)

    if (declarationIds.has(id)) {
      uses.push({ symbol_id: id, from, kind })
    }
  }

  for (const [file, sourceFile] of sourceFiles) {
    for (const statement of sourceFile.statements) {
      if (
        (ts.isImportDeclaration(statement) ||
          ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const target = resolveSpecifier(
          file,
          statement.moduleSpecifier.text,
          fileSet,
        )

        if (!target) {
          continue
        }

        if (ts.isExportDeclaration(statement)) {
          if (
            statement.exportClause &&
            ts.isNamedExports(statement.exportClause)
          ) {
            for (const element of statement.exportClause.elements) {
              record(
                target,
                element.propertyName?.text ?? element.name.text,
                file,
                'reexport',
              )
            }
          } else {
            for (const declaration of declarations.filter(
              (entry) => entry.file === target,
            )) {
              record(target, declaration.name, file, 'reexport')
            }
          }

          continue
        }

        const bindings = statement.importClause?.namedBindings

        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            record(
              target,
              element.propertyName?.text ?? element.name.text,
              file,
              'import',
            )
          }
        } else if (bindings && ts.isNamespaceImport(bindings)) {
          for (const declaration of declarations.filter(
            (entry) => entry.file === target,
          )) {
            record(target, declaration.name, file, 'namespace')
          }
        }
      }
    }
  }

  return {
    graph,
    entrypoints,
    declarations: declarations.sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    uses: uses.sort(
      (left, right) =>
        left.symbol_id.localeCompare(right.symbol_id) ||
        left.from.localeCompare(right.from),
    ),
  }
}

function facilityOwner(
  facilities: readonly Facility[],
  byPath: Map<string, Facility>,
  relative: string,
): Facility | null {
  const direct = byPath.get(relative)

  if (direct) {
    return direct
  }

  return (
    facilities.find((facility) =>
      facility.owned_paths.some(
        (owned) =>
          !path.posix.extname(owned) && relative.startsWith(`${owned}/`),
      ),
    ) ?? null
  )
}

/**
 * Derived symbol nodes exist only when exactly one facility owns every
 * cross-module reference. They therefore cascade with that facility.
 */
export function sourceSymbolFacilities(
  facilities: readonly Facility[],
  index: SymbolIndex,
): Facility[] {
  const byPath = facilitiesByPath(facilities)

  return index.declarations.flatMap((declaration) => {
    const uses = index.uses.filter(
      (entry) => entry.symbol_id === declaration.id,
    )
    const owners = uses.map((use) =>
      facilityOwner(facilities, byPath, use.from),
    )
    const ownerIds = new Set(
      owners
        .filter((owner): owner is Facility => owner !== null)
        .map((owner) => owner.id),
    )

    if (
      uses.length === 0 ||
      owners.some((owner) => owner === null) ||
      ownerIds.size !== 1
    ) {
      return []
    }

    const owner = owners[0] as Facility

    return [
      {
        id: `source-symbol:${declaration.id}`,
        category: 'source-symbol',
        name: declaration.id,
        path: declaration.file,
        owned_paths: [],
        selectable: false,
        node_kind: 'source_symbol',
        source_symbol: declaration.name,
        protected: false,
        dedicated_tests: [],
        owner_facility: owner.id,
      },
    ]
  })
}
