/**
 * The narrow read-only historical audit behind `pan watch audit`.
 *
 * The compliance intake needs a reproducible answer to "which historical
 * submissions relied on a watch span below one cadence" across the five
 * request-authorized installations, including archived runs. This module
 * reads ledger, launch, and stage-record files directly — never the roots'
 * configuration — and writes exactly one report. It changes nothing it
 * reads, and it reports every input it could not parse rather than calling
 * a partial window complete.
 */
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { invariant } from './errors.js'
import {
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  writeJsonAtomic,
} from './io.js'
import { DEFAULT_WATCH_CADENCE_SECONDS } from './watch.js'

export interface WatchAuditOptions {
  /** Harness-relative path of the file listing the authorized roots. */
  rootsFile: string
  /** ISO-8601 window bounds, inclusive. */
  from: string
  to: string
  /** Harness-relative report path, inside `runtime/logs/`. */
  output: string
}

/** One segmented watch session of one audited ledger. */
export interface WatchAuditSession {
  root: string
  run_id: string
  invocation_id: string
  ledger_path: string
  /** The recorded session id, or null for a legacy segment. */
  session: string | null
  /** How the segment was delimited. */
  segmentation: 'session_id' | 'wake_ordinal_reset' | 'ambiguous'
  cadence_seconds: number
  cadence_authority: string | null
  first_event_at: string
  last_wake_at: string | null
  /** First event to last wake, in seconds. */
  span_seconds: number
  /** The session observed across this interval; gaps are excluded. */
  covered_seconds: number
  terminal_state: string | null
  /** The session closed with no terminal wake and no recorded end. */
  orphan: boolean
  /** Span below the session's own cadence. */
  sub_cadence: boolean
  /** A single instant inspection: no interval was ever watched. */
  zero_span: boolean
  launch_mode: string | null
  /** No launch record exists for this invocation. */
  missing_clock: boolean
  /** The stage record this watch's invocation was submitted with, if found. */
  submission_path: string | null
}

export interface WatchAuditGap {
  root: string
  run_id: string
  invocation_id: string
  ledger_path: string
  from: string
  to: string
  seconds: number
  overdue_seconds: number
  /** What evidence classifies the interval. */
  qualification:
    | 'session_end'
    | 'orphan_session'
    | 'ledger_gap'
    | 'legacy_unclassified'
}

export interface WatchAuditError {
  path: string
  error: string
}

export interface WatchAuditReport {
  schema_version: 1
  generated_at: string
  window: { from: string; to: string }
  roots: string[]
  output_path: string
  /** Latest record time actually collected; the window end is a request. */
  collection_cutoff: string
  ledgers_examined: number
  sessions: WatchAuditSession[]
  /** Sessions below one cadence of watched span, with their basis. */
  sub_cadence_sessions: WatchAuditSession[]
  /** Zero-span instant inspections, counted separately from watched spans. */
  zero_span_inspections: WatchAuditSession[]
  /** Non-default cadence sessions and whether each carries authority. */
  cadence_exceptions: Array<{
    root: string
    run_id: string
    invocation_id: string
    session: string | null
    cadence_seconds: number
    authority: string | null
    explained: boolean
  }>
  gaps: WatchAuditGap[]
  errors: WatchAuditError[]
  limitations: string[]
  /** False while any input failed to parse or read. */
  complete: boolean
}

interface LedgerEntry {
  schema_version?: number
  event?: string
  run_id?: string
  invocation_id?: string
  recorded_at?: string
  cadence_seconds?: number
  watch_session_id?: string
  wake?: number
  terminal_state?: string
  cadence_authority?: string
  session_end_reason?: string
  gap?: {
    from?: string
    to?: string
    seconds?: number
    overdue_seconds?: number
    reason?: string
  }
}

/** Evidence directories one run root can hold, newest layout first. */
function evidenceDirectories(runRoot: string): string[] {
  return [
    path.join(runRoot, 'agent', 'evidence'),
    path.join(runRoot, 'evidence'),
  ]
}

/** Stage-record candidates for one invocation under one run root. */
function stageRecordCandidates(
  runRoot: string,
  invocationId: string,
): string[] {
  return [
    path.join(runRoot, 'agent', 'artifacts', 'json', `${invocationId}.json`),
    path.join(runRoot, 'artifacts', 'json', `${invocationId}.json`),
  ]
}

/** Every run root of one installation, live and archived. */
function runRootsOf(installationRoot: string): string[] {
  const workflows = path.join(installationRoot, 'runtime', 'logs', 'workflows')
  const roots: string[] = []

  const collect = (directory: string): void => {
    let names: string[]

    try {
      names = readdirSync(directory)
    } catch {
      return
    }

    for (const name of names) {
      if (name === 'archive' || name.startsWith('.')) {
        continue
      }

      const candidate = path.join(directory, name)

      try {
        if (statSync(candidate).isDirectory()) {
          roots.push(candidate)
        }
      } catch {
        continue
      }
    }
  }

  collect(workflows)
  collect(path.join(workflows, 'archive'))

  return roots
}

