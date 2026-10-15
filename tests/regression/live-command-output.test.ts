import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  handleSubagentStart,
  handleSubagentStop,
} from '../../src/lib/agent-index.js'
import { createTestTempDirectory } from '../temp.js'
import { createFixture } from '../helpers.js'
import {
  findLatestLogDir,
  PAN_RUN,
  runEnv,
} from '../integration/pan-run-fixture.js'

const CLI = path.join(process.cwd(), 'dist/src/cli.js')

function running(args: string[], root: string, extra: NodeJS.ProcessEnv = {}) {
  const child = spawn(PAN_RUN, args, {
    cwd: root,
    env: runEnv(root, extra),
    stdio: 'pipe',
    timeout: 25_000,
  })
  let output = ''
  const listeners = new Set<() => void>()
  const collect = (data: Buffer) => {
    output += data.toString()
    for (const listener of listeners) listener()
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  const until = (predicate: (text: string) => boolean) =>
    new Promise<void>((resolve, reject) => {
      const check = () => {
        if (predicate(output)) {
          clearTimeout(timer)
          listeners.delete(check)
          resolve()
        }
      }
      const timer = setTimeout(() => {
        listeners.delete(check)
        reject(new Error(`Expected live output did not arrive:\n${output}`))
      }, 10_000)
      listeners.add(check)
      check()
    })
  return { child, exited, until, output: () => output }
}

test('toy pan-run keeps heartbeat evidence without repeated idle output', async () => {
  const root = createTestTempDirectory('toy-run-idle-')
  const program = path.join(root, 'toy.cjs')
  writeFileSync(
    program,
    'process.stdin.once("data", () => { console.log("Toy completed"); process.exit(0) })',
  )
  const run = running(
    ['--heartbeat-seconds', '1', '--', process.execPath, program],
    root,
  )
  try {
    await run.until((text) => /♥ \d\d:\d\d|no output yet/u.test(text))
    const dir = findLatestLogDir(root)
    assert.ok(dir)
    // Wait for recorded heartbeat transitions, not an assumed wall duration.
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => {
        clearInterval(poll)
        reject(new Error('Heartbeat did not advance'))
      }, 10_000)
      const poll = setInterval(() => {
        const heartbeat = JSON.parse(
          readFileSync(path.join(dir, 'heartbeat.json'), 'utf8'),
        )
        if (heartbeat.elapsed_seconds >= 3) {
          clearInterval(poll)
          clearTimeout(deadline)
          resolve()
        }
      }, 25)
    })
    run.child.stdin.end('finish\n')
    assert.equal(await run.exited, 0)
    assert.match(run.output(), /Toy completed/u)
    const beats = run.output().match(/♥ \d\d:\d\d/gu) ?? []
    assert.ok(
      beats.length >= 2,
      'a running command must retain visible heartbeats',
    )
    assert.equal(
      new Set(beats).size,
      beats.length,
      'heartbeats carry changing elapsed time only',
    )
    assert.doesNotMatch(run.output(), /no output yet/u)
    assert.ok(!run.output().split('\n').includes('t'), run.output())
    assert.doesNotMatch(
      run.output(),
      /wrapper_pid=|started pid=|watch with|running \d+s/u,
    )
  } finally {
    run.child.stdin.end()
    if (run.child.exitCode === null) run.child.kill('SIGTERM')
    await run.exited
  }
})

