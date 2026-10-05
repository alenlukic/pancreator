/**
 * One record reader over the Cursor transcript shape and the Copilot SDK
 * shape that Copilot CLI and VS Code write. Hooks load it, so it imports
 * nothing beyond the language.
 */

export interface TranscriptToolUse {
  /** The Cursor tool name the readers match: `Read`, `Shell`, and so on. */
  name: string
  input: Record<string, unknown>
}

export interface TranscriptStep {
  role: 'user' | 'assistant'
  text: string
  tools: TranscriptToolUse[]
}

/** Copilot CLI and VS Code tool names, mapped to the Cursor tool name. */
const COPILOT_TOOL_NAMES: Record<string, string> = {
  view: 'Read',
  read_file: 'Read',
  create: 'Write',
  create_file: 'Write',
  edit: 'StrReplace',
  str_replace: 'StrReplace',
  replace_string_in_file: 'StrReplace',
  multi_replace_string_in_file: 'StrReplace',
  grep: 'Grep',
  grep_search: 'Grep',
  glob: 'Glob',
  file_search: 'Glob',
  bash: 'Shell',
  run_in_terminal: 'Shell',
  task: 'Task',
  runSubagent: 'Task',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null
}

/** Copilot tool arguments, renamed to the Cursor argument names. */
function copilotToolInput(raw: unknown): Record<string, unknown> {
  let value = raw

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      value = {}
    }
  }

  const input: Record<string, unknown> = isRecord(value) ? { ...value } : {}

  if (input.path === undefined && typeof input.filePath === 'string') {
    input.path = input.filePath
  }

  if (input.pattern === undefined && typeof input.query === 'string') {
    input.pattern = input.query
  }

  const range = Array.isArray(input.view_range)
    ? input.view_range
    : [input.startLine, input.endLine]
  const start = positiveInteger(range[0])
  const end = positiveInteger(range[1])

  if (start !== null && input.offset === undefined) {
    input.offset = start

    if (end !== null && end >= start) {
      input.limit = end - start + 1
    }
  }

  return input
}

function cursorStep(
  role: 'user' | 'assistant',
  record: Record<string, unknown>,
): TranscriptStep {
  const message = isRecord(record.message) ? record.message : null
  const blocks = Array.isArray(message?.content) ? message.content : []
  const text: string[] = []
  const tools: TranscriptToolUse[] = []

  for (const block of blocks) {
    if (!isRecord(block)) {
      continue
    }

    if (block.type === 'text' && typeof block.text === 'string') {
      text.push(block.text)
    } else if (block.type === 'tool_use' && typeof block.name === 'string') {
      tools.push({
        name: block.name,
        input: isRecord(block.input) ? block.input : {},
      })
    }
  }

  return { role, text: text.join('\n'), tools }
}

function copilotStep(
  role: 'user' | 'assistant',
  record: Record<string, unknown>,
): TranscriptStep {
  const data = isRecord(record.data) ? record.data : {}
  const requests = Array.isArray(data.toolRequests) ? data.toolRequests : []

  return {
    role,
    text: typeof data.content === 'string' ? data.content : '',
    tools: requests.filter(isRecord).flatMap((request) =>
      typeof request.name === 'string'
        ? [
            {
              name: COPILOT_TOOL_NAMES[request.name] ?? request.name,
              input: copilotToolInput(request.arguments),
            },
          ]
        : [],
    ),
  }
}

/**
 * One transcript record as a user or assistant step, or null for any other
 * record. Cursor records carry `role` and `message.content` blocks; Copilot
 * SDK records carry `type` `user.message` or `assistant.message` and `data`.
 */
export function transcriptStep(record: unknown): TranscriptStep | null {
  if (!isRecord(record)) {
    return null
  }

  if (record.role === 'user' || record.role === 'assistant') {
    return cursorStep(record.role, record)
  }

  if (record.type === 'user.message') {
    return copilotStep('user', record)
  }

  if (record.type === 'assistant.message') {
    return copilotStep('assistant', record)
  }

  return null
}

/** Every user and assistant step of one JSONL transcript, oldest first. */
export function transcriptSteps(content: string): TranscriptStep[] {
  const steps: TranscriptStep[] = []

  for (const line of content.split('\n')) {
    if (line.trim().length === 0) {
      continue
    }

    let record: unknown

    try {
      record = JSON.parse(line)
    } catch {
      continue
    }

    const step = transcriptStep(record)

    if (step) {
      steps.push(step)
    }
  }

  return steps
}
