/**
 * One worker transcript's profile: assistant turns, tool calls, and the shell
 * commands that browse files or run tests unfiltered.
 */

import path from 'node:path'

import { isRecord } from '../io.js'

/**
 * Programs that only show file content or a directory listing. A Shell call
 * whose effective command starts with one of them reads what Read, Grep, and
 * Glob read, at the cost of a turn and unbounded output in context.
 */
const SHELL_BROWSING_PROGRAMS = new Set([
  'cat',
  'head',
  'tail',
  'sed',
  'awk',
  'grep',
  'rg',
  'ls',
  'find',
  'wc',
  'nl',
])

const EDIT_TOOLS = new Set(['Write', 'StrReplace', 'Edit', 'MultiEdit'])

const PAN_RUN_VALUE_OPTIONS = new Set([
  '--label',
  '--cwd',
  '--heartbeat-seconds',
])

const INLINE_PYTHON_PATTERN = /(?:^|[\s;&|(])python3?\s+(?:-c\b|-(?=\s|$)|<<)/u

const DIRECT_TEST_RUNNER_PATTERN =
  /\bnpm\s+(?:run\s+)?test\b|\bnode\s+--test\b/u

const OUTPUT_FILTER_PATTERN =
  /\|\s*(?:head|tail|grep|rg|awk|sed|wc|cut|sort|uniq|jq)\b|(?:^|[^0-9&>])>>?\s*[^&\s]|&>/u

const SELF_RUN_CHECKS: Array<{
  pattern: RegExp
  kind: (match: RegExpExecArray) => string
}> = [
  { pattern: /\bnpm\s+run\s+build\b/gu, kind: () => 'npm run build' },
  { pattern: /\bnpm\s+run\s+lint\b/gu, kind: () => 'npm run lint' },
  { pattern: /\bnpm\s+(?:run\s+)?test(?![:\w-])/gu, kind: () => 'npm test' },
  {
    pattern: /\bnpm\s+run\s+(test:[a-z0-9:-]+)/gu,
    kind: (match) => `npm run ${match[1] ?? 'test'}`,
  },
  { pattern: /(?:^|[\s;&|(/])tsc(?=\s|$)/gu, kind: () => 'tsc' },
  { pattern: /\bnode\s+--test\b/gu, kind: () => 'node --test' },
  {
    pattern: /\bpan\s+repository-check\s+([a-z][a-z0-9-]*)/gu,
    kind: (match) => `pan repository-check ${match[1] ?? ''}`,
  },
  { pattern: /\bpan\s+tests\s+impacted\b/gu, kind: () => 'pan tests impacted' },
]

const PAPERWORK: Array<{ pattern: RegExp; kind: string }> = [
  { pattern: /\bpan\s+output\s+scaffold\b/gu, kind: 'pan output scaffold' },
  { pattern: /\bpan\s+output\s+validate\b/gu, kind: 'pan output validate' },
  {
    pattern:
      /\b(?:shasum|sha256sum|sha1sum|md5sum)\b|\bopenssl\s+dgst\b|\bpan\s+context\s+digest\b|\bcreateHash\s*\(/gu,
    kind: 'digest',
  },
]

/** One tool call an assistant record made. */
export interface ToolUse {
  name: string
  input: Record<string, unknown>
}

/** Efficiency counters measured from one worker transcript. */
export interface WorkerTranscriptProfile {
  /** Assistant records; one record is one model turn. */
  turns: number
  tool_calls: Map<string, number>
  reads: number
  /** Reads that name an offset or a limit. */
  partial_reads: number
  /** Reads of a path the same transcript had already read. */
  re_reads: number
  re_read_paths: Map<string, number>
  shell_calls: number
  shell_browsing: number
  inline_python: number
  self_run_checks: Map<string, number>
  unfiltered_test_output: number
  paperwork: Map<string, number>
  /** One-based turn of the first file-tool edit outside `runtime/`. */
  first_source_edit_turn: number | null
}

export function increment(
  counts: Map<string, number>,
  key: string,
  by = 1,
): void {
  counts.set(key, (counts.get(key) ?? 0) + by)
}

export function assistantTurns(content: string): ToolUse[][] {
  const turns: ToolUse[][] = []

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

    if (!isRecord(record) || record.role !== 'assistant') {
      continue
    }

    const blocks = isRecord(record.message) ? record.message.content : null
    const tools: ToolUse[] = []

    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        if (
          isRecord(block) &&
          block.type === 'tool_use' &&
          typeof block.name === 'string'
        ) {
          tools.push({
            name: block.name,
            input: isRecord(block.input) ? block.input : {},
          })
        }
      }
    }

    turns.push(tools)
  }

  return turns
}

