/**
 * The scanned text files, referrer classification, line offsets, relative
 * targets, and the literal tokens that name each facility.
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { isDirectory, isFile } from '../../io.js'
import { EDIT_ONLY_PATHS, type Facility } from '../inventory.js'
import type { ReferrerClass } from './model.js'

const SCAN_ROOTS = ['bin', 'docs', 'governance', 'library', 'src', 'tests']

const SCAN_FILES = ['AGENTS.md', 'README.md']

const SCAN_EXTENSIONS = new Set(['.json', '.md', '.mdc', '.sh', '.ts'])

/**
 * Code that registers facilities in a string-keyed table instead of calling
 * them. The import is a registration, and the key is resolved at run time from
 * somewhere else, so the module is a registry rather than a caller.
 */
export const DISPATCH_TABLE_PATHS = ['src/lib/requirements/handlers.ts']

const PAYLOAD_REGISTRY_PATHS = [
  'bin/install',
  'bin/install-support',
  'bin/update',
]

const DISPATCH_MARKER = '// debloat: dispatch'

/**
 * Files that enumerate facilities. Counting one as a referrer would make every
 * facility of its kind look externally referenced, which would stop every
 * cascade. They are repaired instead, through the typed parsers below.
 *
 * `src/lib/requirements/handlers.ts` belongs here even though it is code. It
 * imports every validator solely to bind it to a handler id in one dispatch
 * table, so the import proves registration and nothing else. A validator is
 * live only when a policy requirement or a direct harness call resolves that
 * handler id, which `validatorResolutionReferences` below models.
 */
function isRegistryPath(relative: string): boolean {
  return (
    EDIT_ONLY_PATHS.includes(relative) ||
    DISPATCH_TABLE_PATHS.includes(relative) ||
    PAYLOAD_REGISTRY_PATHS.includes(relative) ||
    path.basename(relative) === 'index.md' ||
    relative.startsWith('governance/registries/')
  )
}

/**
 * Column of the dispatch marker on each line that carries one.
 *
 * The marker is a trailing comment, so it governs the references written
 * before it on its own line and nothing else in the file. Recording the column
 * rather than the line text is what bounds C-4: a file may register one
 * specifier in a dispatch table and import the same specifier for real a few
 * lines down, and the second occurrence has to keep blocking.
 */
export function dispatchMarkerColumns(content: string): Map<number, number> {
  const columns = new Map<number, number>()

  content.split(/\r?\n/u).forEach((line, index) => {
    const column = line.indexOf(DISPATCH_MARKER)

    if (column >= 0) {
      columns.set(index, column)
    }
  })

  return columns
}

/** Offset at which each line of `content` starts. */
export function lineStartOffsets(content: string): number[] {
  const starts = [0]
  let index = content.indexOf('\n')

  while (index >= 0) {
    starts.push(index + 1)
    index = content.indexOf('\n', index + 1)
  }

  return starts
}

export function lineIndexOf(starts: readonly number[], offset: number): number {
  let low = 0
  let high = starts.length - 1

  while (low < high) {
    const middle = Math.ceil((low + high) / 2)

    if ((starts[middle] as number) <= offset) {
      low = middle
    } else {
      high = middle - 1
    }
  }

  return low
}

export function referrerClass(relative: string, owned: boolean): ReferrerClass {
  if (isRegistryPath(relative)) {
    return 'registry'
  }

  if (owned) {
    return 'facility'
  }

  if (relative.startsWith('tests/')) {
    return 'test'
  }

  // Only executable source blocks a removal. Prose that ships beside the
  // facilities, such as the projected Cursor rule sources, is repaired like
  // any other document.
  if (relative.startsWith('src/') || relative.startsWith('bin/')) {
    return 'code'
  }

  return 'doc'
}

