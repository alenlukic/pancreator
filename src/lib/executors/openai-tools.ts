import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
  type Dirent,
} from 'node:fs'
import path from 'node:path'

import type { OpenAiToolDefinition } from './openai-client.js'

/**
 * Function tools offered to an OpenAI-executed persona, and the bounded
 * implementations behind them.
 *
 * Every model-supplied path passes through `authorizePath`, which resolves it
 * against the run workspace and refuses anything outside the roots the stage's
 * workspace policy allows. That check is defense in depth: the gate of record
 * for workspace mutation remains `scope.no_unapproved_changes`.
 */

/** Directories no tool walks: compiled output, caches, and dependency trees. */
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.venv',
  '__pycache__',
  'coverage',
  'dist',
  'node_modules',
  'venv',
  'vendor',
])

const MAX_WALK_ENTRIES = 20_000
const DEFAULT_SEARCH_MATCHES = 200

/**
 * Roots and bounds one delegation grants its tools. Serialized across the
 * child-process boundary, so every field is plain JSON.
 */
export interface OpenAiToolPolicy {
  /** Directory a relative model-supplied path resolves against. */
  workspaceDir: string
  /** Absolute directories the model may read. */
  readRoots: string[]
  /** Absolute directories the model may write. A subset of `readRoots`. */
  writeRoots: string[]
  /** Tools this stage may invoke after its write boundary is considered. */
  allowedTools: string[]
  /** Byte cap for one tool result before it is truncated and labeled. */
  maxResultBytes: number
  /** Wall-clock bound for one `run_shell` invocation. */
  shellTimeoutMs: number
}

export interface OpenAiToolResult {
  ok: boolean
  /** Text returned to the model as the `function_call_output`. */
  output: string
  truncated: boolean
}

/**
 * Tool catalog. Descriptions are part of the contract the model reads, so they
 * state the authorization boundary rather than leaving it to be discovered
 * through a refusal.
 */
export const OPENAI_TOOL_DEFINITIONS: readonly OpenAiToolDefinition[] = [
  {
    type: 'function',
    name: 'read_file',
    description:
      'Read a UTF-8 text file. The path is absolute, or relative to the run workspace. Reading outside the authorized roots is refused.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'File to read.' },
      },
    },
  },
  {
    type: 'function',
    name: 'list_directory',
    description:
      'List the immediate entries of a directory, marking each as file or directory.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Directory to list.' },
      },
    },
  },
  {
    type: 'function',
    name: 'glob_files',
    description:
      'Find files by glob pattern. Supports **, *, and ?. Compiled output, caches, and dependency directories are never walked.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['pattern'],
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern relative to the search root.',
        },
        path: {
          type: 'string',
          description: 'Search root. Defaults to the run workspace.',
        },
      },
    },
  },
  {
    type: 'function',
    name: 'search_text',
    description:
      'Search file contents with a JavaScript regular expression and return matching lines as path:line:text.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['pattern'],
      properties: {
        pattern: { type: 'string', description: 'Regular expression source.' },
        path: {
          type: 'string',
          description: 'Search root. Defaults to the run workspace.',
        },
        glob: {
          type: 'string',
          description: 'Optional glob restricting which files are searched.',
        },
        max_matches: {
          type: 'integer',
          description: `Maximum matches to return. Defaults to ${DEFAULT_SEARCH_MATCHES}.`,
        },
      },
    },
  },
  {
    type: 'function',
    name: 'write_file',
    description:
      'Create or overwrite a UTF-8 text file. Refused unless the path sits inside a root the stage may write.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'content'],
      properties: {
        path: { type: 'string', description: 'File to write.' },
        content: { type: 'string', description: 'Complete file contents.' },
      },
    },
  },
  {
    type: 'function',
    name: 'edit_file',
    description:
      'Replace an exact string in an existing file. Refused when the string is absent, or when it occurs more than once and replace_all is false.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'old_string', 'new_string'],
      properties: {
        path: { type: 'string', description: 'File to edit.' },
        old_string: { type: 'string', description: 'Exact text to replace.' },
        new_string: { type: 'string', description: 'Replacement text.' },
        replace_all: {
          type: 'boolean',
          description: 'Replace every occurrence instead of requiring one.',
        },
      },
    },
  },
  {
    type: 'function',
    name: 'run_shell',
    description:
      'Run one shell command in the run workspace and return its exit code, stdout, and stderr.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['command'],
      properties: {
        command: { type: 'string', description: 'Command line to run.' },
        cwd: {
          type: 'string',
          description:
            'Working directory. Defaults to the run workspace. Must sit inside an authorized root.',
        },
      },
    },
  },
]

