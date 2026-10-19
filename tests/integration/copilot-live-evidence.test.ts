import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  delegationLivePaths,
  loadDelegationLiveRecord,
  type DelegationLiveEvent,
  type DelegationLiveIdentity,
} from '../../src/lib/executors/delegation-live.js'
import { COPILOT_MAX_OUTPUT_BYTES } from '../../src/lib/executors/copilot-cli.js'
import { COPILOT_RELAY_LIMITS } from '../../src/lib/executors/copilot-relay.js'
import { processIsAlive, withOperationMutex } from '../../src/lib/io.js'
import { prepareInvocation } from '../../src/lib/engine.js'
import { pinFixturePersonaModel } from '../fixture-template.js'
import { checkpoint } from './delivery-helpers.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { operationMutexPath } from '../../src/lib/state.js'
import { setup } from './copilot-live-fixture.js'
import {
  assertSinksSafe,
  beforeExit,
  KEY,
  launch,
  RELAY,
} from './copilot-live-helpers.js'

test('the exact production frame ceiling is accepted below both byte budgets', async () => {
  const fixture = setup()
  const running = launch(fixture, { mode: 'frame-at-limit' })
  const result = await running.result
  assert.equal(result.ok, true, result.error ?? '')
  assert.equal(result.truncated, false)
  const toolLine = result.stdout.split('\n')[0] ?? ''
  assert.equal(toolLine.length, COPILOT_RELAY_LIMITS.frameCharacters)
  assert.ok(Buffer.byteLength(result.stdout) < COPILOT_MAX_OUTPUT_BYTES)
  assert.ok(
    statSync(delegationLivePaths(fixture.root, fixture.identity).events).size <
      COPILOT_RELAY_LIMITS.eventFileBytes,
  )
  assert.equal(
    (running.progress().match(/"toolCallId":"boundary"/gu) ?? []).length,
    1,
  )
  assertSinksSafe(fixture, running.progress(), result)
})

test('an unfinished real protocol keeps requested session identity separate from observation', async () => {
  for (const resumeSessionId of [undefined, '']) {
    const fixture = setup()
    const running = launch(fixture, { mode: 'no-result', resumeSessionId })
    const result = await running.result
    assert.equal(result.ok, false)
    const record = loadDelegationLiveRecord(fixture.root, fixture.identity)
    assert.ok(record?.ended_at)
    const requested =
      'requested_session_id' in record ? record.requested_session_id : undefined
    assert.match(String(requested), /^[0-9a-f-]{36}$/u)
    assert.equal(record.session_id, undefined)
    assert.ok(result.argv.includes(`--session-id=${String(requested)}`))
    assert.equal(record.resumed_from_session_id, undefined)
  }
})

test(
  'real-shaped large tool results preserve assigned identity before the final session acknowledgment',
  { timeout: 20_000 },
  async () => {
    const { createServer } = await import('node:net')
    const fixture = setup()
    const server = createServer()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const connection = once(server, 'connection')
    const running = launch(fixture, {
      mode: 'large-frame',
      socket: String(address.port),
    })
    let socket: import('node:net').Socket | undefined
    try {
      socket = (
        await beforeExit(running, connection)
      )[0] as import('node:net').Socket
      while (!running.progress().includes('"toolCallId":"view-1"')) {
        await beforeExit(running, once(running.child.stderr!, 'data'))
      }
      const record = loadDelegationLiveRecord(fixture.root, fixture.identity)
      assert.ok(record)
      assert.equal(record.ended_at, undefined)
      const requested =
        'requested_session_id' in record
          ? record.requested_session_id
          : undefined
      assert.equal(typeof requested, 'string')
      assert.match(String(requested), /^[0-9a-f-]{36}$/u)
      assert.equal(record.session_id, undefined)
      assert.ok(processIsAlive(record.child_pid ?? 0))
      const events = readFileSync(
        delegationLivePaths(fixture.root, fixture.identity).events,
        'utf8',
      )
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as DelegationLiveEvent)
      const tool = events.find((event) => event.kind === 'tool')
      assert.ok(tool)
      assert.ok(tool.text.length > 256 * 1024)
      assert.ok(tool.text.length < COPILOT_RELAY_LIMITS.frameCharacters)
      assert.equal(
        JSON.parse(tool.text).data.result.content,
        'x'.repeat(1024 * 1024) + '[REDACTED]',
      )
      socket.write('exit')
      const result = await running.result
      assert.equal(
        result.ok,
        true,
        result.error ?? 'relay should accept the bounded tool result',
      )
      assert.equal(result.session_id, requested)
      const terminal = loadDelegationLiveRecord(fixture.root, fixture.identity)
      assert.equal(terminal?.session_id, requested)
      assert.ok(terminal?.ended_at)
      assert.equal(result.truncated, false)
      assertSinksSafe(fixture, running.progress(), result)
      assert.equal(
        (running.progress().match(/"type":"result"/gu) ?? []).length,
        1,
      )
      assert.equal(processIsAlive(record.child_pid ?? 0), false)
    } finally {
      socket?.destroy()
      running.child.kill('SIGTERM')
      await running.result.catch(() => {})
      server.close()
      await once(server, 'close')
    }
  },
)

