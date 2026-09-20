import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { invariant } from '../errors.js'
import { fileExists, readJson } from '../io.js'

const SESSION_ID_PATTERN = /^[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/u

export const DEBLOAT_ROOT = 'runtime/debloat'

export interface DebloatSessionPaths {
  sessionId: string
  /** Repo-relative session directory. */
  relative: string
  directory: string
  candidates: string
  report: string
  adjudication: string
  selection: string
  closure: string
  verification: string
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

/**
 * Session identity, shaped like the debloat worktree name so an operator
 * reading a report can tell at a glance which run produced it.
 */
export function newSessionId(now = new Date()): string {
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1, 2)}` +
    `${pad(now.getUTCDate(), 2)}-${pad(now.getUTCHours(), 2)}` +
    `${pad(now.getUTCMinutes(), 2)}${pad(now.getUTCSeconds(), 2)}`

  return `${stamp}-${randomUUID().replace(/-/gu, '').slice(0, 6)}`
}

export function sessionPaths(
  root: string,
  sessionId: string,
): DebloatSessionPaths {
  invariant(
    SESSION_ID_PATTERN.test(sessionId),
    `Invalid debloat session id: ${sessionId}`,
    { code: 'DEBLOAT_SESSION_INVALID' },
  )

  const relative = `${DEBLOAT_ROOT}/${sessionId}`
  const directory = path.join(root, DEBLOAT_ROOT, sessionId)

  return {
    sessionId,
    relative,
    directory,
    candidates: path.join(directory, 'candidates.json'),
    report: path.join(directory, 'report.md'),
    adjudication: path.join(directory, 'adjudication.json'),
    selection: path.join(directory, 'selection.json'),
    closure: path.join(directory, 'closure.json'),
    verification: path.join(directory, 'verification.json'),
  }
}

/**
 * Read one session artifact, refusing a missing one with the command that
 * produces it. A debloat step that runs out of order is a sequencing mistake
 * rather than a corrupt session, so the refusal names the next action.
 */
export function readSessionArtifact<T>(
  absolute: string,
  producedBy: string,
): T {
  invariant(
    fileExists(absolute),
    `Missing ${path.basename(absolute)}. Run \`${producedBy}\` first.`,
    { code: 'DEBLOAT_SESSION_INCOMPLETE' },
  )

  return readJson(absolute) as T
}
