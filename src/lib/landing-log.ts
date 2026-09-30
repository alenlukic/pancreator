/**
 * Reader for `runtime/release/landing.jsonl`, the landing mutex and step log.
 *
 * Only `acquired` events name a run, so a session is the block of events from
 * one `acquired` to its `released` (or to the `reclaimed` of its dead holder).
 * The mutex keeps sessions from interleaving. Newer step events also carry
 * `token` and `run_id`, and the reader prefers those over the block rule.
 */
import path from 'node:path'

import { fileExists, isRecord, readText, resolveInside } from './io.js'

const LANDING_LOG_PATH = path.join('runtime', 'release', 'landing.jsonl')

export interface LandingLogStep {
  step: string
  at: string
  fields: Record<string, unknown>
}

export interface LandingSession {
  token: string
  run_id: string | null
  worktree: string | null
  acquired_at: string
  steps: LandingLogStep[]
  ended: 'released' | 'reclaimed' | 'open'
}

function parseLines(root: string): Record<string, unknown>[] {
  const logPath = resolveInside(root, LANDING_LOG_PATH)

  if (!fileExists(logPath)) {
    return []
  }

  const events: Record<string, unknown>[] = []

  for (const line of readText(logPath).split('\n')) {
    if (line.trim().length === 0) {
      continue
    }

    try {
      const value: unknown = JSON.parse(line)

      if (isRecord(value)) {
        events.push(value)
      }
    } catch {
      // A torn or foreign line carries no session fact.
    }
  }

  return events
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Parse the landing log into sessions, oldest first. */
export function readLandingSessions(root: string): LandingSession[] {
  const sessions: LandingSession[] = []
  const byToken = new Map<string, LandingSession>()
  let current: LandingSession | null = null

  for (const event of parseLines(root)) {
    const kind = text(event.event)
    const token = text(event.token)

    if (kind === 'acquired' && token) {
      current = {
        token,
        run_id: text(event.run_id),
        worktree: text(event.worktree),
        acquired_at: text(event.timestamp) ?? '',
        steps: [],
        ended: 'open',
      }
      sessions.push(current)
      byToken.set(token, current)
      continue
    }

    if (kind === 'released' && token) {
      const session = byToken.get(token)

      if (session) {
        session.ended = 'released'
      }

      if (current?.token === token) {
        current = null
      }

      continue
    }

    if (kind === 'reclaimed' && isRecord(event.dead_holder)) {
      const deadToken = text(event.dead_holder.token)
      const session = deadToken ? byToken.get(deadToken) : undefined

      if (session) {
        session.ended = 'reclaimed'
      }

      if (current && current.token === deadToken) {
        current = null
      }

      continue
    }

    if (kind === 'step') {
      const session = (token ? byToken.get(token) : undefined) ?? current
      const step = text(event.step)

      if (session && step) {
        const { event: _event, step: _step, timestamp, ...fields } = event

        session.steps.push({
          step,
          at: text(event.at) ?? text(timestamp) ?? '',
          fields,
        })
      }
    }
  }

  return sessions
}

export interface LandedSession {
  token: string
  version: string
  release_commit: string | null
  index_commit: string | null
  tip_before: string
  tip_after: string
  verified_profiles: string[]
  verification_basis: string
  landed_at: string
}

function forRun(
  sessions: LandingSession[],
  runId: string,
  worktree: string,
): LandingSession[] {
  return sessions.filter(
    (session) => session.run_id === runId && session.worktree === worktree,
  )
}

function stepFields(
  session: LandingSession,
  step: string,
): Record<string, unknown> | undefined {
  return session.steps.find((item) => item.step === step)?.fields
}

/** The newest session of the run whose land reached the fast-forward. */
export function latestLandedSession(
  root: string,
  runId: string,
  worktree: string,
): LandedSession | null {
  const session = forRun(readLandingSessions(root), runId, worktree)
    .filter((item) => item.steps.some((step) => step.step === 'fast_forward'))
    .at(-1)

  if (!session) {
    return null
  }

  const forward = session.steps.find((step) => step.step === 'fast_forward')
  const finalize = stepFields(session, 'finalize')
  const tipAfter = text(forward?.fields.tip_after)
  const tipBefore = text(forward?.fields.tip_before)
  const version = text(forward?.fields.version)

  if (!forward || !tipAfter || !tipBefore || !version) {
    return null
  }

  const passed = session.steps.filter(
    (step) => step.step === 'verify' && step.fields.outcome === 'passed',
  )

  return {
    token: session.token,
    version,
    release_commit: text(finalize?.release_commit),
    index_commit: text(finalize?.index_commit),
    tip_before: tipBefore,
    tip_after: tipAfter,
    verified_profiles: passed
      .map((step) => text(step.fields.profile))
      .filter((profile): profile is string => profile !== null),
    verification_basis: text(passed[0]?.fields.basis) ?? 'unrecorded',
    landed_at: forward.at,
  }
}

export interface FailedLandingSession {
  token: string
  release_commit: string
  index_commit: string
  failed_at: string
}

/** The newest session of the run whose build or verify step failed. */
export function latestFailedSession(
  root: string,
  runId: string,
  worktree: string,
): FailedLandingSession | null {
  const session = forRun(readLandingSessions(root), runId, worktree)
    .filter((item) =>
      item.steps.some(
        (step) =>
          (step.step === 'verify' || step.step === 'build') &&
          (step.fields.outcome === 'failed' ||
            step.fields.outcome === 'changed_during_verify'),
      ),
    )
    .at(-1)
  const failure = session?.steps.find(
    (step) =>
      (step.step === 'verify' || step.step === 'build') &&
      (step.fields.outcome === 'failed' ||
        step.fields.outcome === 'changed_during_verify'),
  )
  const finalize = session ? stepFields(session, 'finalize') : undefined
  const releaseCommit = text(finalize?.release_commit)
  const indexCommit = text(finalize?.index_commit)

  return session && failure && releaseCommit && indexCommit
    ? {
        token: session.token,
        release_commit: releaseCommit,
        index_commit: indexCommit,
        failed_at: failure.at,
      }
    : null
}
