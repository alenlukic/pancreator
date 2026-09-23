import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { runWatchAudit } from '../../src/lib/watch-audit.js'
import { createTestTempDirectory } from '../temp.js'

const WINDOW = { from: '2026-09-09T00:00:00Z', to: '2026-09-23T23:59:59Z' }

/** Digest every file under a tree, by path and content. */
function treeDigest(root: string): string {
  const lines: string[] = []
  const pending = [root]

  while (pending.length > 0) {
    const current = pending.pop() as string

    for (const name of readdirSync(current)) {
      const absolute = path.join(current, name)
      const stats = statSync(absolute)

      if (stats.isDirectory()) {
        pending.push(absolute)
      } else {
        lines.push(
          `${path.relative(root, absolute)}:${createHash('sha256').update(readFileSync(absolute)).digest('hex')}`,
        )
      }
    }
  }

  return createHash('sha256').update(lines.sort().join('\n')).digest('hex')
}

interface FixtureRoot {
  root: string
  writeLedger: (
    runId: string,
    invocationId: string,
    entries: Array<Record<string, unknown>>,
    options?: { archived?: boolean; v1?: boolean },
  ) => string
  writeLaunch: (
    runId: string,
    invocationId: string,
    record: Record<string, unknown>,
  ) => void
  writeStageRecord: (runId: string, invocationId: string) => string
}

