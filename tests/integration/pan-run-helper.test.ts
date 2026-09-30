// Drives the Node helper `bin/pan-run` embeds (the heredoc between
// `HELPER_JS_EOF` markers) directly against fixture directories, so the
// compaction and heartbeat logic is tested deterministically without waiting
// on real wall-clock cadence or process lifetimes.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { isRecord } from '../../src/lib/io.js'
import { createTestTempDirectory } from '../temp.js'

const PAN_RUN_SOURCE = readFileSync(
  path.join(process.cwd(), 'bin', 'pan-run'),
  'utf8',
)
const HEREDOC_START = 'cat >"$HELPER" <<\'HELPER_JS_EOF\'\n'
const HEREDOC_END = '\nHELPER_JS_EOF'

function extractHelperSource(): string {
  const start = PAN_RUN_SOURCE.indexOf(HEREDOC_START)

  assert.ok(start !== -1, 'bin/pan-run must define the embedded helper heredoc')

  const bodyStart = start + HEREDOC_START.length
  const end = PAN_RUN_SOURCE.indexOf(HEREDOC_END, bodyStart)

  assert.ok(end !== -1, 'the embedded helper heredoc must be closed')

  return PAN_RUN_SOURCE.slice(bodyStart, end)
}

function writeHelper(root: string): string {
  const helperPath = path.join(root, 'helper.cjs')

  writeFileSync(helperPath, extractHelperSource())

  return helperPath
}

function runHelper(
  helperPath: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
): { stdout: string; status: number } {
  try {
    const stdout = execFileSync('node', [helperPath, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    })

    return { stdout, status: 0 }
  } catch (error) {
    const err = error as { stdout?: string; status?: number }

    return { stdout: err.stdout ?? '', status: err.status ?? 1 }
  }
}

/** Directory-name timestamp `hoursAgo` in the past, in pan-run's format. */
function stamp(hoursAgo: number): string {
  const iso = new Date(Date.now() - hoursAgo * 3_600_000).toISOString()

  return iso.replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
}

interface FixtureOptions {
  record?: Record<string, unknown> | null
  marker?: boolean
}

function seedRecord(
  shellDir: string,
  name: string,
  options: FixtureOptions = {},
): string {
  const dir = path.join(shellDir, name)

  mkdirSync(dir, { recursive: true })
  if (options.record !== undefined && options.record !== null) {
    writeFileSync(path.join(dir, 'record.json'), JSON.stringify(options.record))
  }
  writeFileSync(path.join(dir, 'heartbeat.json'), '{}')
  writeFileSync(path.join(dir, 'output.log'), '')
  if (options.marker) {
    writeFileSync(path.join(dir, '.pan-run.cjs'), '')
  }

  return dir
}

function finishedRecord(
  endedAt: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: 1,
    label: 'fixture',
    command: ['echo', 'x'],
    cwd: '/tmp',
    pid: 1,
    wrapper_pid: 999_999,
    started_at: endedAt,
    ended_at: endedAt,
    exit_code: 0,
    signal: null,
    log_path: 'x',
    heartbeat_path: 'y',
    heartbeat_seconds: 30,
    ...overrides,
  }
}

function runningRecord(pid: number): Record<string, unknown> {
  return {
    schema_version: 1,
    label: 'fixture',
    command: ['sleep', '999'],
    cwd: '/tmp',
    pid,
    wrapper_pid: pid,
    started_at: new Date().toISOString(),
    ended_at: null,
    exit_code: null,
    signal: null,
    log_path: 'x',
    heartbeat_path: 'y',
    heartbeat_seconds: 30,
  }
}

function compact(
  helperPath: string,
  shellDir: string,
  env: NodeJS.ProcessEnv = {},
): Record<string, unknown> {
  const result = runHelper(helperPath, ['compact', shellDir], env)

  assert.equal(result.status, 0, `compact must exit 0: ${result.stdout}`)

  const parsed = JSON.parse(result.stdout) as unknown

  assert.ok(isRecord(parsed), 'compact must print a JSON object')

  return parsed
}

