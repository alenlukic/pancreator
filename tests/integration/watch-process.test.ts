import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { PanError } from '../../src/lib/errors.js'
import { createFixture } from '../fixture-template.js'
import { createTestTempDirectory } from '../temp.js'
import {
  GENERIC_WATCH_RECORD_DIRECTORY,
  processStartIdentity,
  resolveShellRecord,
  watchProcess,
  watchTimer,
  type GenericWatchRecordEntry,
} from '../../src/lib/watch.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

/** Read one generic watch record as entries. */
function readGenericRecord(
  root: string,
  relative: string,
): GenericWatchRecordEntry[] {
  return readFileSync(path.join(root, relative), 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as GenericWatchRecordEntry)
}

/** Poll until the predicate holds or the deadline passes. */
async function waitFor(
  check: () => boolean,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (check()) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  throw new Error('waitFor deadline passed')
}

test('AC-023: generic watch', async (t) => {
  await t.test('a process is held in one watch through its exit', async () => {
    const root = createTestTempDirectory('watch-process-')
    // A real isolated child that lives about half a second.
    const child = spawn(
      process.execPath,
      [
        '-e',
        'const t = setInterval(() => {}, 50); setTimeout(() => process.exit(0), 600)',
      ],
      { stdio: 'ignore' },
    )

    assert.ok(child.pid)

    const exited = once(child, 'exit')
    const result = await watchProcess(root, {
      pid: child.pid,
      label: 'fixture-child',
      cadenceSeconds: 0.1,
      timeoutSeconds: 30,
    })

    assert.equal(result.state, 'exited')
    // An observed exit is reported, never a success: the exit status is
    // unknown without authoritative completion evidence.
    assert.equal(result.exit_status, 'unknown')
    assert.ok(result.wakes >= 2, 'the watch observed several wakes')

    const entries = readGenericRecord(root, result.record_path)
    const sessions = entries.filter(
      (entry) => entry.event === 'session_started',
    )

    assert.equal(sessions.length, 1, 'the process stayed in one watch')

    const wakes = entries.filter((entry) => entry.event === 'wake')

    assert.ok(
      wakes.every(
        (entry) => entry.watch_session_id === result.watch_session_id,
      ),
      'every wake belongs to the one session',
    )
    assert.equal(wakes[0]?.process_alive, true)
    assert.equal(wakes[0]?.process_identity_match, true)
    assert.equal(wakes.at(-1)?.process_alive, false)
    assert.equal(wakes.at(-1)?.terminal_state, 'exited')
    assert.ok(result.record_path.startsWith(GENERIC_WATCH_RECORD_DIRECTORY))

    await exited
  })

  await t.test('a missing process is unverified, never completed', async () => {
    const root = createTestTempDirectory('watch-process-')
    // A child that has already exited: its pid is gone.
    const gone = spawn(process.execPath, ['-e', 'process.exit(0)'], {
      stdio: 'ignore',
    })

    await once(gone, 'exit')
    assert.ok(gone.pid)

    const result = await watchProcess(root, {
      pid: gone.pid as number,
      label: 'gone-child',
      cadenceSeconds: 0.1,
      timeoutSeconds: 30,
    })

    assert.equal(result.state, 'unverified')
    assert.equal(result.exit_status, null)

    const entries = readGenericRecord(root, result.record_path)

    assert.equal(entries.at(-1)?.terminal_state, 'unverified')
    assert.equal(entries.at(-1)?.process_alive, false)
  })

  await t.test(
    'the start identity distinguishes a live process from a reused pid',
    async () => {
      // One live process keeps one identity across reads.
      assert.equal(
        processStartIdentity(process.pid),
        processStartIdentity(process.pid),
      )
      // A pid nobody owns has no identity.
      assert.equal(processStartIdentity(2 ** 30), null)

      // A live pid whose start identity changed after the arming is a
      // reused pid: the watched process exited, whatever now holds the pid.
      const root = createTestTempDirectory('watch-process-')
      let probes = 0
      const result = await watchProcess(root, {
        pid: process.pid,
        label: 'reused-pid',
        cadenceSeconds: 0.05,
        timeoutSeconds: 30,
        identityProbe: () => {
          probes += 1

          return probes === 1 ? 'started-first' : 'started-later'
        },
      })

      assert.equal(result.state, 'exited')
      assert.equal(result.wakes, 1)

      const last = readGenericRecord(root, result.record_path).at(-1)

      assert.equal(last?.process_alive, true)
      assert.equal(last?.process_identity_match, false)
      assert.equal(last?.terminal_state, 'exited')
    },
  )

  await t.test(
    'an unreadable output is recorded, and escapes are refused',
    async () => {
      const root = createTestTempDirectory('watch-process-')
      const child = spawn(
        process.execPath,
        ['-e', 'setTimeout(() => process.exit(0), 400)'],
        { stdio: 'ignore' },
      )

      assert.ok(child.pid)

      const exited = once(child, 'exit')
      const result = await watchProcess(root, {
        pid: child.pid,
        label: 'output-fixture',
        outputPath: 'runtime/logs/watch/missing-output.log',
        cadenceSeconds: 0.1,
        timeoutSeconds: 30,
      })

      assert.equal(result.state, 'exited')

      const entries = readGenericRecord(root, result.record_path)
      const firstWake = entries.find((entry) => entry.event === 'wake')

      assert.equal(firstWake?.output?.exists, false)
      assert.equal(firstWake?.output?.size, null)

      // A watched output outside the root is refused.
      await assert.rejects(
        watchProcess(root, {
          pid: process.pid,
          label: 'escape-output',
          outputPath: '../outside.log',
          cadenceSeconds: 0.1,
          timeoutSeconds: 1,
        }),
        (error: unknown) =>
          error instanceof PanError && error.code === 'PATH_ESCAPE',
      )

      // A record path outside the runtime tree is refused.
      await assert.rejects(
        watchProcess(root, {
          pid: process.pid,
          label: 'escape-record',
          recordPath: 'outside.jsonl',
          cadenceSeconds: 0.1,
          timeoutSeconds: 1,
        }),
        (error: unknown) =>
          error instanceof PanError && error.code === 'PATH_ESCAPE',
      )

      await exited
    },
  )

  await t.test(
    'the timer records the owed inspection and never a completion',
    async () => {
      const root = createTestTempDirectory('watch-timer-')
      const result = await watchTimer(root, {
        label: 'opaque-handle',
        cadenceSeconds: 0.05,
      })

      assert.equal(result.state, 'elapsed')
      assert.equal(result.wakes, 1)

      const entries = readGenericRecord(root, result.record_path)
      const wake = entries.find((entry) => entry.event === 'wake')

      assert.equal(wake?.requires_inspection, true)
      assert.equal(wake?.subject, 'opaque-handle')
      // A timer wake is not a delegation observation: it carries no terminal
      // completion a submission could read.
      assert.notEqual(wake?.terminal_state, 'completed')
      assert.equal(wake?.terminal_state, 'elapsed')
    },
  )

  await t.test('the CLI exposes both forms outside any run', async () => {
    // A full fixture root: the CLI loads its config at startup, and the
    // generic forms need no run inside it.
    const root = createFixture()

    // The timer form completes after one cadence.
    const timer = spawnSync(
      process.execPath,
      [
        CLI,
        'watch',
        '--timer',
        '--label',
        'cli-timer',
        '--cadence-seconds',
        '0.05',
        '--cadence-directed-by-operator',
        'cli fixture',
        '--json',
      ],
      { cwd: root, encoding: 'utf8', timeout: 60_000 },
    )

    assert.equal(timer.status, 0, timer.stderr)
    assert.equal(JSON.parse(timer.stdout).state, 'elapsed')

    // The process form watches a real child to its exit. The child lives
    // until the watch has observed it alive, so a slow CLI start under suite
    // load cannot find it already gone.
    const child = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      {
        stdio: 'ignore',
      },
    )

    assert.ok(child.pid)

    const exited = once(child, 'exit')
    const record = 'runtime/logs/watch/cli-process.jsonl'
    const watcher = spawn(
      process.execPath,
      [
        CLI,
        'watch',
        '--process',
        String(child.pid),
        '--label',
        'cli-process',
        '--record',
        record,
        '--cadence-seconds',
        '0.1',
        '--cadence-directed-by-operator',
        'cli fixture',
        '--json',
      ],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const output = { stdout: '', stderr: '' }

    watcher.stdout.on(
      'data',
      (chunk: Buffer) => (output.stdout += chunk.toString()),
    )
    watcher.stderr.on(
      'data',
      (chunk: Buffer) => (output.stderr += chunk.toString()),
    )

    const watcherExited = once(watcher, 'exit')
    // Hang guard only; the proof is the recorded wakes.
    const guard = setTimeout(() => watcher.kill('SIGKILL'), 60_000)

    try {
      await waitFor(() => {
        try {
          return readGenericRecord(root, record).some(
            (entry) => entry.event === 'wake' && entry.process_alive === true,
          )
        } catch {
          return false
        }
      })
      child.kill('SIGTERM')
      await exited

      const [status] = (await watcherExited) as [number | null]

      assert.equal(status, 0, output.stderr)
    } finally {
      clearTimeout(guard)
      child.kill('SIGKILL')
    }

    const parsed = JSON.parse(output.stdout) as {
      state: string
      exit_status: string | null
    }

    assert.equal(parsed.state, 'exited')
    assert.equal(parsed.exit_status, 'unknown')
  })
})

