/**
 * Worker and supervisor model evidence: the declared worker specs, the detached
 * worker model probe, and the evidence a submission settles.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { invariant } from '../errors.js'
import {
  expectedCursorModelForSpec,
  probeCursorModelSpec,
  probeEnvironment,
} from '../executors/cursor-probe.js'
import { resolveInside, withOperationMutex, writeJsonAtomic } from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import { operationMutexPath, loadState, now } from '../state.js'
import type {
  Invocation,
  RunAdvisory,
  RunModelEvidence,
  RunState,
} from '../types.js'

import {
  persistRun,
  readInvocation,
  readInvocationRecord,
  recordRunAdvisories,
} from './core.js'

function persistModelEvidence(
  root: string,
  state: RunState,
  item: Omit<RunModelEvidence, 'evidence_path' | 'timestamp'>,
): RunModelEvidence {
  const index = (state.model_evidence ?? []).findIndex(
    (existing) =>
      existing.role === item.role &&
      existing.invocation_id === item.invocation_id &&
      existing.worker_role === item.worker_role,
  )
  const filename =
    item.role === 'supervisor'
      ? 'model-evidence-supervisor.json'
      : item.worker_role
        ? `model-evidence-${item.invocation_id}.${item.worker_role}.json`
        : `model-evidence-${item.invocation_id}.json`
  const evidencePath = resolveRunLayout(root, state.run_id).evidence(
    filename,
  ).relative
  const evidence: RunModelEvidence = {
    ...item,
    evidence_path: evidencePath,
    timestamp: now(),
  }

  const items = [...(state.model_evidence ?? [])]

  if (index === -1) {
    items.push(evidence)
  } else {
    items[index] = evidence
  }

  state.model_evidence = items
  writeJsonAtomic(resolveInside(root, evidencePath), {
    schema_version: 1,
    run_id: state.run_id,
    ...evidence,
  })
  persistRun(root, state, 'model_evidence_recorded', {
    role: evidence.role,
    invocation_id: evidence.invocation_id ?? null,
    result: evidence.result,
    evidence_path: evidence.evidence_path,
  })

  return evidence
}

export interface SupervisorModelEvidenceResult {
  evidence: RunModelEvidence
  advisories: RunAdvisory[]
}

/**
 * How long a model-evidence hold waits for another command to release the
 * run mutex.
 *
 * Every hold on that mutex is a state read and a state write, so a queue of
 * ordinary commands drains far inside this bound. It exists to refuse a
 * genuinely wedged holder rather than to pace normal contention. The bound
 * covers every model-evidence writer: `pan models evidence` is a read-mostly
 * write that a supervisor runs beside `pan status --redline`, and a detached
 * probe that refused would lose the answer its live call already paid for.
 */
const MODEL_EVIDENCE_MUTEX_WAIT_MS = 10_000

const MODEL_EVIDENCE_MUTEX_OPTIONS = {
  waitForHolderMs: MODEL_EVIDENCE_MUTEX_WAIT_MS,
}

/** Record the unpinned supervisor model that Cursor exposes for this session. */
export function recordSupervisorModelEvidence(
  root: string,
  runId: string,
  effectiveModel: string,
  source: string,
): SupervisorModelEvidenceResult {
  return withOperationMutex(
    operationMutexPath(root, runId),
    () => {
      invariant(
        effectiveModel.trim().length > 0,
        '--effective-model is required.',
        {
          code: 'CURSOR_MODEL_EVIDENCE_UNAVAILABLE',
        },
      )
      invariant(source.trim().length > 0, '--source is required.', {
        code: 'CURSOR_MODEL_EVIDENCE_UNAVAILABLE',
      })

      const state = loadState(root, runId)
      const existing = state.model_evidence?.find(
        (item) => item.role === 'supervisor',
      )
      let advisories: RunAdvisory[] = []

      if (existing) {
        if (
          normalizedModelName(existing.effective_model ?? '') ===
          normalizedModelName(effectiveModel)
        ) {
          return { evidence: existing, advisories }
        }

        // A mid-run model change is legitimate, so record the new fact and
        // continue the run.
        advisories = recordRunAdvisories(
          state,
          { kind: 'model_evidence', source: 'supervisor_evidence' },
          [
            `The supervisor model changed from ` +
              `'${existing.effective_model}' to '${effectiveModel.trim()}' ` +
              `during this run.`,
          ],
        )
        persistRun(root, state, 'model_evidence_advisory', {
          role: 'supervisor',
          advisories: advisories.map((advisory) => advisory.message),
        })
      }

      const evidence = persistModelEvidence(root, state, {
        role: 'supervisor',
        persona: 'orchestrator',
        declared_spec: null,
        effective_model: effectiveModel.trim(),
        source: source.trim(),
        result: 'recorded',
      })

      return { evidence, advisories }
    },
    MODEL_EVIDENCE_MUTEX_OPTIONS,
  )
}

