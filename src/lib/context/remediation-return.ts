/** The remediation return and the scoped return of a stage. */

import { readJson, resolveInside, isRecord } from '../io.js'
import { matchWorkspaceGlob } from '../workspace/roots.js'
import type {
  RunState,
  StageDefinition,
  RemediationReturn,
  StageScopedReturn,
  InvocationScopedReturn,
  StageEvidenceWorkerDefinition,
} from '../types.js'
import { outputChangedPaths } from './target-instruction-input.js'

/**
 * Whether this stage is re-entered after a successful remediation, and how
 * far that remediation reached (`VERIFY-001`).
 *
 * The return itself is one fact and the blast radius is another. Deriving
 * the return from a non-empty radius conflated them, so a remediation that
 * declared no changed path rendered a first-visit brief on a return visit.
 * The marker is therefore present for every return, and an empty radius
 * simply bounds no case.
 */
export function remediationReturn(
  root: string,
  state: RunState,
  stage: StageDefinition,
): RemediationReturn | undefined {
  if (!stage.context.gate_evidence) {
    return undefined
  }

  const priorVisit = state.stage_history.findIndex(
    (item) => item.stage === stage.slug && item.outcome !== 'blocked',
  )

  if (priorVisit === -1) {
    return undefined
  }

  const remediation = [...state.stage_history]
    .slice(priorVisit + 1)
    .reverse()
    .find((item) => item.stage === 'remediate' && item.outcome === 'success')

  if (!remediation) {
    return undefined
  }

  // The visit whose failing verdict routed this remediation holds the
  // findings a return visit confirms fixed or still open. A passing visit
  // routed nothing: the run left it for ship, and a failed release gate
  // there sent it to remediate, so that gate's evidence is what routed it.
  const remediationIndex = state.stage_history.lastIndexOf(remediation)
  const routing = state.stage_history
    .slice(0, remediationIndex)
    .reverse()
    .find((item) => item.stage === stage.slug && item.outcome !== 'blocked')
  const routingVerdict =
    routing?.outcome === 'failure' && routing.output_path
      ? routing.output_path
      : undefined
  const routingGate = routingVerdict
    ? undefined
    : failedRepairGate(state, remediation.stage)

  return {
    remediation_invocation_id: remediation.invocation_id,
    blast_radius: outputChangedPaths(root, state, 'remediate'),
    ...(routingVerdict ? { routing_output_path: routingVerdict } : {}),
    ...(routingGate ? { routing_gate: routingGate } : {}),
  }
}

/**
 * The failed entry gate whose open repair loop sent the run to `repairStage`,
 * with its evidence. A gate that passed or was disabled since routes nothing.
 */
function failedRepairGate(
  state: RunState,
  repairStage: string,
): RemediationReturn['routing_gate'] {
  for (const [gateStage, record] of Object.entries(state.entry_gates ?? {})) {
    const result = record.last_result

    if (
      record.repair_stage === repairStage &&
      !result.passed &&
      !result.disabled &&
      result.evidence_path
    ) {
      return {
        stage: gateStage,
        criterion_id: record.criterion_id,
        evidence_path: result.evidence_path,
      }
    }
  }

  return undefined
}

/** The verdict that sent the run to the remediation a return visit serves. */
export interface ScopedReturnRouting {
  invocation_id: string
  verdict: string
  findings: Array<{ id: string; severity: string; source: string }>
}

/** Everything the scoped-return decision reads, gathered by the caller. */
export interface ScopedReturnFacts {
  limits: StageScopedReturn
  /** Every evidence worker the stage declares. */
  declared: Array<{ role: string; persona: string; scope: string }>
  remediation_invocation_id: string
  /** Null when no verify verdict routed the remediation. */
  routing: ScopedReturnRouting | null
  blast_radius: string[]
  /** Workspace paths Git reports as deleted. */
  deleted_paths: string[]
}

export type ScopedReturnDecision =
  | { scoped: InvocationScopedReturn }
  | { scoped: null; reason: string }

/**
 * Decide whether a return visit runs the stage worker alone.
 *
 * The visit scopes only for a small, bounded repair: one to `max_paths`
 * changed paths, at most `max_findings` routing findings, no `fail_severe`
 * verdict, no changed path under an excluded glob, no deleted test, and no
 * declared evidence role beyond the ones the stage worker takes over. An
 * empty blast radius means the remediation recorded no changed path, which
 * the briefs already treat as "execute the scope in full", so it never
 * scopes. Every limit is a cost rule: it keeps the three-agent topology for
 * changes large or risky enough to earn it.
 */
