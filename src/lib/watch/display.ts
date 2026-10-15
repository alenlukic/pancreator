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
import {
  transcriptSteps,
  transcriptStep,
  transcriptToolStep,
  type TranscriptStep,
} from '../transcripts/records.js'
import { isRecord } from '../io.js'
import {
  readAgentActivity,
  type AgentActivity,
} from '../agent-index/activity.js'
import type { WatchAgentSessionEntry, WatchAgentWakeInfo } from './agent.js'
import type { GenericWatchRecordEntry } from './process.js'
import {
  copilotSessionsRoot,
  copilotSessionTranscript,
  executorTranscript,
} from '../transcripts/source.js'
import { readLaunchRecord } from './launch.js'
import { resolveWatchedInvocation } from './paths.js'
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
  private readonly toolIds = new Set<string>()

  private steps(content: string): TranscriptStep[] {
    const steps: TranscriptStep[] = []
    for (const line of content.split('\n')) {
      if (!line.trim()) continue
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        continue
      }
      if (!isRecord(value)) continue
      const data = isRecord(value.data) ? value.data : {}
      if (value.type === 'tool.execution_start') {
        const id = typeof data.toolCallId === 'string' ? data.toolCallId : null
        if (id && this.toolIds.has(id)) continue
        if (id) this.toolIds.add(id)
        const step = transcriptToolStep(value)
        if (step) steps.push(step)
      } else {
        // Copilot can describe the same tool in the assistant message and its start event.
        if (Array.isArray(data.toolRequests)) {
          value = {
            ...value,
            data: {
              ...data,
              toolRequests: data.toolRequests.filter((tool: unknown) => {
                if (!isRecord(tool) || typeof tool.toolCallId !== 'string')
                  return true
                if (this.toolIds.has(tool.toolCallId)) return false
                this.toolIds.add(tool.toolCallId)
                return true
              }),
            },
          }
        }
        const step = transcriptStep(value)
        if (step) steps.push(step)
      }
    }
    return steps
  }

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
        this.toolIds.clear()
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
        steps.push(...this.steps(complete.toString('utf8')))
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
  interactive?: boolean
}

/** Renders one session with separate cursors for multiplexed invocations. */
export class WatchDisplay {
  private readonly states = new Map<string, DisplayState>()
  private readonly liveRuns = new Map<string, WatchRecordEntry>()
  private readonly liveAgents = new Map<string, number>()
  private readonly agentStarted = new Map<string, number>()
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

  private state(key: string): DisplayState {
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
    this.liveRuns.set(`${entry.run_id}:${entry.invocation_id}`, entry)
    const state = this.state(`${entry.run_id}:${entry.invocation_id}`)
    // Establish the display cursor before the first wait, without replaying history.
    this.transcriptDelta(entry, state, true)
    const context =
      this.inputs?.context(entry) ??
      resolveWatchedInvocation(this.root, entry.run_id, entry.invocation_id)
        .stage
    return (
      `${this.finish()}── Watch · ${this.summary(context.persona, 120)} ──\n` +
      `  Run: ${this.summary(entry.run_id, 160)}\n` +
      `  Invocation: ${this.summary(entry.invocation_id, 160)}\n` +
      `  Model: ${this.summary(context.model, 160)}\n` +
      `  Observe every ${entry.cadence_seconds}s · Bound ${entry.timeout_seconds ?? 3600}s\n\n`
    )
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

  private readCursor(
    state: DisplayState,
    prime = false,
  ): { steps: TranscriptStep[]; notice: string } {
    try {
      return state.cursor.read(state.transcript, prime)
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string' &&
        ['EACCES', 'EPERM', 'EIO', 'ESTALE', 'EISDIR'].includes(error.code)
      ) {
        return { steps: [], notice: `Transcript unreadable (${error.code}).` }
      }
      throw error
    }
  }

  private fragments(steps: TranscriptStep[]): string[] {
    const assistant = steps.filter((step) => step.role === 'assistant')
    const fragments: string[] = []
    for (const step of assistant) {
      const text = this.continued(step.text, this.textChars)
      if (text) fragments.push(`── Message ──\n  ${text}`)
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
      if (toolText) fragments.push(`── Tool ──\n  ${toolText}`)
    }
    return fragments
  }

  /** Show a shell observer's new output separately from its compact heartbeat. */
  processWake(entry: GenericWatchRecordEntry): string {
    const lines: string[] = []
    if ((entry.output?.growth_bytes ?? 0) > 0 && entry.output?.tail?.length) {
      lines.push(
        `── Output ──\n  ${this.continued(entry.output.tail.join('\n'), this.textChars)}\n`,
      )
    }
    if (!entry.terminal_state) {
      const elapsed = Math.floor(
        entry.heartbeat?.elapsed_seconds ?? entry.wake * entry.cadence_seconds,
      )
      lines.push(
        `♥ ${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}\n`,
      )
    }
    return lines.length ? `${lines.join('\n')}\n` : ''
  }