function normalizedModelName(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '')
}

/** One worker an invocation declares, with the spec the run snapshot projects. */
interface DeclaredWorkerSpec {
  role: 'worker' | 'evidence_worker'
  /** Present only for an evidence worker, whose records are keyed by role. */
  worker_role?: string
  persona: string
  spec: string
  /** How an advisory names this worker to the operator. */
  label: string
}

/**
 * Every worker a stage runs, not only the invocation persona.
 *
 * A verify stage declares parallel evidence workers that the supervisor
 * launches on their own specs. Keying model evidence to the invocation
 * persona alone left those workers unrecorded, so a stage verdict named one
 * model and three produced it.
 */
function declaredWorkerSpecs(invocation: Invocation): DeclaredWorkerSpec[] {
  return [
    {
      role: 'worker',
      persona: invocation.stage.persona,
      spec: invocation.stage.model,
      label: `stage worker '${invocation.stage.persona}'`,
    },
    ...(invocation.evidence_workers ?? []).map((worker) => ({
      role: 'evidence_worker' as const,
      worker_role: worker.role,
      persona: worker.persona,
      spec: worker.model,
      label: `evidence worker role '${worker.role}'`,
    })),
  ]
}

/** Record sourced model evidence for one role declared by an invocation. */
export function recordInvocationModelEvidence(
  root: string,
  runId: string,
  invocationId: string,
  role: string,
  effectiveModel: string,
  source: string,
  launchHandle: string,
): RunModelEvidence {
  return withOperationMutex(
    operationMutexPath(root, runId),
    () => {
      const values = [
        ['--invocation', invocationId],
        ['--role', role],
        ['--effective-model', effectiveModel],
        ['--source', source],
        ['--launch-handle', launchHandle],
      ] as const

      for (const [name, value] of values) {
        invariant(value.trim().length > 0, `${name} is required.`, {
          code: 'INVALID_ARGUMENT',
        })
      }

      const state = loadState(root, runId)
      const { invocation } = readInvocationRecord(root, state, invocationId)

      invariant(
        invocation.run_id === runId &&
          invocation.invocation_id === invocationId,
        `Invocation '${invocationId}' does not belong to run '${runId}'.`,
        { code: 'INVALID_INVOCATION' },
      )

      const roleName = role.trim()
      const declaredWorkers = declaredWorkerSpecs(invocation)
      const declared = declaredWorkers.find((item) =>
        item.role === 'worker'
          ? roleName === 'worker'
          : item.worker_role === roleName,
      )
      const declaredRoles = declaredWorkers.map((item) =>
        item.role === 'worker' ? 'worker' : (item.worker_role as string),
      )

      invariant(
        declared,
        `Role '${roleName}' is not declared by invocation '${invocationId}'. ` +
          `Declared roles: ${declaredRoles.join(', ')}.`,
        { code: 'INVALID_ARGUMENT' },
      )

      return persistModelEvidence(root, state, {
        role: declared.role,
        invocation_id: invocationId,
        ...(declared.worker_role ? { worker_role: declared.worker_role } : {}),
        persona: declared.persona,
        declared_spec: declared.spec,
        effective_model: effectiveModel.trim(),
        source: source.trim(),
        launch_handle: launchHandle.trim(),
        result: 'recorded',
      })
    },
    MODEL_EVIDENCE_MUTEX_OPTIONS,
  )
}

