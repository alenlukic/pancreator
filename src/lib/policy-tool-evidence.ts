/** Tool classification shared by independent execution evidence and policy hooks. */

import path from 'node:path'
import { isRecord } from './io.js'

const EDIT_TOOLS = new Set([
  'Write',
  'StrReplace',
  'Delete',
  'EditNotebook',
  'ApplyPatch',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'edit_file',
  'write_file',
  'search_replace',
  'delete_file',
])
const READ_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'LS',
  'read_file',
  'list_dir',
  'list_directory',
  'search_text',
  'glob_files',
  'grep_search',
])
const DELEGATION_TOOLS = new Set(['Task', 'Subagent', 'task', 'runSubagent'])
const BROWSER_TOOL =
  /(?:^|[:_/-])(?:browser_[a-z_]+|new_page|navigate_page|take_snapshot|take_screenshot|list_pages|select_page|close_page|chrome-devtools|playwright)(?:$|[:_/-])/iu
const GIT_REMOTE =
  /\b(?:git\s+(?:push|pull|fetch|remote|clone)|gh\s+(?:pr|release|repo|api))\b/u
function questionToolClass(toolName: string): boolean {
  const leaf = toolName.split(/[:/]/u).pop() ?? toolName
  const compact = leaf.toLowerCase().replaceAll(/[_-]/g, '')

  return (
    compact === 'askquestion' ||
    compact === 'askquestions' ||
    compact === 'askuser'
  )
}

export function recordInput(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value

  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)

      return isRecord(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  return {}
}

function relativePath(root: string, candidate: string): string {
  const resolved = path.isAbsolute(candidate)
    ? path.relative(root, candidate)
    : path.normalize(candidate)

  return resolved.split(path.sep).join('/')
}

/** Tool classes a call belongs to. A call can belong to several. */
export function toolClasses(
  toolName: string | null,
  toolInput: Record<string, unknown>,
): string[] {
  if (!toolName) return []

  const classes: string[] = []
  const command = typeof toolInput.command === 'string' ? toolInput.command : ''

  if (
    toolName === 'Shell' ||
    toolName === 'Bash' ||
    toolName === 'bash' ||
    toolName === 'run_in_terminal' ||
    toolName === 'run_terminal_cmd'
  ) {
    classes.push('shell')
    if (/(?:^|[\s/])pan\s+delegate\b/u.test(command)) classes.push('delegation')
    if (GIT_REMOTE.test(command)) classes.push('git-remote')
  } else if (DELEGATION_TOOLS.has(toolName)) {
    classes.push('delegation')
  } else if (EDIT_TOOLS.has(toolName)) {
    classes.push('edit')
  } else if (questionToolClass(toolName)) {
    classes.push('question')
  } else if (BROWSER_TOOL.test(toolName)) {
    classes.push('browser')
  }

  if (toolName.startsWith('MCP:')) {
    classes.push(`mcp:${toolName.slice(4).split(':')[0]}`)
  }

  return classes
}

/** Workspace-relative paths a structured read, search, or edit touches. */
export function toolPaths(toolInput: Record<string, unknown>): string[] {
  const keys = [
    'path',
    'file_path',
    'filePath',
    'target_file',
    'notebook_path',
    'target_notebook',
    'directory',
    'dirPath',
  ]
  const found = keys.flatMap((key) => {
    const value = toolInput[key]

    return typeof value === 'string' && value.length > 0 ? [value] : []
  })

  return [...new Set(found)]
}

export function normalizeToolPaths(
  root: string,
  paths: readonly string[],
): string[] {
  return [...new Set(paths.map((entry) => relativePath(root, entry)))].filter(
    (entry) =>
      entry !== '..' && !entry.startsWith('../') && !path.isAbsolute(entry),
  )
}

/** Watch recovery includes non-stall verdicts; they never imply a stall. */
function watchRecoveryResult(output: unknown): boolean {
  if (typeof output === 'string') {
    if (
      /^\s*(?:(?:agent |evidence )?watch (?:stalled|unregistered|unverified|timed_out|interrupted)\b|watch changed:[^\n]*; needs inspection:|(?:stalled|unregistered|unverified|timed_out|interrupted|attach_wake|attach_timed_out|orphaned) ·|Watch: (?:stalled|unverified|timed_out|interrupted|unregistered)\b)/mu.test(
        output,
      )
    )
      return true
    try {
      return watchRecoveryResult(JSON.parse(output))
    } catch {
      return false
    }
  }
  if (Array.isArray(output)) return output.some(watchRecoveryResult)
  if (!isRecord(output)) return false
  if (Array.isArray(output.stalled) && output.stalled.length > 0) return true
  if (
    typeof output.state === 'string' &&
    [
      'stalled',
      'unregistered',
      'unverified',
      'timed_out',
      'interrupted',
      'attach_wake',
      'attach_timed_out',
      'orphaned',
    ].includes(output.state)
  )
    return true
  if (
    typeof output.session_terminal_state === 'string' &&
    [
      'stalled',
      'unverified',
      'timed_out',
      'interrupted',
      'unregistered',
    ].includes(output.session_terminal_state)
  )
    return true
  return ['stdout', 'output', 'text', 'content', 'result', 'ledgers'].some(
    (key) => watchRecoveryResult(output[key]),
  )
}

export interface PolicyToolEvidence {
  classes: string[]
  events: string[]
  paths: string[]
}

/** Keep only trigger-relevant facts, never a raw tool payload or output. */
export function policyToolEvidence(
  toolName: string | null,
  input: unknown,
  output: unknown,
  failed: boolean,
): PolicyToolEvidence {
  const toolInput = recordInput(input)
  const classes = toolClasses(toolName, toolInput)
  const events = failed ? ['tool_failure'] : []
  if (
    classes.includes('shell') &&
    typeof toolInput.command === 'string' &&
    /(?:^|[\s/])pan\s+watch\b/u.test(toolInput.command) &&
    watchRecoveryResult(output)
  )
    events.push('stall')
  return {
    classes,
    events,
    paths:
      classes.includes('edit') || READ_TOOLS.has(toolName ?? '')
        ? toolPaths(toolInput)
        : [],
  }
}
