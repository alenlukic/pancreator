import {
  closeSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs'
import path from 'node:path'

import { invariant } from './errors.js'
import { isRecord } from './io.js'
import { readInstallationIdentity } from './project-config.js'
import { agentGateProfileRuns } from './repository-checks/ledger.js'
import {
  attributionRoots,
  cursorProjectDirectory,
  readTranscripts,
  resolveTranscriptWorkflow,
  transcriptBrief,
  type TranscriptEvidence,
} from './token-spend.js'

const DAY_MS = 24 * 60 * 60 * 1_000
const DEFAULT_PROFILE_DAYS = 7
const MAX_PROFILE_DAYS = 365
const MOST_RE_READ_LIMIT = 5

/** The hypervisor's override for the Cursor transcript directory. */
export const CURSOR_TRANSCRIPTS_ENV = 'PANCREATOR_CURSOR_TRANSCRIPTS_DIR'

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
/**
 * Repository-check profiles an implementing worker may run itself. Every other
 * profile, and every direct suite runner, is a suite call the gates own.
 */
const SANCTIONED_PROFILE_KINDS = new Set([
  'pan repository-check impacted',
  'pan repository-check static',
  'pan repository-check configuration',
])

/** Self-run check kinds that run a whole suite lane the gates own. */
function isSuiteCall(kind: string): boolean {
  if (kind === 'npm test' || kind.startsWith('npm run test:')) {
    return true
  }

  return (
    kind.startsWith('pan repository-check ') &&
    !SANCTIONED_PROFILE_KINDS.has(kind)
  )
}

const PAPERWORK: Array<{ pattern: RegExp; kind: string }> = [
  { pattern: /\bpan\s+output\s+scaffold\b/gu, kind: 'pan output scaffold' },
  { pattern: /\bpan\s+output\s+validate\b/gu, kind: 'pan output validate' },
  {
    pattern:
      /\b(?:shasum|sha256sum|sha1sum|md5sum)\b|\bopenssl\s+dgst\b|\bpan\s+context\s+digest\b|\bcreateHash\s*\(/gu,
    kind: 'digest',
  },
]

/**
 * Bounds of the per-invocation submit scan: the newest candidates opened, the
 * opening bytes read to match the delivery prompt, and the largest transcript
 * read whole. The scan runs inside a submission, so it stays cheap.
 */
const INVOCATION_SCAN_MAX_CANDIDATES = 64
const INVOCATION_OPENING_BYTES = 64 * 1024
const INVOCATION_TRANSCRIPT_MAX_BYTES = 32 * 1024 * 1024

/** One tool call an assistant record made. */
interface ToolUse {
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

export interface WorkerProfileStage {
  stage: string
  personas: string[]
  workers: number
  turns: { total: number; mean: number; max: number }
  tool_calls: Record<string, number>
  file_reads: { total: number; partial: number; re_reads: number }
  most_re_read: Array<{ path: string; re_reads: number }>
  shell: { total: number; browsing: number; inline_python: number }
  self_run_checks: Record<string, number>
  /** Self-run checks that ran a suite the gates own, total and per worker. */
  suite_calls: { total: number; per_worker: number }
  unfiltered_test_output: number
  paperwork: Record<string, number>
  first_source_edit_turn: {
    workers: number
    min: number
    mean: number
    max: number
  } | null
}

export interface WorkerProfileReport {
  schema_version: 1
  generated_at: string
  period: { days: number; start: string; end: string; timezone: 'UTC' }
  sources: {
    workspaces_scanned: number
    embedded_installations_scanned: number
    transcripts_scanned: number
    workers_profiled: number
    /** Worker transcripts whose brief named no stage the profile could read. */
    workers_unattributed: number
  }
  stages: WorkerProfileStage[]
  warnings: string[]
}

export interface GenerateWorkerProfileOptions {
  days?: number
  now?: Date
  /** One transcript directory in place of every root's Cursor project. */
  transcriptsRoot?: string | null
  cursorProjectsRoot?: string
}

function increment(counts: Map<string, number>, key: string, by = 1): void {
  counts.set(key, (counts.get(key) ?? 0) + by)
}

function assistantTurns(content: string): ToolUse[][] {
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

function toolPath(tool: ToolUse): string | null {
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

/**
 * Stage slug encoded in an invocation id such as `99_implement-1_921937a8`
 * (sequence, stage and attempt, content hash), or `null` for another shape.
 */
export function stageFromInvocationId(invocationId: string): string | null {
  return (
    /^\d+_([a-z][a-z0-9-]*?)-\d+_[0-9a-f]+$/u.exec(invocationId)?.[1] ?? null
  )
}

/**
 * A reported file path that names no home directory: relative to the
 * workspace that holds it, with a worktree prefix removed.
 */
function displayPath(target: string, workspaceRoots: string[]): string {
  if (!path.isAbsolute(target)) {
    return target.replace(/^\.\//u, '')
  }

  const absolute = path.resolve(target)
  const holder = workspaceRoots
    .filter((root) => absolute.startsWith(`${root}${path.sep}`))
    .sort((left, right) => right.length - left.length)[0]

  // A path outside every workspace can carry a user name or a Cursor
  // project slug, so only its file name is reported.
  if (holder === undefined) {
    return `(outside workspace)/${path.basename(absolute)}`
  }

  return path
    .relative(holder, absolute)
    .split(path.sep)
    .join('/')
    .replace(/^\.claude\/worktrees\/[^/]+\/|^worktrees\/[^/]+\/[^/]+\//u, '')
}

function profileDays(value: number | undefined): number {
  const days = value ?? DEFAULT_PROFILE_DAYS

  invariant(
    Number.isInteger(days) && days >= 1 && days <= MAX_PROFILE_DAYS,
    `--days MUST be an integer from 1 to ${MAX_PROFILE_DAYS}.`,
    { code: 'INVALID_ARGUMENT' },
  )

  return days
}

function sortedRecord(counts: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...counts].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    ),
  )
}

function mean(total: number, count: number): number {
  return count === 0 ? 0 : Number((total / count).toFixed(1))
}

interface StageAccumulator {
  personas: Set<string>
  profiles: WorkerTranscriptProfile[]
}

/** Stage key of one worker transcript, or `null` when none can be read. */
function workerStage(
  transcript: TranscriptEvidence,
  identity: { stage: string | null; persona: string } | undefined,
): string | null {
  const brief = transcript.brief
  const stage =
    identity?.stage ??
    (brief === null ? null : stageFromInvocationId(brief.invocation_id))

  if (stage === null) {
    return null
  }

  // Evidence workers share their stage's invocation, so their role keeps
  // them apart from the stage worker. The review role is its own stage, as
  // `pan spend` attributes it.
  const role = brief?.role ?? 'worker'

  if (role === 'review') {
    return 'review'
  }

  return role === 'worker' || stage === 'review' ? stage : `${stage}/${role}`
}

/**
 * Per-stage worker efficiency from local Cursor transcripts: turns, tool
 * calls, reads and re-reads, shell browsing, inline Python, self-run checks,
 * unfiltered test output, paperwork calls, and orientation before the first
 * source edit. It reads files only and emits no transcript content.
 */
export function generateWorkerProfileReport(
  root: string,
  options: GenerateWorkerProfileOptions = {},
): WorkerProfileReport {
  const days = profileDays(options.days)
  const now = options.now ?? new Date()
  const endMs = now.getTime()
  const startMs = endMs - days * DAY_MS
  const { roots, warnings } = attributionRoots(root)
  const transcripts = readTranscripts(
    roots,
    startMs,
    options.transcriptsRoot,
    options.cursorProjectsRoot,
  )
  const workflow = resolveTranscriptWorkflow(
    root,
    roots,
    transcripts,
    options.transcriptsRoot,
  )
  const workspaceRoots = [
    ...new Set(
      roots.flatMap((item) => [item.workspace_root, item.harness_root]),
    ),
  ]
  const stages = new Map<string, StageAccumulator>()
  let workersProfiled = 0
  let workersUnattributed = 0

  for (const transcript of transcripts.values()) {
    const identity = workflow.workers.get(transcript.id)

    if (identity === undefined && transcript.brief === null) {
      continue
    }

    const stage = workerStage(transcript, identity)

    if (stage === null) {
      workersUnattributed += 1
      continue
    }

    const accumulator = stages.get(stage) ?? {
      personas: new Set<string>(),
      profiles: [],
    }

    if (identity !== undefined && identity.persona !== 'unknown') {
      accumulator.personas.add(identity.persona)
    }

    accumulator.profiles.push(profileWorkerTranscript(transcript.content))
    stages.set(stage, accumulator)
    workersProfiled += 1
  }

  const rows = [...stages].map(([stage, accumulator]) =>
    stageRow(stage, accumulator, workspaceRoots),
  )

  rows.sort(
    (left, right) =>
      right.turns.total - left.turns.total ||
      left.stage.localeCompare(right.stage),
  )

  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    period: {
      days,
      start: new Date(startMs).toISOString(),
      end: now.toISOString(),
      timezone: 'UTC',
    },
    sources: {
      workspaces_scanned: roots.length,
      embedded_installations_scanned: roots.filter((item) => item.embedded)
        .length,
      transcripts_scanned: transcripts.size,
      workers_profiled: workersProfiled,
      workers_unattributed: workersUnattributed,
    },
    stages: rows,
    warnings,
  }
}

function stageRow(
  stage: string,
  accumulator: StageAccumulator,
  workspaceRoots: string[],
): WorkerProfileStage {
  const { profiles } = accumulator
  const tools = new Map<string, number>()
  const checks = new Map<string, number>()
  const paperwork = new Map<string, number>()
  const reReads = new Map<string, number>()
  const editTurns: number[] = []
  let turns = 0
  let maxTurns = 0
  let reads = 0
  let partial = 0
  let reReadCount = 0
  let shell = 0
  let browsing = 0
  let python = 0
  let unfiltered = 0
  let suiteCalls = 0

  for (const profile of profiles) {
    turns += profile.turns
    maxTurns = Math.max(maxTurns, profile.turns)
    reads += profile.reads
    partial += profile.partial_reads
    reReadCount += profile.re_reads
    shell += profile.shell_calls
    browsing += profile.shell_browsing
    python += profile.inline_python
    unfiltered += profile.unfiltered_test_output

    for (const [name, count] of profile.tool_calls) {
      increment(tools, name, count)
    }

    for (const [kind, count] of profile.self_run_checks) {
      increment(checks, kind, count)

      if (isSuiteCall(kind)) {
        suiteCalls += count
      }
    }

    for (const [kind, count] of profile.paperwork) {
      increment(paperwork, kind, count)
    }

    for (const [target, count] of profile.re_read_paths) {
      increment(reReads, displayPath(target, workspaceRoots), count)
    }

    if (profile.first_source_edit_turn !== null) {
      editTurns.push(profile.first_source_edit_turn)
    }
  }

  return {
    stage,
    personas: [...accumulator.personas].sort(),
    workers: profiles.length,
    turns: { total: turns, mean: mean(turns, profiles.length), max: maxTurns },
    tool_calls: sortedRecord(tools),
    file_reads: { total: reads, partial, re_reads: reReadCount },
    most_re_read: Object.entries(sortedRecord(reReads))
      .slice(0, MOST_RE_READ_LIMIT)
      .map(([target, count]) => ({ path: target, re_reads: count })),
    shell: { total: shell, browsing, inline_python: python },
    self_run_checks: sortedRecord(checks),
    suite_calls: {
      total: suiteCalls,
      per_worker: mean(suiteCalls, profiles.length),
    },
    unfiltered_test_output: unfiltered,
    paperwork: sortedRecord(paperwork),
    first_source_edit_turn:
      editTurns.length === 0
        ? null
        : {
            workers: editTurns.length,
            min: Math.min(...editTurns),
            mean: mean(
              editTurns.reduce((total, value) => total + value, 0),
              editTurns.length,
            ),
            max: Math.max(...editTurns),
          },
  }
}

function sum(record: Record<string, number>): number {
  return Object.values(record).reduce((total, value) => total + value, 0)
}

function table(header: string[], rows: string[][]): string {
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => (row[column] ?? '').length)),
  )
  const line = (cells: string[]): string =>
    cells
      .map((cell, column) =>
        column === 0
          ? cell.padEnd(widths[column] ?? 0)
          : cell.padStart(widths[column] ?? 0),
      )
      .join('  ')
      .trimEnd()

  return [line(header), ...rows.map(line)].join('\n')
}

