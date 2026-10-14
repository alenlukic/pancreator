/** Incremental, redacted watch output, independent of observation decisions. */

import {
  closeSync,
  fstatSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
} from 'node:fs'

import { collectSecrets, redact } from '../agent-index/store.js'
import { PanError } from '../errors.js'
import { transcriptSteps, type TranscriptStep } from '../transcripts/records.js'
import {
  copilotSessionsRoot,
  copilotSessionTranscript,
  executorTranscript,
} from '../transcripts/source.js'
import { readLaunchRecord } from './launch.js'
import { resolveWatchedInvocation } from './paths.js'
import { formatSessionStartLine } from './record.js'
import type { WatchRecordEntry } from './types.js'

const READ_BYTES = 1024 * 1024
const DISCOVERY_SESSIONS = 32

function missingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/**
 * The execution audit is written after exit. Until then, match only a unique
 * session whose user prompt names this run's exact invocation output.
 */
export function liveCopilotTranscript(
  root: string,
  entry: WatchRecordEntry,
): string | null {
  const invocation = resolveWatchedInvocation(
    root,
    entry.run_id,
    entry.invocation_id,
  )
  if (invocation.stage.persona_executor !== 'copilot') return null
  const launched = Date.parse(
    readLaunchRecord(root, entry.run_id, entry.invocation_id)?.launched_at ??
      invocation.created_at,
  )
  let candidates: { file: string; modified: number }[]
  try {
    candidates = readdirSync(copilotSessionsRoot(), { withFileTypes: true })
      .filter(
        (item) =>
          item.isDirectory() && /^[A-Za-z0-9_-]{1,128}$/u.test(item.name),
      )
      .flatMap((item) => {
        const file = copilotSessionTranscript(item.name)
        try {
          const modified = statSync(file).mtimeMs
          return modified >= launched ? [{ file, modified }] : []
        } catch (error) {
          if (missingFile(error)) return []
          throw error
        }
      })
      .sort((a, b) => b.modified - a.modified)
      .slice(0, DISCOVERY_SESSIONS)
  } catch (error) {
    if (missingFile(error)) return null
    throw error
  }
  const matches: string[] = []
  for (const { file } of candidates) {
    let fd: number
    try {
      fd = openSync(file, 'r')
    } catch (error) {
      if (missingFile(error)) continue
      throw error
    }
    try {
      const buffer = Buffer.alloc(READ_BYTES)
      const count = readSync(fd, buffer, 0, buffer.length, 0)
      const steps = transcriptSteps(buffer.subarray(0, count).toString('utf8'))
      if (
        steps.some(
          (step) =>
            step.role === 'user' &&
            step.text.includes(invocation.output.path) &&
            step.text.includes(entry.run_id),
        )
      ) {
        matches.push(file)
      }
    } finally {
      closeSync(fd)
    }
  }
  return matches.length === 1 ? (matches[0] ?? null) : null
}

function limit(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 80 || value > 4096) {
    throw new PanError(`${name} must be an integer from 80 to 4096.`, {
      code: 'INVALID_ARGUMENT',
    })
  }
  return value
}

/** Reads all new complete records in bounded chunks, retaining partial records. */
export class WatchTranscriptCursor {
  private file: string | null = null
  private identity = ''
  private offset = 0
  private pending = Buffer.alloc(0)
  private discarding = false

