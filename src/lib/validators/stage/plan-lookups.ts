/** Plan-output, assessment, and intake lookups within one run. */

import path from 'node:path'
import { readdirSync } from 'node:fs'

import { fileExists, readJson, isRecord } from '../../io.js'
import { resolveRunLayout } from '../../run-layout.js'

function acceptanceCriterionIdsFromPlanOutput(
  root: string,
  planOutputPath: string,
): string[] {
  const absolute = path.join(root, planOutputPath)

  if (!fileExists(absolute)) {
    return []
  }

  const value = readJson(absolute) as Record<string, unknown>
  const data = isRecord(value.data) ? value.data : {}
  const criteria = Array.isArray(data.acceptance_criteria)
    ? data.acceptance_criteria
    : []
  const ids: string[] = []

  for (const item of criteria) {
    if (isRecord(item) && typeof item.id === 'string') {
      ids.push(item.id)
    }
  }

  return [...new Set(ids)].sort()
}

function assessmentVerdictForInvocation(
  root: string,
  runId: string,
  invocationId: string,
): string | null {
  const layout = resolveRunLayout(root, runId)
  const assessmentsDirectory = path.dirname(
    layout.assessment('placeholder').absolute,
  )

  const currentPath = path.join(
    assessmentsDirectory,
    `${invocationId}.assessment.json`,
  )
  const legacyPath = path.join(
    assessmentsDirectory,
    `assessment-${invocationId}.json`,
  )
  const assessmentPath = fileExists(currentPath) ? currentPath : legacyPath

  if (!fileExists(assessmentPath)) {
    return null
  }

  try {
    const value = readJson(assessmentPath)

    return isRecord(value) && typeof value.verdict === 'string'
      ? value.verdict
      : null
  } catch {
    return null
  }
}

function latestPlanOutputPathFromOutputs(
  root: string,
  runId: string,
): string | null {
  const layout = resolveRunLayout(root, runId)
  const outputsDir = path.dirname(layout.output('placeholder').absolute)

  if (!fileExists(outputsDir)) {
    return null
  }

  const planPattern = /^(?:\d{3}_)?plan-(\d+)[-_]/u
  const planFiles = readdirSync(outputsDir)
    .filter((entry) => planPattern.test(entry))
    .sort((left, right) => {
      const leftNumber = Number(planPattern.exec(left)?.[1] ?? 0)
      const rightNumber = Number(planPattern.exec(right)?.[1] ?? 0)

      return leftNumber - rightNumber
    })

  if (planFiles.length === 0) {
    return null
  }

  const latestPlan = planFiles[planFiles.length - 1]

  return layout.output(latestPlan.replace(/\.json$/u, '')).relative
}

function acceptedPlanOutputPath(
  root: string,
  runId: string,
  runState?: Record<string, unknown>,
): string | null {
  const stageHistory = Array.isArray(runState?.stage_history)
    ? runState.stage_history
    : []
  let latestAccepted: string | null = null
  let latestSuccessful: string | null = null

  for (const item of stageHistory) {
    if (
      !isRecord(item) ||
      item.stage !== 'plan' ||
      item.outcome !== 'success' ||
      typeof item.output_path !== 'string'
    ) {
      continue
    }

    if (!fileExists(path.join(root, item.output_path))) {
      continue
    }

    latestSuccessful = item.output_path

    if (typeof item.invocation_id !== 'string') {
      continue
    }

    if (
      assessmentVerdictForInvocation(root, runId, item.invocation_id) === 'pass'
    ) {
      latestAccepted = item.output_path
    }
  }

  if (latestAccepted) {
    return latestAccepted
  }

  if (latestSuccessful) {
    return latestSuccessful
  }

  return latestPlanOutputPathFromOutputs(root, runId)
}

/**
 * The ratified intake product spec, read from the intake stage's own output on
 * disk. The plan validator used to require the plan document to carry a
 * verbatim copy of the spec (~3.4 KB per attempt) purely so this data was in
 * reach; the run record is the single source instead.
 */
export function intakeProductSpecFromRun(
  root: string,
  targetPath: string,
  runState?: Record<string, unknown>,
): Record<string, unknown> | null {
  const runMatch = /runtime\/logs\/workflows\/([^/]+)\//u.exec(targetPath)

  if (!runMatch) {
    return null
  }

  const stageHistory = Array.isArray(runState?.stage_history)
    ? runState.stage_history
    : []
  let latest: string | null = null

  for (const item of stageHistory) {
    if (
      isRecord(item) &&
      item.stage === 'intake' &&
      item.outcome === 'success' &&
      typeof item.output_path === 'string' &&
      fileExists(path.join(root, item.output_path))
    ) {
      latest = item.output_path
    }
  }

  if (!latest) {
    const layout = resolveRunLayout(root, runMatch[1])
    const outputsDir = path.dirname(layout.output('placeholder').absolute)

    if (fileExists(outputsDir)) {
      const intakePattern = /^(?:\d{3}_)?intake-(\d+)[-_]/u
      const intakeFiles = readdirSync(outputsDir)
        .filter((entry) => intakePattern.test(entry))
        .sort((left, right) => {
          const leftNumber = Number(intakePattern.exec(left)?.[1] ?? 0)
          const rightNumber = Number(intakePattern.exec(right)?.[1] ?? 0)

          return leftNumber - rightNumber
        })

      if (intakeFiles.length > 0) {
        latest = layout.output(
          intakeFiles[intakeFiles.length - 1].replace(/\.json$/u, ''),
        ).relative
      }
    }
  }

  if (!latest) {
    return null
  }

  try {
    const value = readJson(path.join(root, latest))

    if (
      isRecord(value) &&
      isRecord(value.data) &&
      isRecord(value.data.product_spec)
    ) {
      return value.data.product_spec
    }
  } catch {
    return null
  }

  return null
}

/**
 * Return the sorted acceptance criterion ids of the run's accepted plan output,
 * where the run is the one whose `runtime/logs/workflows/<run-id>/` directory
 * holds `targetPath`. Prefers the latest successful plan with a passing
 * assessment, then the latest successful plan, then the newest plan output on
 * disk. Returns an empty list when no plan output is found.
 */
export function planAcceptanceCriterionIds(
  root: string,
  targetPath: string,
  runState?: Record<string, unknown>,
): string[] {
  const runMatch = /runtime\/logs\/workflows\/([^/]+)\//u.exec(targetPath)

  if (!runMatch) {
    return []
  }

  const planOutputPath = acceptedPlanOutputPath(root, runMatch[1], runState)

  if (!planOutputPath) {
    return []
  }

  return acceptanceCriterionIdsFromPlanOutput(root, planOutputPath)
}