function readLedgerEntries(ledgerPath: string): {
  entries: LedgerEntry[]
  unparseableLines: number
} {
  let unparseableLines = 0
  const entries = readText(ledgerPath)
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown

        return isRecord(parsed) && parsed.schema_version === 1
          ? [parsed as LedgerEntry]
          : []
      } catch {
        unparseableLines += 1

        return []
      }
    })

  return { entries, unparseableLines }
}

interface Segment {
  sessionId: string | null
  segmentation: WatchAuditSession['segmentation']
  entries: LedgerEntry[]
}

/**
 * Segment one ledger into sessions. New-format entries group by their
 * recorded session id. Legacy entries split where the evidence marks a
 * restart: an arming whose wake ordinal does not advance past the last wake,
 * or a wake followed by an arming more than one cadence later, which a live
 * watch never does because it re-arms immediately. A legacy segment mixed
 * into session-identified history is marked ambiguous rather than assigned
 * an invented process.
 */
function segmentLedger(entries: LedgerEntry[]): Segment[] {
  const segments: Segment[] = []
  let current: Segment | null = null
  let sawLegacy = false

  const startNew = (
    sessionId: string | null,
    segmentation: WatchAuditSession['segmentation'],
  ): Segment => {
    const segment: Segment = { sessionId, segmentation, entries: [] }

    segments.push(segment)

    return segment
  }

  for (const entry of entries) {
    if (entry.event === 'gap') {
      continue
    }

    if (entry.watch_session_id !== undefined) {
      if (current === null || current.sessionId !== entry.watch_session_id) {
        current = startNew(entry.watch_session_id, 'session_id')
      }

      current.entries.push(entry)
      continue
    }

    sawLegacy = true

    if (current === null || current.sessionId !== null) {
      current = startNew(null, 'wake_ordinal_reset')
      current.entries.push(entry)
      continue
    }

    const lastWakeOrdinal = [...current.entries]
      .reverse()
      .find((item) => item.event === 'wake')?.wake
    // A re-armed watch restarts its ordinals: an arming at or below the last
    // wake's ordinal cannot come from the same loop.
    const ordinalReset =
      entry.event === 'armed' &&
      typeof entry.wake === 'number' &&
      typeof lastWakeOrdinal === 'number' &&
      entry.wake <= lastWakeOrdinal

    const previous = current.entries[current.entries.length - 1]
    const cadenceMs =
      (previous?.cadence_seconds ?? DEFAULT_WATCH_CADENCE_SECONDS) * 1000
    const intervalMs =
      previous?.recorded_at !== undefined && entry.recorded_at !== undefined
        ? Date.parse(entry.recorded_at) - Date.parse(previous.recorded_at)
        : 0
    // A wake whose next arming lands more than one cadence later means no
    // watch was live across the interval.
    const timingBreak =
      previous?.event === 'wake' &&
      entry.event === 'armed' &&
      intervalMs > cadenceMs

    if (ordinalReset || timingBreak) {
      current = startNew(null, 'wake_ordinal_reset')
    }

    current.entries.push(entry)
  }

  if (sawLegacy && segments.some((segment) => segment.sessionId !== null)) {
    for (const segment of segments) {
      if (segment.sessionId === null) {
        segment.segmentation = 'ambiguous'
      }
    }
  }

  return segments
}