test(
  'launch, session, chat, tool and completion are observable before a handshake permits exit',
  { timeout: 90_000 },
  async (context) => {
    const { createServer } = await import('node:net')

    for (const role of ['stage', 'reviewer']) {
      const fixture = setup(role)
      const server = createServer()
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      assert.ok(address && typeof address !== 'string')
      const connection = once(server, 'connection')
      const running = launch(fixture, {
        socket: String(address.port),
        timeoutMs: 70_000,
      })
      let socket: import('node:net').Socket | undefined

      try {
        const [connected] = await beforeExit(running, connection)
        socket = connected as import('node:net').Socket
        await beforeExit(running, running.observed)
        // The stub cannot exit until this observer releases its socket.
        const record = loadDelegationLiveRecord(fixture.root, fixture.identity)
        assert.ok(record)
        assert.equal(record.ended_at, undefined)
        assert.equal(record.attempt, 2)
        assert.equal(record.role, role)
        assert.equal(record.wrapper_record_path, '/wrapper/record')
        assert.match(record.requested_session_id ?? '', /^[0-9a-f-]{36}$/u)
        assert.equal(record.session_id, record.requested_session_id)
        assert.ok(record.relay_start_identity)
        assert.ok(record.child_pid && processIsAlive(record.child_pid))
        assert.ok(record.child_start_identity)

        const events = readFileSync(
          delegationLivePaths(fixture.root, fixture.identity).events,
          'utf8',
        )
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as DelegationLiveEvent)
        assert.deepEqual(
          events.map((event) => event.sequence),
          events.map((_, index) => index + 1),
        )
        for (const stream of ['stdout', 'stderr'] as const) {
          const streamEvents = events.filter((event) => event.stream === stream)
          assert.deepEqual(
            streamEvents.map((event) => event.stream_sequence),
            streamEvents.map((_, index) => index + 1),
          )
          assert.equal(record.stream_sequences[stream], streamEvents.length)
        }
        assert.deepEqual(
          events
            .filter((event) => event.stream === 'stdout')
            .map((event) => event.kind),
          ['session', 'assistant', 'tool', 'tool', 'completion', 'diagnostic'],
        )
        assert.match(
          events.find((event) => event.kind === 'assistant')?.text ?? '',
          /hello ☃ \[REDACTED\]/u,
        )
        assertSinksSafe(fixture, running.progress(), record)
        if (role === 'stage') {
          const paths = delegationLivePaths(fixture.root, fixture.identity)
          const originalEvents = readFileSync(paths.events, 'utf8')
          const watcher = watch(path.dirname(paths.record))
          try {
            let renewed = loadDelegationLiveRecord(
              fixture.root,
              fixture.identity,
            )
            while (!renewed || renewed.heartbeat_at <= record.heartbeat_at) {
              await beforeExit(
                running,
                once(watcher, 'change', { signal: context.signal }),
                context.signal,
              )
              renewed = loadDelegationLiveRecord(fixture.root, fixture.identity)
            }
            assert.equal(renewed.ended_at, undefined)
            assert.equal(renewed.child_pid, record.child_pid)
            assert.equal(
              renewed.child_start_identity,
              record.child_start_identity,
            )
            assert.equal(renewed.relay_pid, record.relay_pid)
            assert.equal(renewed.launch_id, record.launch_id)
            assert.equal(renewed.sequence, record.sequence)
            assert.deepEqual(renewed.stream_sequences, record.stream_sequences)
            assert.equal(readFileSync(paths.events, 'utf8'), originalEvents)
            assert.ok(processIsAlive(renewed.child_pid ?? 0))
            assert.ok(processIsAlive(renewed.relay_pid))
          } finally {
            watcher.close()
          }
        }
        socket.write('exit')
        const result = await running.result
        assert.equal(result.ok, true, result.error ?? '')
        assert.equal(result.parsed?.final_message, 'hello ☃ [REDACTED]')
        assert.equal(
          loadDelegationLiveRecord(fixture.root, fixture.identity)?.exit_code,
          0,
        )
        assertSinksSafe(fixture, running.progress(), result)
        assert.equal(
          (running.progress().match(/"type":"result"/gu) ?? []).length,
          1,
        )
        assert.equal(processIsAlive(record.child_pid), false)
        assert.equal(
          readdirSync(
            path.dirname(
              delegationLivePaths(fixture.root, fixture.identity).record,
            ),
          ).filter((name) => name.endsWith('.live.json')).length,
          1,
        )
      } finally {
        socket?.destroy()
        running.child.kill('SIGTERM')
        await running.result.catch(() => {})
        server.close()
        await once(server, 'close')
      }
    }
  },
)

