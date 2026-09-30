import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { findProjectRoot, isRecord } from '../io.js'
import {
  keywordRunSuffix,
  keywordRunSuffixFrom,
  RUN_SUFFIX_MAX_LENGTH,
} from '../naming.js'
import { agentDirectory, parseJsonFile, textFileContent } from './identity.js'
import {
  createRuntimeMutableFileSet,
  moveDirectory,
  runtimeMutablePaths,
} from './mutable-files.js'
import { HASH_RUN_SUFFIX_PATTERN, updateFileCount } from './run-ids.js'
import type { RunSuffixMigrationSummary } from './temporal-names.js'

function workflowKeywordSuffix(runDirectory: string): string | null {
  const statePath = path.join(agentDirectory(runDirectory), 'state.json')

  if (!existsSync(statePath)) {
    return null
  }

  const state = parseJsonFile(statePath)

  if (!isRecord(state)) {
    return null
  }

  const candidates = [
    typeof state.title === 'string' ? state.title : null,
    isRecord(state.request) && typeof state.request.source_path === 'string'
      ? path.basename(state.request.source_path)
      : null,
    typeof state.workflow_slug === 'string' ? state.workflow_slug : null,
  ]

  for (const candidate of candidates) {
    const suffix = candidate === null ? null : keywordRunSuffix(candidate)

    if (suffix) {
      return suffix
    }
  }

  return null
}

function bestOfNKeywordSuffix(directory: string): string | null {
  const statePath = path.join(directory, 'state.json')

  if (existsSync(statePath)) {
    const state = parseJsonFile(statePath)

    if (
      isRecord(state) &&
      isRecord(state.request) &&
      typeof state.request.source_path === 'string'
    ) {
      const suffix = keywordRunSuffix(path.basename(state.request.source_path))

      if (suffix) {
        return suffix
      }
    }
  }

  const requestPath = path.join(directory, 'request.md')

  return existsSync(requestPath)
    ? keywordRunSuffixFrom(
        'request.md',
        textFileContent(requestPath) ?? undefined,
      )
    : null
}

function sessionKeywordSuffix(directory: string): string | null {
  for (const entry of readdirSync(directory)) {
    if (entry.endsWith('-card.md')) {
      const suffix = keywordRunSuffix(entry.slice(0, -'-card.md'.length))

      if (suffix) {
        return suffix
      }
    }
  }

  return null
}

function dedupedRunId(
  prefix: string,
  suffix: string,
  taken: (candidate: string) => boolean,
): string | null {
  const stem = suffix.slice(0, RUN_SUFFIX_MAX_LENGTH - 2).replace(/-+$/u, '')
  const candidates = [
    suffix,
    ...Array.from({ length: 8 }, (_, index) => `${stem}-${index + 2}`),
  ]

  for (const candidate of candidates) {
    const id = `${prefix}_${candidate}`

    if (!taken(id)) {
      return id
    }
  }

  return null
}

interface SuffixMigrationGroup {
  kind: 'workflow' | 'best-of-n' | 'session'
  /** Parent directories scanned for hash-suffixed children, archive included. */
  parents: string[]
  /** Same-index twins that must be renamed in lockstep (state mirrors). */
  twins: (string | null)[]
}

const SUFFIX_MIGRATION_GROUPS: SuffixMigrationGroup[] = [
  {
    kind: 'workflow',
    parents: ['runtime/logs/workflows', 'runtime/logs/workflows/archive'],
    twins: ['runtime/workflows', 'runtime/workflows/archive'],
  },
  {
    kind: 'best-of-n',
    parents: ['runtime/logs/best-of-n', 'runtime/logs/best-of-n/archive'],
    twins: [null, null],
  },
  {
    kind: 'session',
    parents: ['runtime/logs/sessions', 'runtime/logs/sessions/archive'],
    twins: [null, null],
  },
]

/**
 * Replace opaque 8-hex run directory suffixes with high-signal keyword
 * suffixes derived from what the run was about, rewriting every persisted
 * reference to the old IDs. Directories without a derivable seed, and
 * best-of-N sessions whose worktrees still exist on disk (git records their
 * absolute paths), keep their hash suffix and are reported as skipped.
 */
export function migrateRunSuffixes(
  root = findProjectRoot(),
  mutableFileSet = createRuntimeMutableFileSet(path.join(root, 'runtime')),
): RunSuffixMigrationSummary {
  const runtimeRoot = path.join(root, 'runtime')

  const mappings = new Map<string, string>()
  const moves: Array<{ parent: string; source: string; target: string }> = []
  const skipped: string[] = []
  const counts = { workflow: 0, 'best-of-n': 0, session: 0 }

  for (const group of SUFFIX_MIGRATION_GROUPS) {
    const taken = (candidate: string): boolean =>
      group.parents.some((relative) =>
        existsSync(path.join(root, relative, candidate)),
      ) ||
      group.twins.some(
        (relative) =>
          relative !== null && existsSync(path.join(root, relative, candidate)),
      ) ||
      [...mappings.values()].includes(candidate)

    group.parents.forEach((parentRelative, parentIndex) => {
      const parent = path.join(root, parentRelative)

      if (!existsSync(parent)) {
        return
      }

      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        const match = HASH_RUN_SUFFIX_PATTERN.exec(entry.name)

        if (!entry.isDirectory() || !match) {
          continue
        }

        const directory = path.join(parent, entry.name)
        const suffix =
          group.kind === 'workflow'
            ? workflowKeywordSuffix(directory)
            : group.kind === 'best-of-n'
              ? bestOfNKeywordSuffix(directory)
              : sessionKeywordSuffix(directory)

        if (!suffix) {
          skipped.push(`${parentRelative}/${entry.name}`)
          continue
        }

        if (
          group.kind === 'best-of-n' &&
          (existsSync(path.join(root, 'worktrees', entry.name)) ||
            existsSync(path.join(runtimeRoot, 'worktrees', entry.name)))
        ) {
          skipped.push(`${parentRelative}/${entry.name}`)
          continue
        }

        const target = dedupedRunId(match[1], suffix, taken)

        if (!target) {
          skipped.push(`${parentRelative}/${entry.name}`)
          continue
        }

        if (target === entry.name) {
          continue
        }

        mappings.set(entry.name, target)
        moves.push({ parent, source: entry.name, target })

        const twinRelative = group.twins[parentIndex]

        if (twinRelative !== null && twinRelative !== undefined) {
          const twinParent = path.join(root, twinRelative)

          if (existsSync(path.join(twinParent, entry.name))) {
            moves.push({ parent: twinParent, source: entry.name, target })
          }
        }

        counts[group.kind] += 1
      }
    })
  }

  const updatedFiles =
    mappings.size > 0
      ? updateFileCount(runtimeMutablePaths(mutableFileSet), mappings)
      : 0

  for (const move of moves) {
    moveDirectory(move.parent, move.source, move.target, mutableFileSet)
  }

  return {
    run_directories: counts.workflow,
    best_of_n_directories: counts['best-of-n'],
    session_directories: counts.session,
    updated_files: updatedFiles,
    skipped_directories: skipped.sort(),
  }
}
