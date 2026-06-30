export const CURSOR_SDK_IDLE_UPDATE_MS = 120_000

const MAX_NARRATIVE_LENGTH = 480
const MAX_TOOL_VALUE_LENGTH = 180

export interface CursorSdkRunResultLike {
  status: string
  result?: string
}

export interface CursorSdkRunLike<TResult extends CursorSdkRunResultLike> {
  stream(): AsyncIterable<unknown>
  wait(): Promise<TResult>
}

export interface CursorSdkInvocationLogger {
  observe(event: unknown): void
  progress(message: string): void
  finding(message: string): void
  issue(message: string): void
  finish(result: CursorSdkRunResultLike): void
  close(): void
}

export interface CursorSdkLoggingOptions {
  task: string
  write?: (chunk: string) => void
  recordEvent?: (event: unknown) => void
  idleUpdateMs?: number
}

export interface CursorSdkInvocationInput<
  TResult extends CursorSdkRunResultLike,
> extends CursorSdkLoggingOptions {
  invoke: () => Promise<CursorSdkRunLike<TResult>>
  logger?: CursorSdkInvocationLogger
}

type ToolCategory = 'explore' | 'change' | 'shell' | 'other'

interface ToolLogEntry {
  category: ToolCategory
  line: string
  referencesFile: boolean
}

interface PendingToolCall {
  name: string
  args?: unknown
}

interface LoggerState {
  closed: boolean
  currentTask: string
  emittedNarrative: boolean
  failureReported: boolean
  hasOutput: boolean
  idleTimer?: ReturnType<typeof setTimeout>
  lastNarrative?: string
  pendingTools: ToolLogEntry[]
  runningTools: Map<string, PendingToolCall>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key]

    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return undefined
}

function readScalarString(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  const text = readString(record, keys)

  if (text !== undefined) {
    return text
  }

  for (const key of keys) {
    const value = record[key]

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }

  return undefined
}

