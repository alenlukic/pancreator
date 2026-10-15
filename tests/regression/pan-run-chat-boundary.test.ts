import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'
import {
  findLatestLogDir,
  PAN_RUN,
  PROCESS_TIMEOUT_MS,
  readRecord,
  runEnv,
  runPanRun,
} from '../integration/pan-run-fixture.js'

const hook = path.join(process.cwd(), 'bin/pan-hook-shell-monitor')

function hookResult(command: string) {
  const result = spawnSync(hook, {
    input: JSON.stringify({ command }),
    encoding: 'utf8',
    timeout: PROCESS_TIMEOUT_MS,
  })

  assert.equal(result.status, 0, result.stderr)

  return JSON.parse(result.stdout) as {
    permission: string
    agent_message?: string
  }
}

function writeRequest(root: string, value: unknown): string {
  const file = path.join(root, 'command.json')

  writeFileSync(file, JSON.stringify(value))

  return file
}

test('chat boundary: the submitted command contains only a request path and returns a bounded lifecycle result', () => {
  const root = createTestTempDirectory('pan-run-chat-')
  const payload = {
    status: 'created',
    run_id: 'repair-run',
    next_command: './bin/pan prepare repair-run',
    details: Array.from({ length: 120 }, (_, index) => ({ index })),
    token: 'synthetic-chat-secret',
  }
  const program =
    'const fs = require("node:fs");' +
    'fs.writeFileSync("args.json", JSON.stringify(process.argv.slice(1)));' +
    `console.log(JSON.stringify(${JSON.stringify(payload)}, null, 2))`
  const args = [' spaces ', '', '$(never-execute)', 'quote\"\'\\', 'é']
  const request = writeRequest(root, {
    label: 'initialize-repair',
    cwd: root,
    argv: [process.execPath, '-e', program, ...args],
  })
  const command = `'${PAN_RUN}' --request '${request}'`

  assert.ok(Buffer.byteLength(command) <= 400)
  assert.ok(!command.includes(program))
  assert.ok(!command.includes('synthetic-chat-secret'))
  assert.equal(hookResult(command).permission, 'allow')

  // This is the actual shell-tool command, not just the child process argv.
  const result = spawnSync('bash', ['-c', command], {
    encoding: 'utf8',
    env: runEnv(root, { MY_TOKEN: 'synthetic-chat-secret' }),
    timeout: PROCESS_TIMEOUT_MS,
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Completed: initialize-repair/u)
  assert.match(result.stdout, /status: created/u)
  assert.match(result.stdout, /run_id: repair-run/u)
  assert.match(result.stdout, /next_command: .\/bin\/pan prepare repair-run/u)
  assert.doesNotMatch(result.stdout, /runtime\/logs\/shell\//u)
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /"details"|"index"|synthetic-chat-secret/u,
  )
  assert.ok(result.stdout.trim().split('\n').length <= 10)
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(root, 'args.json'), 'utf8')),
    args,
  )

  const record = readRecord(root)

  assert.equal(record.summary, true)
  assert.equal(record.exit_code, 0)
  assert.equal(record.cwd, root)
  assert.deepEqual(record.command, [
    process.execPath,
    '-e',
    program.replaceAll('synthetic-chat-secret', '[REDACTED:MY_TOKEN]'),
    ...args,
  ])
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(root, String(record.log_path)), 'utf8')),
    {
      ...payload,
      token: '[REDACTED:MY_TOKEN]',
    },
  )
})

test('chat boundary: long inline programs and multiline calls are refused before execution', () => {
  for (const command of [
    `bin/pan-run -- node -e '${'x;'.repeat(250)}'`,
    `bin/pan-run -c '${'é'.repeat(210)}'`,
    "bin/pan-run -c 'printf first\nprintf second'",
  ]) {
    const result = hookResult(command)

    assert.equal(result.permission, 'deny')
    assert.match(result.agent_message ?? '', /COMMAND_DISPLAY_TOO_LARGE/u)
    assert.match(result.agent_message ?? '', /file tool/u)
    assert.match(result.agent_message ?? '', /--request/u)
  }

  const lifecycle = hookResult(
    'bin/pan-run -- ./bin/pan init --request input.md',
  )

  assert.equal(lifecycle.permission, 'deny')
  assert.match(lifecycle.agent_message ?? '', /LIFECYCLE_OUTPUT_UNBOUNDED/u)

  for (const command of [
    'bin/pan-run --summary -- ./bin/pan status run',
    'bin/pan-run --stream -- ./bin/pan status run --json',
    'bin/pan-run -- ./bin/pan watch run',
  ]) {
    assert.equal(hookResult(command).permission, 'allow')
  }
})

