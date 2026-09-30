/**
 * Run layer for `pan handoff`. Owns eligibility checks, note writing,
 * supervisor_handoffs records and events, and the fence check.
 *
 * Depends on state.ts, io.ts, run-layout.ts, and watch.ts. Never depends on
 * engine.ts.
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { PanError, invariant } from './errors.js'
import {
  readText,
  resolveInside,
  withOperationMutex,
  writeJsonAtomic,
  writeTextAtomic,
} from './io.js'
import { resolveRunLayout } from './run-layout.js'
import { loadState, now, operationMutexPath, persist } from './state.js'
import { runHasLiveWatch } from './watch/session.js'
import type { RunState, RunStatus, SupervisorHandoffRecord } from './types.js'

// ---------------------------------------------------------------------------
// Accepted run statuses
// ---------------------------------------------------------------------------

/** Terminal run statuses that handoff refuses. */
const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  'succeeded',
  'failed',
  'canceled',
])

// ---------------------------------------------------------------------------
// Eligibility check
// ---------------------------------------------------------------------------

export interface HandoffEligibilityResult {
  ok: boolean
  code?: string
  message?: string
}

/**
 * Check whether a run is eligible for handoff. Returns ok when the run is at
 * a clean boundary; otherwise returns the specific refusal code.
 *
 * Eligibility is checked inside the run operation mutex (the caller holds it).
 */
export function checkHandoffEligibility(
  root: string,
  state: RunState,
): HandoffEligibilityResult {
  // Terminal run
  if (TERMINAL_STATUSES.has(state.status)) {
    return {
      ok: false,
      code: 'HANDOFF_RUN_TERMINAL',
      message: `Run ${state.run_id} is ${state.status} and cannot be handed off.`,
    }
  }

  // Session-bound run (cohort, horizon, best_of_n)
  if (state.cohort ?? state.horizon ?? state.best_of_n) {
    return {
      ok: false,
      code: 'HANDOFF_SESSION_UNSUPPORTED',
      message: `Run ${state.run_id} belongs to a session and cannot be handed off.`,
    }
  }

  // Pending invoke_agent
  if (state.pending_action?.type === 'invoke_agent') {
    return {
      ok: false,
      code: 'HANDOFF_WORKER_IN_FLIGHT',
      message: `Run ${state.run_id} has a pending worker invocation.`,
    }
  }

  // Live watch lock
  if (runHasLiveWatch(root, state.run_id)) {
    return {
      ok: false,
      code: 'HANDOFF_WATCH_OPEN',
      message: `Run ${state.run_id} has an open watch lock.`,
    }
  }

  // Already pending handoff
  const latest = latestHandoffRecord(state)
  if (latest?.status === 'sending' || latest?.status === 'sent') {
    return {
      ok: false,
      code: 'HANDOFF_ALREADY_PENDING',
      message: `Run ${state.run_id} already has a pending handoff.`,
    }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Record helpers
// ---------------------------------------------------------------------------

export function latestHandoffRecord(
  state: RunState,
): SupervisorHandoffRecord | null {
  const records = state.supervisor_handoffs ?? []
  return records.length > 0 ? (records.at(-1) as SupervisorHandoffRecord) : null
}

function currentSessionGeneration(state: RunState): number {
  return state.supervisor_card?.session_generation ?? 0
}

// ---------------------------------------------------------------------------
// Note writing
// ---------------------------------------------------------------------------

export interface WriteNoteOptions {
  note?: string
  noteFile?: string
  runId: string
  handoffId: string
}

/**
 * Resolve and write the handoff note to the run evidence directory.
 * Returns the harness-relative path.
 */
export function writeHandoffNote(
  root: string,
  options: WriteNoteOptions,
): string {
  const { note, noteFile, runId, handoffId } = options
  let noteText: string

  if (typeof noteFile === 'string' && noteFile.length > 0) {
    noteText = readText(resolveInside(root, noteFile))
  } else if (typeof note === 'string' && note.trim().length > 0) {
    noteText = note
  } else {
    throw new PanError(
      'A handoff note is required: pass --note <text> or --note-file <path>.',
      { code: 'HANDOFF_NOTE_MISSING' },
    )
  }

  const layout = resolveRunLayout(root, runId)
  const notePath = layout.evidence(`handoff-note-${handoffId}.md`).relative
  const noteAbsolute = resolveInside(root, notePath)
  mkdirSync(path.dirname(noteAbsolute), { recursive: true })
  writeTextAtomic(noteAbsolute, noteText)
  return notePath
}

// ---------------------------------------------------------------------------
// Evidence file writing
// ---------------------------------------------------------------------------

/** Harness-relative path of the step-evidence JSON for one handoff attempt. */
export function handoffEvidencePath(
  root: string,
  runId: string,
  handoffId: string,
): string {
  return resolveRunLayout(root, runId).evidence(
    `handoff-evidence-${handoffId}.json`,
  ).relative
}

/**
 * Write the step-evidence JSON artifact for one handoff attempt.
 * Returns the harness-relative path.
 */
export function writeHandoffEvidence(
  root: string,
  runId: string,
  handoffId: string,
  evidence: unknown,
): string {
  const evPath = handoffEvidencePath(root, runId, handoffId)
  const evAbsolute = resolveInside(root, evPath)
  mkdirSync(path.dirname(evAbsolute), { recursive: true })
  writeJsonAtomic(evAbsolute, evidence)
  return evPath
}

// ---------------------------------------------------------------------------
// Record mutations (all under run operation mutex)
// ---------------------------------------------------------------------------

/**
 * Append a `sending` record under the run operation mutex. Eligibility is
 * checked again inside the same critical section, because another handoff can
 * append its own record between `prepareHandoff` and this call. A refusal
 * appends nothing and returns the refusal code.
 */
export function appendSendingRecord(
  root: string,
  runId: string,
  record: Omit<SupervisorHandoffRecord, 'status'>,
): HandoffEligibilityResult {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)
    const eligibility = checkHandoffEligibility(root, state)

    if (!eligibility.ok) {
      return eligibility
    }

    if (!state.supervisor_handoffs) {
      state.supervisor_handoffs = []
    }

    state.supervisor_handoffs.push({ ...record, status: 'sending' })
    persist(root, state, 'supervisor_handoff_sending', {
      handoff_id: record.id,
    })
    return eligibility
  })
}