export function evaluateScopedReturn(
  facts: ScopedReturnFacts,
): ScopedReturnDecision {
  const { limits } = facts
  const decline = (reason: string): ScopedReturnDecision => ({
    scoped: null,
    reason,
  })
  const uncovered = facts.declared.filter(
    (worker) => !limits.dimensions.includes(worker.role),
  )

  if (uncovered.length > 0) {
    return decline(
      `the stage declares evidence roles the stage worker does not cover: ` +
        uncovered.map((worker) => worker.role).join(', '),
    )
  }

  if (facts.blast_radius.length === 0) {
    return decline('the remediation recorded no changed path')
  }

  if (facts.blast_radius.length > limits.max_paths) {
    return decline(
      `the remediation changed ${facts.blast_radius.length} paths, above ` +
        `the limit of ${limits.max_paths}`,
    )
  }

  const excluded = facts.blast_radius.filter((changed) =>
    limits.excluded_path_globs.some((glob) =>
      matchWorkspaceGlob(glob, changed),
    ),
  )

  if (excluded.length > 0) {
    return decline(`the remediation changed ${excluded.join(', ')}`)
  }

  const deletedTests = facts.deleted_paths.filter((deleted) =>
    deleted.startsWith('tests/'),
  )

  if (deletedTests.length > 0) {
    return decline(`the workspace deletes tests: ${deletedTests.join(', ')}`)
  }

  const findings = facts.routing?.findings ?? []

  if (facts.routing?.verdict === 'fail_severe') {
    return decline('the routing verdict was fail_severe')
  }

  if (findings.length > limits.max_findings) {
    return decline(
      `the routing verdict carried ${findings.length} findings, above the ` +
        `limit of ${limits.max_findings}`,
    )
  }

  return {
    scoped: {
      remediation_invocation_id: facts.remediation_invocation_id,
      routing_invocation_id: facts.routing?.invocation_id ?? null,
      blast_radius: facts.blast_radius,
      findings,
      dimensions: facts.declared,
      limits: {
        max_paths: limits.max_paths,
        max_findings: limits.max_findings,
        excluded_path_globs: limits.excluded_path_globs,
      },
    },
  }
}

/**
 * The scoped-return decision for the stage's next visit, or undefined when
 * the stage declares no scoped return or the visit is not a return.
 */
export function scopedReturnForStage(
  root: string,
  state: RunState,
  stage: StageDefinition,
  deletedPaths: string[],
  // The workers this visit would launch. A worker whose `run_when` keeps it
  // off the visit assigns no dimension, so the stage worker does not take it
  // over either.
  workers: StageEvidenceWorkerDefinition[] | undefined = stage.evidence_workers,
): ScopedReturnDecision | undefined {
  if (!stage.scoped_return || !workers || workers.length === 0) {
    return undefined
  }

  const visit = remediationReturn(root, state, stage)

  if (!visit) {
    return undefined
  }

  const remediationIndex = state.stage_history.findIndex(
    (item) => item.invocation_id === visit.remediation_invocation_id,
  )
  const routingItem = state.stage_history
    .slice(0, remediationIndex === -1 ? undefined : remediationIndex)
    .reverse()
    .find((item) => item.stage === stage.slug && item.outcome !== 'blocked')
  let routing: ScopedReturnRouting | null = null

  // A passing verify did not route this remediation (the ship release gate
  // did), so its warnings are not routing findings.
  if (routingItem?.output_path && routingItem.outcome === 'failure') {
    const value = readJson(resolveInside(root, routingItem.output_path))
    const verify =
      isRecord(value) && isRecord(value.data) && isRecord(value.data.verify)
        ? value.data.verify
        : null

    routing = {
      invocation_id: routingItem.invocation_id,
      verdict: typeof verify?.verdict === 'string' ? verify.verdict : '',
      findings: (Array.isArray(verify?.findings) ? verify.findings : []).map(
        (finding) => ({
          id: isRecord(finding) ? String(finding.id ?? '') : '',
          severity: isRecord(finding) ? String(finding.severity ?? '') : '',
          source: isRecord(finding) ? String(finding.source ?? '') : '',
        }),
      ),
    }
  }

  return evaluateScopedReturn({
    limits: stage.scoped_return,
    // A scoped visit is always a return, so each dimension takes the
    // worker's return-visit scope when it declares one.
    declared: workers.map((worker) => ({
      role: worker.role,
      persona: worker.persona,
      scope: worker.return_scope ?? worker.scope,
    })),
    remediation_invocation_id: visit.remediation_invocation_id,
    routing,
    blast_radius: visit.blast_radius,
    deleted_paths: deletedPaths,
  })
}
