import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { isRecord } from '../../src/lib/io.js'
import { createTestTempDirectory } from '../temp.js'

const PAN_RUN = path.join(process.cwd(), 'bin', 'pan-run')
const PROCESS_TIMEOUT_MS = 30_000
const BANNER =
  /\[pan-run\] log: (\S+) observe: \.\/bin\/pan watch --process (\d+) --label \S+ --output \S+ --exit-record (\S+)/u

function runEnv(
  root: string,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }

  // Surrounding diagnostics would change the captured streams.
  delete env.PAN_VERBOSE
  delete env.PAN_PROGRESS_FD
  delete env.PAN_RUN_HEARTBEAT_SECONDS

  return { ...env, ...extra, PANCREATOR_ROOT: root }
}

function runPanRun(
  args: string[],
  options: { root: string; env?: NodeJS.ProcessEnv; input?: string },
) {
  return spawnSync(PAN_RUN, args, {
    encoding: 'utf8',
    env: runEnv(options.root, options.env),
    input: options.input,
    timeout: PROCESS_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  })
}

/** Read and parse a JSON file, returning null on any error. */
function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function findLatestLogDir(root: string): string | null {
  const shellLogsDir = path.join(root, 'runtime', 'logs', 'shell')

  if (!existsSync(shellLogsDir)) return null

  const dirs = readdirSync(shellLogsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()

  const last = dirs.at(-1)

  return last === undefined ? null : path.join(shellLogsDir, last)
}

function readRecord(root: string): Record<string, unknown> {
  const record = readJsonFile(
    path.join(findLatestLogDir(root) as string, 'record.json'),
  )

  assert.ok(isRecord(record), 'record.json must be a JSON object')

  return record
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Poll until the predicate holds or the deadline passes. */
async function waitFor(check: () => boolean, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs

  while (!check()) {
    if (Date.now() > deadline) throw new Error('waitFor deadline passed')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/** Start pan-run in streaming mode and resolve once its banner printed. */
async function startPanRun(root: string, args: string[]) {
  const child = spawn(PAN_RUN, args, {
    env: runEnv(root),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const streams = { stdout: '', stderr: '' }

  child.stdout.on('data', (chunk: Buffer) => (streams.stdout += chunk))
  child.stderr.on('data', (chunk: Buffer) => (streams.stderr += chunk))

  const closed = once(child, 'close') as Promise<[number | null, string]>
  // Hang guard only; each test proves its contract from records.
  const guard = setTimeout(() => child.kill('SIGKILL'), PROCESS_TIMEOUT_MS)

  closed.finally(() => clearTimeout(guard)).catch(() => undefined)
  await waitFor(() => BANNER.test(streams.stderr))

  const banner = BANNER.exec(streams.stderr) as RegExpExecArray

  return {
    child,
    streams,
    closed,
    logPath: path.join(root, banner[1]),
    pid: Number(banner[2]),
    recordPath: banner[3],
  }
}

// AC-13: record fields, streaming while running, exit code
test('AC-13: pan-run writes record.json, streams to output.log, exits with command code', async (t) => {
  await t.test('basic success case with -- form', () => {
    const root = createTestTempDirectory('pan-run-ac13-')
    const result = runPanRun(
      ['--label', 'test-ac13', '--', 'echo', 'hello world'],
      { root },
    )

    assert.equal(
      result.status,
      0,
      `pan-run should exit 0; stderr: ${result.stderr}`,
    )
    assert.equal(result.stdout, 'hello world\n')

    const logDir = findLatestLogDir(root)
    assert.ok(logDir, 'a shell log directory must exist')

    const record = readRecord(root)

    assert.equal(record.schema_version, 1, 'schema_version must be 1')
    assert.equal(record.label, 'test-ac13', 'label must match')
    assert.deepEqual(record.command, ['echo', 'hello world'])
    assert.equal(record.cwd, process.cwd())
    assert.ok(typeof record.pid === 'number', 'pid must be a number')
    assert.ok(typeof record.wrapper_pid === 'number')
    assert.ok(typeof record.started_at === 'string')
    assert.ok(typeof record.ended_at === 'string')
    assert.equal(record.exit_code, 0, 'exit_code must be 0')
    assert.equal(record.signal, null, 'signal must be null on clean exit')
    assert.equal(
      record.log_path,
      `${path.relative(root, logDir)}/output.log`,
      'log_path must name the harness-relative output.log',
    )
    assert.equal(
      record.heartbeat_path,
      `${path.relative(root, logDir)}/heartbeat.json`,
    )
    assert.equal(record.heartbeat_seconds, 30)
    assert.equal(
      readFileSync(path.join(logDir, 'output.log'), 'utf8'),
      'hello world\n',
    )
    assert.ok(
      isRecord(readJsonFile(path.join(logDir, 'heartbeat.json'))),
      'heartbeat.json holds a JSON object even for a short command',
    )
    assert.deepEqual(
      readdirSync(logDir).sort(),
      ['heartbeat.json', 'output.log', 'record.json'],
      'the record directory keeps no scratch files',
    )
  })

  await t.test('-c form runs through bash -c', () => {
    const root = createTestTempDirectory('pan-run-c-form-')
    const result = runPanRun(['-c', 'echo "shell string" | tr a-z A-Z'], {
      root,
    })

    assert.equal(result.status, 0)
    assert.equal(result.stdout, 'SHELL STRING\n')
    assert.deepEqual(readRecord(root).command, [
      'bash',
      '-c',
      'echo "shell string" | tr a-z A-Z',
    ])
  })

  await t.test('exit code is passed through', () => {
    const root = createTestTempDirectory('pan-run-exit-')
    const result = runPanRun(['--', 'bash', '-c', 'exit 7'], { root })

    assert.equal(result.status, 7, 'exit code must be 7')
    assert.equal(readRecord(root).exit_code, 7)
  })

  await t.test('stdout and stderr stay on their own streams', () => {
    const root = createTestTempDirectory('pan-run-streams-')
    const result = runPanRun(['-c', 'echo out; echo err >&2'], { root })

    assert.equal(result.stdout, 'out\n')
    assert.match(result.stderr, /^err$/mu)
    assert.doesNotMatch(result.stdout, /err/u)
  })

  await t.test('the command reads the wrapper stdin', () => {
    const root = createTestTempDirectory('pan-run-stdin-')
    const result = runPanRun(['--', 'cat'], { root, input: 'piped\n' })

    assert.equal(result.status, 0)
    assert.equal(result.stdout, 'piped\n')
  })

  await t.test('a closed stdin still runs the command', () => {
    const root = createTestTempDirectory('pan-run-closed-stdin-')
    const result = spawnSync('bash', ['-c', '"$0" -- echo ran <&-', PAN_RUN], {
      encoding: 'utf8',
      env: runEnv(root),
      timeout: PROCESS_TIMEOUT_MS,
    })

    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, 'ran\n')
    assert.equal(readRecord(root).exit_code, 0)
  })

  await t.test('output reaches output.log while the command runs', async () => {
    const root = createTestTempDirectory('pan-run-streaming-')
    const run = await startPanRun(root, [
      '--',
      'bash',
      '-c',
      'echo line1; sleep 2; echo line2',
    ])

    await waitFor(() => readFileSync(run.logPath, 'utf8').includes('line1'))

    assert.equal(
      run.child.exitCode,
      null,
      'line1 is in output.log before the command exits',
    )
    assert.ok(processAlive(run.pid), 'the wrapped command is still running')

    const [code] = await run.closed

    assert.equal(code, 0)
    assert.equal(readFileSync(run.logPath, 'utf8'), 'line1\nline2\n')
  })

  await t.test(
    'startup line on stderr names log path and observation command',
    () => {
      const root = createTestTempDirectory('pan-run-stderr-')
      const result = runPanRun(['--', 'echo', 'hi'], { root })
      const banner = BANNER.exec(result.stderr)

      assert.ok(banner, `stderr must carry the banner: ${result.stderr}`)
      assert.equal(
        result.stderr.split('\n').filter((line) => line.startsWith('[pan-run]'))
          .length,
        1,
        'the banner is one line',
      )
      assert.equal(Number(banner[2]), readRecord(root).pid)
      assert.equal(
        banner[3],
        `${banner[1].replace(/output\.log$/u, '')}record.json`,
      )
    },
  )

  await t.test(
    'both scripts are executable Bash files under bin/ without suffix',
    () => {
      for (const script of ['pan-run', 'run-quiet']) {
        const scriptPath = path.join(process.cwd(), 'bin', script)

        assert.ok(
          (statSync(scriptPath).mode & 0o111) !== 0,
          `bin/${script} must be executable`,
        )
        assert.match(
          readFileSync(scriptPath, 'utf8'),
          /^#!\/usr\/bin\/env bash\n/u,
          `bin/${script} must be a Bash script`,
        )
      }
    },
  )
})

test('AC-13: a signal to the wrapper stops the command and is recorded', async (t) => {
  for (const [signal, name, code] of [
    ['SIGTERM', 'TERM', 143],
    ['SIGINT', 'INT', 130],
  ] as const) {
    await t.test(`${signal} exits ${code} and records ${name}`, async () => {
      const root = createTestTempDirectory('pan-run-signal-')
      const run = await startPanRun(root, ['-c', 'sleep 30 | cat'])

      run.child.kill(signal)

      const [status] = await run.closed

      assert.equal(status, code)

      const record = readRecord(root)

      assert.equal(record.signal, name)
      assert.equal(record.exit_code, code)
      assert.equal(
        processAlive(run.pid),
        false,
        'the wrapped command is gone once the wrapper exits',
      )
    })
  }
})

test('the heartbeat never holds a piped parent after the command ends', () => {
  const root = createTestTempDirectory('pan-run-orphan-')
  // A parent collecting piped output waits for every copy of the pipe; the
  // guard fires only when a heartbeat sleep kept one open.
  const result = spawnSync(PAN_RUN, ['--', 'true'], {
    encoding: 'utf8',
    env: runEnv(root),
    timeout: 20_000,
  })

  assert.equal(result.error, undefined, 'the pipes closed with the wrapper')
  assert.equal(result.status, 0)
})

// AC-14: heartbeat cadence and clamp
test('AC-14: heartbeat updates heartbeat.json and clamps cadence above 60', async (t) => {
  await t.test(
    '1-second heartbeat updates at least twice in a 3-second command',
    () => {
      const root = createTestTempDirectory('pan-run-hb-')
      const result = runPanRun(
        ['--heartbeat-seconds', '1', '--', 'bash', '-c', 'echo start; sleep 3'],
        { root },
      )

      assert.equal(result.status, 0)

      const beats = result.stderr
        .split('\n')
        .filter((line) =>
          /^\[pan-run\] bash running \d+s pid=\d+ last: start$/u.test(line),
        )

      assert.ok(
        beats.length >= 2,
        `two heartbeat lines expected: ${result.stderr}`,
      )

      const hb = readJsonFile(
        path.join(findLatestLogDir(root)!, 'heartbeat.json'),
      )

      assert.ok(isRecord(hb), 'heartbeat.json must be a JSON object')
      assert.ok(
        typeof hb.elapsed_seconds === 'number' && hb.elapsed_seconds >= 2,
        `heartbeat elapsed_seconds must be ≥ 2; got ${hb.elapsed_seconds}`,
      )
      assert.equal(hb.log_bytes, 'start\n'.length)
      assert.deepEqual(hb.recent_lines, ['start'])
      assert.equal(typeof hb.last_output_at, 'string')
    },
  )

  await t.test('cadence above 60 is clamped to 60', () => {
    const root = createTestTempDirectory('pan-run-clamp-')
    const result = runPanRun(
      ['--heartbeat-seconds', '120', '--', 'echo', 'ok'],
      { root },
    )

    assert.equal(result.status, 0)
    assert.equal(readRecord(root).heartbeat_seconds, 60)
  })

  await t.test('PAN_RUN_HEARTBEAT_SECONDS lowers the cadence', () => {
    const root = createTestTempDirectory('pan-run-hb-env-')
    const result = runPanRun(['--', 'echo', 'ok'], {
      root,
      env: { PAN_RUN_HEARTBEAT_SECONDS: '45' },
    })

    assert.equal(result.status, 0)
    assert.equal(readRecord(root).heartbeat_seconds, 45)
  })
})

// AC-15: redaction
test('AC-15: secrets are redacted in output.log, heartbeat.json, record.json, and terminal output', async (t) => {
  await t.test('environment and root .env secrets never persist', () => {
    const root = createTestTempDirectory('pan-run-redact-')
    const envSecret = 'mysupersecretpassword1'
    const dotenvSecret = 'dotenv-only-secret-99'

    writeFileSync(path.join(root, '.env'), `MY_DOTENV_TOKEN=${dotenvSecret}\n`)

    const result = runPanRun(
      [
        '--heartbeat-seconds',
        '1',
        '--',
        'bash',
        '-c',
        `echo "values ${envSecret} ${dotenvSecret}"; echo "err ${envSecret}" >&2; sleep 1.5`,
        dotenvSecret,
      ],
      { root, env: { MY_API_KEY: envSecret } },
    )

    assert.equal(result.status, 0)

    const logDir = findLatestLogDir(root)!
    const surfaces = {
      stdout: result.stdout,
      stderr: result.stderr,
      'output.log': readFileSync(path.join(logDir, 'output.log'), 'utf8'),
      'heartbeat.json': readFileSync(
        path.join(logDir, 'heartbeat.json'),
        'utf8',
      ),
      'record.json': readFileSync(path.join(logDir, 'record.json'), 'utf8'),
    }

    for (const [surface, text] of Object.entries(surfaces)) {
      assert.ok(!text.includes(envSecret), `${surface} leaks the env secret`)
      assert.ok(
        !text.includes(dotenvSecret),
        `${surface} leaks the .env secret`,
      )
    }

    assert.match(
      surfaces.stdout,
      /values \[REDACTED:MY_API_KEY\] \[REDACTED:MY_DOTENV_TOKEN\]/u,
    )
    assert.match(surfaces['heartbeat.json'], /\[REDACTED:MY_API_KEY\]/u)
    assert.match(surfaces['record.json'], /\[REDACTED:MY_DOTENV_TOKEN\]/u)
  })

  await t.test('a secret split across an idle flush is still redacted', () => {
    const root = createTestTempDirectory('pan-run-split-redact-')
    const secretValue = 'abcdefghijklmnopq'

    runPanRun(
      [
        '--',
        'bash',
        '-c',
        // A whole secret, then a secret cut in two, each held past the
        // 500 ms idle flush before the line ends.
        `printf 'aaaa${secretValue}bb'; sleep 0.8; printf ' one\\n'; ` +
          `printf '0123456789012345678901234abcdefgh'; sleep 0.8; printf 'ijklmnopq two\\n'`,
      ],
      { root, env: { MY_TOKEN: secretValue } },
    )

    assert.equal(
      readFileSync(path.join(findLatestLogDir(root)!, 'output.log'), 'utf8'),
      'aaaa[REDACTED:MY_TOKEN]bb one\n0123456789012345678901234[REDACTED:MY_TOKEN] two\n',
    )
  })

  await t.test('a secret in a derived or explicit label never persists', () => {
    const root = createTestTempDirectory('pan-run-label-redact-')
    const secretValue = 'envfilesecret123'

    writeFileSync(path.join(root, '.env'), `MY_TOKEN=${secretValue}\n`)

    const assigned = runPanRun(['-c', `MY_TOKEN=${secretValue} true`], {
      root,
    })
    const explicit = runPanRun(['--label', `x${secretValue}`, '--', 'true'], {
      root,
    })

    assert.equal(assigned.status, 0)
    assert.equal(explicit.status, 0)

    const shellDir = path.join(root, 'runtime', 'logs', 'shell')
    const entries = readdirSync(shellDir, {
      recursive: true,
      withFileTypes: true,
    })
    const labels: unknown[] = []

    for (const entry of entries) {
      const entryPath = path.join(entry.parentPath, entry.name)

      assert.ok(!entryPath.includes(secretValue), `${entryPath} leaks`)
      if (!entry.isFile()) continue
      assert.ok(
        !readFileSync(entryPath, 'utf8').includes(secretValue),
        `${entryPath} content leaks`,
      )
      if (entry.name === 'record.json') {
        labels.push((readJsonFile(entryPath) as Record<string, unknown>).label)
      }
    }

    assert.deepEqual(labels.sort(), ['true', 'x[REDACTED:MY_TOKEN]'])
    for (const output of [assigned.stderr, explicit.stderr]) {
      assert.ok(!output.includes(secretValue), 'the banner leaks')
    }
  })

  await t.test('short values under 8 characters are not redacted', () => {
    const root = createTestTempDirectory('pan-run-short-secret-')
    const result = runPanRun(['--', 'bash', '-c', 'echo "short: abc123"'], {
      root,
      env: { MY_TOKEN: 'abc123' },
    })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /short: abc123/u)
  })
})

test('a linked worktree logs to its main worktree', () => {
  const main = createTestTempDirectory('pan-run-main-')
  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync(
      'git',
      [
        '-c',
        'user.name=fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'core.hooksPath=/dev/null',
        ...args,
      ],
      { cwd, encoding: 'utf8', timeout: PROCESS_TIMEOUT_MS },
    )

    assert.equal(result.status, 0, result.stderr)
  }

  mkdirSync(path.join(main, 'bin'))
  cpSync(PAN_RUN, path.join(main, 'bin', 'pan-run'))
  writeFileSync(path.join(main, 'config.json'), '{}\n')
  git(main, 'init', '-q')
  git(main, 'add', '-A')
  git(main, 'commit', '-q', '-m', 'fixture')

  const worktree = path.join(main, 'linked')

  git(main, 'worktree', 'add', '-q', worktree)

  const env = runEnv(main)

  delete env.PANCREATOR_ROOT

  const result = spawnSync(
    path.join(worktree, 'bin', 'pan-run'),
    ['--', 'echo', 'from-worktree'],
    { encoding: 'utf8', env, cwd: worktree, timeout: PROCESS_TIMEOUT_MS },
  )

  assert.equal(result.status, 0, result.stderr)
  assert.ok(findLatestLogDir(main), 'the log lands under the main worktree')
  assert.equal(
    existsSync(path.join(worktree, 'runtime')),
    false,
    'the linked worktree holds no shell log',
  )
})

/**
 * A `node` that kills itself when pan-run starts its `record-start` helper,
 * the way the field reports show the helper dying with signal 9. With
 * `onlyFirst` it kills the first attempt and runs later ones normally.
 */
function killingNodeShim(root: string, onlyFirst: boolean): NodeJS.ProcessEnv {
  const shimDirectory = path.join(root, 'shim')
  const firstMarker = path.join(root, 'first-attempt')

  mkdirSync(shimDirectory, { recursive: true })
  writeFileSync(
    path.join(shimDirectory, 'node'),
    [
      '#!/usr/bin/env bash',
      'if [[ "${2:-}" == record-start ]]; then',
      onlyFirst
        ? `  if [[ -e "${firstMarker}" ]]; then exec "${process.execPath}" "$@"; fi`
        : '',
      onlyFirst ? `  : > "${firstMarker}"` : '',
      '  echo "helper killed for the test" >&2',
      '  kill -KILL $$',
      'fi',
      `exec "${process.execPath}" "$@"`,
      '',
    ].join('\n'),
  )
  chmodSync(path.join(shimDirectory, 'node'), 0o755)

  return { PATH: `${shimDirectory}:${process.env.PATH ?? ''}` }
}

test('AC-004: a start helper killed twice still prints the observe line and the record names the failure', () => {
  const root = createTestTempDirectory('pan-run-start-killed-')
  const result = runPanRun(['--label', 'killed', '--', 'echo', 'still runs'], {
    root,
    env: killingNodeShim(root, false),
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'still runs\n')
  assert.match(result.stderr, BANNER)
  assert.match(
    result.stderr,
    /record-start helper failed with status 137 \(KILL\)/u,
  )

  const record = readRecord(root)

  assert.equal(record.label, 'killed')
  assert.deepEqual(record.command, ['echo', 'still runs'])
  assert.equal(record.exit_code, 0)
  assert.ok(typeof record.started_at === 'string')
  assert.deepEqual(record.record_start_failure, {
    status: 137,
    signal: 'KILL',
    recovered: false,
    stderr: 'helper killed for the test',
  })
})

test('AC-004: a start helper killed once is retried, and the record keeps the first failure', () => {
  const root = createTestTempDirectory('pan-run-start-retried-')
  const result = runPanRun(['--label', 'retried', '--', 'echo', 'still runs'], {
    root,
    env: killingNodeShim(root, true),
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, BANNER)

  const record = readRecord(root)

  assert.equal(record.exit_code, 0)
  assert.ok(typeof record.started_at === 'string')
  assert.deepEqual(record.record_start_failure, {
    status: 137,
    signal: 'KILL',
    recovered: true,
    stderr: 'helper killed for the test',
  })
  assert.ok(
    isRecord(
      readJsonFile(
        path.join(findLatestLogDir(root) as string, 'heartbeat.json'),
      ),
    ),
    'the retry writes the heartbeat file the first attempt did not',
  )
})
