/** Execution hits from harness run records and standalone sessions. */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { isDirectory, isFile, isRecord } from '../../io.js'
import type { Facility } from '../inventory.js'
import {
  listDirectories,
  parseTimestamp,
  readJsonRecord,
  safeStatMs,
} from './files.js'

/**
 * Expand a log root into its run directories, following the archive.
 *
 * `pan archive` moves a run into a sibling `archive/` directory rather than
 * deleting it, so a 30-day window that reads only the active tree reports
 * every facility older than the 7-day retention default as unused.
 */
function withArchive(base: string): string[] {
  const found: string[] = []

  for (const name of listDirectories(base)) {
    if (name === 'archive') {
      const archive = path.join(base, name)

      found.push(
        ...listDirectories(archive).map((child) => path.join(archive, child)),
      )
      continue
    }

    found.push(path.join(base, name))
  }

  return found
}

function runDirectories(root: string): string[] {
  return [
    ...withArchive(path.join(root, 'runtime', 'logs', 'workflows')),
    ...withArchive(path.join(root, 'runtime', 'workflows')),
  ]
}

/**
 * Mode a standalone session ran under.
 *
 * The session writes `<mode>-card.md`, which is exact. The directory name
 * carries the same mode with a `-2` disambiguating suffix when two sessions
 * share a minute, so it is the fallback rather than the primary source.
 */
function sessionMode(absolute: string): string | null {
  if (isDirectory(absolute)) {
    for (const entry of readdirSync(absolute)) {
      if (entry.endsWith('-card.md')) {
        return entry.slice(0, -'-card.md'.length)
      }
    }
  }

  const segments = path.basename(absolute).split('_')
  const suffix = segments.at(-1)

  if (!suffix || segments.length < 2) {
    return null
  }

  return suffix.replace(/-\d+$/u, '')
}

/**
 * Walks workflow runs and standalone sessions active since the window start
 * and reports each facility they used through `record`: the run's workflow,
 * each invocation's persona, workflow, policies, and guidance owners, and each
 * session's mode and matching command. Returns how many runs and sessions fell
 * inside the window. Unreadable records are skipped.
 */
export function collectRunHits(
  root: string,
  facilities: readonly Facility[],
  windowStartMs: number,
  record: (facilityId: string, at: number, source: string) => void,
): { runs: number; sessions: number } {
  const guidanceOwners = new Map<string, string>()

  for (const entry of facilities) {
    for (const owned of entry.owned_paths) {
      guidanceOwners.set(owned, entry.id)
    }
  }

  const commandNames = new Set(
    facilities
      .filter((entry) => entry.category === 'command')
      .map((entry) => entry.name),
  )
  let runs = 0
  let sessions = 0

  for (const runDir of runDirectories(root)) {
    const agentDir = path.join(runDir, 'agent')
    const statePath = path.join(agentDir, 'state.json')
    const state = isFile(statePath) ? readJsonRecord(statePath) : null
    const stateAt =
      parseTimestamp(state?.created_at) ??
      parseTimestamp(state?.updated_at) ??
      safeStatMs(statePath) ??
      safeStatMs(runDir)

    if (stateAt === null || stateAt < windowStartMs) {
      continue
    }

    runs += 1

    if (typeof state?.workflow_slug === 'string') {
      record(
        `workflow:${state.workflow_slug}`,
        stateAt,
        path.relative(root, runDir),
      )
    }

    const invocationsDir = path.join(agentDir, 'invocations')

    if (!isDirectory(invocationsDir)) {
      continue
    }

    for (const entry of readdirSync(invocationsDir).sort()) {
      if (!entry.endsWith('.json')) {
        continue
      }

      const invocationPath = path.join(invocationsDir, entry)
      const invocation = readJsonRecord(invocationPath)

      if (!invocation) {
        continue
      }

      const at =
        parseTimestamp(invocation.created_at) ??
        safeStatMs(invocationPath) ??
        stateAt

      if (at < windowStartMs) {
        continue
      }

      const source = path.relative(root, invocationPath)
      const stage = isRecord(invocation.stage) ? invocation.stage : null
      const workflow = isRecord(invocation.workflow)
        ? invocation.workflow
        : null

      if (typeof stage?.persona === 'string') {
        record(`persona:${stage.persona}`, at, source)
      }

      if (typeof workflow?.slug === 'string') {
        record(`workflow:${workflow.slug}`, at, source)
      }

      if (Array.isArray(invocation.policies)) {
        for (const policy of invocation.policies) {
          if (isRecord(policy) && typeof policy.id === 'string') {
            record(`policy:${policy.id}`, at, source)
          }
        }
      }

      // Guidance is the one structured edge that reaches a skill or a
      // handbook, so it is the only direct evidence those categories get.
      const manifest = isRecord(invocation.contract_manifest)
        ? invocation.contract_manifest
        : null

      if (manifest && Array.isArray(manifest.guidance)) {
        for (const guidance of manifest.guidance) {
          if (!isRecord(guidance) || typeof guidance.source_path !== 'string') {
            continue
          }

          const owner = guidanceOwners.get(guidance.source_path)

          if (owner) {
            record(owner, at, source)
          }
        }
      }
    }
  }

  for (const sessionDir of withArchive(
    path.join(root, 'runtime', 'logs', 'sessions'),
  )) {
    const at = safeStatMs(sessionDir)

    if (at === null || at < windowStartMs) {
      continue
    }

    sessions += 1

    const mode = sessionMode(sessionDir)

    if (!mode) {
      continue
    }

    const source = path.relative(root, sessionDir)

    record(`mode:${mode}`, at, source)

    // A standalone session is named for the mode its command resolves, which
    // is the only runtime trace a card-backed slash command leaves.
    if (commandNames.has(`pan-${mode}`)) {
      record(`command:pan-${mode}`, at, source)
    }
  }

  return { runs, sessions }
}
