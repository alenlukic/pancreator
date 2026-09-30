/** Post-ship observation checks the release validator applies. */

import path from 'node:path'

import { isRecord, fileExists, readJson } from '../../io.js'
import {
  observationWindowMs,
  OBSERVATION_WINDOW_FORMS,
} from '../../acceptance-proof.js'
import type { HandlerResult } from '../../requirements/types.js'
import { sharedRequiredChildFields } from './field-contract.js'
import { issue } from './evidence.js'

/**
 * Acceptance criterion ids the run's latest successful verify output deferred
 * to post-ship observation (`result: observe`). A run without such a verify
 * output, or one written before the `observe` proof type, defers none.
 */
function verifyObserveCriterionIds(
  root: string,
  runState?: Record<string, unknown>,
): string[] {
  const stageHistory = Array.isArray(runState?.stage_history)
    ? runState.stage_history
    : []
  let latest: string | null = null

  for (const item of stageHistory) {
    if (
      isRecord(item) &&
      item.stage === 'verify' &&
      item.outcome === 'success' &&
      typeof item.output_path === 'string'
    ) {
      latest = item.output_path
    }
  }

  if (!latest || !fileExists(path.join(root, latest))) {
    return []
  }

  try {
    const value = readJson(path.join(root, latest))
    const verify =
      isRecord(value) && isRecord(value.data) && isRecord(value.data.verify)
        ? value.data.verify
        : null
    const results = Array.isArray(verify?.acceptance_results)
      ? verify.acceptance_results
      : []

    return [
      ...new Set(
        results
          .filter(
            (entry): entry is Record<string, unknown> =>
              isRecord(entry) &&
              typeof entry.id === 'string' &&
              typeof entry.result === 'string' &&
              entry.result.trim().toLowerCase() === 'observe',
          )
          .map((entry) => entry.id as string),
      ),
    ].sort()
  } catch {
    return []
  }
}

/**
 * Every verify result deferred to observation needs one ship observation
 * whose declared fields are all non-empty text, so `pan observations` can
 * list it and the harness technician audit can check it.
 */
export function releaseObservationIssues(
  root: string,
  release: Record<string, unknown>,
  runState?: Record<string, unknown>,
): HandlerResult['issues'] {
  const issues: HandlerResult['issues'] = []
  const requiredFields = sharedRequiredChildFields(
    root,
    'ship',
    'data.release.observations[]',
  )
  const rawObservations = Array.isArray(release.observations)
    ? release.observations
    : []
  const observed = new Set<string>()

  for (const [index, entry] of rawObservations.entries()) {
    const missing = requiredFields.filter(
      (field) =>
        !isRecord(entry) ||
        typeof entry[field] !== 'string' ||
        (entry[field] as string).trim().length === 0,
    )

    if (missing.length > 0) {
      issues.push(
        issue(
          'release.observation_shape',
          `release.observations[${index}] MUST carry non-empty ` +
            `${missing.join(', ')}`,
        ),
      )
      continue
    }

    const record = entry as Record<string, unknown>

    // `pan observations` dates an item from this window, so a window it
    // cannot parse would make the item due the moment it ships.
    if (
      typeof record.window === 'string' &&
      observationWindowMs(record.window) === null
    ) {
      issues.push(
        issue(
          'release.observation_window',
          `release.observations[${index}].window MUST be a positive ` +
            `${OBSERVATION_WINDOW_FORMS} window, such as 7d; got ` +
            `${JSON.stringify(record.window)}`,
        ),
      )
    }

    observed.add((record.criterion as string).trim())
  }

  for (const criterion of verifyObserveCriterionIds(root, runState)) {
    if (!observed.has(criterion)) {
      issues.push(
        issue(
          'release.observation_missing',
          `Verify deferred ${criterion} to post-ship observation, so ` +
            'release.observations MUST record its signal, source, window, ' +
            'and check',
        ),
      )
    }
  }

  return issues
}
