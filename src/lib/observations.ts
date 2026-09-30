import { readFileSync } from 'node:fs'
import path from 'node:path'

import { observationWindowMs } from './acceptance-proof.js'
import { PanError } from './errors.js'
import {
  appendJsonLine,
  fileExists,
  isRecord,
  readJson,
  resolveInside,
  withOperationMutex,
} from './io.js'
import { listRunStates, loadState } from './state.js'
import type { RunState } from './types.js'

export { observationWindowMs }

/**
 * Post-ship observation items.
 *
 * A ship output records `data.release.observations[]` for every acceptance
 * criterion verify deferred to a signal after ship. This module lists those
 * items across runs and keeps the append-only ledger of their resolutions,
 * so the harness technician audit can confirm or refute each one once its
 * window has elapsed. Nothing here queries the named source; an operator or
 * agent runs the recorded check.
 */

const RESOLUTIONS_PATH = path.join(
  'runtime',
  'observations',
  'resolutions.jsonl',
)
const RESOLUTIONS_MUTEX = path.join(
  'runtime',
  'observations',
  'resolutions.lock',
)

export type ObservationResolutionStatus = 'confirmed' | 'refuted'

export type ObservationStatus = 'open' | 'due' | ObservationResolutionStatus

export interface ObservationResolution {
  schema_version: 1
  run_id: string
  criterion: string
  status: ObservationResolutionStatus
  note: string
  /** Harness-relative regression intake a refutation filed. */
  intake?: string
  resolved_at: string
}

export interface ObservationItem {
  run_id: string
  criterion: string
  signal: string
  source: string
  window: string
  check: string
  /** Submission time of the run's latest successful ship output. */
  shipped_at: string
  /** `shipped_at` plus `window`, or null when the window does not parse. */
  due_at: string | null
  /**
   * `open` while the window runs, `due` once it has elapsed or cannot be
   * computed, and the resolution status once the ledger resolves the item.
   */
  status: ObservationStatus
  resolution?: ObservationResolution
}

export function observationResolutionsPath(root: string): string {
  return resolveInside(root, RESOLUTIONS_PATH)
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

/** Observations the run's latest successful ship output records. */
function shipObservations(
  root: string,
  state: RunState,
): Array<Omit<ObservationItem, 'due_at' | 'status' | 'resolution'>> {
  const ship = [...state.stage_history]
    .reverse()
    .find(
      (item) =>
        item.stage === 'ship' &&
        item.outcome === 'success' &&
        typeof item.output_path === 'string',
    )

  if (!ship || !fileExists(path.join(root, ship.output_path))) {
    return []
  }

  let value: unknown

  try {
    value = readJson(path.join(root, ship.output_path))
  } catch {
    return []
  }

  const release =
    isRecord(value) && isRecord(value.data) && isRecord(value.data.release)
      ? value.data.release
      : null
  const entries = Array.isArray(release?.observations)
    ? release.observations
    : []
  const items: Array<
    Omit<ObservationItem, 'due_at' | 'status' | 'resolution'>
  > = []

  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue
    }

    const criterion = nonEmptyText(entry.criterion)

    if (!criterion) {
      continue
    }

    items.push({
      run_id: state.run_id,
      criterion,
      signal: nonEmptyText(entry.signal) ?? '',
      source: nonEmptyText(entry.source) ?? '',
      window: nonEmptyText(entry.window) ?? '',
      check: nonEmptyText(entry.check) ?? '',
      shipped_at: ship.submitted_at,
    })
  }

  return items
}

function resolutionKey(runId: string, criterion: string): string {
  return `${runId}\u0000${criterion}`
}

/**
 * Epoch milliseconds an observation falls due: its ship time plus its window.
 * Null when either does not parse, which the ship validator refuses for a new
 * output, so a caller treats null as due.
 */
function observationDueMs(observation: {
  window: string
  shipped_at: string
}): number | null {
  const windowMs = observationWindowMs(observation.window)
  const shippedMs = Date.parse(observation.shipped_at)

  return windowMs === null || Number.isNaN(shippedMs)
    ? null
    : shippedMs + windowMs
}

/** Every resolution the ledger records, in append order. */
export function readObservationResolutions(
  root: string,
): ObservationResolution[] {
  const ledger = observationResolutionsPath(root)

  if (!fileExists(ledger)) {
    return []
  }

  const resolutions: ObservationResolution[] = []

  for (const line of readFileSync(ledger, 'utf8').split('\n')) {
    if (line.trim().length === 0) {
      continue
    }

    let parsed: unknown

    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }

    if (
      isRecord(parsed) &&
      typeof parsed.run_id === 'string' &&
      typeof parsed.criterion === 'string' &&
      (parsed.status === 'confirmed' || parsed.status === 'refuted') &&
      typeof parsed.note === 'string' &&
      typeof parsed.resolved_at === 'string'
    ) {
      resolutions.push(parsed as unknown as ObservationResolution)
    }
  }

  return resolutions
}

/**
 * Observation items across every recorded run, newest ship first. Resolved
 * items appear only with `all`.
 */
export function listObservations(
  root: string,
  options: { all?: boolean; now?: Date } = {},
): ObservationItem[] {
  const now = (options.now ?? new Date()).getTime()
  const resolutions = new Map(
    readObservationResolutions(root).map((resolution) => [
      resolutionKey(resolution.run_id, resolution.criterion),
      resolution,
    ]),
  )
  const items: ObservationItem[] = []

  for (const state of listRunStates(root)) {
    for (const observation of shipObservations(root, state)) {
      const resolution = resolutions.get(
        resolutionKey(observation.run_id, observation.criterion),
      )

      if (resolution && !options.all) {
        continue
      }

      const dueMs = observationDueMs(observation)

      items.push({
        ...observation,
        due_at: dueMs === null ? null : new Date(dueMs).toISOString(),
        status: resolution
          ? resolution.status
          : dueMs !== null && dueMs > now
            ? 'open'
            : 'due',
        ...(resolution ? { resolution } : {}),
      })
    }
  }

  return items.sort(
    (left, right) =>
      right.shipped_at.localeCompare(left.shipped_at) ||
      left.run_id.localeCompare(right.run_id) ||
      left.criterion.localeCompare(right.criterion),
  )
}