test('wakes report output growth, a tail on growth, and silence once output stops', async () => {
  const root = createTestTempDirectory('watch-process-growth-')
  const outputRelative = 'runtime/logs/watch/growth-output.log'
  const outputAbsolute = path.join(root, outputRelative)

  mkdirSync(path.dirname(outputAbsolute), { recursive: true })
  writeFileSync(outputAbsolute, '')

  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  })

  assert.ok(child.pid)

  const exited = once(child, 'exit')
  let call = 0

  const result = await watchProcess(root, {
    pid: child.pid,
    label: 'growth-fixture',
    outputPath: outputRelative,
    // The injected sleep drives the timeline deterministically: it never
    // really waits, so the cadence value here only has to satisfy the
    // constructor's cadence <= timeout invariant.
    cadenceSeconds: 1,
    timeoutSeconds: 30,
    sleep: async () => {
      call += 1

      if (call === 1) {
        appendFileSync(outputAbsolute, 'a\n')
      } else if (call === 2) {
        appendFileSync(outputAbsolute, 'b\n')
      } else if (call === 3) {
        // No further output: this wake must report silence. Killing the
        // child here also ends the watch on this same wake.
        child.kill('SIGKILL')
        await exited
      }
    },
  })

  assert.equal(result.state, 'exited')

  const wakeEntries = readGenericRecord(root, result.record_path).filter(
    (entry) => entry.event === 'wake',
  )

  assert.equal(
    wakeEntries.length,
    3,
    `expected exactly 3 wakes: ${wakeEntries.length}`,
  )

  const [first, second, third] = wakeEntries

  assert.equal(
    first?.output?.growth_bytes,
    null,
    'the first wake has no prior size to compare',
  )
  assert.deepEqual(first?.output?.tail, ['a'])

  assert.equal(second?.output?.growth_bytes, 2)
  assert.deepEqual(second?.output?.tail, ['a', 'b'])

  assert.equal(
    third?.output?.growth_bytes,
    0,
    'no growth since the second wake',
  )
  assert.equal(third?.output?.tail, undefined, 'a silent wake carries no tail')
  assert.equal(third?.terminal_state, 'exited')
})