interface ShellWord {
  value: string
  end: number
}

/** Split the leading words of a command, honoring quotes and escapes. */
function shellWords(command: string, limit: number): ShellWord[] {
  const words: ShellWord[] = []
  let index = 0

  while (index < command.length && words.length < limit) {
    while (index < command.length && /\s/u.test(command[index] ?? '')) {
      index += 1
    }

    if (index >= command.length) {
      break
    }

    let value = ''

    while (index < command.length && !/\s/u.test(command[index] ?? '')) {
      const character = command[index] ?? ''

      if (character === "'" || character === '"') {
        const close = command.indexOf(character, index + 1)
        const end = close === -1 ? command.length : close

        value += command.slice(index + 1, end)
        index = end + 1
      } else if (character === '\\' && index + 1 < command.length) {
        value += command[index + 1]
        index += 2
      } else {
        value += character
        index += 1
      }
    }

    words.push({ value, end: Math.min(index, command.length) })
  }

  return words
}

/**
 * The command a Shell call actually runs: leading `cd <dir> &&` hops,
 * environment assignments, a `bin/pan-run [options] --` or `-c '<string>'`
 * wrapper, and a `bash -c '<string>'` wrapper are removed. The rest of the
 * command line is kept, so a chain after the first command stays visible.
 */
export function effectiveShellCommand(command: string): string {
  return unwrapShellCommand(command).command
}

