import { readFileSync } from 'node:fs'
import path from 'node:path'

import { invariant } from '../errors.js'
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
}

function symbolId(file: string, name: string): string {
  return `${file}#${name}`
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