const LINE_COMMENT = /(^|[^:"'`\\])\/\/[^\n]*/gu

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//gu

/**
 * Source with its comments removed.
 *
 * A comment that names a facility is documentation, not a dependency. Left in,
 * one sentence of prose in a live module pins a facility that nothing calls:
 * a doc comment in the engine kept `ORCH-001` alive, and a comment in the
 * debloat scanner kept `persona:spotfixer` alive.
 *
 * A block comment is blanked rather than collapsed so every surviving
 * character keeps its line. The dispatch classifier reads the line of each
 * match, and a stripped newline would move a real import onto a marked line.
 */
export function withoutComments(content: string): string {
  return content
    .replace(BLOCK_COMMENT, (match) => match.replace(/[^\n]/gu, ' '))
    .replace(LINE_COMMENT, (_match, prefix: string) => prefix)
}

export function listTextFiles(root: string): string[] {
  const found: string[] = []

  const walk = (relative: string): void => {
    const absolute = path.join(root, relative)

    if (!isDirectory(absolute)) {
      return
    }

    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        walk(child)
      } else if (
        entry.isFile() &&
        (SCAN_EXTENSIONS.has(path.extname(entry.name)) ||
          path.extname(entry.name) === '')
      ) {
        found.push(child)
      }
    }
  }

  for (const base of SCAN_ROOTS) {
    walk(base)
  }

  for (const file of SCAN_FILES) {
    if (isFile(path.join(root, file))) {
      found.push(file)
    }
  }

  return found.sort()
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

const RELATIVE_IMPORT_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.\.?\/[^'"]+)['"]/gu

const MARKDOWN_LINK_PATTERN = /\]\(([^)\s#]+)(?:\s[^)]*)?\)/gu

/**
 * Repo-relative paths a file names through a specifier relative to itself.
 *
 * Two shapes matter and neither shares text with the target's repository
 * path. A sibling import reads `./refusals.js`, so a validator that only the
 * module beside it imports looks unreferenced. An index reads
 * `[spotfix.md](spotfix.md)`, so every skill index entry looks unreferenced
 * and a removal would leave the index listing a file that no longer exists.
 */
export interface RelativeTarget {
  target: string
  /** Zero-based line of `content` that carried the specifier. */
  line: number
}

export function relativeTargets(
  relative: string,
  content: string,
): RelativeTarget[] {
  const directory = path.posix.dirname(relative)
  const extension = path.posix.extname(relative)
  const starts = lineStartOffsets(content)
  const specifiers: Array<{ specifier: string; offset: number }> = []

  if (extension === '.ts') {
    for (const match of content.matchAll(RELATIVE_IMPORT_PATTERN)) {
      specifiers.push({
        specifier: match[1] as string,
        offset: match.index ?? 0,
      })
    }
  }

  if (extension === '.md' || extension === '.mdc') {
    for (const match of content.matchAll(MARKDOWN_LINK_PATTERN)) {
      const target = match[1] as string

      if (!/^[a-z][a-z0-9+.-]*:/iu.test(target)) {
        specifiers.push({ specifier: target, offset: match.index ?? 0 })
      }
    }
  }

  return specifiers.map(({ specifier, offset }) => {
    const resolved = path.posix.normalize(path.posix.join(directory, specifier))

    return {
      target: resolved.endsWith('.js')
        ? `${resolved.slice(0, -'.js'.length)}.ts`
        : resolved,
      line: lineIndexOf(starts, offset),
    }
  })
}

/**
 * Literal strings whose presence in a repository file means the file depends
 * on the facility.
 *
 * Every token is a path or a harness identifier rather than a bare name, so a
 * sentence that happens to contain the word cannot create an edge.
 */
export function referenceTokens(entry: Facility): string[] {
  const tokens = [...entry.owned_paths]

  // style: allow style.switch_default Every facility category is listed, so a default would hide the compiler error that a new category must produce here.
  switch (entry.category) {
    case 'policy':
      tokens.push(entry.name)
      break
    case 'persona':
      tokens.push(`pan-${entry.name}`)
      break
    case 'command':
      tokens.push(entry.name)
      break
    case 'workflow':
      tokens.push(`library/workflows/${entry.name}`)
      break
    case 'mode':
      tokens.push(`--mode ${entry.name}`, `"card_mode": "${entry.name}"`)
      break
    case 'validator':
      tokens.push(`validators/${entry.name}.js`, `validators/${entry.name}.ts`)
      break
    case 'artifact-profile':
      tokens.push(`'${entry.name}'`, `"${entry.name}"`)
      break
    case 'cli-subcommand':
      // A subcommand is also run without the `pan` wrapper. A package script
      // and a direct call on the built CLI are both callers, and neither
      // shares text with the two tokens above. The quoted form is its own
      // token because a shell script writes the interpolated path in quotes,
      // which puts a `"` between the file and the subcommand.
      tokens.push(
        `case '${entry.name}'`,
        `pan ${entry.name}`,
        `npm run ${entry.name}`,
        `cli.js ${entry.name}`,
        `cli.js" ${entry.name}`,
      )
      break
    case 'criterion':
      tokens.push(entry.name)
      break
    case 'invocation':
      tokens.push(`'${entry.name}'`, `"${entry.name}"`)
      break
    case 'requirement':
      tokens.push(entry.name.split('/').at(-1) ?? entry.name)
      break
    case 'source-symbol':
      if (entry.source_symbol) {
        tokens.push(entry.source_symbol)
      }
      break
    case 'handbook':
    case 'orphan':
    case 'skill':
    case 'template':
      break
  }

  return [...new Set(tokens)]
}

export function ownerOf(
  byPath: Map<string, Facility>,
  relative: string,
): Facility | null {
  const direct = byPath.get(relative)

  if (direct) {
    return direct
  }

  // A workflow owns its whole directory, including prompts and stage files.
  for (const [owned, facility] of byPath) {
    if (!owned.includes('.') && relative.startsWith(`${owned}/`)) {
      return facility
    }
  }

  return null
}