function shorten(value: string, maxLength = MAX_TOOL_VALUE_LENGTH): string {
  const compact = value.replace(/\s+/gu, ' ').trim()

  if (compact.length <= maxLength) {
    return compact
  }

  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function compactNarrative(value: string): string {
  const paragraphs = value
    .split(/\n\s*\n/gu)
    .map((paragraph) => paragraph.replace(/\s+/gu, ' ').trim())
    .filter(Boolean)
    .slice(0, 2)
  const compact = paragraphs.join('\n\n')

  return shorten(compact, MAX_NARRATIVE_LENGTH)
}

function extractAssistantText(
  event: Record<string, unknown>,
): string | undefined {
  const message = event.message

  if (!isRecord(message)) {
    return undefined
  }

  if (typeof message.text === 'string') {
    return message.text
  }

  if (!Array.isArray(message.content)) {
    return undefined
  }

  const textBlocks: string[] = []

  for (const block of message.content) {
    if (
      !isRecord(block) ||
      block.type !== 'text' ||
      typeof block.text !== 'string'
    ) {
      continue
    }

    textBlocks.push(block.text)
  }

  return textBlocks.join('\n\n')
}

function extractRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function extractPath(args: Record<string, unknown>): string | undefined {
  return readString(args, [
    'path',
    'file_path',
    'filePath',
    'target',
    'relative_path',
    'relativePath',
    'directory',
    'cwd',
  ])
}

function extractLineRange(args: Record<string, unknown>): string {
  const start = readScalarString(args, [
    'start_line',
    'startLine',
    'line_start',
    'lineStart',
    'offset',
  ])
  const end = readScalarString(args, [
    'end_line',
    'endLine',
    'line_end',
    'lineEnd',
  ])
  const limit = readScalarString(args, ['limit', 'line_count', 'lineCount'])

  if (start !== undefined && end !== undefined) {
    return ` L${start}–${end}`
  }

  if (start !== undefined && limit !== undefined) {
    const numericStart = Number(start)
    const numericLimit = Number(limit)

    if (Number.isFinite(numericStart) && Number.isFinite(numericLimit)) {
      return ` L${numericStart}–${numericStart + numericLimit - 1}`
    }
  }

  if (start !== undefined) {
    return ` L${start}`
  }

  return ''
}

function formatExploreTool(
  name: string,
  args: Record<string, unknown>,
): ToolLogEntry {
  const normalizedName = name.toLowerCase()
  const path = extractPath(args)

  if (normalizedName.includes('grep') || normalizedName.includes('search')) {
    const query = readString(args, [
      'query',
      'pattern',
      'search_term',
      'searchTerm',
    ])
    const scope = path ?? readString(args, ['glob', 'include', 'files'])
    const detail = [query, scope ? `in ${scope}` : undefined]
      .filter(Boolean)
      .join(' ')

    return {
      category: 'explore',
      line:
        detail.length > 0
          ? `Searched ${shorten(detail)}`
          : `Searched with ${name}`,
      referencesFile: scope !== undefined,
    }
  }

  if (
    normalizedName.includes('glob') ||
    normalizedName.includes('list') ||
    normalizedName === 'ls'
  ) {
    const pattern = readString(args, ['glob', 'pattern', 'query'])
    const detail = pattern ?? path

    return {
      category: 'explore',
      line:
        detail !== undefined
          ? `Listed ${shorten(detail)}`
          : `Listed with ${name}`,
      referencesFile: detail !== undefined,
    }
  }

  return {
    category: 'explore',
    line:
      path !== undefined
        ? `Read ${shorten(path)}${extractLineRange(args)}`
        : `Read with ${name}`,
    referencesFile: path !== undefined,
  }
}

function formatChangeTool(
  name: string,
  args: Record<string, unknown>,
): ToolLogEntry {
  const path = extractPath(args)
  const normalizedName = name.toLowerCase()
  let verb = 'Changed'

  if (normalizedName.includes('write') || normalizedName.includes('create')) {
    verb = 'Wrote'
  } else if (
    normalizedName.includes('delete') ||
    normalizedName.includes('remove')
  ) {
    verb = 'Removed'
  } else if (normalizedName.includes('patch')) {
    verb = 'Patched'
  }

  return {
    category: 'change',
    line:
      path !== undefined ? `${verb} ${shorten(path)}` : `${verb} with ${name}`,
    referencesFile: path !== undefined,
  }
}

function formatShellTool(
  name: string,
  args: Record<string, unknown>,
): ToolLogEntry {
  const command = readString(args, ['command', 'cmd', 'script'])

  return {
    category: 'shell',
    line: command !== undefined ? `Ran ${shorten(command)}` : `Ran ${name}`,
    referencesFile: false,
  }
}

function formatOtherTool(
  name: string,
  args: Record<string, unknown>,
): ToolLogEntry {
  const description = readString(args, [
    'description',
    'task',
    'prompt',
    'tool',
  ])

  return {
    category: 'other',
    line:
      description !== undefined
        ? `${name}: ${shorten(description)}`
        : `Used ${name}`,
    referencesFile: false,
  }
}

function formatToolCall(name: string, argsValue: unknown): ToolLogEntry {
  const args = extractRecord(argsValue) ?? {}
  const normalizedName = name.toLowerCase()

  if (
    normalizedName.includes('read') ||
    normalizedName.includes('grep') ||
    normalizedName.includes('search') ||
    normalizedName.includes('glob') ||
    normalizedName.includes('list') ||
    normalizedName === 'ls'
  ) {
    return formatExploreTool(name, args)
  }

  if (
    normalizedName.includes('edit') ||
    normalizedName.includes('write') ||
    normalizedName.includes('patch') ||
    normalizedName.includes('create') ||
    normalizedName.includes('delete') ||
    normalizedName.includes('remove')
  ) {
    return formatChangeTool(name, args)
  }

  if (
    normalizedName.includes('shell') ||
    normalizedName.includes('terminal') ||
    normalizedName.includes('command') ||
    normalizedName === 'bash'
  ) {
    return formatShellTool(name, args)
  }

  return formatOtherTool(name, args)
}

function toolGroupHeading(entries: ToolLogEntry[]): string {
  const categories = new Set(entries.map((entry) => entry.category))
  const count = entries.length

  if (categories.size !== 1) {
    return `Used ${count} ${count === 1 ? 'tool' : 'tools'}`
  }

  const category = entries[0]?.category ?? 'other'

  if (category === 'explore') {
    const allReferenceFiles = entries.every((entry) => entry.referencesFile)
    const noun = allReferenceFiles ? 'file' : 'item'
    return `Explored ${count} ${count === 1 ? noun : `${noun}s`}`
  }

  if (category === 'change') {
    return `Changed ${count} ${count === 1 ? 'file' : 'files'}`
  }

  if (category === 'shell') {
    return `Ran ${count} ${count === 1 ? 'command' : 'commands'}`
  }

  return `Used ${count} ${count === 1 ? 'tool' : 'tools'}`
}

function extractToolError(result: unknown): string | undefined {
  if (typeof result === 'string' && result.trim().length > 0) {
    return shorten(result)
  }

  if (!isRecord(result)) {
    return undefined
  }

  return readString(result, ['error', 'message', 'stderr', 'output'])
}

function statusIsFailure(status: string): boolean {
  const normalized = status.toLowerCase()
  return (
    normalized === 'error' ||
    normalized === 'cancelled' ||
    normalized === 'canceled'
  )
}

/** Creates a low-chrome renderer for Cursor SDK stream events. */
export function createCursorSdkInvocationLogger(
  options: CursorSdkLoggingOptions,
): CursorSdkInvocationLogger {
  const write =
    options.write ?? ((chunk: string) => process.stderr.write(chunk))
  const idleUpdateMs = options.idleUpdateMs ?? CURSOR_SDK_IDLE_UPDATE_MS
  const state: LoggerState = {
    closed: false,
    currentTask: compactNarrative(options.task),
    emittedNarrative: false,
    failureReported: false,
    hasOutput: false,
    pendingTools: [],
    runningTools: new Map(),
  }

  function scheduleIdleUpdate(): void {
    if (state.closed || idleUpdateMs <= 0) {
      return
    }

    if (state.idleTimer !== undefined) {
      clearTimeout(state.idleTimer)
    }

    state.idleTimer = setTimeout(() => {
      state.idleTimer = undefined

      if (state.pendingTools.length > 0) {
        flushTools()
      } else {
        emitBlock(`Still working on ${state.currentTask}…`)
      }
    }, idleUpdateMs)
    state.idleTimer.unref?.()
  }

  function emitBlock(
    message: string,
    options: { preserveLines?: boolean } = {},
  ): void {
    const compact = options.preserveLines
      ? message.trim()
      : compactNarrative(message)

    if (compact.length === 0 || state.closed) {
      return
    }

    if (state.hasOutput) {
      write('\n')
    }

    write(`${compact}\n`)
    state.hasOutput = true
    scheduleIdleUpdate()
  }

  function flushTools(): void {
    if (state.pendingTools.length === 0 || state.closed) {
      return
    }

    const entries = state.pendingTools.splice(0)
    const lines = [
      toolGroupHeading(entries),
      ...entries.map((entry) => `  ${entry.line}`),
    ]
    emitBlock(lines.join('\n'), { preserveLines: true })
  }

  function emitNarrative(message: string): void {
    const compact = compactNarrative(message)

    if (compact.length === 0 || compact === state.lastNarrative) {
      return
    }

    flushTools()
    emitBlock(compact)
    state.lastNarrative = compact
    state.emittedNarrative = true
  }

  function emitIssue(message: string): void {
    flushTools()
    emitBlock(`Issue: ${message}`)
    state.failureReported = true
  }

  function observeToolCall(event: Record<string, unknown>): void {
    const callId = typeof event.call_id === 'string' ? event.call_id : undefined
    const name = typeof event.name === 'string' ? event.name : 'tool'
    const status =
      typeof event.status === 'string'
        ? event.status.toLowerCase()
        : 'completed'

    if (status === 'running') {
      if (callId !== undefined) {
        state.runningTools.set(callId, { name, args: event.args })
      }

      return
    }

    const pending =
      callId !== undefined ? state.runningTools.get(callId) : undefined
    const toolName = pending?.name ?? name
    const args = event.args ?? pending?.args
    state.pendingTools.push(formatToolCall(toolName, args))

    if (callId !== undefined) {
      state.runningTools.delete(callId)
    }

    if (status === 'error') {
      const detail = extractToolError(event.result)
      emitIssue(
        detail !== undefined
          ? `${toolName} failed — ${detail}`
          : `${toolName} failed.`,
      )
    }
  }

  function observe(eventValue: unknown): void {
    options.recordEvent?.(eventValue)

    if (
      !isRecord(eventValue) ||
      typeof eventValue.type !== 'string' ||
      state.closed
    ) {
      return
    }

    if (eventValue.type === 'assistant') {
      const text = extractAssistantText(eventValue)

      if (text !== undefined) {
        emitNarrative(text)
      }

      return
    }

    if (eventValue.type === 'tool_call') {
      observeToolCall(eventValue)
      return
    }

    if (eventValue.type === 'task') {
      const text = readString(eventValue, ['text'])

      if (text !== undefined) {
        state.currentTask = compactNarrative(text)
        emitNarrative(text)
      }

      return
    }

    if (eventValue.type === 'status') {
      const status = readString(eventValue, ['status'])

      if (status !== undefined && statusIsFailure(status)) {
        const detail = readString(eventValue, ['message'])
        emitIssue(detail !== undefined ? detail : `Agent ${status}.`)
      }

      return
    }

    if (eventValue.type === 'request') {
      emitIssue('Agent is waiting for operator input or approval.')
    }
  }

  function progress(message: string): void {
    state.currentTask = compactNarrative(message)
    emitNarrative(message)
  }

  function finding(message: string): void {
    emitNarrative(`Finding: ${message}`)
  }

  function issue(message: string): void {
    emitIssue(message)
  }

  function finish(result: CursorSdkRunResultLike): void {
    flushTools()

    if (!state.emittedNarrative && typeof result.result === 'string') {
      emitNarrative(result.result)
    }

    if (statusIsFailure(result.status) && !state.failureReported) {
      emitIssue(`Agent run ${result.status}.`)
    }

    close()
  }

  function close(): void {
    if (state.closed) {
      return
    }

    flushTools()
    state.closed = true

    if (state.idleTimer !== undefined) {
      clearTimeout(state.idleTimer)
      state.idleTimer = undefined
    }
  }

  scheduleIdleUpdate()

  return { observe, progress, finding, issue, finish, close }
}

/** Streams one Cursor SDK run through the shared operator-facing logger. */
export async function withCursorSdkInvocationLogging<
  TResult extends CursorSdkRunResultLike,
>(input: CursorSdkInvocationInput<TResult>): Promise<TResult> {
  const logger =
    input.logger ??
    createCursorSdkInvocationLogger({
      task: input.task,
      write: input.write,
      recordEvent: input.recordEvent,
      idleUpdateMs: input.idleUpdateMs,
    })

  try {
    const run = await input.invoke()

    for await (const event of run.stream()) {
      logger.observe(event)
    }

    const result = await run.wait()
    logger.finish(result)

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.issue(message)
    logger.close()
    throw error
  }
}