/** A fake installation root with the runtime layout the audit scans. */
function makeInstallation(prefix: string): FixtureRoot {
  const root = createTestTempDirectory(prefix)

  const runRoot = (runId: string, archived = false): string =>
    path.join(
      root,
      'runtime',
      'logs',
      'workflows',
      ...(archived ? ['archive'] : []),
      runId,
    )

  return {
    root,
    writeLedger: (runId, invocationId, entries, options = {}) => {
      const base = runRoot(runId, options.archived === true)
      const evidence = options.v1
        ? path.join(base, 'evidence')
        : path.join(base, 'agent', 'evidence')
      const ledger = path.join(evidence, `${invocationId}-watch.jsonl`)

      mkdirSync(evidence, { recursive: true })
      writeFileSync(
        ledger,
        `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
        'utf8',
      )

      return ledger
    },
    writeLaunch: (runId, invocationId, record) => {
      const evidence = path.join(runRoot(runId), 'agent', 'evidence')

      mkdirSync(evidence, { recursive: true })
      writeFileSync(
        path.join(evidence, `${invocationId}-launch.json`),
        `${JSON.stringify(record, null, 2)}\n`,
        'utf8',
      )
    },
    writeStageRecord: (runId, invocationId) => {
      const artifacts = path.join(runRoot(runId), 'agent', 'artifacts', 'json')

      mkdirSync(artifacts, { recursive: true })

      const record = path.join(artifacts, `${invocationId}.json`)

      writeFileSync(
        record,
        `${JSON.stringify({ schema_version: 1, run_id: runId, invocation_id: invocationId })}\n`,
        'utf8',
      )

      return record
    },
  }
}

/** One schema-1 ledger entry. */
function entry(
  runId: string,
  invocationId: string,
  event: string,
  recordedAt: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: 1,
    event,
    run_id: runId,
    invocation_id: invocationId,
    recorded_at: recordedAt,
    cadence_seconds: 60,
    wake: 0,
    ...extra,
  }
}

/** Write the roots file and return the audit options for it. */
function auditOptions(
  operatorRoot: string,
  roots: string[],
  output = 'runtime/logs/watch-audit/report.json',
): { rootsFile: string; from: string; to: string; output: string } {
  writeFileSync(
    path.join(operatorRoot, 'roots.txt'),
    `${roots.join('\n')}\n# a comment line is ignored\n`,
    'utf8',
  )

  return {
    rootsFile: 'roots.txt',
    from: WINDOW.from,
    to: WINDOW.to,
    output,
  }
}

test('AC-013: historical spans', () => {
  const installation = makeInstallation('watch-audit-hist-')

  // A normal completed session with launch and submission records.
  installation.writeLedger('run-a1', 'inv-a1', [
    entry('run-a1', 'inv-a1', 'session_started', '2026-09-20T10:00:00.000Z', {
      watch_session_id: 'sess-1',
    }),
    entry('run-a1', 'inv-a1', 'armed', '2026-09-20T10:00:00.500Z', {
      wake: 1,
      watch_session_id: 'sess-1',
    }),
    entry('run-a1', 'inv-a1', 'wake', '2026-09-20T10:01:00.500Z', {
      wake: 1,
      watch_session_id: 'sess-1',
      terminal_state: 'completed',
      terminal_basis: 'agent_state',
    }),
  ])
  installation.writeLaunch('run-a1', 'inv-a1', {
    schema_version: 1,
    run_id: 'run-a1',
    invocation_id: 'inv-a1',
    launch_mode: 'background',
    launched_at: '2026-09-20T09:59:00.000Z',
  })
  const submission = installation.writeStageRecord('run-a1', 'inv-a1')

  // A legacy sub-cadence span: armed, then a completed wake five seconds on.
  installation.writeLedger('run-b1', 'inv-b1', [
    entry('run-b1', 'inv-b1', 'armed', '2026-09-21T08:00:00.000Z', { wake: 1 }),
    entry('run-b1', 'inv-b1', 'wake', '2026-09-21T08:00:05.000Z', {
      wake: 1,
      terminal_state: 'completed',
      terminal_basis: 'output_plausible',
    }),
  ])

  // A zero-span instant inspection in an archived run.
  installation.writeLedger(
    'run-b2',
    'inv-b2',
    [
      entry('run-b2', 'inv-b2', 'wake', '2026-09-21T09:00:00.000Z', {
        wake: 0,
        terminal_state: 'completed',
        terminal_basis: 'agent_state',
      }),
    ],
    { archived: true },
  )

  // An entry outside the window is excluded.
  installation.writeLedger('run-b3', 'inv-b3', [
    entry('run-b3', 'inv-b3', 'wake', '2026-08-01T00:00:00.000Z', {
      wake: 0,
      terminal_state: 'completed',
    }),
  ])

  const before = treeDigest(installation.root)
  const operatorRoot = createTestTempDirectory('watch-audit-operator-')
  const report = runWatchAudit(operatorRoot, {
    ...auditOptions(operatorRoot, [installation.root]),
    output: 'runtime/logs/watch-audit/historical.json',
  })

  // The seeded sessions come back exactly, with their identities and links.
  const byInvocation = new Map(
    report.sessions.map((session) => [session.invocation_id, session]),
  )
  const completed = byInvocation.get('inv-a1' as string)

  assert.ok(completed)
  assert.equal(completed?.run_id, 'run-a1')
  assert.equal(completed?.session, 'sess-1')
  assert.equal(completed?.segmentation, 'session_id')
  assert.equal(completed?.terminal_state, 'completed')
  assert.equal(completed?.launch_mode, 'background')
  assert.equal(completed?.missing_clock, false)
  assert.equal(completed?.submission_path, submission)
  assert.equal(completed?.span_seconds, 60.5)

  const subCadence = report.sub_cadence_sessions.map(
    (session) => session.invocation_id,
  )

  assert.ok(subCadence.includes('inv-b1'), 'the five-second span is listed')
  assert.ok(
    subCadence.includes('inv-b2'),
    'the zero-span record is included with its basis',
  )

  const zeroSpan = report.zero_span_inspections

  assert.equal(zeroSpan.length, 1)
  assert.equal(zeroSpan[0]?.invocation_id, 'inv-b2')
  assert.equal(zeroSpan[0]?.span_seconds, 0)

  // The out-of-window entry produced no session.
  assert.equal(byInvocation.has('inv-b3' as string), false)

  // The report names its real collection cutoff.
  assert.equal(report.collection_cutoff, '2026-09-21T09:00:00.000Z')
  assert.equal(report.complete, true)
  assert.equal(report.errors.length, 0)

  // The audit is read-only: every input byte is unchanged.
  assert.equal(treeDigest(installation.root), before)
})

test('AC-013: unreadable and missing inputs are named, never complete', () => {
  const installation = makeInstallation('watch-audit-partial-')

  installation.writeLedger('run-c1', 'inv-c1', [
    entry('run-c1', 'inv-c1', 'wake', '2026-09-21T09:00:00.000Z', {
      wake: 0,
      terminal_state: 'completed',
    }),
  ])

  // A ledger with an unparseable line.
  const damaged = installation.writeLedger('run-c2', 'inv-c2', [
    entry('run-c2', 'inv-c2', 'wake', '2026-09-21T10:00:00.000Z', {
      wake: 0,
      terminal_state: 'completed',
    }),
  ])

  writeFileSync(damaged, `${readFileSync(damaged, 'utf8')}{not json}\n`, 'utf8')

  const operatorRoot = createTestTempDirectory('watch-audit-operator-')
  const report = runWatchAudit(
    operatorRoot,
    auditOptions(operatorRoot, [
      installation.root,
      path.join(operatorRoot, 'missing-root'),
    ]),
  )

  assert.equal(report.complete, false, 'a partial audit is never complete')
  assert.ok(
    report.errors.some((error) => error.path.endsWith('missing-root')),
    'the inaccessible root is named',
  )
  assert.ok(
    report.errors.some((error) => error.path.endsWith('inv-c2-watch.jsonl')),
    'the unparseable ledger line is named',
  )
  // The readable input is still reported.
  assert.ok(
    report.sessions.some((session) => session.invocation_id === 'inv-c1'),
  )
})

test('AC-004: cadence window', () => {
  const installation = makeInstallation('watch-audit-cadence-')

  // The clean fixture: a directed 300-second session with its authority.
  installation.writeLedger('run-d1', 'inv-d1', [
    entry('run-d1', 'inv-d1', 'session_started', '2026-09-22T10:00:00.000Z', {
      watch_session_id: 'sess-directed',
      cadence_seconds: 300,
      cadence_authority: 'operator directed 300s',
    }),
    entry('run-d1', 'inv-d1', 'armed', '2026-09-22T10:00:01.000Z', {
      wake: 1,
      watch_session_id: 'sess-directed',
      cadence_seconds: 300,
      cadence_authority: 'operator directed 300s',
    }),
    entry('run-d1', 'inv-d1', 'wake', '2026-09-22T10:05:01.000Z', {
      wake: 1,
      watch_session_id: 'sess-directed',
      cadence_seconds: 300,
      terminal_state: 'completed',
      terminal_basis: 'agent_state',
    }),
  ])

  // The offending control: a 300-second session with no authority.
  installation.writeLedger('run-d2', 'inv-d2', [
    entry('run-d2', 'inv-d2', 'armed', '2026-09-22T11:00:00.000Z', {
      wake: 1,
      cadence_seconds: 300,
    }),
    entry('run-d2', 'inv-d2', 'wake', '2026-09-22T11:05:00.000Z', {
      wake: 1,
      cadence_seconds: 300,
      terminal_state: 'completed',
    }),
  ])

  const operatorRoot = createTestTempDirectory('watch-audit-operator-')
  const report = runWatchAudit(
    operatorRoot,
    auditOptions(operatorRoot, [installation.root]),
  )

  const unexplained = report.cadence_exceptions.filter(
    (exception) => !exception.explained,
  )

  assert.equal(report.cadence_exceptions.length, 2)
  assert.equal(unexplained.length, 1, 'the control is explicitly found')
  assert.equal(unexplained[0]?.invocation_id, 'inv-d2')
  assert.equal(unexplained[0]?.cadence_seconds, 300)
  assert.equal(
    report.cadence_exceptions.find((exception) => exception.explained)
      ?.authority,
    'operator directed 300s',
    'the clean fixture carries its authority',
  )

  // A window with no new-format sessions names its limitation rather than
  // proving adoption from an empty sample.
  const empty = makeInstallation('watch-audit-empty-')
  const emptyReport = runWatchAudit(
    operatorRoot,
    auditOptions(
      operatorRoot,
      [empty.root],
      'runtime/logs/watch-audit/empty.json',
    ),
  )

  assert.equal(emptyReport.sessions.length, 0)
  assert.ok(
    emptyReport.limitations.some((limitation) => /empty/u.test(limitation)),
    'the no-sample limitation is named',
  )
  // Nothing was collected, so the cutoff is when the audit ran, or the window
  // end when that came first — never a window end still in the future.
  assert.equal(
    emptyReport.collection_cutoff,
    new Date(
      Math.min(Date.parse(WINDOW.to), Date.parse(emptyReport.generated_at)),
    ).toISOString(),
  )
})

test('AC-022: a recorded gap is counted once', () => {
  const installation = makeInstallation('watch-audit-recorded-gap-')

  // A new-format ledger: an orphaned session, the gap its successor
  // recorded, and the successor session.
  installation.writeLedger('run-e1', 'inv-e1', [
    entry('run-e1', 'inv-e1', 'session_started', '2026-09-22T10:00:00.000Z', {
      watch_session_id: 'sess-orphan',
    }),
    entry('run-e1', 'inv-e1', 'armed', '2026-09-22T10:00:01.000Z', {
      wake: 1,
      watch_session_id: 'sess-orphan',
    }),
    entry('run-e1', 'inv-e1', 'gap', '2026-09-22T10:10:00.000Z', {
      gap: {
        from: '2026-09-22T10:00:01.000Z',
        to: '2026-09-22T10:10:00.000Z',
        seconds: 599,
        overdue_seconds: 539,
        reason: 'orphan_session',
        source: 'ledger',
        key: 'gap:2026-09-22T10:00:01.000Z:orphan_session',
      },
    }),
    entry('run-e1', 'inv-e1', 'session_started', '2026-09-22T10:10:00.000Z', {
      watch_session_id: 'sess-next',
    }),
    entry('run-e1', 'inv-e1', 'wake', '2026-09-22T10:10:00.000Z', {
      watch_session_id: 'sess-next',
      terminal_state: 'completed',
      terminal_basis: 'agent_state',
    }),
  ])

  const operatorRoot = createTestTempDirectory('watch-audit-operator-')
  const report = runWatchAudit(
    operatorRoot,
    auditOptions(operatorRoot, [installation.root]),
  )

  assert.equal(report.sessions.length, 2)
  assert.equal(report.gaps.length, 1, 'the recorded gap is not re-derived')
  assert.equal(report.gaps[0]?.qualification, 'orphan_session')
  assert.equal(report.gaps[0]?.seconds, 599)
})

test('AC-022: cohort gap replay', () => {
  const installation = makeInstallation('watch-audit-gap-')

  // The intake's shape: a wake at 03:19:16Z, then an arming at 03:20:30Z.
  // The ordinal continues, so only the timing separates the two sessions.
  installation.writeLedger(
    '63288_Sep-21-1255_chunk',
    '03_implement-1_d7d9de1b',
    [
      entry(
        '63288_Sep-21-1255_chunk',
        '03_implement-1_d7d9de1b',
        'armed',
        '2026-09-21T03:18:16.000Z',
        { wake: 2 },
      ),
      entry(
        '63288_Sep-21-1255_chunk',
        '03_implement-1_d7d9de1b',
        'wake',
        '2026-09-21T03:19:16.000Z',
        { wake: 2 },
      ),
      entry(
        '63288_Sep-21-1255_chunk',
        '03_implement-1_d7d9de1b',
        'armed',
        '2026-09-21T03:20:30.000Z',
        { wake: 3 },
      ),
      entry(
        '63288_Sep-21-1255_chunk',
        '03_implement-1_d7d9de1b',
        'wake',
        '2026-09-21T03:21:30.000Z',
        { wake: 3, terminal_state: 'completed' },
      ),
    ],
  )

  const ledger = path.join(
    installation.root,
    'runtime',
    'logs',
    'workflows',
    '63288_Sep-21-1255_chunk',
    'agent',
    'evidence',
    '03_implement-1_d7d9de1b-watch.jsonl',
  )
  const before = readFileSync(ledger, 'utf8')
  const operatorRoot = createTestTempDirectory('watch-audit-operator-')
  const report = runWatchAudit(
    operatorRoot,
    auditOptions(operatorRoot, [installation.root]),
  )

  assert.equal(report.gaps.length, 1, 'exactly one gap is reported')

  const gap = report.gaps[0]

  assert.equal(gap?.from, '2026-09-21T03:19:16.000Z')
  assert.equal(gap?.to, '2026-09-21T03:20:30.000Z')
  assert.equal(gap?.seconds, 74)
  assert.equal(gap?.overdue_seconds, 14)
  assert.equal(gap?.qualification, 'legacy_unclassified')

  // Two sessions are segmented, and no wake is invented between them.
  assert.equal(report.sessions.length, 2)
  assert.equal(
    readFileSync(ledger, 'utf8'),
    before,
    'the historical ledger is untouched',
  )
})
