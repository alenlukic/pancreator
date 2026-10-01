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

function runQuiet(
  source: string,
  options: {
    verbose?: boolean
    /** Open fd 3 as PAN_PROGRESS_FD with this heartbeat cadence. */
    progressSeconds?: string
    nested?: boolean
  } = {},
): SpawnSyncReturns<string> & { root: string; progress: string } {
  // An inherited operator diagnostic would change the output and fail these
  // cases.
  const env = { ...process.env }
  delete env.PAN_VERBOSE
  delete env.PAN_RUN_HEARTBEAT_SECONDS
  // An interactive `npm test` exports its own progress sink, which would take
  // the heartbeat lines this file captures.
  delete env.PAN_PROGRESS_FD

  const root = createTestTempDirectory('run-quiet-')
  env.PANCREATOR_ROOT = root

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
    ? readdirSync(dir)
        .sort()
        .map((name) => path.join(dir, name))
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

// OUTPUT-001 cites this name. Each heartbeat line carries the latest output,
// so a line that stops changing exposes a silent command, and the lines reach
// only the opted-in PAN_PROGRESS_FD sink.
test('progress ticks mark intervals in which the command produced output', () => {
  const result = runQuiet(
    "process.stdout.write('first\\n'); setTimeout(() => process.stdout.write('second\\n'), 1500); setTimeout(() => {}, 3000)",
    { progressSeconds: '1' },
  )

  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
  assert.match(
    result.progress,
    /\[pan-run\] \S+ started pid=\d+; watch with \.\/bin\/pan watch --shell runtime\/logs\/shell\/\S+\n/u,
  )
  assert.match(
    result.progress,
    /\[pan-run\] node running \d+s pid=\d+ \+\d+B\n {2}first\n/u,
  )
  assert.match(result.progress, /\+\d+B\n(?: {2}first\n)? {2}second\n/u)
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
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PANCREATOR_ROOT: root,
    PAN_REVIEW_TOKEN: 'fake-heartbeat-value-123',
  }
  delete env.PAN_VERBOSE
  delete env.PAN_PROGRESS_FD
  delete env.PAN_RUN_HEARTBEAT_SECONDS
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
  assert.match(
    result.progress,
    /\[pan-run\] node running \d+s pid=\d+ (\+\d+B\n {2}inner|no new output for \d+s \(last: inner\))/u,
    'the inner wrapper reached the outer sink',
  )
  assert.match(result.progress, /\[pan-run\] run-quiet running /u)
})