/** The labeled default evidence for one declared worker spec. */
function defaultModelEvidence(
  invocationId: string,
  declared: DeclaredWorkerSpec,
  source: string,
  error?: string,
): Omit<RunModelEvidence, 'evidence_path' | 'timestamp'> {
  return {
    role: declared.role,
    invocation_id: invocationId,
    ...(declared.worker_role ? { worker_role: declared.worker_role } : {}),
    persona: declared.persona,
    declared_spec: declared.spec,
    // The projected spec is what the harness launches the worker on, so it is
    // a true record of the declared model. `default` labels it so no reader
    // mistakes it for an observation of what Cursor actually ran.
    effective_model: declared.spec,
    source,
    result: 'default',
    ...(error ? { error } : {}),
  }
}

/**
 * Record the labeled default for every spec a prepared invocation declares.
 *
 * Model evidence used to arrive only from a manual probe, so a supervisor
 * that skipped it produced a submit advisory it could ignore. Prepare now
 * records what the run snapshot projects, and a probe that lands overwrites
 * it with the observed variant.
 */
export function recordDefaultModelEvidence(
  root: string,
  state: RunState,
  invocation: Invocation,
): void {
  if (invocation.model_evidence_required !== true) {
    return
  }

  for (const declared of declaredWorkerSpecs(invocation)) {
    persistModelEvidence(
      root,
      state,
      defaultModelEvidence(
        invocation.invocation_id,
        declared,
        'run snapshot projected spec, recorded before any probe',
      ),
    )
  }
}

/** The active Cursor invocation a model probe may speak for. */
function probeableInvocation(
  root: string,
  state: RunState,
  invocationId: string,
): Invocation {
  invariant(
    state.current_invocation?.id === invocationId,
    `Invocation '${invocationId}' is not active for run '${state.run_id}'.`,
    { code: 'CURSOR_MODEL_EVIDENCE_UNAVAILABLE' },
  )

  const invocation = readInvocation(root, state.current_invocation.json_path)

  invariant(
    (invocation.stage.persona_executor ?? 'cursor') === 'cursor',
    `Invocation '${invocationId}' does not use the Cursor executor.`,
    { code: 'CURSOR_MODEL_EVIDENCE_UNAVAILABLE' },
  )

  return invocation
}

/**
 * Mark a detached worker model probe as in flight.
 *
 * Only submission reads this evidence, so the launch that needs it does not
 * wait for Cursor to answer. The marker makes the in-flight probe visible to
 * `pan status`, and the detached child overwrites it when the answer lands.
 * A probe that never lands leaves the marker, which submission treats exactly
 * as it treats an unavailable probe.
 */
export function recordPendingWorkerModelProbe(
  root: string,
  runId: string,
  invocationId: string,
): RunModelEvidence {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)
    const invocation = probeableInvocation(root, state, invocationId)
    const marked = declaredWorkerSpecs(invocation).map((declared) =>
      persistModelEvidence(root, state, {
        role: declared.role,
        invocation_id: invocationId,
        ...(declared.worker_role ? { worker_role: declared.worker_role } : {}),
        persona: declared.persona,
        declared_spec: declared.spec,
        effective_model: null,
        source: 'detached cursor-agent probe in flight',
        result: 'pending',
      }),
    )

    return marked[0] as RunModelEvidence
  })
}

/** What starting one detached worker model probe left behind. */
export interface StartedWorkerModelProbe {
  evidence: RunModelEvidence
  /** Process id of the detached child, or null when the spawn gave none. */
  probe_pid: number | null
}

/**
 * Record the in-flight marker and start the detached child that answers it.
 *
 * The live call belongs to a child because only submission reads the answer,
 * so neither the command that prepares a worker nor the one that probes it
 * waits for Cursor. A child that never lands leaves the marker, which
 * submission treats exactly as it treats an unavailable probe.
 */
export function startDetachedWorkerModelProbe(
  root: string,
  runId: string,
  invocationId: string,
): StartedWorkerModelProbe {
  const evidence = recordPendingWorkerModelProbe(root, runId, invocationId)
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../../cli.js', import.meta.url)),
      'models',
      '--probe',
      '--await-probe',
      '--run',
      runId,
      '--invocation',
      invocationId,
    ],
    { cwd: root, detached: true, stdio: 'ignore' },
  )

  child.unref()

  return { evidence, probe_pid: child.pid ?? null }
}

