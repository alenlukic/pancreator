/**
 * Platform-guidance sightings: evidence that a host showed a catalogued
 * platform string or took a catalogued platform action during a run. A
 * sighting is not a `platform_guidance_conflicts[]` entry, because only the
 * agent knows which step the guidance covered and which authority it followed.
 */

import {
  appendJsonLine,
  fileExists,
  isRecord,
  readText,
  resolveInside,
  withOperationMutex,
} from '../io.js'
import { PanError } from '../errors.js'
import {
  loadPlatformGuidanceCatalog,
  redlineHost,
  type GuidanceSurface,
  type RedlineHost,
} from '../platform-guidance.js'
import { resolveRunLayout } from '../run-layout.js'
import {
  listRunStates,
  loadState,
  operationMutexPath,
  persist,
  runIsLive,
} from '../state.js'
import { PLATFORM_ACTION_CATEGORY, readRedlineRecord } from './redline.js'

export const SIGHTINGS_FILENAME = 'platform-guidance-sightings.jsonl'

export interface PlatformGuidanceSighting {
  schema_version: 1
  observed_at: string
  run_id: string
  host: RedlineHost
  guidance_id: string
  category: string
  surface: GuidanceSurface
  /** Set when the sighting is a platform action rather than guidance text. */
  action: typeof PLATFORM_ACTION_CATEGORY.id | null
  /** A path or tool-call id that locates the sighting; never its content. */
  evidence: string | null
  session_id: string | null
}

export interface SightingInput {
  host: string | null
  guidanceId: string
  action?: string | null
  evidence?: string | null
  sessionId?: string | null
}

/** The root-relative path of a run's sightings ledger. */
export function sightingsPath(root: string, runId: string): string {
  return resolveRunLayout(root, runId).evidence(SIGHTINGS_FILENAME).relative
}

/** Read a run's sightings; unreadable lines are skipped. */
export function readSightings(
  root: string,
  runId: string,
): PlatformGuidanceSighting[] {
  const absolute = resolveInside(root, sightingsPath(root, runId))

  if (!fileExists(absolute)) {
    return []
  }

  return readText(absolute)
    .split('\n')
    .flatMap((line) => {
      try {
        const value: unknown = JSON.parse(line)

        return isRecord(value) && value.schema_version === 1
          ? [value as unknown as PlatformGuidanceSighting]
          : []
      } catch {
        return []
      }
    })
}

/**
 * The single live run whose latest redline declaration names `host`. A hook
 * knows its host but not its run, so it records nothing when zero or several
 * runs match.
 */
export function sightingRunForHost(
  root: string,
  host: RedlineHost,
): string | null {
  const matches = listRunStates(root)
    .filter(runIsLive)
    .filter((state) => {
      const declarations = readRedlineRecord(root, state.run_id)?.declarations

      return declarations?.at(-1)?.host === host
    })

  return matches.length === 1 ? matches[0].run_id : null
}

/**
 * Append one sighting to the run's ledger and persist a run event. The
 * guidance id MUST name a catalog entry for the host.
 */
export function recordSighting(
  root: string,
  runId: string,
  input: SightingInput,
): PlatformGuidanceSighting {
  const host = redlineHost(input.host, {})

  if (host === null) {
    throw new PanError('pan redline observe requires --host.', {
      code: 'INVALID_REDLINE_HOST',
    })
  }

  const entry = loadPlatformGuidanceCatalog(root)?.entries.find(
    (candidate) => candidate.id === input.guidanceId,
  )

  if (!entry || !entry.hosts.includes(host)) {
    throw new PanError(
      `--guidance-id ${input.guidanceId} names no platform guidance catalog ` +
        `entry for host ${host}.`,
      { code: 'UNKNOWN_PLATFORM_GUIDANCE' },
    )
  }

  const action =
    input.action ??
    (entry.category === PLATFORM_ACTION_CATEGORY.id ? entry.category : null)

  if (action !== null && action !== PLATFORM_ACTION_CATEGORY.id) {
    throw new PanError(
      `--action MUST be ${PLATFORM_ACTION_CATEGORY.id}; received ${action}.`,
      { code: 'INVALID_PLATFORM_ACTION' },
    )
  }

  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)
    const relative = sightingsPath(root, runId)
    const sighting: PlatformGuidanceSighting = {
      schema_version: 1,
      observed_at: new Date().toISOString(),
      run_id: runId,
      host,
      guidance_id: entry.id,
      category: entry.category,
      surface: entry.surface,
      action: action === null ? null : PLATFORM_ACTION_CATEGORY.id,
      evidence: input.evidence ?? null,
      session_id: input.sessionId ?? null,
    }

    appendJsonLine(resolveInside(root, relative), sighting)
    persist(root, state, 'platform_guidance_sighted', {
      record_path: relative,
      host,
      guidance_id: entry.id,
      category: entry.category,
      action: sighting.action,
    })

    return sighting
  })
}
