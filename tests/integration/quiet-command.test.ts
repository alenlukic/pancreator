import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

const QUIET_RUNNER = path.join(process.cwd(), 'bin', 'run-quiet')
const PAN_RUN = path.join(process.cwd(), 'bin', 'pan-run')
const PROCESS_TIMEOUT_MS = 30_000
const PROCESS_MAX_BUFFER = 4 * 1024 * 1024

function quietEnvironment(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PANCREATOR_ROOT: root }

  // The tested wrapper owns its record, formatting, and progress descriptor.
  for (const name of Object.keys(env)) {
    if (
      name.startsWith('PAN_RUN_') ||
      name === 'PAN_VERBOSE' ||
      name === 'PAN_PROGRESS_FD'
    ) {
      delete env[name]
    }
  }

  return env
}

function runQuiet(
  source: string,
  options: {
    verbose?: boolean
    /** Open fd 3 as PAN_PROGRESS_FD with this heartbeat cadence. */
    progressSeconds?: string
    nested?: boolean
  } = {},
): SpawnSyncReturns<string> & { root: string; progress: string } {
  const root = createTestTempDirectory('run-quiet-')
  const env = quietEnvironment(root)

  if (options.verbose) {
    env.PAN_VERBOSE = '1'
  }

  if (options.progressSeconds !== undefined) {
    env.PAN_PROGRESS_FD = '3'
    env.PAN_RUN_HEARTBEAT_SECONDS = options.progressSeconds
  }

  const command = ['--', process.execPath, '-e', source]
  const result = spawnSync(
    QUIET_RUNNER,
    options.nested ? ['--', QUIET_RUNNER, ...command] : command,
    {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
      timeout: PROCESS_TIMEOUT_MS,
      maxBuffer: PROCESS_MAX_BUFFER,
    },
  )

  return Object.assign(result, {
    root,
    progress: String(result.output[3] ?? ''),
  })
}

function recordDirectories(root: string): string[] {
  const dir = path.join(root, 'runtime', 'logs', 'shell')

  return existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(dir, entry.name))
        .sort()
    : []
}

/** AC-17: every mode leaves the log, the heartbeat file, and the exit record. */
function assertRecordFiles(root: string, exitCode: number): void {
  const [dir] = recordDirectories(root)

  assert.ok(dir, 'a shell record directory must exist')

  for (const file of ['output.log', 'heartbeat.json', 'record.json']) {
    assert.ok(existsSync(path.join(dir, file)), `${file} must exist`)
  }

  const record = JSON.parse(
    readFileSync(path.join(dir, 'record.json'), 'utf8'),
  ) as { exit_code: unknown; label: unknown }

  assert.equal(record.exit_code, exitCode)
  assert.equal(record.label, path.basename(process.execPath))
}

test('quiet command suppresses successful stdout and stderr', () => {
  const result = runQuiet(
    "process.stdout.write('ordinary output\\n'); process.stderr.write('warning output\\n')",
  )

  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
  assertRecordFiles(result.root, 0)

  const [dir] = recordDirectories(result.root)

  assert.ok(dir, 'a shell record directory must exist')
  assert.equal(
    existsSync(path.join(dir, 'stdout.log')),
    false,
    'a successful quiet run removes the duplicate stdout capture',
  )
  assert.equal(
    existsSync(path.join(dir, 'stderr.log')),
    false,
    'a successful quiet run removes the duplicate stderr capture',
  )
})

test('quiet command preserves captured output when the command fails', () => {
  const result = runQuiet(
    "process.stdout.write('context\\n'); process.stderr.write('failure\\n'); process.exit(7)",
  )

  assert.equal(result.status, 7)
  assert.equal(result.stdout, 'context\n', 'captured stdout replays on stdout')
  assert.equal(result.stderr, 'failure\n', 'captured stderr replays on stderr')
  assertRecordFiles(result.root, 7)

  const [dir] = recordDirectories(result.root)

  assert.equal(readFileSync(path.join(dir, 'stdout.log'), 'utf8'), 'context\n')
  assert.equal(readFileSync(path.join(dir, 'stderr.log'), 'utf8'), 'failure\n')
})

test('quiet command streams successful output in verbose mode', () => {
  const result = runQuiet("process.stdout.write('visible\\n')", {
    verbose: true,
  })

  assert.equal(result.status, 0)
  assert.equal(result.stdout, 'visible\n')
  assert.ok(result.stderr.length > 0, 'streaming mode prints the start line')
  assert.ok(
    result.stderr
      .split('\n')
      .filter(Boolean)
      .every((line) => line.startsWith('[pan-run] ')),
    `stderr holds only wrapper lines: ${result.stderr}`,
  )
  assertRecordFiles(result.root, 0)
})