/**
 * Probe one active Cursor worker invocation and persist its effective model.
 *
 * The run mutex covers the state read and the state write, never the live
 * call. A probe takes roughly two minutes, and the detached child that runs
 * it is not one the supervisor waits for, so holding the lock across the call
 * would fail every other command against the run with
 * `RUN_OPERATION_IN_PROGRESS` for that whole window. The second hold re-reads
 * the state so a concurrent probe's write is not lost.
 *
 * Both holds wait for a live holder instead of refusing. A probe runs
 * detached and nobody retries it, so a refused hold loses the answer the
 * live call already paid for; the holds themselves are a state read and a
 * state write, so the queue drains in milliseconds.
 */
export function probeRunInvocationModel(
  root: string,
  runId: string,
  invocationId: string,
): RunModelEvidence & {
  advisories: string[]
  /** One record per parallel evidence worker the invocation declares. */
  evidence_workers: RunModelEvidence[]
} {
  const contended = MODEL_EVIDENCE_MUTEX_OPTIONS
  const plan = withOperationMutex(
    operationMutexPath(root, runId),
    () => {
      const state = loadState(root, runId)
      const invocation = probeableInvocation(root, state, invocationId)

      return {
        declared: declaredWorkerSpecs(invocation),
        stageSlug: invocation.stage.slug,
      }
    },
    contended,
  )
  const { declared, stageSlug } = plan
  // Every worker the stage runs is probed, and two workers that share a spec
  // share one live call: the evidence is per role, but the answer is per
  // spec, and a live call costs about two minutes.
  const probed = new Map<string, ProbedModelSpec>()

  for (const spec of new Set(declared.map((item) => item.spec))) {
    probed.set(spec, probeModelSpec(root, spec))
  }

  return withOperationMutex(
    operationMutexPath(root, runId),
    () => {
      const state = loadState(root, runId)
      const errors: string[] = []
      const recorded = declared.map((item) => {
        const outcome = probed.get(item.spec) as ProbedModelSpec

        if (outcome.error) {
          errors.push(`${item.label}: ${outcome.error}`)
        }

        return persistModelEvidence(root, state, {
          role: item.role,
          invocation_id: invocationId,
          ...(item.worker_role ? { worker_role: item.worker_role } : {}),
          persona: item.persona,
          declared_spec: item.spec,
          effective_model: outcome.resolved,
          source: 'cursor-agent system/init event',
          result: outcome.result,
          ...(outcome.error ? { error: outcome.error } : {}),
        })
      })

      // A probe result never fails the run. Record it as an advisory so
      // `pan status` recovers it after an interruption.
      const advisories =
        errors.length > 0
          ? recordRunAdvisories(
              state,
              {
                kind: 'model_evidence',
                source: 'probe',
                stage: stageSlug,
                invocation_id: invocationId,
              },
              errors,
            )
          : []

      if (advisories.length > 0) {
        persistRun(root, state, 'model_evidence_advisory', {
          invocation_id: invocationId,
          stage: stageSlug,
          advisories: advisories.map((advisory) => advisory.message),
        })
      }

      return {
        ...(recorded[0] as RunModelEvidence),
        advisories: advisories.map((advisory) => advisory.message),
        evidence_workers: recorded.filter(
          (item) => item.role === 'evidence_worker',
        ),
      }
    },
    contended,
  )
}

interface ProbedModelSpec {
  resolved: string | null
  result: RunModelEvidence['result']
  error?: string
}

