/**
 * COMMS-001 visible-chat checks for Cursor hooks.
 *
 * A hook never sees the assistant's text, so both checks read the
 * conversation transcript. Each assistant record is one model step; a step
 * with tool calls and no text is the tool-only step COMMS-001 forbids. The
 * reminder fires after a tool result, so it reaches subagents and long
 * autonomous loops that the prompt-submit reminder never reaches.
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs'
import path from 'node:path'

import {
  findAgent,
  readIndex,
  resolveCanonicalId,
} from '../agent-index/store.js'
import { transcriptStep } from '../transcripts/records.js'

const CHILD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u

/** Tail bytes read to find the current turn; bounds hook latency. */
export const TURN_TAIL_BYTES = 262_144

export const TOOL_UPDATE_REMINDER =
  '[COMMS-001] Your last tool call had no visible chat update. Before your ' +
  'next tool call, write one line in chat that names the action, and put ' +
  'any significant result in chat first.'

export const SILENT_TURN_FOLLOWUP =
  '[COMMS-001] You ended your turn with no visible chat text. Hidden ' +
  'reasoning and a Thinking block do not reach the operator. Write your ' +
  'answer or report in chat now, outcome first.'

export type VisibleChatEvent = 'postToolUse' | 'postToolUseFailure' | 'stop'

export interface TurnStep {
  text: boolean
  tool: boolean
}

export interface VisibleChatResponse {
  additional_context?: string
  followup_message?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readTail(file: string): { text: string; truncated: boolean } | null {
  try {
    const { size } = statSync(file)
    const start = Math.max(0, size - TURN_TAIL_BYTES)
    const buffer = Buffer.alloc(size - start)
    const fd = openSync(file, 'r')

    try {
      readSync(fd, buffer, 0, buffer.length, start)
    } finally {
      closeSync(fd)
    }

    return { text: buffer.toString('utf8'), truncated: start > 0 }
  } catch {
    return null
  }
}

/**
 * The assistant steps of the transcript's current turn, oldest first: every
 * assistant record after the last user record, in the Cursor or the Copilot
 * CLI and VS Code record shape. Returns null when the path is not an
 * absolute `.jsonl` file or cannot be read.
 */
export function currentTurnSteps(transcriptPath: string): TurnStep[] | null {
  if (!path.isAbsolute(transcriptPath) || !transcriptPath.endsWith('.jsonl')) {
    return null
  }

  const tail = readTail(transcriptPath)

  if (tail === null) {
    return null
  }

  const lines = tail.text.split('\n')

  if (tail.truncated) {
    lines.shift()
  }

  const steps: TurnStep[] = []

  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]?.trim()

    if (!line) {
      continue
    }

    let record: unknown

    try {
      record = JSON.parse(line)
    } catch {
      continue
    }

    const step = transcriptStep(record)

    if (step?.role === 'user') {
      break
    }

    if (step) {
      steps.push({
        text: step.text.trim().length > 0,
        tool: step.tools.length > 0,
      })
    }
  }

  return steps.reverse()
}

/**
 * The transcript a hook payload belongs to. Inside a subagent Cursor sends a
 * null `transcript_path`, so the child's own file is resolved through the
 * agent index: `subagentStart` stored the parent transcript under the launch
 * id the child's payload names as `parent_tool_call_id`, and the child file is
 * `<parent dir>/subagents/<conversation_id>.jsonl`.
 */
export function payloadTranscriptPath(
  payload: Record<string, unknown>,
  root: string | null,
): string | null {
  if (typeof payload.transcript_path === 'string') {
    return payload.transcript_path
  }

  const launchId = payload.parent_tool_call_id
  const childId = payload.conversation_id

  if (
    root === null ||
    typeof launchId !== 'string' ||
    typeof childId !== 'string' ||
    !CHILD_ID_PATTERN.test(childId)
  ) {
    return null
  }

  const index = readIndex(root)
  const canonical =
    resolveCanonicalId(index, launchId) ?? resolveCanonicalId(index, childId)
  const parentTranscript =
    canonical === null
      ? null
      : findAgent(index, canonical)?.parent_transcript_path

  return typeof parentTranscript === 'string'
    ? path.join(path.dirname(parentTranscript), 'subagents', `${childId}.jsonl`)
    : null
}

/**
 * Respond to a visible-chat hook event. After a tool result, remind the agent
 * when its latest tool-calling step carried no text. When the main loop ends
 * on its first stop, ask for a visible report when the whole turn carried no
 * text. Every other case, and any error, returns `{}` so a hook never blocks.
 * `root` locates the agent index that resolves a subagent's transcript.
 */
export function resolveVisibleChatHook(
  event: VisibleChatEvent,
  payloadText: string,
  root: string | null = null,
): VisibleChatResponse {
  try {
    const payload: unknown = JSON.parse(payloadText)
    const transcriptPath = isRecord(payload)
      ? payloadTranscriptPath(payload, root)
      : null

    if (!isRecord(payload) || transcriptPath === null) {
      return {}
    }

    const steps = currentTurnSteps(transcriptPath)

    if (steps === null || steps.length === 0) {
      return {}
    }

    if (event === 'stop') {
      const firstStop =
        payload.loop_count === undefined || payload.loop_count === 0

      return payload.status === 'completed' &&
        firstStop &&
        !steps.some((step) => step.text)
        ? { followup_message: SILENT_TURN_FOLLOWUP }
        : {}
    }

    const lastToolStep = steps.filter((step) => step.tool).at(-1)

    return lastToolStep && !lastToolStep.text
      ? { additional_context: TOOL_UPDATE_REMINDER }
      : {}
  } catch {
    return {}
  }
}