test('prepared scripts reuse private spooling, preserve stdin and failures, and retain full redacted evidence', () => {
  const root = createTestTempDirectory('pan-run-script-request-')
  const body =
    'read answer\nprintf "received:%s\\n" "$answer"\nprintf "%s\\n" "$MY_TOKEN" >&2\nexit 7\n'
  const file = writeRequest(root, { label: 'script-check', script: body })
  const result = runPanRun(['--request', file], {
    root,
    input: 'hello\n',
    env: { MY_TOKEN: 'synthetic-request-secret' },
  })

  assert.equal(result.status, 7, result.stderr)
  assert.match(result.stdout, /Failed: script-check \(exit 7\)/u)
  assert.match(result.stdout, /received:hello/u)
  assert.match(result.stdout, /\[REDACTED:MY_TOKEN\]/u)
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /synthetic-request-secret/u,
  )
  assert.ok(result.stdout.trim().split('\n').length <= 10)

  const record = readRecord(root)
  const dir = findLatestLogDir(root)

  assert.ok(dir)
  assert.equal(record.exit_code, 7)
  assert.equal(readFileSync(path.join(dir, 'script.sh'), 'utf8'), body)
  assert.deepEqual(record.command, ['bash', path.join(dir, 'script.sh')])
  assert.match(
    readFileSync(path.join(dir, 'output.log'), 'utf8'),
    /received:hello/u,
  )
})

test('summary keeps structured errors visible despite large stdout and preserves the full streams', () => {
  const root = createTestTempDirectory('pan-run-summary-errors-')
  const program = [
    'console.log(JSON.stringify({details: "x".repeat(100000)}, null, 2));',
    'console.error(JSON.stringify({error: "CHECK_FAILED", message: "Inspect the retained evidence", details: "y".repeat(20000)}, null, 2));',
    'process.exitCode = 9;',
  ].join('\n')
  const result = runPanRun(
    ['--summary', '--', process.execPath, '-e', program],
    { root },
  )

  assert.equal(result.status, 9, result.stderr)
  assert.match(result.stdout, /Failed: node \(exit 9\)/u)
  assert.match(result.stdout, /error: CHECK_FAILED/u)
  assert.match(result.stdout, /message: Inspect the retained evidence/u)
  assert.ok(result.stdout.trim().split('\n').length <= 10)
  assert.ok(result.stdout.split('\n').every((line) => line.length <= 240))

  const dir = findLatestLogDir(root)

  assert.ok(dir)
  assert.equal(
    JSON.parse(readFileSync(path.join(dir, 'stdout.log'), 'utf8')).details
      .length,
    100000,
  )
  assert.equal(
    JSON.parse(readFileSync(path.join(dir, 'stderr.log'), 'utf8')).details
      .length,
    20000,
  )
  assert.ok(
    readFileSync(path.join(dir, 'output.log'), 'utf8').includes('CHECK_FAILED'),
  )
})

test('prepared requests fail closed on malformed fields before launching a command', () => {
  const root = createTestTempDirectory('pan-run-invalid-request-')
  const valid = { label: 'check', argv: ['echo', 'MUST_NOT_RUN'] }
  const invalid = [
    null,
    [],
    {},
    { ...valid, extra: true },
    { ...valid, script: 'exit 0' },
    { ...valid, argv: [] },
    { ...valid, argv: ['echo', null] },
    { ...valid, argv: ['echo', '\0'] },
    { ...valid, label: 'a\nb' },
    { ...valid, output: 'invented' },
    { ...valid, cwd: 42 },
    { ...valid, script: 'x'.repeat(1024 * 1024) },
  ]

  for (const value of invalid) {
    const result = runPanRun(['--request', writeRequest(root, value)], { root })

    assert.equal(result.status, 2)
    assert.match(result.stderr, /INVALID_REQUEST/u)
    assert.doesNotMatch(result.stdout + result.stderr, /MUST_NOT_RUN/u)
  }

  const file = path.join(root, 'command.json')

  writeFileSync(file, '{invalid')
  assert.equal(runPanRun(['--request', file], { root }).status, 2)
  assert.equal(
    runPanRun(['--request', path.join(root, 'absent.json')], { root }).status,
    2,
  )
})

test('prepared output modes and verbose override preserve the direct streaming contract', () => {
  const root = createTestTempDirectory('pan-run-request-modes-')
  const request = { label: 'modes', argv: ['printf', 'first\nsecond\n'] }

  for (const [output, env, expected] of [
    ['stream', {}, 'first\nsecond\n'],
    ['quiet', {}, ''],
    ['summary', { PAN_VERBOSE: '1' }, 'first\nsecond\n'],
  ] as const) {
    const file = writeRequest(root, { ...request, output })
    const result = runPanRun(['--request', file], { root, env })

    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, expected)
  }
})