test('spawn failure, timeout, missing result and independent output bounds remain explicit failures', async () => {
  for (const mode of [
    'spawn',
    'timeout',
    'no-result',
    'missing-session',
    'wrong-session',
    'bounded',
    'frame-bound',
    'event-bound',
  ]) {
    const fixture = setup()
    const running = launch(fixture, {
      mode,
      timeoutMs: mode === 'timeout' ? 200 : 5_000,
      ...(mode === 'spawn'
        ? { binary: path.join(fixture.root, 'missing-cli') }
        : {}),
      ...(mode === 'bounded' ? { maxOutputBytes: 1024 } : {}),
      ...(mode === 'event-bound'
        ? {
            runner: `
          import {readFileSync} from 'node:fs'
          import {runCopilotRelay, COPILOT_RELAY_LIMITS} from ${JSON.stringify(new URL(`file://${RELAY}`).href)}
          const result = await runCopilotRelay(readFileSync(0,'utf8'), process.env, text => process.stderr.write(text), {...COPILOT_RELAY_LIMITS,eventFileBytes:4096})
          process.stdout.write(JSON.stringify(result))
        `,
          }
        : {}),
    })

    const result = await running.result
    assert.equal(result.ok, false, mode)
    assert.ok(result.error, mode)
    assert.equal(result.timed_out, mode === 'timeout', mode)
    const bounded = ['bounded', 'frame-bound', 'event-bound'].includes(mode)
    assert.equal(result.truncated, bounded)
    const record = loadDelegationLiveRecord(fixture.root, fixture.identity)
    assert.ok(record?.ended_at)
    assert.ok(record.error)
    assert.match(record.requested_session_id ?? '', /^[0-9a-f-]{36}$/u)
    assert.ok(
      result.argv.includes(`--session-id=${record.requested_session_id}`),
    )
    if (mode === 'missing-session' || mode === 'wrong-session') {
      assert.equal(result.exit_code, 0)
      assert.equal(result.parsed?.exit_code, 0)
      assert.match(
        result.error ?? '',
        mode === 'missing-session'
          ? /result did not identify the bound session/u
          : /result session did not match the requested session/u,
      )
      assert.equal(
        result.session_id,
        mode === 'wrong-session' ? 'other-session' : undefined,
      )
      assert.equal(
        record.session_id,
        mode === 'wrong-session'
          ? 'other-session'
          : record.requested_session_id,
      )
    }

    if (record.child_pid) {
      assert.equal(processIsAlive(record.child_pid), false, mode)
    }

    if (bounded) {
      assert.equal(record.truncated, true)
      assert.equal(result.timed_out, false)
      assert.match(
        result.error ?? '',
        mode === 'event-bound'
          ? /event file limit exceeded/u
          : mode === 'frame-bound'
            ? /frame limit exceeded/u
            : /aggregate output limit exceeded/u,
      )
      const diagnostic =
        /observed=(\d+) (bytes|characters), limit=(\d+) \2/u.exec(
          result.error ?? '',
        )
      assert.ok(diagnostic)
      assert.ok(Number(diagnostic[1]) > Number(diagnostic[3]))
      assert.equal(
        diagnostic[2],
        mode === 'frame-bound' ? 'characters' : 'bytes',
      )
      assert.equal(
        Number(diagnostic[3]),
        mode === 'frame-bound'
          ? COPILOT_RELAY_LIMITS.frameCharacters
          : mode === 'event-bound'
            ? 4096
            : 1024,
      )
      assert.match(result.error ?? '', /raw_output=\d+ bytes/u)
      assert.equal(record.error, result.error)
      const paths = delegationLivePaths(fixture.root, fixture.identity)
      assert.ok(
        statSync(paths.events).size <=
          (mode === 'event-bound' ? 4096 : COPILOT_MAX_OUTPUT_BYTES),
      )
      assert.ok(
        Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <
          COPILOT_MAX_OUTPUT_BYTES,
      )
      if (mode === 'frame-bound') {
        assert.equal(result.stdout, '')
        assert.ok(
          COPILOT_RELAY_LIMITS.frameCharacters + 1 < COPILOT_MAX_OUTPUT_BYTES,
        )
        assert.ok(!running.progress().includes('x'.repeat(100)))
      }
      if (mode === 'event-bound') {
        assert.ok(100 * Buffer.byteLength('{}\n') < 4096)
        assert.ok(statSync(paths.events).size > 0)
      }
      const descendant = Number(
        readFileSync(path.join(fixture.root, 'descendant.pid'), 'utf8'),
      )
      assert.equal(processIsAlive(descendant), false)
      assertSinksSafe(fixture, running.progress(), result)
    }

    assert.ok(!JSON.stringify(result).includes(KEY))
  }
})

test('successful process group termination is not repeated during relay cleanup', async () => {
  for (const mode of ['descendant', 'bounded']) {
    const fixture = setup()
    const signalsPath = path.join(fixture.root, 'group-signals.json')
    const running = launch(fixture, {
      mode,
      maxOutputBytes: 1024,
      runner: `
        import {readFileSync, writeFileSync} from 'node:fs'
        import {runCopilotRelay} from ${JSON.stringify(new URL(`file://${RELAY}`).href)}
        const kill = process.kill.bind(process)
        const signals = []
        process.kill = (pid, signal) => {
          if (pid < 0) signals.push(signal)
          return kill(pid, signal)
        }
        const result = await runCopilotRelay(readFileSync(0, 'utf8'), process.env, text => process.stderr.write(text))
        writeFileSync(${JSON.stringify(signalsPath)}, JSON.stringify(signals))
        process.stdout.write(JSON.stringify(result))
      `,
    })
    const result = await running.result
    assert.equal(result.ok, mode === 'descendant', result.error ?? '')
    const signals: unknown = JSON.parse(readFileSync(signalsPath, 'utf8'))
    assert.deepEqual(
      signals,
      mode === 'descendant' ? ['SIGKILL'] : ['SIGTERM', 'SIGKILL'],
    )
    const pid = Number(
      readFileSync(path.join(fixture.root, 'descendant.pid'), 'utf8'),
    )
    assert.equal(processIsAlive(pid), false)
    const record = loadDelegationLiveRecord(fixture.root, fixture.identity)
    assert.ok(record?.ended_at)
    assert.equal(record.error, result.error)
    assertSinksSafe(fixture, running.progress(), result)
  }
})

test('a CLI exit cleans descendants that retain its pipes and ignore SIGTERM', async () => {
  const fixture = setup()
  const running = launch(fixture, { mode: 'descendant', timeoutMs: 5_000 })
  const result = await running.result
  assert.equal(result.ok, true, result.error ?? '')
  assert.equal(result.timed_out, false)
  const pid = Number(
    readFileSync(path.join(fixture.root, 'descendant.pid'), 'utf8'),
  )
  assert.equal(processIsAlive(pid), false)
})

for (const kind of ['stage', 'evidence'] as const) {
  test(
    `${kind} dispatch publishes its actual identity with scoped delegation locks`,
    { timeout: 60_000 },
    async (context) => {
      const { createServer } = await import('node:net')
      const engine = new URL('../../src/lib/engine.js', import.meta.url).href
      const run = checkpoint(
        kind === 'stage' ? 'delivery@created' : 'delivery@verify-prepared',
        {
          key: `copilot-live-dispatch-${kind}`,
          fixture: (root) => {
            for (const persona of kind === 'stage'
              ? ['coder']
              : ['verifier', 'reviewer', 'qa-tester']) {
              pinFixturePersonaModel(
                root,
                persona,
                'copilot:test-model[provider=openai]',
              )
            }
            execFileSync('git', ['add', 'config.json'], { cwd: root })
            execFileSync(
              'git',
              ['commit', '-qm', 'Configure Copilot fixture'],
              { cwd: root },
            )
          },
        },
      )
      const invocation =
        kind === 'stage'
          ? prepareInvocation(run.root, run.runId).invocation
          : run.invocation
      assert.ok(invocation)
      const worker = invocation.evidence_workers?.[0]
      if (kind === 'evidence') {
        assert.ok(worker)
        rmSync(path.join(run.root, worker.evidence_path), { force: true })
      }
      const fixture = setup(
        'stage',
        path.join(run.root, 'runtime', 'copilot-live-fixture'),
      )
      const server = createServer()
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      assert.ok(address && typeof address !== 'string')
      const connection = once(server, 'connection')
      const runner = `
      import { delegateInvocation, delegateEvidenceWorkers } from ${JSON.stringify(engine)}
      const result = ${
        kind === 'stage'
          ? `delegateInvocation(${JSON.stringify(run.root)}, ${JSON.stringify(run.runId)}).execution`
          : `delegateEvidenceWorkers(${JSON.stringify(run.root)}, ${JSON.stringify(run.runId)}, {roles:[${JSON.stringify(worker?.role)}]})`
      }
      process.stdout.write(JSON.stringify(${kind === 'stage' ? '{...result,ok:result !== null && result.is_error === false}' : '{ok:result.length === 1 && result.every(worker => worker.ok)}'}))
    `
      const running = launch(fixture, { socket: String(address.port), runner })
      let socket: import('node:net').Socket | undefined
      try {
        const [connected] = await beforeExit(
          running,
          connection,
          context.signal,
        )
        socket = connected as import('node:net').Socket
        await beforeExit(running, running.observed, context.signal)
        const directory = resolveRunLayout(run.root, run.runId).evidence(
          '',
        ).absolute
        const files = readdirSync(directory).filter((name) =>
          name.endsWith('.live.json'),
        )
        assert.equal(files.length, 1)
        const identity = JSON.parse(
          readFileSync(path.join(directory, files[0] ?? ''), 'utf8'),
        ) as DelegationLiveIdentity
        assert.equal(identity.run_id, run.runId)
        assert.equal(identity.invocation_id, invocation.invocation_id)
        assert.equal(identity.attempt, invocation.attempt)
        assert.equal(identity.role, kind === 'stage' ? 'stage' : worker?.role)
        const record = loadDelegationLiveRecord(run.root, identity)
        assert.equal(record?.ended_at, undefined)
        assert.match(record?.requested_session_id ?? '', /^[0-9a-f-]{36}$/u)
        assert.equal(record?.session_id, record?.requested_session_id)
        assert.equal(record?.wrapper_record_path, '/wrapper/record')
        const mutex = operationMutexPath(run.root, run.runId)
        if (kind === 'stage') {
          assert.doesNotThrow(() => withOperationMutex(mutex, () => undefined))
          const launchMutex = `${mutex}.delegate`
          assert.equal(
            Number(readFileSync(launchMutex, 'utf8').trim()),
            running.child.pid,
          )
          assert.throws(
            () =>
              withOperationMutex(launchMutex, () =>
                assert.fail('delegate released its launch mutex'),
              ),
            /operation.*progress|busy|held|mutex/iu,
          )
        }
        socket.write('release')
        const result = await running.result
        assert.equal(result.ok, true, result.error ?? '')
        assert.ok(loadDelegationLiveRecord(run.root, identity)?.ended_at)
        assert.equal(existsSync(mutex), false)
        if (kind === 'stage') {
          assert.equal(existsSync(`${mutex}.delegate`), false)
        }
      } finally {
        socket?.destroy()
        running.child.kill('SIGTERM')
        await running.result.catch(() => {})
        server.close()
        await once(server, 'close')
      }
    },
  )
}

test('SIGTERM terminates the CLI even after it has emitted completion', async () => {
  const { createServer } = await import('node:net')
  const fixture = setup()
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const connection = once(server, 'connection')
  const running = launch(fixture, { socket: String(address.port) })
  let socket: import('node:net').Socket | undefined

  try {
    const [connected] = await beforeExit(running, connection)
    socket = connected as import('node:net').Socket
    await beforeExit(running, running.observed)
    running.child.kill('SIGTERM')
    const result = await running.result
    socket.destroy()
    assert.equal(result.ok, false)
    assert.equal(result.signal, 'SIGTERM')
    assert.match(result.error ?? '', /interrupted/u)
    const record = loadDelegationLiveRecord(fixture.root, fixture.identity)
    assert.ok(record?.child_pid)
    assert.equal(processIsAlive(record.child_pid), false)
    assertSinksSafe(fixture, running.progress(), result)
  } finally {
    socket?.destroy()
    running.child.kill('SIGTERM')
    await running.result.catch(() => {})
    server.close()
    await once(server, 'close')
  }
})

for (const interruption of ['signal', 'parent'] as const) {
  test(
    `startup ${interruption} loss cleans the detached child during identity lookup`,
    { timeout: 20_000 },
    async () => {
      const { createServer } = await import('node:net')
      const fixture = setup()
      const shimDirectory = path.join(fixture.root, 'identity-bin')
      mkdirSync(shimDirectory)
      const shim = path.join(shimDirectory, 'ps')
      writeFileSync(
        shim,
        `#!${process.execPath}
const net = require('node:net')
const {spawnSync} = require('node:child_process')
const pid = Number(process.argv.at(-1))
const finish = () => {
  const result = spawnSync('/bin/ps', process.argv.slice(2), {encoding:'utf8', timeout:1000})
  process.stdout.write(result.stdout ?? '')
  process.exit(result.status ?? 1)
}
if (pid === process.ppid) { finish() } else {
  const socket = net.connect(Number(process.env.IDENTITY_GATE), '127.0.0.1', () => {
    socket.write(JSON.stringify({child:pid,relay:process.ppid}) + '\\n')
  })
  socket.on('data', () => { socket.destroy(); finish() })
}
`,
      )
      chmodSync(shim, 0o755)
      const server = createServer()
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      assert.ok(address && typeof address !== 'string')
      const connection = once(server, 'connection')
      const runner = `
        import {spawn} from 'node:child_process'
        import {readFileSync} from 'node:fs'
        const request = JSON.parse(readFileSync(0, 'utf8'))
        request.adapterParentPid = process.pid
        const relay = spawn(process.execPath, [${JSON.stringify(RELAY)}], {stdio:['pipe',1,2]})
        relay.stdin.end(JSON.stringify(request))
        setInterval(() => {}, 1000)
      `
      const running = launch(fixture, {
        mode: 'timeout',
        timeoutMs: 8_000,
        path: `${shimDirectory}:${process.env.PATH ?? ''}`,
        identityGate: String(address.port),
        ...(interruption === 'parent' ? { runner, parentSignal: true } : {}),
      })
      let socket: import('node:net').Socket | undefined
      let childPid: number | undefined
      let relayPid: number | undefined

      try {
        const [connected] = await beforeExit(running, connection)
        socket = connected as import('node:net').Socket
        const [bytes] = await once(socket, 'data')
        const identity = JSON.parse(String(bytes)) as {
          child: number
          relay: number
        }

        childPid = identity.child
        relayPid = identity.relay
        assert.ok(processIsAlive(childPid))
        running.child.kill('SIGTERM')
        socket.write('release')
        const result = await running.result
        assert.equal(result.ok, false)
        assert.equal(result.timed_out, false)
        assert.match(
          result.error ?? '',
          interruption === 'signal' ? /interrupted/u : /parent exited/u,
        )
        assert.equal(processIsAlive(childPid), false)
        const record = loadDelegationLiveRecord(fixture.root, fixture.identity)
        assert.ok(record?.ended_at)
        assert.ok(record.error)
      } finally {
        socket?.destroy()
        // Failed pre-repair assertions must not leave the detached fixture alive.
        for (const pid of [childPid ? -childPid : undefined, relayPid]) {
          if (pid !== undefined) {
            try {
              process.kill(pid, 'SIGKILL')
            } catch (error) {
              if (
                !(
                  error instanceof Error &&
                  'code' in error &&
                  error.code === 'ESRCH'
                )
              ) {
                throw error
              }
            }
          }
        }
        running.child.kill('SIGTERM')
        await running.result.catch(() => {})
        server.close()
        await once(server, 'close')
      }
    },
  )
}

test(
  'adapter loss before relay entry prevents CLI creation',
  { timeout: 20_000 },
  async () => {
    const { createServer } = await import('node:net')
    const fixture = setup()
    const server = createServer()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const connection = once(server, 'connection')
    const gatedRelay = `
              import {readFileSync} from 'node:fs'
              import net from 'node:net'
              import {runCopilotRelay} from ${JSON.stringify(new URL(`file://${RELAY}`).href)}
              const raw = readFileSync(0, 'utf8')
              const request = JSON.parse(raw)
              const socket = net.connect(Number(process.env.IDENTITY_GATE), '127.0.0.1', () => {
                socket.write(JSON.stringify({relay:process.pid,parent:request.adapterParentPid}) + '\\n')
              })
              await new Promise(resolve => socket.once('data', resolve))
              socket.destroy()
              const result = await runCopilotRelay(raw, process.env, text => process.stderr.write(text))
              process.stdout.write(JSON.stringify(result) + '\\n')
            `
    const runner = `
              import {spawn} from 'node:child_process'
              import {readFileSync} from 'node:fs'
              const request = JSON.parse(readFileSync(0, 'utf8'))
              request.adapterParentPid = process.pid
              const relay = spawn(process.execPath, ['--input-type=module','--eval',${JSON.stringify(gatedRelay)}], {stdio:['pipe',1,2]})
              relay.stdin.end(JSON.stringify(request))
              setInterval(() => {}, 1000)
            `
    const running = launch(fixture, {
      mode: 'timeout',
      timeoutMs: 500,
      runner,
      parentSignal: true,
      identityGate: String(address.port),
    })
    let socket: import('node:net').Socket | undefined
    let relayPid: number | undefined

    try {
      const [connected] = await beforeExit(running, connection)
      socket = connected as import('node:net').Socket
      const [bytes] = await once(socket, 'data')
      const identity = JSON.parse(String(bytes)) as {
        relay: number
        parent: number
      }
      relayPid = identity.relay
      assert.equal(identity.parent, running.child.pid)
      assert.equal(
        existsSync(path.join(fixture.root, 'cli-started.pid')),
        false,
      )
      const adapterExit = once(running.child, 'exit')
      running.child.kill('SIGTERM')
      await adapterExit
      socket.write('release')
      const result = await running.result
      assert.equal(
        existsSync(path.join(fixture.root, 'cli-started.pid')),
        false,
        'an orphan relay created a CLI after its adapter exited',
      )
      assert.equal(result.ok, false)
      assert.equal(result.timed_out, false)
      assert.match(result.error ?? '', /parent exited/u)
      const record = loadDelegationLiveRecord(fixture.root, fixture.identity)
      assert.ok(record?.ended_at)
      assert.equal(record.child_pid, undefined)
    } finally {
      socket?.destroy()
      const marker = path.join(fixture.root, 'cli-started.pid')
      const cliPid = existsSync(marker)
        ? Number(readFileSync(marker, 'utf8'))
        : undefined

      for (const pid of [cliPid ? -cliPid : undefined, relayPid]) {
        if (pid !== undefined) {
          try {
            process.kill(pid, 'SIGKILL')
          } catch (error) {
            if (
              !(
                error instanceof Error &&
                'code' in error &&
                error.code === 'ESRCH'
              )
            ) {
              throw error
            }
          }
        }
      }

      running.child.kill('SIGTERM')
      await running.result.catch(() => {})
      server.close()
      await once(server, 'close')
    }
  },
)