  read(
    file: string | null,
    prime = false,
  ): { steps: TranscriptStep[]; notice: string } {
    if (!file) return { steps: [], notice: '' }
    let fd: number
    try {
      fd = openSync(file, 'r')
    } catch (error) {
      if (missingFile(error)) {
        return { steps: [], notice: 'transcript unavailable' }
      }
      throw error
    }
    try {
      const stat = fstatSync(fd)
      const identity = `${stat.dev}:${stat.ino}`
      if (
        file !== this.file ||
        identity !== this.identity ||
        stat.size < this.offset
      ) {
        this.file = file
        this.identity = identity
        this.offset = 0
        this.pending = Buffer.alloc(0)
        this.discarding = false
      }
      if (prime) {
        this.offset = stat.size
        this.pending = Buffer.alloc(0)
        const last = Buffer.alloc(1)
        this.discarding =
          stat.size > 0 &&
          readSync(fd, last, 0, 1, stat.size - 1) === 1 &&
          last[0] !== 0x0a
        return { steps: [], notice: '' }
      }
      const steps: TranscriptStep[] = []
      const bytes = Buffer.alloc(Math.min(READ_BYTES, stat.size - this.offset))
      // Drain the snapshot even on a terminal wake; no later wake is guaranteed.
      while (this.offset < stat.size) {
        const count = readSync(
          fd,
          bytes,
          0,
          Math.min(bytes.length, stat.size - this.offset),
          this.offset,
        )
        if (count === 0) break
        this.offset += count
        let content = Buffer.concat([this.pending, bytes.subarray(0, count)])
        if (this.discarding) {
          const end = content.indexOf(0x0a)
          if (end === -1) continue
          content = content.subarray(end + 1)
          this.discarding = false
        }
        const end = content.lastIndexOf(0x0a)
        const complete =
          end === -1 ? Buffer.alloc(0) : content.subarray(0, end + 1)
        this.pending = Buffer.from(content.subarray(end + 1))
        steps.push(...transcriptSteps(complete.toString('utf8')))
      }
      return { steps, notice: '' }
    } finally {
      closeSync(fd)
    }
  }
}

interface DisplayState {
  cursor: WatchTranscriptCursor
  transcript: string | null
  wrapper: string | null
  bytes: number
  idle: number
  notice: string
}

export interface WatchDisplayInputs {
  context: (entry: WatchRecordEntry) => { persona: string; model: string }
  transcript: (entry: WatchRecordEntry) => {
    steps: TranscriptStep[]
    notice: string
  }
  secrets: string[]
}

/** Renders one session with separate cursors for multiplexed invocations. */
export class WatchDisplay {
  private readonly states = new Map<string, DisplayState>()
  private readonly secrets: string[]
  private readonly textChars = limit('PANCREATOR_WATCH_TEXT_CHARS', 600)
  private readonly toolChars = limit('PANCREATOR_WATCH_TOOL_CHARS', 240)
  private readonly wrapperChars = limit('PANCREATOR_WATCH_WRAPPER_CHARS', 160)
  private idleLineWidth = 0

  constructor(
    private readonly root: string,
    private readonly inputs?: WatchDisplayInputs,
  ) {
    this.secrets = inputs?.secrets ?? collectSecrets(root)
  }

