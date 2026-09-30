/** The per-stage worker profile report over a window of transcripts. */

import path from 'node:path'

import { invariant } from '../errors.js'
import {
  attributionRoots,
  readTranscripts,
  resolveTranscriptWorkflow,
  type TranscriptEvidence,
} from '../token-spend.js'
import {
  increment,
  profileWorkerTranscript,
  type WorkerTranscriptProfile,
} from './transcript.js'

const DAY_MS = 24 * 60 * 60 * 1_000

const DEFAULT_PROFILE_DAYS = 7

const MAX_PROFILE_DAYS = 365

const MOST_RE_READ_LIMIT = 5

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
