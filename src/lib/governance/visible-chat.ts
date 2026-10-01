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

function stepOf(record: Record<string, unknown>): TurnStep {
  const message = isRecord(record.message) ? record.message : null
  const parts = Array.isArray(message?.content) ? message.content : []

  return {
    text: parts.some(
      (part) =>
        isRecord(part) &&
        part.type === 'text' &&
        typeof part.text === 'string' &&
        part.text.trim().length > 0,
    ),
    tool: parts.some((part) => isRecord(part) && part.type === 'tool_use'),
  }
}

/**
 * The assistant steps of the transcript's current turn, oldest first: every
 * assistant record after the last user record. Returns null when the path is
 * not an absolute `.jsonl` file or cannot be read.
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

    if (!isRecord(record)) {
      continue
    }

    if (record.role === 'user') {
      break
    }

    if (record.role === 'assistant') {
      steps.push(stepOf(record))
    }
  }

  return steps.reverse()
}

/**
 * Respond to a visible-chat hook event. After a tool result, remind the agent
 * when its latest tool-calling step carried no text. When the main loop ends
 * on its first stop, ask for a visible report when the whole turn carried no
 * text. Every other case, and any error, returns `{}` so a hook never blocks.
 */
export function resolveVisibleChatHook(
  event: VisibleChatEvent,
  payloadText: string,
): VisibleChatResponse {
  try {
    const payload: unknown = JSON.parse(payloadText)

    if (!isRecord(payload) || typeof payload.transcript_path !== 'string') {
      return {}
    }

    const steps = currentTurnSteps(payload.transcript_path)

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