// OUTPUT-001 cites this name. Quiet progress sends new output once and emits
// compact heartbeats between updates, only to the opted-in PAN_PROGRESS_FD sink.
test('progress ticks mark intervals in which the command produced output', () => {
  const result = runQuiet(
    "process.stdout.write('first\\n'); setTimeout(() => process.stdout.write('second\\n'), 1500); setTimeout(() => {}, 3000)",
    { progressSeconds: '1' },
  )

  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
  assert.match(result.progress, /^── Command ──\n\n/u)
  assert.match(result.progress, /^♥ \d{2,}:\d{2}$/mu)
  assert.deepEqual(
    result.progress
      .split('\n')
      .filter((line) => line === '  first' || line === '  second'),
    ['  first', '  second'],
  )
  assert.doesNotMatch(result.progress, /\[pan-run\]/u)
  assertRecordFiles(result.root, 0)
})

test('AC-11: quiet mode forwards captured heartbeat lines to the progress sink', () => {
  const result = runQuiet(
    "process.stdout.write('# heartbeat 1s: 0 passed, 0 failed, 0 files done\\n')",
    { progressSeconds: '30' },
  )

  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  assert.match(
    result.progress,
    /# heartbeat 1s: 0 passed, 0 failed, 0 files done/u,
  )
})

test('AC-11: quiet mode with no progress sink copies heartbeat lines to stderr as they arrive', async () => {
  const root = createTestTempDirectory('pan-run-quiet-no-sink-')
  const seen = path.join(root, 'heartbeat-seen')
  const env = quietEnvironment(root)
  env.PAN_REVIEW_TOKEN = 'fake-heartbeat-value-123'
  // The command finishes only after the test saw its heartbeat on stderr, so
  // a copy made at exit instead of on arrival fails the run.
  const source = [
    "const fs = require('node:fs')",
    "process.stdout.write('captured line\\n# heartbeat 1s: 2 passed, 0 failed, 1 files done ' + process.env.PAN_REVIEW_TOKEN + '\\n')",
    'const deadline = Date.now() + 20000',
    'const poll = setInterval(() => {',
    `  if (fs.existsSync(${JSON.stringify(seen)})) { clearInterval(poll); process.stdout.write('after\\n') }`,
    '  else if (Date.now() > deadline) { clearInterval(poll); process.exit(9) }',
    '}, 25)',
  ].join('\n')
  const child = spawn(
    PAN_RUN,
    ['--quiet', '--', process.execPath, '-e', source],
    {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let stdout = ''
  let stderr = ''

  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk))
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk

    if (stderr.includes('# heartbeat ')) {
      writeFileSync(seen, '')
    }
  })

  const guard = setTimeout(() => child.kill('SIGKILL'), PROCESS_TIMEOUT_MS)
  const [status] = (await once(child, 'close')) as [number | null]
  clearTimeout(guard)

  assert.equal(status, 0, stderr)
  assert.equal(stdout, '')
  assert.equal(
    stderr,
    '# heartbeat 1s: 2 passed, 0 failed, 1 files done [REDACTED:PAN_REVIEW_TOKEN]\n',
  )
})

test('a nested quiet wrapper beats to the sink the outer wrapper exported', () => {
  const result = runQuiet(
    "process.stdout.write('inner\\n'); setTimeout(() => {}, 2500)",
    { progressSeconds: '1', nested: true },
  )

  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
  assert.match(result.progress, /^ {2}inner$/mu)
  assert.match(result.progress, /^♥ \d{2,}:\d{2}$/mu)
  assert.equal(result.progress.match(/^── Command ──$/gmu)?.length, 1)

  const directories = recordDirectories(result.root)
  const records = directories.map((directory) => ({
    directory,
    record: JSON.parse(
      readFileSync(path.join(directory, 'record.json'), 'utf8'),
    ) as { label: string; parent_record: string; exit_code: number },
  }))
  const outer = records.find(({ record }) => record.label === 'run-quiet')
  const inner = records.find(
    ({ record }) => record.label === path.basename(process.execPath),
  )

  assert.equal(records.length, 2)
  assert.ok(outer)
  assert.ok(inner)
  assert.equal(outer.record.exit_code, 0)
  assert.equal(inner.record.exit_code, 0)
  assert.equal(
    inner.record.parent_record,
    path.relative(result.root, outer.directory),
  )
  assert.equal(
    readFileSync(path.join(outer.directory, 'output.log'), 'utf8'),
    '',
    'inner progress bypasses the outer capture and reaches its sink directly',
  )
  assert.equal(
    readFileSync(path.join(inner.directory, 'output.log'), 'utf8'),
    'inner\n',
  )
})