  /** Prime an indexed subagent's transcript before observing live changes. */
  startAgent(entry: WatchAgentSessionEntry): string {
    this.liveAgents.set(entry.subject, entry.cadence_seconds)
    this.agentStarted.set(entry.subject, Date.parse(entry.recorded_at))
    const state = this.state(`agent:${entry.subject}`)
    const activity = readAgentActivity(
      this.root,
      entry.subject,
      Date.now(),
      entry.cadence_seconds,
    )
    state.transcript = activity?.transcript?.path ?? null
    this.readCursor(state, !activity?.stop)
    return `── Watch · ${this.summary(entry.subject, 120)} ──\n\n`
  }

  /** Emit new chat and tools for a standalone agent without idle wake spam. */
  wakeAgent(entry: WatchAgentWakeInfo): string {
    const output = this.agentDelta(entry.subject, entry.agent_activity)
    if (entry.terminal_state) {
      this.liveAgents.delete(entry.subject)
      return output
    }
    const elapsed = Math.max(
      0,
      Math.floor(
        (Date.parse(entry.recorded_at) -
          (this.agentStarted.get(entry.subject) ??
            Date.parse(entry.recorded_at))) /
          1000,
      ),
    )
    return `${output}♥ ${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}\n\n`
  }

  private agentDelta(subject: string, activity: AgentActivity | null): string {
    const state = this.state(`agent:${subject}`)
    state.transcript = activity?.transcript?.path ?? state.transcript
    const delta = this.readCursor(state)
    const fragments = this.fragments(delta.steps)
    const notice =
      delta.notice ||
      (!state.transcript ? 'Waiting for the agent transcript.' : '')
    if (notice && notice !== state.notice) fragments.push(notice)
    state.notice = notice
    return fragments.length ? `${fragments.join('\n\n')}\n\n` : ''
  }

  /** Route an attach ledger's known watch record shapes to the same live renderer. */
  follow(entry: Record<string, unknown>): string {
    if (
      entry.schema_version !== 1 ||
      typeof entry.watch_session_id !== 'string'
    )
      return ''
    if (
      typeof entry.run_id === 'string' &&
      typeof entry.invocation_id === 'string'
    ) {
      // These are harness-authored records; the discriminants select the owning watch format.
      const record = entry as unknown as WatchRecordEntry
      if (entry.event === 'session_started') return this.start(record)
      if (entry.event === 'wake') return this.wake(record)
    } else if (typeof entry.subject === 'string') {
      if (entry.event === 'session_started' && 'agent_entry' in entry)
        return this.startAgent(entry as unknown as WatchAgentSessionEntry)
      if (entry.event === 'wake' && 'agent_activity' in entry)
        return this.wakeAgent(entry as unknown as WatchAgentWakeInfo)
    }
    return ''
  }

  /** Forward transcript activity between observation wakes without changing their cadence. */
  refresh(): string {
    const output: string[] = []
    for (const [subject, cadence] of this.liveAgents) {
      const state = this.state(`agent:${subject}`)
      output.push(
        this.agentDelta(
          subject,
          state.transcript
            ? null
            : readAgentActivity(this.root, subject, Date.now(), cadence),
        ),
      )
    }
    for (const [key, entry] of this.liveRuns) {
      const state = this.state(key)
      const delta = this.transcriptDelta(entry, state)
      const fragments = this.fragments(delta.steps)
      if (delta.notice && delta.notice !== state.notice)
        fragments.push(delta.notice)
      state.notice = delta.notice
      if (fragments.length)
        output.push(`${this.finish()}${fragments.join('\n\n')}\n\n`)
    }
    return output.join('')
  }

  /** Prints new transcript and wrapper fragments; silent wakes stay in the ledger. */
  wake(entry: WatchRecordEntry): string {
    const key = `${entry.run_id}:${entry.invocation_id}`
    if (entry.terminal_state) this.liveRuns.delete(key)
    else this.liveRuns.set(key, entry)
    const state = this.state(key)
    const activity = entry.observation?.agent_activity
    const delta = this.transcriptDelta(entry, state)
    const notice = delta.notice !== state.notice ? delta.notice : ''
    state.notice = delta.notice
    const fragments = this.fragments(delta.steps)
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
      const elapsed = entry.wake * entry.cadence_seconds
      return (this.inputs?.interactive ?? process.stderr.isTTY)
        ? `\r${line.padEnd(this.idleLineWidth)}`
        : `♥ ${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}\n`
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
      (fragments.length ? `\n${fragments.join('\n\n')}\n\n` : '')
    )
  }

  /** Ends an in-place idle counter before another diagnostic or verdict. */
  finish(): string {
    if (this.idleLineWidth === 0) return ''
    this.idleLineWidth = 0
    return '\n'
  }
}