// AC-16: --exit-record support
test('AC-16: --exit-record reports the exit status of a wrapped command', async (t) => {
  const PAN_RUN = path.join(process.cwd(), 'bin', 'pan-run')
  const BANNER = /watch with \.\/bin\/pan watch --shell (\S+)/u

  await t.test(
    'a watch armed on a live wrapped command that exits 3 reports exit_status 3',
    async () => {
      const root = createTestTempDirectory('watch-exit-record-')
      const env: NodeJS.ProcessEnv = { ...process.env, PANCREATOR_ROOT: root }

      delete env.PAN_VERBOSE
      delete env.PAN_PROGRESS_FD

      const wrapper = spawn(PAN_RUN, ['--', 'bash', '-c', 'sleep 1; exit 3'], {
        env,
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      let stderr = ''

      wrapper.stderr.on('data', (chunk: Buffer) => (stderr += chunk))

      const wrapperClosed = once(wrapper, 'close')
      // Hang guard only; the proof is the recorded exit status.
      const guard = setTimeout(() => wrapper.kill('SIGKILL'), 30_000)

      try {
        await waitFor(() => BANNER.test(stderr))

        const [, shellRecord] = BANNER.exec(stderr) as RegExpExecArray
        const shell = resolveShellRecord(root, shellRecord as string)
        const result = await watchProcess(root, {
          pid: shell.pid,
          label: 'wrapped-exit-3',
          outputPath: shell.output_path,
          exitRecordPath: shell.record_path,
          shellRecord: shell.directory,
          cadenceSeconds: 0.2,
          timeoutSeconds: 30,
        })

        assert.equal(result.state, 'exited')
        assert.equal(result.exit_status, 3)

        const terminal = readGenericRecord(root, result.record_path).at(-1)

        assert.equal(terminal?.terminal_state, 'exited')
        assert.equal(terminal?.exit_status, 3)

        const [status] = (await wrapperClosed) as [number | null]

        assert.equal(status, 3)
      } finally {
        clearTimeout(guard)
      }
    },
  )

  await t.test(
    'an --exit-record outside runtime/logs is refused at arm',
    async () => {
      const root = createTestTempDirectory('watch-exit-record-escape-')

      await assert.rejects(
        watchProcess(root, {
          pid: process.pid,
          label: 'escape',
          exitRecordPath: 'record.json',
          cadenceSeconds: 0.1,
          timeoutSeconds: 1,
        }),
        (error: unknown) =>
          error instanceof PanError && error.code === 'PATH_ESCAPE',
      )
    },
  )

  await t.test(
    'the re-arm command carries --output and --exit-record',
    async () => {
      const root = createTestTempDirectory('watch-exit-record-rearm-')
      const result = await watchProcess(root, {
        pid: process.pid,
        label: 'rearm',
        outputPath: 'runtime/logs/shell/x/output.log',
        exitRecordPath: 'runtime/logs/shell/x/record.json',
        cadenceSeconds: 0.1,
        timeoutSeconds: 0.2,
      })

      assert.equal(result.state, 'timed_out')
      assert.equal(result.exit_status, null)
      assert.equal(
        result.rearm_command,
        `./bin/pan watch --process ${process.pid} --label 'rearm' ` +
          `--output 'runtime/logs/shell/x/output.log' ` +
          `--exit-record 'runtime/logs/shell/x/record.json' --timeout-seconds 0.2`,
      )
    },
  )
})

test('pan watch --shell resolves one pan-run record to its process and paths', async (t) => {
  const name = '20261001T051502Z-run-built-650b256b'
  const directory = `runtime/logs/shell/${name}`
  const seed = (root: string, record: Record<string, unknown> | null): void => {
    mkdirSync(path.join(root, directory), { recursive: true })

    if (record) {
      writeFileSync(
        path.join(root, directory, 'record.json'),
        JSON.stringify(record),
      )
    }
  }

  await t.test(
    'a full path, a bare name, and latest name the same record',
    () => {
      const root = createTestTempDirectory('watch-shell-resolve-')

      seed(root, { pid: 4242, label: 'npm test' })
      symlinkSync(name, path.join(root, 'runtime/logs/shell/latest'))

      const expected = {
        root,
        directory,
        pid: 4242,
        label: 'npm test',
        output_path: `${directory}/output.log`,
        record_path: `${directory}/record.json`,
      }

      assert.deepEqual(resolveShellRecord(root, directory), expected)
      assert.deepEqual(resolveShellRecord(root, `${directory}/`), expected)
      assert.deepEqual(resolveShellRecord(root, name), expected)
      assert.deepEqual(resolveShellRecord(root, 'latest'), expected)
    },
  )

  await t.test(
    'a linked worktree finds the record its pan-run wrote to the main checkout',
    () => {
      const main = createTestTempDirectory('watch-shell-main-')
      const git = (cwd: string, ...args: string[]): void => {
        const result = spawnSync('git', args, { cwd, encoding: 'utf8' })

        assert.equal(result.status, 0, result.stderr)
      }

      git(main, 'init', '-q')
      git(
        main,
        '-c',
        'user.email=t@example.com',
        '-c',
        'user.name=t',
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        'root',
      )
      mkdirSync(path.join(main, 'bin'))
      writeFileSync(path.join(main, 'bin', 'pan-run'), '')
      writeFileSync(path.join(main, 'config.json'), '{}')
      seed(main, { pid: 4242, label: 'npm test' })

      const worktree = path.join(main, 'linked')

      git(main, 'worktree', 'add', '-q', '--detach', worktree)

      const resolved = resolveShellRecord(worktree, directory)

      assert.equal(realpathSync(resolved.root), realpathSync(main))
      assert.equal(resolved.pid, 4242)
      assert.equal(resolved.record_path, `${directory}/record.json`)
    },
  )

  await t.test('a record without a label takes it from the name', () => {
    const root = createTestTempDirectory('watch-shell-label-')

    seed(root, { pid: 4242 })

    assert.equal(resolveShellRecord(root, name).label, 'run-built')
  })

  await t.test(
    'a path outside runtime/logs and a missing record are refused',
    () => {
      const root = createTestTempDirectory('watch-shell-refused-')

      seed(root, null)

      assert.throws(
        () => resolveShellRecord(root, 'docs/x'),
        (error: unknown) =>
          error instanceof PanError && error.code === 'PATH_ESCAPE',
      )
      assert.throws(
        () => resolveShellRecord(root, name),
        (error: unknown) =>
          error instanceof PanError &&
          error.code === 'SHELL_RECORD_UNREADABLE' &&
          /pan watch --process/u.test(error.message),
      )
    },
  )

  await t.test('a timed-out --shell watch re-arms with --shell', async () => {
    const root = createTestTempDirectory('watch-shell-rearm-')
    const result = await watchProcess(root, {
      pid: process.pid,
      label: 'rearm',
      outputPath: `${directory}/output.log`,
      exitRecordPath: `${directory}/record.json`,
      shellRecord: directory,
      cadenceSeconds: 0.1,
      timeoutSeconds: 0.2,
    })

    assert.equal(result.state, 'timed_out')
    assert.equal(
      result.rearm_command,
      `./bin/pan watch --shell '${directory}' --timeout-seconds 0.2`,
    )
  })

  await t.test(
    'the CLI watches a wrapped command to its exit status and refuses mixed forms',
    () => {
      const root = createFixture()
      const wrapped = spawnSync(
        path.join(process.cwd(), 'bin', 'pan-run'),
        ['--', 'bash', '-c', 'exit 3'],
        {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, PANCREATOR_ROOT: root, PAN_VERBOSE: '' },
          timeout: 60_000,
        },
      )
      const shellRecord = /watch with \.\/bin\/pan watch --shell (\S+)/u.exec(
        wrapped.stderr,
      )?.[1]

      assert.ok(shellRecord, wrapped.stderr)

      const watched = spawnSync(
        process.execPath,
        [
          CLI,
          'watch',
          '--shell',
          shellRecord,
          '--cadence-seconds',
          '0.05',
          '--cadence-directed-by-operator',
          'cli fixture',
          '--json',
        ],
        { cwd: root, encoding: 'utf8', timeout: 60_000 },
      )

      assert.equal(watched.status, 0, watched.stderr)

      const result = JSON.parse(watched.stdout) as Record<string, unknown>

      assert.equal(result.state, 'exited')
      assert.equal(result.exit_status, 3)

      const mixed = spawnSync(
        process.execPath,
        [CLI, 'watch', '--shell', shellRecord, '--process', '1'],
        { cwd: root, encoding: 'utf8', timeout: 60_000 },
      )

      assert.notEqual(mixed.status, 0)
      assert.match(mixed.stderr, /--shell reads the pid/u)
    },
  )
})