/** Run the audit and write the report. Read-only for every audited root. */
export function runWatchAudit(
  root: string,
  options: WatchAuditOptions,
): WatchAuditReport {
  const fromMs = Date.parse(options.from)
  const toMs = Date.parse(options.to)

  invariant(
    Number.isFinite(fromMs) && Number.isFinite(toMs) && fromMs <= toMs,
    `--from and --to MUST be ISO-8601 bounds with --from before --to.`,
    { code: 'INVALID_ARGUMENT' },
  )

  const outputAbsolute = resolveInside(root, options.output)
  const logsRoot = resolveInside(root, 'runtime/logs')

  invariant(
    outputAbsolute === logsRoot ||
      outputAbsolute.startsWith(`${logsRoot}${path.sep}`),
    `The audit report path MUST stay inside the runtime tree ` +
      `(runtime/logs): ${options.output}`,
    { code: 'PATH_ESCAPE' },
  )

  const rootsFileAbsolute = resolveInside(root, options.rootsFile)

  invariant(
    fileExists(rootsFileAbsolute),
    `Audit roots file not found: ${options.rootsFile}`,
    { code: 'PATH_NOT_FOUND' },
  )

  const roots = readText(rootsFileAbsolute)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))

  invariant(
    roots.length > 0,
    `Audit roots file lists no roots: ${options.rootsFile}`,
    {
      code: 'INVALID_ARGUMENT',
    },
  )

  const errors: WatchAuditError[] = []
  const sessions: WatchAuditSession[] = []
  const gaps: WatchAuditGap[] = []

  const cadenceExceptions: WatchAuditReport['cadence_exceptions'] = []
  const limitations: string[] = []

  let ledgersExamined = 0
  let latestCollectedMs = 0

  for (const auditRoot of roots) {
    if (!fileExists(auditRoot)) {
      errors.push({
        path: auditRoot,
        error: 'root is not accessible',
      })
      continue
    }

    for (const runRoot of runRootsOf(auditRoot)) {
      for (const evidenceDir of evidenceDirectories(runRoot)) {
        let ledgerNames: string[]

        try {
          ledgerNames = readdirSync(evidenceDir).filter(
            (name) => name.endsWith('-watch.jsonl') && !name.startsWith('.'),
          )
        } catch {
          continue
        }

        for (const ledgerName of ledgerNames) {
          const ledgerPath = path.join(evidenceDir, ledgerName)
          let entries: LedgerEntry[]

          try {
            const read = readLedgerEntries(ledgerPath)

            entries = read.entries

            if (read.unparseableLines > 0) {
              errors.push({
                path: ledgerPath,
                error: `${read.unparseableLines} ledger line(s) did not parse as schema-1 entries`,
              })
            }
          } catch (error) {
            errors.push({
              path: ledgerPath,
              error: error instanceof Error ? error.message : String(error),
            })
            continue
          }

          ledgersExamined += 1

          const inWindow = entries.filter((entry) => {
            const at = Date.parse(entry.recorded_at ?? '')

            return Number.isFinite(at) && at >= fromMs && at <= toMs
          })

          for (const entry of inWindow) {
            const at = Date.parse(entry.recorded_at ?? '')

            if (Number.isFinite(at) && at > latestCollectedMs) {
              latestCollectedMs = at
            }
          }

          if (inWindow.length === 0) {
            continue
          }

          const runId = inWindow[0]?.run_id ?? path.basename(runRoot)
          const invocationId =
            inWindow[0]?.invocation_id ??
            ledgerName.replace(/-watch\.jsonl$/u, '')

          // Recorded gap events are authoritative where they exist, so a
          // derived gap over the same interval is not counted a second time.
          const recordedIntervals: Array<{ fromMs: number; toMs: number }> = []

          for (const entry of inWindow) {
            if (entry.event === 'gap' && entry.gap) {
              recordedIntervals.push({
                fromMs: Date.parse(entry.gap.from ?? ''),
                toMs: Date.parse(entry.gap.to ?? ''),
              })
              gaps.push({
                root: auditRoot,
                run_id: runId,
                invocation_id: invocationId,
                ledger_path: ledgerPath,
                from: entry.gap.from ?? '',
                to: entry.gap.to ?? '',
                seconds: entry.gap.seconds ?? 0,
                overdue_seconds: entry.gap.overdue_seconds ?? 0,
                qualification:
                  entry.gap.reason === 'orphan_session'
                    ? 'orphan_session'
                    : entry.gap.reason === 'sibling_handoff' ||
                        entry.gap.reason === 'interrupted'
                      ? 'session_end'
                      : 'legacy_unclassified',
              })
            }
          }

          const coveredByRecordedGap = (from: string, to: string): boolean => {
            const fromMs = Date.parse(from)
            const toMs = Date.parse(to)

            return recordedIntervals.some(
              (interval) => interval.fromMs < toMs && interval.toMs > fromMs,
            )
          }

          const segments = segmentLedger(inWindow)
          const launchPaths = evidenceDir
            ? [path.join(evidenceDir, `${invocationId}-launch.json`)]
            : []
          const launchRecord = launchPaths
            .filter((candidate) => fileExists(candidate))
            .map((candidate) => {
              try {
                return readJson(candidate)
              } catch {
                return null
              }
            })[0]
          const launchMode = isRecord(launchRecord)
            ? typeof launchRecord.launch_mode === 'string'
              ? launchRecord.launch_mode
              : 'unknown'
            : null

          const submissionPath =
            stageRecordCandidates(runRoot, invocationId).find((candidate) =>
              fileExists(candidate),
            ) ?? null

          segments.forEach((segment, index) => {
            const first = segment.entries[0]
            const wakes = segment.entries.filter(
              (entry) => entry.event === 'wake',
            )
            const lastWake = wakes[wakes.length - 1]
            const terminal = [...wakes]
              .reverse()
              .find((entry) => entry.terminal_state !== undefined)

            const firstMs = Date.parse(first?.recorded_at ?? '')
            const lastMs = Date.parse(
              (lastWake ?? segment.entries[segment.entries.length - 1])
                ?.recorded_at ?? '',
            )
            const spanSeconds =
              Number.isFinite(firstMs) && Number.isFinite(lastMs)
                ? Math.max(0, (lastMs - firstMs) / 1000)
                : 0

            const cadence =
              first?.cadence_seconds ?? DEFAULT_WATCH_CADENCE_SECONDS
            const authority =
              segment.entries.find(
                (entry) => entry.cadence_authority !== undefined,
              )?.cadence_authority ?? null

            // A segment is an orphan when nothing closed it and a later
            // segment or the open ledger end follows it.
            const closed =
              terminal !== undefined ||
              segment.entries.some((entry) => entry.event === 'session_ended')
            const orphan = !closed
            // A zero-span instant inspection is counted separately and still
            // listed as shorter than one cadence, with its basis.
            const zeroSpan = wakes.length > 0 && spanSeconds === 0
            const subCadence = wakes.length > 0 && spanSeconds < cadence

            sessions.push({
              root: auditRoot,
              run_id: runId,
              invocation_id: invocationId,
              ledger_path: ledgerPath,
              session: segment.sessionId ?? `legacy-${index + 1}`,
              segmentation: segment.segmentation,
              cadence_seconds: cadence,
              cadence_authority: authority,
              first_event_at: first?.recorded_at ?? '',
              last_wake_at: lastWake?.recorded_at ?? null,
              span_seconds: spanSeconds,
              covered_seconds: spanSeconds,
              terminal_state: terminal?.terminal_state ?? null,
              orphan,
              sub_cadence: subCadence,
              zero_span: zeroSpan,
              launch_mode: launchMode,
              missing_clock: launchMode === null,
              submission_path: submissionPath,
            })

            if (cadence !== DEFAULT_WATCH_CADENCE_SECONDS) {
              cadenceExceptions.push({
                root: auditRoot,
                run_id: runId,
                invocation_id: invocationId,
                session: segment.sessionId ?? `legacy-${index + 1}`,
                cadence_seconds: cadence,
                authority,
                explained: authority !== null,
              })
            }

            // The interval between a wake and the next segment's first event
            // is time no watch was live for: a live watch re-arms at once.
            const next = segments[index + 1]

            if (next !== undefined) {
              const nextFirst = next.entries[0]
              const gapFrom = (
                lastWake ?? segment.entries[segment.entries.length - 1]
              )?.recorded_at
              const gapTo = nextFirst?.recorded_at
              const gapSeconds =
                gapFrom && gapTo
                  ? (Date.parse(gapTo) - Date.parse(gapFrom)) / 1000
                  : 0

              if (
                gapFrom &&
                gapTo &&
                gapSeconds > 1 &&
                !coveredByRecordedGap(gapFrom, gapTo)
              ) {
                gaps.push({
                  root: auditRoot,
                  run_id: runId,
                  invocation_id: invocationId,
                  ledger_path: ledgerPath,
                  from: gapFrom,
                  to: gapTo,
                  seconds: gapSeconds,
                  overdue_seconds: Math.max(0, gapSeconds - cadence),
                  qualification:
                    segment.segmentation === 'session_id'
                      ? 'session_end'
                      : 'legacy_unclassified',
                })
              }
            }
          })
        }
      }
    }
  }

  limitations.push(
    'No transcript source was supplied, so per-session await block windows ' +
      'and model round counts are not reported. Their absence is a ' +
      'limitation, not a count of zero.',
  )

  if (sessions.length === 0) {
    limitations.push(
      'No watch sessions fell inside the window: the sample is empty, which ' +
        'is not evidence of adoption or of violation.',
    )
  }

  if (sessions.every((session) => session.segmentation !== 'session_id')) {
    limitations.push(
      'No new-format session identity appears in the window; adoption of ' +
        'session-scoped watches cannot be confirmed from this sample.',
    )
  }

  // With nothing collected, the collection could not have reached past the
  // moment it ran, so a window end in the future is never the cutoff.
  const generatedMs = Date.now()
  const report: WatchAuditReport = {
    schema_version: 1,
    generated_at: new Date(generatedMs).toISOString(),
    window: { from: options.from, to: options.to },
    roots,
    output_path: options.output,
    collection_cutoff: new Date(
      latestCollectedMs > 0 ? latestCollectedMs : Math.min(toMs, generatedMs),
    ).toISOString(),
    ledgers_examined: ledgersExamined,
    sessions,
    sub_cadence_sessions: sessions.filter((session) => session.sub_cadence),
    zero_span_inspections: sessions.filter((session) => session.zero_span),
    cadence_exceptions: cadenceExceptions,
    gaps,
    errors,
    limitations,
    complete: errors.length === 0,
  }

  writeJsonAtomic(outputAbsolute, report)

  return report
}
