/**
 * Transcript lookup for one invocation and the suite-cost advisory computed
 * from it.
 */

import {
  closeSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs'
import path from 'node:path'

import { readInstallationIdentity } from '../project-config.js'
import { agentGateProfileRuns } from '../repository-checks/ledger.js'
import {
  cursorProjectDirectory,
  transcriptBrief,
} from '../token-spend/transcripts.js'
import { shellBrowsingCalls } from './transcript.js'

/** The hypervisor's override for the Cursor transcript directory. */
export const CURSOR_TRANSCRIPTS_ENV = 'PANCREATOR_CURSOR_TRANSCRIPTS_DIR'

/**
 * Bounds of the per-invocation submit scan: the newest candidates opened, the
 * opening bytes read to match the delivery prompt, and the largest transcript
 * read whole. The scan runs inside a submission, so it stays cheap.
 */
const INVOCATION_SCAN_MAX_CANDIDATES = 64

const INVOCATION_OPENING_BYTES = 64 * 1024

const INVOCATION_TRANSCRIPT_MAX_BYTES = 32 * 1024 * 1024

/** Transcript directory the submit advisory scans for one invocation. */
export function invocationTranscriptsRoot(root: string): string {
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

function openingChunk(absolute: string): string {
  const descriptor = openSync(absolute, 'r')

  try {
    const buffer = Buffer.alloc(INVOCATION_OPENING_BYTES)
    const bytes = readSync(descriptor, buffer, 0, buffer.length, 0)

    return buffer.subarray(0, bytes).toString('utf8')
  } finally {
    closeSync(descriptor)
  }
}

function modifiedSince(absolute: string, sinceMs: number): number | null {
  try {
    const modified = statSync(absolute).mtimeMs

    return modified >= sinceMs ? modified : null
  } catch {
    return null
  }
}

/**
 * Stage-worker transcripts whose opening delivery prompt names this
 * invocation. Only session and subagent directories changed since the
 * invocation was prepared are listed, the newest candidates are opened
 * first, and each candidate is read up to its opening bytes before a match
 * reads the whole file, so the scan stays bounded on a large project.
 */
export function findInvocationTranscripts(
  transcriptsRoot: string,
  invocationId: string,
  sinceMs: number,
): string[] {
  let sessions: string[]

  try {
    sessions = readdirSync(transcriptsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(transcriptsRoot, entry.name))
  } catch {
    return []
  }

  const candidates: Array<{ absolute: string; modified: number }> = []

  for (const session of sessions) {
    for (const directory of [session, path.join(session, 'subagents')]) {
      // A new file in a directory moves the directory's own time, so a
      // directory older than the invocation holds no worker it launched.
      if (modifiedSince(directory, sinceMs) === null) {
        continue
      }

      let entries: string[]

      try {
        entries = readdirSync(directory).filter((name) =>
          name.endsWith('.jsonl'),
        )
      } catch {
        continue
      }

      for (const name of entries) {
        const absolute = path.join(directory, name)
        const modified = modifiedSince(absolute, sinceMs)

        if (modified !== null) {
          candidates.push({ absolute, modified })
        }
      }
    }
  }

  candidates.sort((left, right) => right.modified - left.modified)

  const matches: string[] = []

  for (const candidate of candidates.slice(0, INVOCATION_SCAN_MAX_CANDIDATES)) {
    let opening: string

    try {
      opening = openingChunk(candidate.absolute)
    } catch {
      continue
    }

    // A verbatim delivery can outgrow the opening bytes, which leaves the
    // first record unparseable, so the stage card's own path still matches.
    // An evidence brief is `<invocation-id>.<role>-brief.md` and never does.
    const brief = transcriptBrief(opening)
    const matched =
      brief === null
        ? opening.includes(`invocations/${invocationId}.md`)
        : brief.invocation_id === invocationId && brief.role === 'worker'

    if (matched) {
      matches.push(candidate.absolute)
    }
  }

  return matches
}

/** What the submit advisory records for one source-stage worker invocation. */
export interface WorkerInvocationSuiteCost {
  worker_gate_profiles: Record<string, number>
  shell_browsing_calls: number | null
  transcript_found: boolean
  message: string
}

/**
 * The worker-run gate profiles and shell browsing calls of one invocation,
 * or `null` when both are zero or the measurement failed. The measurement is
 * advisory evidence inside a submission, so any error skips it rather than
 * failing the submit.
 */
export function workerInvocationSuiteCost(
  root: string,
  runId: string,
  invocationId: string,
  preparedAtMs: number,
): WorkerInvocationSuiteCost | null {
  try {
    const profiles = agentGateProfileRuns(root, runId, invocationId)
    const browsing = invocationShellBrowsingCalls(
      root,
      invocationId,
      Number.isFinite(preparedAtMs) ? preparedAtMs : 0,
    )
    const gateRuns = Object.values(profiles).reduce(
      (total, value) => total + value,
      0,
    )

    if (gateRuns === 0 && (browsing.shell_browsing_calls ?? 0) === 0) {
      return null
    }

    const profileText =
      gateRuns === 0
        ? 'no gate profile'
        : Object.entries(profiles)
            .map(([profile, count]) => `${profile} ${count}x`)
            .join(', ')
    const browsingText =
      browsing.shell_browsing_calls === null
        ? 'shell browsing unavailable (no transcript names this invocation)'
        : `${browsing.shell_browsing_calls} shell browsing call` +
          `${browsing.shell_browsing_calls === 1 ? '' : 's'}`

    return {
      worker_gate_profiles: profiles,
      shell_browsing_calls: browsing.shell_browsing_calls,
      transcript_found: browsing.transcripts > 0,
      message:
        `Worker invocation ${invocationId} ran ${profileText} itself and ` +
        `made ${browsingText}. The exit gate runs the suites, so iterate on ` +
        `the impacted, static, and configuration profiles, and read files ` +
        `with Read, Grep, and Glob.`,
    }
  } catch {
    return null
  }
}

/**
 * Shell browsing calls across the worker transcripts of one invocation, or
 * `null` when no transcript names it. A transcript above the size bound is
 * skipped rather than read.
 */
export function invocationShellBrowsingCalls(
  root: string,
  invocationId: string,
  sinceMs: number,
): { transcripts: number; shell_browsing_calls: number | null } {
  const found = findInvocationTranscripts(
    invocationTranscriptsRoot(root),
    invocationId,
    sinceMs,
  ).filter((absolute) => {
    try {
      return statSync(absolute).size <= INVOCATION_TRANSCRIPT_MAX_BYTES
    } catch {
      return false
    }
  })

  if (found.length === 0) {
    return { transcripts: 0, shell_browsing_calls: null }
  }

  return {
    transcripts: found.length,
    shell_browsing_calls: found.reduce(
      (total, absolute) =>
        total + shellBrowsingCalls(readFileSync(absolute, 'utf8')),
      0,
    ),
  }
}