test('compactShellLogs removes a finished record past the age bound', () => {
  const root = createTestTempDirectory('pan-run-helper-age-')
  const shellDir = path.join(root, 'runtime', 'logs', 'shell')
  const helper = writeHelper(root)
  const oldName = `${stamp(30)}-old-aaaaaaaa`
  const oldDir = seedRecord(shellDir, oldName, {
    record: finishedRecord(new Date(Date.now() - 30 * 3_600_000).toISOString()),
  })

  const result = compact(helper, shellDir)

  assert.equal(result.removed, 1)
  assert.equal(existsSync(oldDir), false, 'the old finished record is removed')
})

test('compactShellLogs keeps a record whose name is old but which finished within the grace window', () => {
  const root = createTestTempDirectory('pan-run-helper-grace-')
  const shellDir = path.join(root, 'runtime', 'logs', 'shell')
  const helper = writeHelper(root)
  // A genuinely long-running command: its directory name is far in the
  // past, but it only just finished, so the grace window still protects it.
  const oldName = `${stamp(30)}-longrun-bbbbbbbb`
  const dir = seedRecord(shellDir, oldName, {
    record: finishedRecord(new Date().toISOString()),
  })

  const result = compact(helper, shellDir)

  assert.equal(result.kept_grace, 1)
  assert.equal(result.removed, 0)
  assert.equal(
    existsSync(dir),
    true,
    'a record inside the grace window survives',
  )
})

test('compactShellLogs never removes a record whose wrapper is still alive', () => {
  const root = createTestTempDirectory('pan-run-helper-running-')
  const shellDir = path.join(root, 'runtime', 'logs', 'shell')
  const helper = writeHelper(root)
  const oldName = `${stamp(30)}-running-cccccccc`
  const dir = seedRecord(shellDir, oldName, {
    record: runningRecord(process.pid),
  })

  const result = compact(helper, shellDir)

  assert.equal(result.kept_running, 1)
  assert.equal(result.removed, 0)
  assert.equal(existsSync(dir), true, 'a running record is never removed')
})

test('compactShellLogs keeps an unreadable record with the helper marker present', () => {
  const root = createTestTempDirectory('pan-run-helper-marker-')
  const shellDir = path.join(root, 'runtime', 'logs', 'shell')
  const helper = writeHelper(root)
  const oldName = `${stamp(30)}-nomanifest-dddddddd`
  const dir = seedRecord(shellDir, oldName, { record: null, marker: true })

  const result = compact(helper, shellDir)

  assert.equal(result.removed, 0)
  assert.equal(
    existsSync(dir),
    true,
    'a record with no record.json but a live marker is kept',
  )
})

test('compactShellLogs removes an old record with no record.json and no marker', () => {
  const root = createTestTempDirectory('pan-run-helper-orphan-')
  const shellDir = path.join(root, 'runtime', 'logs', 'shell')
  const helper = writeHelper(root)
  const oldName = `${stamp(30)}-orphan-eeeeeeee`
  const dir = seedRecord(shellDir, oldName, { record: null })

  const result = compact(helper, shellDir)

  assert.equal(result.removed, 1)
  assert.equal(existsSync(dir), false)
})

test('PAN_RUN_KEEP_RECORDS keeps only the newest N finished records', () => {
  const root = createTestTempDirectory('pan-run-helper-count-')
  const shellDir = path.join(root, 'runtime', 'logs', 'shell')
  const helper = writeHelper(root)
  // All three are well within the default 24-hour age bound and well past
  // the 10-minute grace, so only the count bound decides their fate.
  const oldest = seedRecord(shellDir, `${stamp(3)}-a-11111111`, {
    record: finishedRecord(
      new Date(Date.now() - 3 * 3_600_000 + 60_000).toISOString(),
    ),
  })
  const middle = seedRecord(shellDir, `${stamp(2)}-b-22222222`, {
    record: finishedRecord(
      new Date(Date.now() - 2 * 3_600_000 + 60_000).toISOString(),
    ),
  })
  const newest = seedRecord(shellDir, `${stamp(1)}-c-33333333`, {
    record: finishedRecord(
      new Date(Date.now() - 1 * 3_600_000 + 60_000).toISOString(),
    ),
  })

  const result = compact(helper, shellDir, { PAN_RUN_KEEP_RECORDS: '2' })

  assert.equal(result.removed, 1)
  assert.equal(existsSync(oldest), false, 'the oldest of three is dropped')
  assert.equal(existsSync(middle), true)
  assert.equal(existsSync(newest), true)
})

