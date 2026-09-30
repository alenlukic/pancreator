/**
 * Parsing and validation of `pan watch` cadence, stall, state, and timeout
 * options.
 */

import { PanError } from '../errors.js'

import {
  DEFAULT_WATCH_CADENCE_SECONDS,
  DEFAULT_WATCH_TIMEOUT_SECONDS,
  MIN_WATCH_CADENCE_SECONDS,
  WATCH_CADENCE_BELOW_MINIMUM,
  WATCH_CADENCE_UNAUTHORIZED,
  WATCH_STALL_WAKES_TOO_SMALL,
  type WatchAgentState,
} from './types.js'

/**
 * Parses `--cadence-seconds`, returning the default cadence when absent. Throws
 * `INVALID_ARGUMENT` for a non-number, `WATCH_CADENCE_BELOW_MINIMUM` below the
 * minimum, and `WATCH_CADENCE_UNAUTHORIZED` for any non-default cadence without
 * a recorded operator direction.
 */
export function parseCadenceSeconds(
  value: string | null,
  authority?: string | null,
): number {
  if (value === null) {
    return DEFAULT_WATCH_CADENCE_SECONDS
  }

  const parsed = Number(value)

  if (Number.isNaN(parsed)) {
    throw new PanError(`--cadence-seconds MUST be a number, not '${value}'.`, {
      code: 'INVALID_ARGUMENT',
    })
  }

  if (!Number.isFinite(parsed) || parsed < MIN_WATCH_CADENCE_SECONDS) {
    throw new PanError(
      `--cadence-seconds MUST be a finite number of at least ${MIN_WATCH_CADENCE_SECONDS}.`,
      { code: WATCH_CADENCE_BELOW_MINIMUM },
    )
  }

  const trimmed = authority?.trim()

  if (parsed !== DEFAULT_WATCH_CADENCE_SECONDS && !trimmed) {
    throw new PanError(
      `--cadence-seconds ${parsed} differs from the one 60-second cadence ` +
        `DELEGATE-001 fixes. A cadence exception needs the recorded operator ` +
        `direction: pass --cadence-directed-by-operator <reason>.`,
      { code: WATCH_CADENCE_UNAUTHORIZED },
    )
  }

  return parsed
}

/**
 * Recognize the legacy `--stall-wakes` count as a duration override.
 *
 * The count only ever meant "this many cadences without change", so the
 * supported conversion is back into seconds against the resolved cadence. A
 * count of 1 named "stall on the first quiet wake", which was never a
 * supported behavior; refusing it beats silently ignoring it.
 */
export function parseStallWakes(
  value: string | null,
  cadenceSeconds: number,
): number | null {
  if (value === null) {
    return null
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new PanError(`--stall-wakes MUST be a positive integer.`, {
      code: 'INVALID_ARGUMENT',
    })
  }

  if (parsed === 1) {
    throw new PanError(
      `--stall-wakes 1 would call the first quiet wake a stall. The stall ` +
        `bound is a duration: pass --stall-timeout-seconds, or a wake count ` +
        `of at least 2.`,
      { code: WATCH_STALL_WAKES_TOO_SMALL },
    )
  }

  return parsed * cadenceSeconds
}

/**
 * Parses `--agent-state` as `running` or `completed`, returning null when
 * absent. Throws `INVALID_ARGUMENT` for any other value.
 */
export function parseAgentState(value: string | null): WatchAgentState | null {
  if (value === null) {
    return null
  }

  if (value !== 'running' && value !== 'completed') {
    throw new PanError(
      `--agent-state MUST be 'running' or 'completed', not '${value}'. It ` +
        `reports what you saw when you inspected the launched agent itself.`,
      { code: 'INVALID_ARGUMENT' },
    )
  }

  return value
}

/**
 * Parses a positive integer option, returning the fallback when absent. Throws
 * `INVALID_ARGUMENT` naming the option for any other value.
 */
export function parsePositiveInteger(
  value: string | null,
  name: string,
  fallback: number,
): number {
  if (value === null) {
    return fallback
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new PanError(`${name} MUST be a positive integer.`, {
      code: 'INVALID_ARGUMENT',
    })
  }

  return parsed
}

/**
 * Parses `--timeout-seconds` as a positive finite number, returning the default
 * bound when absent. Throws `INVALID_ARGUMENT` otherwise.
 */
export function parseTimeoutSeconds(value: string | null): number {
  if (value === null) {
    return DEFAULT_WATCH_TIMEOUT_SECONDS
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new PanError('--timeout-seconds MUST be a positive number.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  return parsed
}