export const OPENAI_TOOL_NAMES: readonly string[] = OPENAI_TOOL_DEFINITIONS.map(
  (tool) => tool.name,
)

export function openAiToolDefinitions(
  policy: OpenAiToolPolicy,
): OpenAiToolDefinition[] {
  const allowed = new Set(policy.allowedTools)

  return OPENAI_TOOL_DEFINITIONS.filter((tool) => allowed.has(tool.name))
}

function containedIn(target: string, root: string): boolean {
  const relative = path.relative(root, target)

  return (
    relative.length === 0 ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  )
}

/**
 * Resolve symlinks as far as the path exists. A file that does not exist yet
 * still has to sit under a real root, so the deepest existing ancestor is
 * resolved and the remaining segments are re-joined onto it.
 */
function realOrNearest(target: string): string {
  let current = path.resolve(target)

  for (;;) {
    try {
      const real = realpathSync(current)

      return current === path.resolve(target)
        ? real
        : path.join(real, path.relative(current, path.resolve(target)))
    } catch {
      const parent = path.dirname(current)

      if (parent === current) {
        return path.resolve(target)
      }

      current = parent
    }
  }
}

export interface PathAuthorization {
  ok: boolean
  absolute: string
  error?: string
}

/**
 * Resolve a model-supplied path and confirm it lands inside `roots`. Returns a
 * refusal the model can read rather than throwing, so one bad path costs a
 * round instead of the delegation.
 */
export function authorizePath(
  candidate: string,
  roots: string[],
  policy: OpenAiToolPolicy,
  action: string,
): PathAuthorization {
  const absolute = path.resolve(policy.workspaceDir, candidate)
  const resolved = realOrNearest(absolute)
  const allowed = roots.map(realOrNearest)

  if (allowed.some((root) => containedIn(resolved, root))) {
    return { ok: true, absolute }
  }

  return {
    ok: false,
    absolute,
    error:
      `Path '${candidate}' resolves to '${resolved}', which this stage may ` +
      `not ${action}. Authorized ${action} roots: ${roots.join(', ')}.`,
  }
}

function failure(error: string): OpenAiToolResult {
  return { ok: false, output: error, truncated: false }
}

function success(output: string, policy: OpenAiToolPolicy): OpenAiToolResult {
  const limit = policy.maxResultBytes

  if (Buffer.byteLength(output, 'utf8') <= limit) {
    return { ok: true, output, truncated: false }
  }

  // Truncation is disclosed in the payload itself: a silently shortened
  // result would read to the model as the complete answer.
  const kept = Buffer.from(output, 'utf8').subarray(0, limit).toString('utf8')

  return {
    ok: true,
    output: `${kept}\n\n[truncated to ${limit} bytes by the Pancreator tool result cap]`,
    truncated: true,
  }
}

function globToRegExp(pattern: string): RegExp {
  let source = ''

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]

    if (char === '*') {
      if (pattern[index + 1] === '*') {
        const slashed = pattern[index + 2] === '/'

        source += slashed ? '(?:.*/)?' : '.*'
        index += slashed ? 2 : 1
        continue
      }

      source += '[^/]*'
      continue
    }

    if (char === '?') {
      source += '[^/]'
      continue
    }

    source += char.replace(/[.+^${}()|[\]\\]/u, '\\$&')
  }

  return new RegExp(`^${source}$`, 'u')
}

/** Relative file paths under `root`, skipping caches and dependency trees. */
function walkFiles(root: string): string[] {
  const found: string[] = []
  const queue: string[] = ['']

  while (queue.length > 0 && found.length < MAX_WALK_ENTRIES) {
    const relative = queue.shift() as string
    let entries: Dirent[]

    try {
      entries = readdirSync(path.join(root, relative), { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const child =
        relative.length === 0 ? entry.name : `${relative}/${entry.name}`

      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          queue.push(child)
        }
        continue
      }

      if (entry.isFile()) {
        found.push(child)
      }
    }
  }

  return found.sort()
}

function stringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key]

  return typeof value === 'string' ? value : null
}