test('PAN_RUN_KEEP_HOURS=0 disables compaction', () => {
  const root = createTestTempDirectory('pan-run-helper-disabled-')
  const shellDir = path.join(root, 'runtime', 'logs', 'shell')
  const helper = writeHelper(root)
  const dir = seedRecord(shellDir, `${stamp(1000)}-ancient-ffffffff`, {
    record: finishedRecord(
      new Date(Date.now() - 1000 * 3_600_000).toISOString(),
    ),
  })

  const result = compact(helper, shellDir, { PAN_RUN_KEEP_HOURS: '0' })

  assert.equal(result.skipped, true)
  assert.equal(existsSync(dir), true, 'nothing is removed while disabled')
})

test('PAN_RUN_KEEP_RECORDS=0 also disables compaction', () => {
  const root = createTestTempDirectory('pan-run-helper-disabled-count-')
  const shellDir = path.join(root, 'runtime', 'logs', 'shell')
  const helper = writeHelper(root)
  const dir = seedRecord(shellDir, `${stamp(1000)}-ancient-00000001`, {
    record: finishedRecord(
      new Date(Date.now() - 1000 * 3_600_000).toISOString(),
    ),
  })

  const result = compact(helper, shellDir, { PAN_RUN_KEEP_RECORDS: '0' })

  assert.equal(result.skipped, true)
  assert.equal(existsSync(dir), true)
})

test('compactShellLogs leaves non-record entries untouched', () => {
  const root = createTestTempDirectory('pan-run-helper-stray-')
  const shellDir = path.join(root, 'runtime', 'logs', 'shell')
  const helper = writeHelper(root)

  mkdirSync(path.join(shellDir, 'archive'), { recursive: true })
  mkdirSync(path.join(shellDir, 'qa-dead-arm-noexit'), { recursive: true })
  writeFileSync(path.join(shellDir, 'ship-prepare-x.json'), '{}')
  writeFileSync(path.join(shellDir, '.pan-run-abc123.cjs'), '// leftover')

  compact(helper, shellDir)

  assert.deepEqual(
    readdirSync(shellDir).sort(),
    [
      '.pan-run-abc123.cjs',
      'archive',
      'qa-dead-arm-noexit',
      'ship-prepare-x.json',
    ],
    'only timestamp-named record directories are compaction candidates',
  )
})

test('a held lock skips compaction; a stale lock is reclaimed', () => {
  const root = createTestTempDirectory('pan-run-helper-lock-')
  const shellDir = path.join(root, 'runtime', 'logs', 'shell')
  const logsDir = path.dirname(shellDir)
  const helper = writeHelper(root)
  const oldDir = seedRecord(shellDir, `${stamp(30)}-locked-99999999`, {
    record: finishedRecord(new Date(Date.now() - 30 * 3_600_000).toISOString()),
  })
  const lockDir = path.join(logsDir, '.shell-compact.lock')

  mkdirSync(lockDir, { recursive: true })

  const lockedResult = compact(helper, shellDir)

  assert.equal(lockedResult.locked, true)
  assert.equal(existsSync(oldDir), true, 'a fresh lock blocks compaction')

  // Back-date the lock past the stale bound (60s) so the next call reclaims it.
  const staleMs = Date.now() - 120_000

  utimesSync(lockDir, staleMs / 1000, staleMs / 1000)

  const reclaimedResult = compact(helper, shellDir)

  assert.equal(reclaimedResult.locked, false)
  assert.equal(reclaimedResult.removed, 1)
  assert.equal(
    existsSync(oldDir),
    false,
    'a stale lock is reclaimed and compaction proceeds',
  )
  assert.equal(existsSync(lockDir), false, 'the lock is released after use')
})