export interface ResolveObservationRequest {
  runId: string
  criterion: string
  status: string
  note: string
  intake?: string | null
  /**
   * Root a relative `intake` resolves against, `root` by default. A sweep
   * resolves an installation's item from the source checkout, where the
   * audit filed its intake, so it passes that checkout here.
   */
  intakeRoot?: string
  now?: Date
}

/**
 * Append one resolution to the ledger. Refuses an unknown run or criterion,
 * a confirmation before the item's window ends, a second resolution of the
 * same item, and a refutation that names no regression intake on disk.
 */
export function resolveObservation(
  root: string,
  request: ResolveObservationRequest,
): ObservationResolution {
  if (request.status !== 'confirmed' && request.status !== 'refuted') {
    throw new PanError('--status MUST be confirmed or refuted.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  const note = request.note.trim()

  if (note.length === 0) {
    throw new PanError('--note MUST state the evidence for the resolution.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  const intake = request.intake?.trim() ?? ''

  if (request.status === 'refuted' && intake.length === 0) {
    throw new PanError(
      'A refuted observation MUST name the regression intake it filed with --intake.',
      { code: 'OBSERVATION_INTAKE_REQUIRED' },
    )
  }

  // An embedded-installation audit files its intake in the Pancreator source
  // checkout, so an absolute path outside this root is accepted as given.
  if (
    intake.length > 0 &&
    !fileExists(
      path.isAbsolute(intake)
        ? intake
        : resolveInside(request.intakeRoot ?? root, intake),
    )
  ) {
    throw new PanError(`--intake does not name a file: ${intake}`, {
      code: 'OBSERVATION_INTAKE_NOT_FOUND',
    })
  }

  const state = loadState(root, request.runId)
  const observation = shipObservations(root, state).find(
    (item) => item.criterion === request.criterion,
  )

  if (!observation) {
    throw new PanError(
      `Run ${request.runId} records no ship observation for ${request.criterion}.`,
      { code: 'OBSERVATION_NOT_FOUND' },
    )
  }

  const now = request.now ?? new Date()
  const dueMs = observationDueMs(observation)

  // REPAIR-001: the signal has not built up before the window ends, so only
  // a refutation, which the signal can already show, may close an open item.
  if (
    request.status === 'confirmed' &&
    dueMs !== null &&
    dueMs > now.getTime()
  ) {
    throw new PanError(
      `Observation ${request.criterion} of run ${request.runId} is open ` +
        `until ${new Date(dueMs).toISOString()}. Confirm it after that time, ` +
        'or refute it now if the signal already shows the regression.',
      { code: 'OBSERVATION_NOT_DUE' },
    )
  }

  return withOperationMutex(resolveInside(root, RESOLUTIONS_MUTEX), () => {
    const existing = readObservationResolutions(root).find(
      (resolution) =>
        resolution.run_id === request.runId &&
        resolution.criterion === request.criterion,
    )

    if (existing) {
      throw new PanError(
        `Observation ${request.criterion} of run ${request.runId} is already ` +
          `${existing.status} (${existing.resolved_at}).`,
        { code: 'OBSERVATION_ALREADY_RESOLVED' },
      )
    }

    const resolution: ObservationResolution = {
      schema_version: 1,
      run_id: request.runId,
      criterion: request.criterion,
      status: request.status as ObservationResolutionStatus,
      note,
      ...(intake.length > 0 ? { intake } : {}),
      resolved_at: now.toISOString(),
    }

    appendJsonLine(observationResolutionsPath(root), resolution)

    return resolution
  })
}

/**
 * A predicate that says whether a run still owes an unresolved observation.
 * Retention keeps such a run in the live tree, because `pan observations`
 * and `pan observations resolve` read only live runs. The ledger is read
 * once per predicate. A run whose state cannot load holds nothing.
 */
export function unresolvedObservationHold(
  root: string,
): (runId: string) => boolean {
  let resolved: Set<string> | null = null

  return (runId) => {
    let observations: ReturnType<typeof shipObservations>

    try {
      observations = shipObservations(root, loadState(root, runId))
    } catch {
      return false
    }

    if (observations.length === 0) {
      return false
    }

    resolved ??= new Set(
      readObservationResolutions(root).map((resolution) =>
        resolutionKey(resolution.run_id, resolution.criterion),
      ),
    )

    const keys = resolved

    return observations.some(
      (item) => !keys.has(resolutionKey(item.run_id, item.criterion)),
    )
  }
}

/** Plain-text table of observation items for the terminal. */
export function renderObservations(items: readonly ObservationItem[]): string {
  if (items.length === 0) {
    return 'No open post-ship observations.'
  }

  return items
    .map((item) =>
      [
        `${item.status.toUpperCase()} ${item.run_id} ${item.criterion} ` +
          `(window ${item.window || 'unset'}, due ${item.due_at ?? 'unknown'})`,
        `  signal: ${item.signal}`,
        `  source: ${item.source}`,
        `  check: ${item.check}`,
        ...(item.resolution
          ? [
              `  resolution: ${item.resolution.note}` +
                (item.resolution.intake
                  ? ` (intake ${item.resolution.intake})`
                  : ''),
            ]
          : []),
      ].join('\n'),
    )
    .join('\n\n')
}