/** One live Cursor call, judged against the catalog prediction for the spec. */
function probeModelSpec(root: string, declaredSpec: string): ProbedModelSpec {
  // A bare (bracket-less) spec delegates the variant choice to Cursor, so
  // any successfully resolved variant is the declared behavior — the same
  // contract `probeCursorModels` applies. Only a bracketed spec carries a
  // catalog-predicted display name to compare against; a spec id is never
  // compared literally with a display name.
  const bareSpec = !declaredSpec.includes('[')
  const expected = expectedCursorModelForSpec(root, declaredSpec)
  const probe = probeCursorModelSpec(
    declaredSpec,
    undefined,
    probeEnvironment(root),
  )
  // Only a failed probe is unavailable. A bracketed spec with no catalog
  // prediction is `recorded`, because a target installation carries no
  // catalog.
  const result = ((): RunModelEvidence['result'] => {
    if (probe.resolved === null || probe.error !== undefined) {
      return 'unavailable'
    }

    if (bareSpec) {
      return 'match'
    }

    if (expected === null) {
      return 'recorded'
    }

    return normalizedModelName(probe.resolved) === normalizedModelName(expected)
      ? 'match'
      : 'mismatch'
  })()
  const error =
    result === 'unavailable'
      ? (probe.error ?? 'Cursor reported no resolvable model.')
      : result === 'mismatch'
        ? `Cursor resolved '${probe.resolved}', but the run snapshot expects '${expected}'.`
        : undefined

  return { resolved: probe.resolved, result, ...(error ? { error } : {}) }
}

/**
 * Settle the model evidence of one submission.
 *
 * The absence of a probe answer never stops a submission: the run snapshot
 * still names the spec each worker was launched on, so the record takes that
 * spec as a labeled default. Only a real mismatch between recorded evidence
 * and the run snapshot is a hard failure, because a stage verdict produced on
 * a model the run did not declare is not the verdict the run asked for.
 */
export function settleSubmissionModelEvidence(
  root: string,
  state: RunState,
  invocation: Invocation,
): { advisories: string[]; mismatches: string[] } {
  const advisories: string[] = []
  const mismatches: string[] = []

  if (invocation.model_evidence_required !== true) {
    return { advisories, mismatches }
  }

  const supervisor = state.model_evidence?.find(
    (item) => item.role === 'supervisor' && item.result === 'recorded',
  )

  if (!supervisor?.effective_model) {
    advisories.push(
      `This run records no sourced supervisor model evidence. Cursor did not ` +
        `expose model metadata for the supervising session.`,
    )
  }

  for (const declared of declaredWorkerSpecs(invocation)) {
    const recorded = state.model_evidence?.find(
      (item) =>
        item.role === declared.role &&
        item.invocation_id === invocation.invocation_id &&
        item.worker_role === declared.worker_role,
    )

    if (!recorded) {
      advisories.push(
        `Invocation '${invocation.invocation_id}' records no model evidence ` +
          `for its ${declared.label}, so the model that produced that work ` +
          `is unrecorded.`,
      )
      continue
    }

    // A probe in flight and a probe that failed both produced no answer. The
    // projected spec is the honest record of what the harness launched, so it
    // replaces the marker as a labeled default rather than as a gap.
    if (recorded.result === 'pending' || recorded.result === 'unavailable') {
      persistModelEvidence(
        root,
        state,
        defaultModelEvidence(
          invocation.invocation_id,
          declared,
          recorded.result === 'pending'
            ? 'run snapshot projected spec; the detached probe did not land'
            : 'run snapshot projected spec; the probe produced no answer',
          recorded.error,
        ),
      )
      continue
    }

    // `recorded` means the probe resolved a model with no local catalog to
    // predict it, which is normal in a target installation.
    if (
      recorded.result === 'mismatch' ||
      recorded.persona !== declared.persona ||
      recorded.declared_spec !== declared.spec
    ) {
      mismatches.push(
        `the ${declared.label} declared '${declared.spec}' and the recorded ` +
          `evidence resolved '${recorded.effective_model ?? 'unknown'}' for ` +
          `${recorded.persona} (spec '${recorded.declared_spec ?? 'unknown'}')`,
      )
    }
  }

  return { advisories, mismatches }
}

/**
 * Whether the run is bound by the model-evidence contract: true when the
 * supervisor recorded its model evidence before the run's first stage
 * submission. Runs whose supervisor never recorded, or recorded only after work
 * was submitted, keep the older contract, so their stage cards do not demand
 * model evidence.
 */
export function runUsesModelEvidenceContract(state: RunState): boolean {
  const supervisor = state.model_evidence?.find(
    (item) => item.role === 'supervisor' && item.result === 'recorded',
  )
  const firstSubmission = state.stage_history[0]?.submitted_at

  return Boolean(
    supervisor && (!firstSubmission || supervisor.timestamp <= firstSubmission),
  )
}