test('toy pan watch shows subagent chat and tools before completion through a prepared wrapper request', async () => {
  const root = createFixture()
  const parent = path.join(root, 'parent.jsonl')
  const directory = path.join(root, 'subagents')
  const agent = 'toy-worker'
  mkdirSync(directory)
  writeFileSync(parent, '')
  const transcript = path.join(directory, `${agent}.jsonl`)
  writeFileSync(
    transcript,
    `${JSON.stringify({ type: 'user.message', data: { content: 'Tiny toy task' } })}\n`,
  )
  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: agent,
    parent_conversation_id: 'toy-parent',
    transcript_path: parent,
  })
  const request = path.join(root, 'watch.json')
  writeFileSync(
    request,
    JSON.stringify({
      label: 'toy-watch',
      argv: [
        'env',
        'TOY_MODE=1',
        process.execPath,
        CLI,
        'watch',
        '--agent',
        agent,
        '--timeout-seconds',
        '60',
      ],
    }),
  )
  const secret = 'synthetic-live-output-secret'
  writeFileSync(path.join(root, '.env'), `MY_TOKEN=${secret}\n`)
  const run = running(['--request', request], root)
  let attached: ReturnType<typeof running> | undefined
  try {
    await run.until((text) => text.includes('── Watch'))
    attached = running(
      [
        '--summary',
        '--',
        process.execPath,
        CLI,
        'watch',
        '--attach',
        `runtime/logs/watch/agent-${agent}.jsonl`,
        '--timeout-seconds',
        '60',
      ],
      root,
    )
    await attached.until((text) => text.includes('── Watch'))
    const greeting = `Toy worker: checking the greeting. ${'Readable '.repeat(45)}${secret}`
    appendFileSync(
      transcript,
      `${JSON.stringify({ type: 'assistant.message', data: { content: greeting, reasoningText: 'PRIVATE_REASONING_MUST_NOT_APPEAR', toolRequests: [{ toolCallId: 'read-1', name: 'view', arguments: { path: 'greeting.txt' } }] } })}\n`,
    )
    appendFileSync(
      transcript,
      `${JSON.stringify({ type: 'tool.execution_start', data: { toolName: 'view', toolCallId: 'read-1', arguments: { path: 'greeting.txt' } } })}\n`,
    )
    await run.until(
      (text) =>
        text.includes('Toy worker: checking the greeting.') &&
        text.includes('── Tool ──\n  Read'),
    )
    await attached.until(
      (text) =>
        text.includes('Toy worker: checking the greeting.') &&
        text.includes('── Tool ──\n  Read'),
    )
    assert.equal(
      run.child.exitCode,
      null,
      'activity must arrive while the worker is still active',
    )
    assert.equal(attached.child.exitCode, null)
    assert.ok(
      run.output().includes('Readable '.repeat(45)),
      'the wrapper must not truncate live chat at 240 characters',
    )
    assert.doesNotMatch(
      run.output() + attached.output(),
      /synthetic-live-output-secret|PRIVATE_REASONING_MUST_NOT_APPEAR/u,
    )
    appendFileSync(
      transcript,
      `${JSON.stringify({ type: 'assistant.message', data: { content: 'Toy worker: greeting verified.' } })}\n`,
    )
    handleSubagentStop(root, {
      event: 'subagentStop',
      subagent_id: agent,
      status: 'completed',
      agent_transcript_path: transcript,
    })
    assert.equal(await run.exited, 0, run.output())
    assert.equal(await attached.exited, 0, attached.output())
    assert.match(attached.output(), /Toy worker: greeting verified\./u)
    assert.match(run.output(), /Toy worker: greeting verified\./u)
    assert.equal(
      run.output().split('Toy worker: checking the greeting.').length - 1,
      1,
    )
    assert.equal(run.output().split('── Tool ──\n  Read').length - 1, 1)
    assert.doesNotMatch(run.output(), /no output yet|unchanged x|\r/u)
    assert.match(run.output(), /── Message ──\n  Toy worker:/u)
    assert.match(run.output(), /\n\n── Tool ──\n  Read\n\n/u)
    assert.match(run.output(), /── Result ──\n  Completed/u)
  } finally {
    if (run.child.exitCode === null) run.child.kill('SIGTERM')
    if (attached && attached.child.exitCode === null)
      attached.child.kill('SIGTERM')
    await run.exited
    await attached?.exited
  }
})

test('toy direct lifecycle call selects readable summary without an extra flag', () => {
  const root = createTestTempDirectory('toy-lifecycle-')
  const result = spawnSync(
    PAN_RUN,
    [
      '--',
      path.join(process.cwd(), 'bin/pan'),
      'governance',
      'lookup',
      '--mode',
      'pair',
      '--json',
    ],
    {
      cwd: process.cwd(),
      env: runEnv(root),
      encoding: 'utf8',
      timeout: 20_000,
    },
  )
  // Use an invalid command as a tiny real CLI failure, with structured error output.
  assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /Failed: pan \(exit 1\)/u)
  assert.doesNotMatch(result.stdout + result.stderr, /^\s*\{\s*$/mu)
  assert.match(result.stdout + result.stderr, /error:/u)
})