test('compaction removes at most 50 records in one run', () => {
  const root = createTestTempDirectory('pan-run-helper-cap-')
  const shellDir = path.join(root, 'runtime', 'logs', 'shell')
  const helper = writeHelper(root)
  const dirs: string[] = []

  for (let i = 0; i < 60; i += 1) {
    const name = `${stamp(30)}-cap${String(i).padStart(2, '0')}-${i.toString(16).padStart(8, '0')}`

    dirs.push(
      seedRecord(shellDir, name, {
        record: finishedRecord(
          new Date(Date.now() - 30 * 3_600_000).toISOString(),
        ),
      }),
    )
  }

  const result = compact(helper, shellDir)

  assert.equal(result.removed, 50, 'removal is capped at 50 per run')
  const remaining = dirs.filter((dir) => existsSync(dir))

  assert.equal(remaining.length, 10)
})

test('beat prints growth with an indented tail, then silence once output stops changing', () => {
  const root = createTestTempDirectory('pan-run-helper-beat-')
  const shellDir = path.join(root, 'runtime', 'logs', 'shell')
  const helper = writeHelper(root)
  const name = `${stamp(0)}-beattest-12345678`
  const dir = seedRecord(shellDir, name, {
    record: {
      schema_version: 1,
      label: 'beattest',
      command: ['echo', 'x'],
      cwd: '/tmp',
      pid: 4242,
      wrapper_pid: process.pid,
      started_at: new Date(Date.now() - 5000).toISOString(),
      ended_at: null,
      exit_code: null,
      signal: null,
      log_path: 'x',
      heartbeat_path: 'y',
      heartbeat_seconds: 1,
    },
  })
  const beatEnv = {
    PAN_RUN_RECORD_DIR: dir,
    PAN_RUN_LABEL: 'beattest',
    PAN_RUN_PID: '4242',
  }

  writeFileSync(path.join(dir, 'output.log'), 'line1\n')

  const first = runHelper(helper, ['beat'], beatEnv)

  assert.equal(first.status, 0)
  assert.match(
    first.stdout,
    /^\[pan-run\] beattest running \d+s pid=4242 \+6B\n {2}line1\n$/u,
  )

  const hbAfterFirst = JSON.parse(
    readFileSync(path.join(dir, 'heartbeat.json'), 'utf8'),
  ) as Record<string, unknown>

  assert.equal(hbAfterFirst.log_bytes, 6)
  assert.equal(hbAfterFirst.last_beat_bytes, 0)
  assert.deepEqual(hbAfterFirst.recent_lines, ['line1'])
  assert.equal(typeof hbAfterFirst.beat_at, 'string')

  // No growth since the first beat: the second beat must report silence,
  // never repeat the stale tail as if it were new output.
  const second = runHelper(helper, ['beat'], beatEnv)

  assert.equal(second.status, 0)
  assert.match(
    second.stdout,
    /^\[pan-run\] beattest running \d+s pid=4242 no new output for \d+s \(last: line1\)\n$/u,
  )

  const hbAfterSecond = JSON.parse(
    readFileSync(path.join(dir, 'heartbeat.json'), 'utf8'),
  ) as Record<string, unknown>

  assert.equal(hbAfterSecond.last_beat_bytes, 6)
})

test('beat reports "no output yet" for an empty log', () => {
  const root = createTestTempDirectory('pan-run-helper-beat-empty-')
  const shellDir = path.join(root, 'runtime', 'logs', 'shell')
  const helper = writeHelper(root)
  const name = `${stamp(0)}-empty-87654321`
  const dir = seedRecord(shellDir, name, {
    record: {
      schema_version: 1,
      label: 'empty',
      command: ['sleep', '5'],
      cwd: '/tmp',
      pid: 4343,
      wrapper_pid: process.pid,
      started_at: new Date().toISOString(),
      ended_at: null,
      exit_code: null,
      signal: null,
      log_path: 'x',
      heartbeat_path: 'y',
      heartbeat_seconds: 1,
    },
  })

  const result = runHelper(helper, ['beat'], {
    PAN_RUN_RECORD_DIR: dir,
    PAN_RUN_LABEL: 'empty',
    PAN_RUN_PID: '4343',
  })

  assert.equal(result.status, 0)
  assert.match(
    result.stdout,
    /^\[pan-run\] empty running \d+s pid=4343 no output yet\n$/u,
  )
})