/** The attempt `prepareHandoff` opened, plus what the driver will type and select. */
export interface SendingRecordAttempt {
  handoffId: string
  fromSessionGeneration: number
  evidencePath: string
  notePath: string | null
  prompt: string
  model: string
  effort: string
}

/**
 * The driver's pre-Send callback for a real handoff: it appends the `sending`
 * record, carrying the label the driver verified, and refuses Send when the
 * run is no longer eligible.
 */
export function sendingRecordCallback(
  root: string,
  runId: string,
  attempt: SendingRecordAttempt,
): (context: {
  verifiedLabel: string
}) => Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  return (context) => {
    const eligibility = appendSendingRecord(root, runId, {
      id: attempt.handoffId,
      from_session_generation: attempt.fromSessionGeneration,
      prompt: attempt.prompt,
      model: attempt.model,
      effort: attempt.effort,
      verified_label: context.verifiedLabel,
      initiated_at: now(),
      evidence_path: attempt.evidencePath,
      ...(attempt.notePath !== null ? { note_path: attempt.notePath } : {}),
    })

    return Promise.resolve(
      eligibility.ok
        ? { ok: true }
        : {
            ok: false,
            code: eligibility.code ?? 'HANDOFF_ALREADY_PENDING',
            message: eligibility.message ?? 'Handoff refused before Send.',
          },
    )
  }
}

/**
 * Mark the latest handoff record `sent`. Called after Send succeeds.
 */
export function markHandoffSent(
  root: string,
  runId: string,
  handoffId: string,
  verifiedLabel: string,
): void {
  withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)
    const records = state.supervisor_handoffs ?? []
    const latest = records.at(-1)

    if (!latest || latest.id !== handoffId || latest.status !== 'sending') {
      return // Safety guard; nothing to update
    }

    state.supervisor_handoffs = [
      ...records.slice(0, -1),
      {
        ...latest,
        status: 'sent',
        sent_at: now(),
        verified_label: verifiedLabel,
      },
    ]

    persist(root, state, 'supervisor_handoff_sent', { handoff_id: handoffId })
  })
}

/**
 * Mark the latest handoff record `aborted`. Called when Send fails.
 */
export function markHandoffAborted(
  root: string,
  runId: string,
  handoffId: string,
  abortedCode: string,
): void {
  withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)
    const records = state.supervisor_handoffs ?? []
    const latest = records.at(-1)

    if (!latest || latest.id !== handoffId) {
      return
    }

    state.supervisor_handoffs = [
      ...records.slice(0, -1),
      {
        ...latest,
        status: 'aborted',
        resolved_at: now(),
        aborted_code: abortedCode,
      },
    ]

    persist(root, state, 'supervisor_handoff_aborted', {
      handoff_id: handoffId,
      aborted_code: abortedCode,
    })
  })
}

/**
 * Mutate `state` in-place to mark the latest handoff record `accepted`.
 * Called inside an already-held operation mutex (e.g. from attestSupervisorCard).
 * The caller is responsible for calling `persist` after this.
 *
 * Returns the handoff id when a record was accepted, else null.
 */