  private clean(text: string): string {
    const normalized = redact(text, this.secrets)
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/gu, '')
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '')
      .replace(/\r\n/gu, '\n')
      .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/gu, '')
    // Terminal controls can split a secret value before normalization.
    return redact(normalized, this.secrets)
  }

  private summary(text: string, chars: number): string {
    const clean = redact(
      this.clean(text).replace(/\s+/gu, ' ').trim(),
      this.secrets,
    )
    return clean.length > chars ? `${clean.slice(0, chars - 3)}...` : clean
  }

  private continued(text: string, chars: number): string {
    return this.clean(text)
      .split('\n')
      .flatMap((line) => {
        const points = Array.from(line)
        const lines: string[] = []
        for (let index = 0; index < points.length; index += chars) {
          lines.push(points.slice(index, index + chars).join(''))
        }
        return lines.length ? lines : ['']
      })
      .join('\n  ')
  }

  private state(entry: WatchRecordEntry): DisplayState {
    const key = `${entry.run_id}:${entry.invocation_id}`
    let state = this.states.get(key)
    if (!state) {
      state = {
        cursor: new WatchTranscriptCursor(),
        transcript: null,
        wrapper: null,
        bytes: 0,
        idle: 0,
        notice: '',
      }
      this.states.set(key, state)
    }
    return state
  }

  /** Prints the run, invocation, persona, model, cadence and bound once. */
  start(entry: WatchRecordEntry): string {
    const state = this.state(entry)
    // Establish the display cursor before the first wait, without replaying history.
    this.transcriptDelta(entry, state, true)
    const context =
      this.inputs?.context(entry) ??
      resolveWatchedInvocation(this.root, entry.run_id, entry.invocation_id)
        .stage
    return `${this.finish()}${this.summary(
      `${formatSessionStartLine(entry)}; run ${entry.run_id}; persona ${context.persona}; model ${context.model}`,
      4096,
    )}\n`
  }

  private transcriptDelta(
    entry: WatchRecordEntry,
    state: DisplayState,
    prime = false,
  ): { steps: TranscriptStep[]; notice: string } {
    try {
      if (this.inputs) return this.inputs.transcript(entry)
      state.transcript =
        executorTranscript(this.root, entry.run_id, entry.invocation_id) ??
        entry.observation?.agent_activity?.transcript?.path ??
        state.transcript ??
        liveCopilotTranscript(this.root, entry)
      return state.cursor.read(state.transcript, prime)
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string' &&
        ['EACCES', 'EPERM', 'EIO', 'ESTALE', 'EISDIR'].includes(error.code)
      ) {
        return { steps: [], notice: `transcript unreadable (${error.code})` }
      }
      throw error
    }
  }

  /** Prints new transcript and wrapper fragments, or updates one idle line. */
  wake(entry: WatchRecordEntry): string {
    const state = this.state(entry)
    const activity = entry.observation?.agent_activity
    const delta = this.transcriptDelta(entry, state)
    const notice = delta.notice !== state.notice ? delta.notice : ''
    state.notice = delta.notice
    const assistant = delta.steps.filter((step) => step.role === 'assistant')
    const fragments: string[] = []
    for (const step of assistant) {
      const text = this.continued(step.text, this.textChars)
      if (text) fragments.push(`chat: ${text}`)
      const tools: { name: string; count: number }[] = []
      for (const tool of step.tools) {
        const last = tools.at(-1)
        if (last?.name === tool.name) last.count += 1
        else tools.push({ name: tool.name, count: 1 })
      }
      const toolText = this.continued(
        tools
          .map(({ name, count }) => `${name}${count > 1 ? ` x${count}` : ''}`)
          .join(', '),
        this.toolChars,
      )
      if (toolText) fragments.push(`tools: ${toolText}`)
    }
    const heartbeat = activity?.open_call?.shell_heartbeat
    let wrapper = ''
    if (heartbeat?.log_bytes != null) {
      const previous = state.wrapper === heartbeat.record_path ? state.bytes : 0
      const growth = Math.max(0, heartbeat.log_bytes - previous)
      state.wrapper = heartbeat.record_path
      state.bytes = heartbeat.log_bytes
      if (growth > 0) {
        const newest = heartbeat.recent_lines.at(-1)
        wrapper =
          `wrapper +${growth}B` +
          (newest ? `: ${this.summary(newest, this.wrapperChars)}` : '')
      }
    }
    const label =
      this.states.size > 1
        ? `[pan watch:${[...this.states.values()].indexOf(state) + 1}]`
        : '[pan watch]'
    if (wrapper) fragments.push(wrapper)
    if (notice) fragments.push(notice)
    if (
      !entry.changed &&
      fragments.length === 0 &&
      !entry.terminal_state &&
      !entry.completion_hold
    ) {
      state.idle += 1
      const line = `${label} unchanged x${state.idle}`
      this.idleLineWidth = Math.max(this.idleLineWidth, line.length)
      return `\r${line.padEnd(this.idleLineWidth)}`
    }
    const idle = state.idle > 0 ? `; unchanged x${state.idle}` : ''
    state.idle = 0
    const output = entry.observation?.output_present
      ? entry.observation.output_is_scaffold
        ? 'output scaffold'
        : entry.observation.output_matches_invocation
          ? 'output present'
          : 'output present (other invocation)'
      : 'no output'
    const terminal = entry.terminal_state
      ? ` -> ${entry.terminal_state}`
      : entry.completion_hold
        ? ` -> holding for one confirming wake (${entry.completion_hold})`
        : ''
    return (
      `${this.finish()}${label} wake ${entry.wake} at ${entry.recorded_at}: ${output}${idle}` +
      `${terminal}\n` +
      (fragments.length ? `  ${fragments.join('\n  ')}\n` : '')
    )
  }

  /** Ends an in-place idle counter before another diagnostic or verdict. */
  finish(): string {
    if (this.idleLineWidth === 0) return ''
    this.idleLineWidth = 0
    return '\n'
  }
}
