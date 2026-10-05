/**
 * The one transcript source every reader uses: where each host keeps its
 * agent transcripts, plus the record reader in `records.ts`.
 *
 * Cursor keeps `<projects>/<workspace slug>/agent-transcripts/<session>/`
 * with `<session>.jsonl` and `subagents/<id>.jsonl`. Copilot CLI keeps
 * `~/.copilot/session-state/<session>/events.jsonl`; a copilot worker's
 * session id is on its delegation execution record. A VS Code local agent
 * names its file in each hook payload's `transcript_path` (probe PR-11
 * confirms its record shape; the reader assumes the Copilot SDK shape).
 */

import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { readInstallationIdentity } from '../project-config.js'
import { loadDelegationExecutionRecord } from '../validation/artifacts.js'

export {
  transcriptStep,
  transcriptSteps,
  type TranscriptStep,
  type TranscriptToolUse,
} from './records.js'

/** The override for the Cursor transcript directory. */
export const CURSOR_TRANSCRIPTS_ENV = 'PANCREATOR_CURSOR_TRANSCRIPTS_DIR'

/** The override for the Copilot CLI session-state directory. */
export const COPILOT_SESSIONS_ENV = 'PANCREATOR_COPILOT_SESSIONS_DIR'

/**
 * Cursor stores a project's transcripts under a directory named for the
 * workspace path with separators replaced by hyphens.
 */
export function cursorProjectDirectory(
  workspaceRoot: string,
  projectsRoot = path.join(os.homedir(), '.cursor', 'projects'),
): string {
  const slug = path
    .resolve(workspaceRoot)
    .split(path.sep)
    .filter(Boolean)
    .join('-')

  return path.join(projectsRoot, slug)
}

/** The Cursor transcript directory of the installation's workspace. */
export function cursorTranscriptsRoot(root: string): string {
  const configured = process.env[CURSOR_TRANSCRIPTS_ENV]?.trim()

  if (configured) {
    return path.resolve(configured)
  }

  const workspaceRoot = readInstallationIdentity(root)?.workspace_root ?? '.'

  return path.join(
    cursorProjectDirectory(path.resolve(root, workspaceRoot)),
    'agent-transcripts',
  )
}

/** The Copilot CLI session-state directory. */
export function copilotSessionsRoot(): string {
  const configured = process.env[COPILOT_SESSIONS_ENV]?.trim()

  return configured
    ? path.resolve(configured)
    : path.join(os.homedir(), '.copilot', 'session-state')
}

/** The transcript of one Copilot CLI session. */
export function copilotSessionTranscript(sessionId: string): string {
  return path.join(copilotSessionsRoot(), sessionId, 'events.jsonl')
}

/**
 * The transcript of a harness-dispatched external worker, from the session
 * id on its delegation execution record. Null for a Cursor worker, a record
 * without a session id, or a transcript that is not on this machine.
 */
export function executorTranscript(
  root: string,
  runId: string,
  invocationId: string,
): string | null {
  const record = loadDelegationExecutionRecord(root, runId, invocationId)
  const sessionId = record?.session_id

  if (
    record?.executor !== 'copilot' ||
    typeof sessionId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(sessionId)
  ) {
    return null
  }

  const transcript = copilotSessionTranscript(sessionId)

  return existsSync(transcript) ? transcript : null
}
