import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { invariant } from '../errors.js'
import { isRecord, resolveInside, writeJsonAtomic } from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import {
  agentDirectory,
  parseJsonFile,
  replaceMappings,
  toRepoRelative,
  type StageOccurrence,
} from './identity.js'

/**
 * Run-local map from every invocation id a citation may still name to the id
 * that run carries now.
 *
 * Invocation prefixes are resequenced while a run is live and again when it
 * closes, so a path an operator or a report wrote down stops resolving. The
 * rewrite repairs every reference inside the run's own files; nothing repairs
 * a citation that left it. This map is the alias that closes that gap, and it
 * changes no name.
 */
export const INVOCATION_ALIAS_FILE = 'invocation-aliases.json'

interface InvocationAliasRecord {
  schema_version: 1
  run_id: string
  updated_at: string
  /** Superseded invocation id to the id the run carries now. */
  aliases: Record<string, string>
}

function invocationAliasPath(runDirectory: string): string {
  return path.join(agentDirectory(runDirectory), INVOCATION_ALIAS_FILE)
}

/**
 * The alias file records superseded ids, so the rewrite that supersedes them
 * must not rewrite the record's own keys into their replacements.
 */
export function isInvocationAliasFile(filePath: string): boolean {
  return path.basename(filePath) === INVOCATION_ALIAS_FILE
}

function readInvocationAliases(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    return {}
  }

  let parsed: unknown

  try {
    parsed = parseJsonFile(filePath)
  } catch {
    return {}
  }

  if (!isRecord(parsed) || !isRecord(parsed.aliases)) {
    return {}
  }

  const aliases: Record<string, string> = {}

  for (const [from, to] of Object.entries(parsed.aliases)) {
    if (typeof to === 'string' && to.length > 0 && from !== to) {
      aliases[from] = to
    }
  }

  return aliases
}

/**
 * Extend the run's alias map with one resequencing pass.
 *
 * An alias already in the file is repointed through this pass, so a citation
 * written before the first resequence still lands on the current id after the
 * last one. Identity entries are dropped: a pass that renamed nothing leaves
 * the map exactly as it was.
 */
export function recordInvocationAliases(
  runDirectory: string,
  runId: string,
  occurrences: StageOccurrence[],
): void {
  const filePath = invocationAliasPath(runDirectory)
  const existing = readInvocationAliases(filePath)
  const renames = new Map(
    occurrences
      .filter(
        (occurrence) =>
          occurrence.oldInvocationId !== occurrence.newInvocationId,
      )
      .map((occurrence) => [
        occurrence.oldInvocationId,
        occurrence.newInvocationId,
      ]),
  )
  const aliases: Record<string, string> = {}

  for (const [from, to] of Object.entries(existing)) {
    const current = renames.get(to) ?? to

    if (from !== current) {
      aliases[from] = current
    }
  }

  for (const [from, to] of renames) {
    aliases[from] = to
  }

  if (Object.keys(aliases).length === 0) {
    return
  }

  const record: InvocationAliasRecord = {
    schema_version: 1,
    run_id: runId,
    updated_at: new Date().toISOString(),
    aliases: Object.fromEntries(
      Object.entries(aliases).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  }

  mkdirSync(path.dirname(filePath), { recursive: true })
  writeJsonAtomic(filePath, record)
}

/** What one citation of a run's artifact resolves to today. */
export interface ResolvedRunCitation {
  run_id: string
  citation: string
  /** The citation with every superseded invocation id replaced. */
  resolved: string
  /** True when the alias map changed the citation. */
  aliased: boolean
  /** Repository-relative path that exists now, when one could be resolved. */
  path: string | null
  /** Alias record consulted, or `null` when the run has none. */
  alias_path: string | null
}

/**
 * Where one citation candidate lands, or `null` when it leaves the run it
 * claims to cite.
 *
 * A citation is caller-supplied text, so each candidate passes the shared
 * containment helper twice: once against the installation and once against
 * the run directory. A traversal such as `../../../../etc/hosts` yields no
 * candidate and the resolver answers as it does for an unknown citation,
 * rather than reporting a path that has nothing to do with the run.
 */
function containedCitationPath(
  root: string,
  runDirectory: string,
  candidate: string,
): string | null {
  try {
    const absolute = resolveInside(root, candidate)

    return resolveInside(runDirectory, path.relative(runDirectory, absolute))
  } catch {
    return null
  }
}

/**
 * Resolve a citation of one run's artifact against that run's alias map.
 *
 * The citation may be a whole repository-relative path or a bare invocation
 * id; both carry the prefix that moved. A citation the map does not touch
 * comes back unchanged, which is the honest answer for a path that was always
 * current and for one that never existed.
 */
export function resolveRunCitation(
  root: string,
  runId: string,
  citation: string,
): ResolvedRunCitation {
  const runDirectory = resolveInside(root, `runtime/logs/workflows/${runId}`)

  invariant(existsSync(runDirectory), `Unknown run: ${runId}`, {
    code: 'RUN_NOT_FOUND',
  })

  const filePath = invocationAliasPath(runDirectory)
  const aliases = readInvocationAliases(filePath)
  const resolved = replaceMappings(citation, new Map(Object.entries(aliases)))
  const candidates = [
    resolved,
    ...(resolved.includes('/')
      ? []
      : // A bare invocation id names no file on its own; the card is the
        // artifact a reader following a stale citation is looking for.
        [
          resolveRunLayout(root, runId).invocation(resolved, '.md').relative,
          resolveRunLayout(root, runId).invocation(resolved, '.json').relative,
        ]),
  ]

  return {
    run_id: runId,
    citation,
    resolved,
    aliased: resolved !== citation,
    path:
      candidates.find((candidate) => {
        const absolute = containedCitationPath(root, runDirectory, candidate)

        return absolute !== null && existsSync(absolute)
      }) ?? null,
    alias_path: existsSync(filePath) ? toRepoRelative(root, filePath) : null,
  }
}