function readFileTool(
  args: Record<string, unknown>,
  policy: OpenAiToolPolicy,
): OpenAiToolResult {
  const target = stringArg(args, 'path')

  if (target === null) {
    return failure("read_file requires a string 'path'.")
  }

  const authorized = authorizePath(target, policy.readRoots, policy, 'read')

  if (!authorized.ok) {
    return failure(authorized.error ?? 'read refused')
  }

  try {
    return success(readFileSync(authorized.absolute, 'utf8'), policy)
  } catch (error) {
    return failure(
      `read_file failed for '${target}': ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function listDirectoryTool(
  args: Record<string, unknown>,
  policy: OpenAiToolPolicy,
): OpenAiToolResult {
  const target = stringArg(args, 'path')

  if (target === null) {
    return failure("list_directory requires a string 'path'.")
  }

  const authorized = authorizePath(target, policy.readRoots, policy, 'read')

  if (!authorized.ok) {
    return failure(authorized.error ?? 'read refused')
  }

  try {
    const entries = readdirSync(authorized.absolute, { withFileTypes: true })
      .map((entry) => `${entry.isDirectory() ? 'dir ' : 'file'} ${entry.name}`)
      .sort()

    return success(entries.join('\n'), policy)
  } catch (error) {
    return failure(
      `list_directory failed for '${target}': ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function globFilesTool(
  args: Record<string, unknown>,
  policy: OpenAiToolPolicy,
): OpenAiToolResult {
  const pattern = stringArg(args, 'pattern')

  if (pattern === null) {
    return failure("glob_files requires a string 'pattern'.")
  }

  const searchRoot = stringArg(args, 'path') ?? policy.workspaceDir
  const authorized = authorizePath(searchRoot, policy.readRoots, policy, 'read')

  if (!authorized.ok) {
    return failure(authorized.error ?? 'read refused')
  }

  const matcher = globToRegExp(pattern)
  const matches = walkFiles(authorized.absolute).filter((relative) =>
    matcher.test(relative),
  )

  return success(matches.join('\n'), policy)
}

function searchTextTool(
  args: Record<string, unknown>,
  policy: OpenAiToolPolicy,
): OpenAiToolResult {
  const pattern = stringArg(args, 'pattern')

  if (pattern === null) {
    return failure("search_text requires a string 'pattern'.")
  }

  let expression: RegExp

  try {
    expression = new RegExp(pattern, 'u')
  } catch (error) {
    return failure(
      `search_text pattern is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const searchRoot = stringArg(args, 'path') ?? policy.workspaceDir
  const authorized = authorizePath(searchRoot, policy.readRoots, policy, 'read')

  if (!authorized.ok) {
    return failure(authorized.error ?? 'read refused')
  }

  const globArg = stringArg(args, 'glob')
  const fileFilter = globArg === null ? null : globToRegExp(globArg)
  const maxMatches =
    typeof args.max_matches === 'number' && args.max_matches > 0
      ? Math.floor(args.max_matches)
      : DEFAULT_SEARCH_MATCHES
  const lines: string[] = []

  for (const relative of walkFiles(authorized.absolute)) {
    if (lines.length >= maxMatches) {
      break
    }

    if (fileFilter !== null && !fileFilter.test(relative)) {
      continue
    }

    let content: string

    try {
      content = readFileSync(path.join(authorized.absolute, relative), 'utf8')
    } catch {
      continue
    }

    const fileLines = content.split('\n')

    for (let index = 0; index < fileLines.length; index += 1) {
      if (lines.length >= maxMatches) {
        break
      }

      const line = fileLines[index] as string

      if (expression.test(line)) {
        lines.push(`${relative}:${index + 1}:${line}`)
      }
    }
  }

  return success(lines.join('\n'), policy)
}

function writeFileTool(
  args: Record<string, unknown>,
  policy: OpenAiToolPolicy,
): OpenAiToolResult {
  const target = stringArg(args, 'path')
  const content = stringArg(args, 'content')

  if (target === null || content === null) {
    return failure("write_file requires string 'path' and 'content'.")
  }

  const authorized = authorizePath(target, policy.writeRoots, policy, 'write')

  if (!authorized.ok) {
    return failure(authorized.error ?? 'write refused')
  }

  try {
    mkdirSync(path.dirname(authorized.absolute), { recursive: true })
    writeFileSync(authorized.absolute, content, 'utf8')

    return success(
      `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${authorized.absolute}.`,
      policy,
    )
  } catch (error) {
    return failure(
      `write_file failed for '${target}': ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function editFileTool(
  args: Record<string, unknown>,
  policy: OpenAiToolPolicy,
): OpenAiToolResult {
  const target = stringArg(args, 'path')
  const oldString = stringArg(args, 'old_string')
  const newString = stringArg(args, 'new_string')

  if (target === null || oldString === null || newString === null) {
    return failure(
      "edit_file requires string 'path', 'old_string', and 'new_string'.",
    )
  }

  const authorized = authorizePath(target, policy.writeRoots, policy, 'write')

  if (!authorized.ok) {
    return failure(authorized.error ?? 'write refused')
  }

  let content: string

  try {
    content = readFileSync(authorized.absolute, 'utf8')
  } catch (error) {
    return failure(
      `edit_file failed for '${target}': ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const occurrences = content.split(oldString).length - 1

  if (occurrences === 0) {
    return failure(
      `edit_file found no occurrence of old_string in '${target}'.`,
    )
  }

  if (occurrences > 1 && args.replace_all !== true) {
    return failure(
      `edit_file found ${occurrences} occurrences of old_string in '${target}'. ` +
        'Pass replace_all, or supply a longer unique string.',
    )
  }

  const updated =
    args.replace_all === true
      ? content.split(oldString).join(newString)
      : content.replace(oldString, newString)

  try {
    writeFileSync(authorized.absolute, updated, 'utf8')
  } catch (error) {
    return failure(
      `edit_file failed for '${target}': ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  return success(
    `Replaced ${args.replace_all === true ? occurrences : 1} occurrence(s) in ${authorized.absolute}.`,
    policy,
  )
}

/**
 * Run one model-supplied command line.
 *
 * TS-001 prefers an argument array with no shell, and every fixed harness
 * command follows that rule. This tool is the deliberate exception: the
 * command line is the payload the model is asking to run, so a shell is the
 * behavior rather than a convenience. The command is passed as one `-c`
 * argument and is never concatenated into a harness-built string, the working
 * directory must pass path authorization, and the invocation carries a
 * timeout and an output cap.
 */
function runShellTool(
  args: Record<string, unknown>,
  policy: OpenAiToolPolicy,
): OpenAiToolResult {
  const command = stringArg(args, 'command')

  if (command === null) {
    return failure("run_shell requires a string 'command'.")
  }

  const requestedCwd = stringArg(args, 'cwd') ?? policy.workspaceDir
  const authorized = authorizePath(
    requestedCwd,
    policy.readRoots,
    policy,
    'read',
  )

  if (!authorized.ok) {
    return failure(authorized.error ?? 'working directory refused')
  }

  const spawned = spawnSync('/bin/sh', ['-c', command], {
    cwd: authorized.absolute,
    encoding: 'utf8',
    timeout: policy.shellTimeoutMs,
    maxBuffer: policy.maxResultBytes,
  })
  const timedOut =
    (spawned.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT'

  if (spawned.error && !timedOut) {
    return failure(`run_shell failed to start: ${spawned.error.message}`)
  }

  const report = [
    `exit_code: ${timedOut ? 'null (timed out)' : String(spawned.status)}`,
    `stdout:\n${spawned.stdout ?? ''}`,
    `stderr:\n${spawned.stderr ?? ''}`,
  ].join('\n')

  if (timedOut) {
    return failure(
      `run_shell timed out after ${policy.shellTimeoutMs}ms.\n${report}`,
    )
  }

  return success(report, policy)
}

const TOOL_IMPLEMENTATIONS: Record<
  string,
  (args: Record<string, unknown>, policy: OpenAiToolPolicy) => OpenAiToolResult
> = {
  read_file: readFileTool,
  list_directory: listDirectoryTool,
  glob_files: globFilesTool,
  search_text: searchTextTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
  run_shell: runShellTool,
}

/**
 * Execute one model-requested tool call. Every failure mode returns a result
 * the loop hands back to the model; nothing here throws, because a tool error
 * is information the model can act on rather than a delegation failure.
 */
export function executeOpenAiTool(
  name: string,
  rawArguments: string,
  policy: OpenAiToolPolicy,
): OpenAiToolResult {
  const implementation = TOOL_IMPLEMENTATIONS[name]

  if (!implementation) {
    return failure(
      `Unknown tool '${name}'. Available tools: ${OPENAI_TOOL_NAMES.join(', ')}.`,
    )
  }

  if (!policy.allowedTools.includes(name)) {
    return failure(
      `Tool '${name}' is not granted to this stage. Available tools: ${policy.allowedTools.join(', ')}.`,
    )
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(rawArguments.length === 0 ? '{}' : rawArguments)
  } catch (error) {
    return failure(
      `Arguments for '${name}' were not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return failure(`Arguments for '${name}' MUST be a JSON object.`)
  }

  return implementation(parsed as Record<string, unknown>, policy)
}