export function applyHandoffAccepted(
  state: RunState,
  newSessionGeneration: number,
): string | null {
  const records = state.supervisor_handoffs ?? []
  const latest = records.at(-1)

  if (!latest || (latest.status !== 'sending' && latest.status !== 'sent')) {
    return null
  }

  state.supervisor_handoffs = [
    ...records.slice(0, -1),
    {
      ...latest,
      status: 'accepted',
      resolved_at: now(),
      accepted_session_generation: newSessionGeneration,
    },
  ]

  return latest.id
}

// ---------------------------------------------------------------------------
// Fence check
// ---------------------------------------------------------------------------

/**
 * Check whether `pan prepare` or `pan submit` should be fenced because a
 * handoff is pending.
 *
 * The fence is active when the latest record is `sending` or `sent` AND the
 * session generation matches the recorded `from_session_generation`.
 */
export function checkHandoffFence(
  state: RunState,
  action: 'prepare' | 'submit',
): void {
  const latest = latestHandoffRecord(state)
  if (!latest) return

  if (latest.status !== 'sending' && latest.status !== 'sent') {
    return
  }

  const currentGeneration = currentSessionGeneration(state)

  if (currentGeneration !== latest.from_session_generation) {
    return
  }

  invariant(
    false,
    `pan ${action} refused: run ${state.run_id} has been handed off ` +
      `(status: ${latest.status}). The receiving session must attest the ` +
      `supervisor card to lift the fence.`,
    {
      code: 'SUPERVISOR_HANDED_OFF',
      details: {
        run_id: state.run_id,
        handoff_id: latest.id,
        from_session_generation: latest.from_session_generation,
        current_session_generation: currentGeneration,
        handoff_status: latest.status,
      },
    },
  )
}

// ---------------------------------------------------------------------------
// High-level orchestration (called by the CLI)
// ---------------------------------------------------------------------------

export interface RunHandoffOptions {
  runId: string
  prompt: string
  model: string
  effort: string
  note?: string
  noteFile?: string
  dryRun?: boolean
}

/**
 * Prepare a handoff attempt: check eligibility, write the note, and return a
 * `handoffId` and `notePath` the driver can use. Everything happens under the
 * run operation mutex.
 *
 * The caller then runs the driver and calls `finalizeHandoff`.
 *
 * Throws when eligibility fails or note is missing.
 */
export function prepareHandoff(
  root: string,
  options: RunHandoffOptions,
): {
  handoffId: string
  notePath: string | null
  evidencePath: string
  fromSessionGeneration: number
} {
  return withOperationMutex(operationMutexPath(root, options.runId), () => {
    const state = loadState(root, options.runId)

    // Eligibility
    const eligibility = checkHandoffEligibility(root, state)
    invariant(eligibility.ok, eligibility.message ?? 'Handoff refused.', {
      code: eligibility.code ?? 'HANDOFF_RUN_TERMINAL',
    })

    const handoffId = randomUUID()
    const fromGeneration = currentSessionGeneration(state)

    // Write note (required for non-dry-run)
    let notePath: string | null = null
    if (!options.dryRun) {
      notePath = writeHandoffNote(root, {
        note: options.note,
        noteFile: options.noteFile,
        runId: options.runId,
        handoffId,
      })
    } else if (options.note !== undefined || options.noteFile !== undefined) {
      // Optional note in dry-run mode
      try {
        notePath = writeHandoffNote(root, {
          note: options.note,
          noteFile: options.noteFile,
          runId: options.runId,
          handoffId,
        })
      } catch {
        notePath = null
      }
    }

    return {
      handoffId,
      notePath,
      evidencePath: handoffEvidencePath(root, options.runId, handoffId),
      fromSessionGeneration: fromGeneration,
    }
  })
}

/** The latest supervisor handoff as `pan status` reports it. */
export interface HandoffStatusEntry {
  id: string
  status: SupervisorHandoffRecord['status']
  prompt: string
  model: string
  effort: string
  initiated_at: string
  sent_at?: string
  resolved_at?: string
  note_path?: string
  evidence_path?: string
  verified_label?: string
  aborted_code?: string
}

export function latestHandoffStatus(
  state: RunState,
): HandoffStatusEntry | null {
  const r = latestHandoffRecord(state)

  if (r === null) {
    return null
  }

  return {
    id: r.id,
    status: r.status,
    prompt: r.prompt,
    model: r.model,
    effort: r.effort,
    initiated_at: r.initiated_at,
    ...(r.sent_at ? { sent_at: r.sent_at } : {}),
    ...(r.resolved_at ? { resolved_at: r.resolved_at } : {}),
    ...(r.note_path ? { note_path: r.note_path } : {}),
    ...(r.evidence_path ? { evidence_path: r.evidence_path } : {}),
    ...(r.verified_label ? { verified_label: r.verified_label } : {}),
    ...(r.aborted_code ? { aborted_code: r.aborted_code } : {}),
  }
}
