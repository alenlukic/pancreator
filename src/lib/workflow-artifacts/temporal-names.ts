import { existsSync, readdirSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'
import { inboxTemporalScanDirectories } from '../inbox.js'
import { findProjectRoot } from '../io.js'
import { keywordRunSuffixFrom, temporalNamePrefix } from '../naming.js'
import { deterministicUuidSuffix, textFileContent } from './identity.js'
import {
  createRuntimeMutableFileSet,
  relocateRuntimeMutablePaths,
  runtimeMutablePaths,
  type RuntimeMutableFileSet,
} from './mutable-files.js'
import {
  policyMandatedFileDate,
  temporalFileDate,
  updateFileCount,
  utcDate,
} from './run-ids.js'

// Runtime directories whose loose files are non-durable: their names MUST use
// the temporal prefix scheme so age is legible and archiving can rely on it.
export const TEMPORAL_FILE_DIRECTORIES = [
  'runtime/pr-descriptions',
  'runtime/research',
  'runtime/benchmarks',
]

const INBOX_TEMPORAL_SCAN_DIRECTORIES = inboxTemporalScanDirectories()

const EMBEDDED_TIMESTAMP_NAME_PATTERN =
  /^(?:request-)?(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})?Z-?(.*)$/u

const EMBEDDED_DATE_NAME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})-?(.*)$/u

export interface RuntimeNameStandardizationSummary {
  renamed_files: number
  updated_files: number
  renames: Record<string, string>
}

interface TemporalFileSource {
  date: Date
  slugSeed: string
}

/**
 * Recover a file's temporal identity from its legacy name. Names without any
 * embedded timestamp fall back to the file's modification time: imprecise, but
 * the only signal available, and used exactly once at migration.
 */
function temporalFileSource(filePath: string): TemporalFileSource {
  const name = path.basename(filePath)
  const extension = path.extname(name)
  const base = extension ? name.slice(0, -extension.length) : name
  const timestampMatch = EMBEDDED_TIMESTAMP_NAME_PATTERN.exec(base)

  if (timestampMatch) {
    const date = utcDate(
      timestampMatch[1],
      timestampMatch[2],
      timestampMatch[3],
      timestampMatch[4],
      timestampMatch[5],
      timestampMatch[6],
      timestampMatch[7] ?? '0',
    )

    if (date) {
      return { date, slugSeed: timestampMatch[8] }
    }
  }

  const dateMatch = EMBEDDED_DATE_NAME_PATTERN.exec(base)

  if (dateMatch) {
    const date = utcDate(dateMatch[1], dateMatch[2], dateMatch[3])

    if (date) {
      return { date, slugSeed: dateMatch[4] }
    }
  }

  return { date: statSync(filePath).mtime, slugSeed: base }
}

function standardizedFileSlug(filePath: string, slugSeed: string): string {
  const sanitized = slugSeed
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')

  // An existing keyword slug is operator-chosen and kept verbatim; only slugs
  // that are empty or opaque hex fragments are re-derived from file content.
  if (sanitized.length > 0 && !/^[0-9a-f]{7,}$/u.test(sanitized)) {
    return sanitized
  }

  const derived = keywordRunSuffixFrom(
    sanitized,
    textFileContent(filePath) ?? undefined,
  )

  return (
    derived ??
    (sanitized.length > 0
      ? sanitized
      : deterministicUuidSuffix(path.basename(filePath)))
  )
}

function isPolicyMandatedFileName(name: string): boolean {
  return policyMandatedFileDate(name) !== null
}

function isCompliantTemporalFileName(name: string): boolean {
  return temporalFileDate(name) !== null
}

/**
 * Whether standardization would rename a loose file of this name. The cleanup
 * planner asks the same question, so its plan names exactly the renames the
 * standardizer performs.
 */
export function needsTemporalFileName(name: string): boolean {
  return (
    !name.startsWith('.') &&
    !isCompliantTemporalFileName(name) &&
    !isPolicyMandatedFileName(name)
  )
}

/**
 * Directories the standardizer scans, keyed by the runtime area they belong
 * to. Each temporal directory contributes itself and its `archive/` child.
 */
export function temporalFileDirectories(): Record<string, string[]> {
  return {
    inbox: [...INBOX_TEMPORAL_SCAN_DIRECTORIES],
    ...Object.fromEntries(
      TEMPORAL_FILE_DIRECTORIES.map((directoryRelative) => [
        directoryRelative,
        [directoryRelative, `${directoryRelative}/archive`],
      ]),
    ),
  }
}

/**
 * Rename the non-compliant loose files of one directory into the temporal
 * scheme, recording each move as a harness-relative mapping.
 *
 * The inbox directories and the pull-request directories once ran two
 * near-identical copies of this loop, so a traversal fix reached only one of
 * them.
 */
function standardizeTemporalFileNamesIn(
  root: string,
  parentRelative: string,
  mappings: Map<string, string>,
  mutableFileSet?: RuntimeMutableFileSet,
): void {
  const parent = path.join(root, parentRelative)

  if (!existsSync(parent)) {
    return
  }

  const entries = readdirSync(parent, { withFileTypes: true })
  const taken = new Set(entries.map((entry) => entry.name))

  for (const entry of entries) {
    if (!entry.isFile() || !needsTemporalFileName(entry.name)) {
      continue
    }

    const absolute = path.join(parent, entry.name)
    const { date, slugSeed } = temporalFileSource(absolute)
    const extension = path.extname(entry.name)
    const slug = standardizedFileSlug(absolute, slugSeed)

    const prefix = temporalNamePrefix(date)
    let target = `${prefix}_${slug}${extension}`
    let ordinal = 2

    while (taken.has(target)) {
      target = `${prefix}_${slug}-${ordinal}${extension}`
      ordinal += 1
    }

    taken.add(target)
    const targetAbsolute = path.join(parent, target)

    renameSync(absolute, targetAbsolute)
    relocateRuntimeMutablePaths(mutableFileSet, absolute, targetAbsolute)
    mappings.set(
      `${parentRelative}/${entry.name}`,
      `${parentRelative}/${target}`,
    )
  }
}

/**
 * Rename every non-durable file under the temporal runtime directories to the
 * `<days-to-anchor>_<MMM-DD>-<minutes-to-end-of-UTC-day>_<slug>` scheme used by
 * `runtime/logs/workflows`, then rewrite persisted references to the old names.
 * `directories` narrows the pass to a subset of `temporalFileDirectories()`,
 * which is how a class-filtered cleanup renames only what it planned.
 */
export function standardizeRuntimeFileNames(
  root = findProjectRoot(),
  mutableFileSet = createRuntimeMutableFileSet(path.join(root, 'runtime')),
  directories: readonly string[] = Object.values(
    temporalFileDirectories(),
  ).flat(),
): RuntimeNameStandardizationSummary {
  const mappings = new Map<string, string>()

  for (const parentRelative of directories) {
    standardizeTemporalFileNamesIn(
      root,
      parentRelative,
      mappings,
      mutableFileSet,
    )
  }

  const updatedFiles =
    mappings.size > 0
      ? updateFileCount(runtimeMutablePaths(mutableFileSet), mappings)
      : 0

  return {
    renamed_files: mappings.size,
    updated_files: updatedFiles,
    renames: Object.fromEntries(mappings),
  }
}

export interface RunSuffixMigrationSummary {
  run_directories: number
  best_of_n_directories: number
  session_directories: number
  updated_files: number
  skipped_directories: string[]
}