function counts(record: Record<string, number>): string {
  const entries = Object.entries(record)

  return entries.length === 0
    ? 'none'
    : entries.map(([key, value]) => `${key} ${value}`).join(', ')
}

/** The compact human form of a worker profile report. */
export function formatWorkerProfileReport(report: WorkerProfileReport): string {
  const heading =
    `Worker profile, last ${report.period.days} day` +
    `${report.period.days === 1 ? '' : 's'} ` +
    `(${report.period.start.slice(0, 10)} to ${report.period.end.slice(0, 10)} UTC): ` +
    `${report.sources.workers_profiled} workers across ` +
    `${report.stages.length} stages from ` +
    `${report.sources.transcripts_scanned} transcripts.`

  if (report.stages.length === 0) {
    return [
      heading,
      'No worker transcript fell inside the window.',
      ...report.warnings.map((warning) => `Warning: ${warning}`),
    ].join('\n')
  }

  const summary = table(
    [
      'stage',
      'workers',
      'turns',
      'mean',
      'max',
      'reads',
      'partial',
      're-reads',
      'shell',
      'browse',
      'python',
      'checks',
      'suites',
      'unfiltered',
      'paperwork',
      'first edit',
    ],
    report.stages.map((stage) => [
      stage.stage,
      String(stage.workers),
      String(stage.turns.total),
      String(stage.turns.mean),
      String(stage.turns.max),
      String(stage.file_reads.total),
      String(stage.file_reads.partial),
      String(stage.file_reads.re_reads),
      String(stage.shell.total),
      String(stage.shell.browsing),
      String(stage.shell.inline_python),
      String(sum(stage.self_run_checks)),
      String(stage.suite_calls.total),
      String(stage.unfiltered_test_output),
      String(sum(stage.paperwork)),
      stage.first_source_edit_turn === null
        ? '-'
        : `${stage.first_source_edit_turn.min}-${stage.first_source_edit_turn.max}`,
    ]),
  )
  const details = report.stages.flatMap((stage) => [
    '',
    `${stage.stage}${stage.personas.length > 0 ? ` (${stage.personas.join(', ')})` : ''}`,
    `  self-run checks: ${counts(stage.self_run_checks)}`,
    `  paperwork: ${counts(stage.paperwork)}`,
    `  most re-read: ${
      stage.most_re_read.length === 0
        ? 'none'
        : stage.most_re_read
            .map((item) => `${item.path} ${item.re_reads}`)
            .join(', ')
    }`,
  ])

  return [
    heading,
    '',
    summary,
    ...details,
    ...report.warnings.map((warning) => `Warning: ${warning}`),
  ].join('\n')
}

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