function unwrapShellCommand(command: string): {
  command: string
  /** A `pan-run --quiet` wrapper kept the output out of context. */
  quiet: boolean
} {
  let rest = command.trim()
  let quiet = false

  for (let hop = 0; hop < 8; hop += 1) {
    const cd = /^cd\s+(?:'[^']*'|"[^"]*"|\S+)\s*(?:&&|;)\s*/u.exec(rest)

    if (cd) {
      rest = rest.slice(cd[0].length)
      continue
    }

    const assignment =
      /^[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+/u.exec(rest)

    if (assignment) {
      rest = rest.slice(assignment[0].length)
      continue
    }

    const words = shellWords(rest, 8)
    const program = path.posix.basename(words[0]?.value ?? '')

    if (program === 'pan-run') {
      let index = 1

      while (index < words.length) {
        const word = words[index]?.value ?? ''

        if (PAN_RUN_VALUE_OPTIONS.has(word)) {
          index += 2
        } else if (word === '--quiet') {
          quiet = true
          index += 1
        } else {
          break
        }
      }

      const next = words[index]

      if (next?.value === '-c' && words[index + 1] !== undefined) {
        rest = (words[index + 1]?.value ?? '').trim()
      } else if (next?.value === '--') {
        rest = rest.slice(next.end).trim()
      } else {
        rest = rest.slice(words[index - 1]?.end ?? 0).trim()
      }
      continue
    }

    if (
      (program === 'bash' || program === 'sh' || program === 'zsh') &&
      /^-[a-z]*c$/u.test(words[1]?.value ?? '') &&
      words[2] !== undefined
    ) {
      rest = (words[2]?.value ?? '').trim()
      continue
    }

    break
  }

  return { command: rest, quiet }
}

/** True when a Shell call's effective command starts with a browsing program. */
export function isShellBrowsingCommand(command: string): boolean {
  const first = shellWords(effectiveShellCommand(command), 1)[0]?.value ?? ''

  return SHELL_BROWSING_PROGRAMS.has(path.posix.basename(first))
}

/**
 * True when a Shell call runs a test runner directly and lets its whole output
 * into context: `npm test`, `npm run test:<lane>`, or `node --test`, without a
 * pipe into a filter (head, tail, grep, rg, awk, sed, wc, cut, sort, uniq, jq),
 * a stdout redirect to a file, or `pan-run --quiet`. The failures-only wrappers
 * `pan repository-check` and `pan tests impacted` never count.
 */
export function isUnfilteredTestCommand(command: string): boolean {
  const { command: effective, quiet } = unwrapShellCommand(command)

  return (
    DIRECT_TEST_RUNNER_PATTERN.test(effective) &&
    !quiet &&
    !OUTPUT_FILTER_PATTERN.test(effective)
  )
}

function shellCommand(tool: ToolUse): string | null {
  return typeof tool.input.command === 'string' ? tool.input.command : null
}

export function toolPath(tool: ToolUse): string | null {
  for (const key of ['path', 'file_path', 'target_file']) {
    const value = tool.input[key]

    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }

  return null
}

function isRuntimePath(target: string): boolean {
  return target.split(/[/\\]/u).includes('runtime')
}

/** Count the Shell calls of one transcript whose effective command browses. */
export function shellBrowsingCalls(content: string): number {
  let count = 0

  for (const turn of assistantTurns(content)) {
    for (const tool of turn) {
      const command = tool.name === 'Shell' ? shellCommand(tool) : null

      if (command !== null && isShellBrowsingCommand(command)) {
        count += 1
      }
    }
  }

  return count
}

/** Measure every efficiency counter of one worker transcript. */
export function profileWorkerTranscript(
  content: string,
): WorkerTranscriptProfile {
  const profile: WorkerTranscriptProfile = {
    turns: 0,
    tool_calls: new Map(),
    reads: 0,
    partial_reads: 0,
    re_reads: 0,
    re_read_paths: new Map(),
    shell_calls: 0,
    shell_browsing: 0,
    inline_python: 0,
    self_run_checks: new Map(),
    unfiltered_test_output: 0,
    paperwork: new Map(),
    first_source_edit_turn: null,
  }
  const readPaths = new Set<string>()

  for (const turn of assistantTurns(content)) {
    profile.turns += 1

    for (const tool of turn) {
      increment(profile.tool_calls, tool.name)

      const target = toolPath(tool)

      if (tool.name === 'Read' && target !== null) {
        profile.reads += 1

        if (
          (tool.input.offset ?? null) !== null ||
          (tool.input.limit ?? null) !== null
        ) {
          profile.partial_reads += 1
        }

        if (readPaths.has(target)) {
          profile.re_reads += 1
          increment(profile.re_read_paths, target)
        }

        readPaths.add(target)
      }

      if (
        EDIT_TOOLS.has(tool.name) &&
        target !== null &&
        profile.first_source_edit_turn === null &&
        !isRuntimePath(target)
      ) {
        profile.first_source_edit_turn = profile.turns
      }

      const command = tool.name === 'Shell' ? shellCommand(tool) : null

      if (command === null) {
        continue
      }

      const effective = effectiveShellCommand(command)

      profile.shell_calls += 1

      if (isShellBrowsingCommand(command)) {
        profile.shell_browsing += 1
      }

      if (INLINE_PYTHON_PATTERN.test(effective)) {
        profile.inline_python += 1
      }

      if (isUnfilteredTestCommand(command)) {
        profile.unfiltered_test_output += 1
      }

      // A kind counts once per call, so `npm run build && npm run build`
      // is one build and a chained `build && lint` is one of each.
      const kinds = new Set<string>()

      for (const check of SELF_RUN_CHECKS) {
        for (const match of effective.matchAll(check.pattern)) {
          kinds.add(check.kind(match))
        }
      }

      kinds.delete('pan repository-check validate')

      for (const kind of kinds) {
        increment(profile.self_run_checks, kind)
      }

      for (const item of PAPERWORK) {
        if (effective.search(item.pattern) !== -1) {
          increment(profile.paperwork, item.kind)
        }
      }
    }
  }

  return profile
}
