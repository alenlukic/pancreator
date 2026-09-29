/**
 * The agent-index hook wrapper writes to the resolved harness root from any
 * working directory, prints exactly one JSON response, and survives
 * concurrent writers (AC-004, AC-009).
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

const HOOK = path.join(process.cwd(), 'bin', 'pan-hook-agent-index')

function harnessRoot(): string {
  const root = createTestTempDirectory('agent-index-hook-root-')
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'pancreator-v2-prototype' }),
  )
  return root
}

function runHook(
  event: string,
  payload: unknown,
  env: Record<string, string>,
): string {
  const result = spawnSync(HOOK, [event], {
    input: JSON.stringify(payload),
    cwd: createTestTempDirectory('agent-index-hook-cwd-'),
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 20_000,
  })

  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

function runHookAsync(
  event: string,
  payload: unknown,
  env: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(HOOK, [event], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    let stdout = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(`hook exited ${code}`))
      }
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

function jsonDocuments(stdout: string): unknown[] {
  return stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as unknown)
}

test('AC-004: a hook fired outside the harness writes the index at PANCREATOR_ROOT', () => {
  assert.ok(
    existsSync(path.join(process.cwd(), 'dist', 'src', 'agent-index-hook.js')),
    'the entry point is built beside the wrapper',
  )

  const root = harnessRoot()
  const stdout = runHook(
    'subagentStart',
    { subagent_id: 'outside-agent', parent_conversation_id: 'p' },
    { PANCREATOR_ROOT: root },
  )

  assert.deepEqual(jsonDocuments(stdout), [{ permission: 'allow' }])

  const index = JSON.parse(
    readFileSync(path.join(root, 'runtime/logs/agents/index.json'), 'utf8'),
  ) as { agents: Array<{ agent_id: string }> }

  assert.deepEqual(
    index.agents.map((agent) => agent.agent_id),
    ['outside-agent'],
  )
})

test('AC-007: the probe marker captures payload field names and id values only', () => {
  const root = harnessRoot()
  const agents = path.join(root, 'runtime/logs/agents')

  mkdirSync(agents, { recursive: true })
  writeFileSync(path.join(agents, 'probe.enabled'), '')
  runHook(
    'preToolUse',
    {
      conversation_id: 'probe-conv',
      tool_use_id: 'probe-tu',
      tool_name: 'Shell',
      unexpected_field: 'probe-value-not-an-id',
      tool_input: { command: 'echo probe-command-body' },
    },
    { PANCREATOR_ROOT: root },
  )

  const text = readFileSync(path.join(agents, 'probe-payloads.jsonl'), 'utf8')
  const line = JSON.parse(text) as {
    event: string
    fields: string[]
    tool_input_fields: string[]
    ids: Record<string, string>
  }

  assert.equal(line.event, 'preToolUse')
  assert.deepEqual(line.fields, [
    'conversation_id',
    'tool_input',
    'tool_name',
    'tool_use_id',
    'unexpected_field',
  ])
  assert.deepEqual(line.tool_input_fields, ['command'])
  assert.deepEqual(line.ids, {
    conversation_id: 'probe-conv',
    tool_use_id: 'probe-tu',
  })
  assert.ok(!text.includes('probe-command-body'))
  assert.ok(!text.includes('probe-value-not-an-id'))
})

test('AC-009: a hook that cannot resolve its root prints one fallback document', () => {
  const notHarness = createTestTempDirectory('agent-index-hook-bad-')

  for (const [event, expected] of [
    ['preToolUse', { permission: 'allow' }],
    ['subagentStop', {}],
  ] as const) {
    const stdout = runHook(
      event,
      { conversation_id: 'x', subagent_id: 'x' },
      { PANCREATOR_ROOT: notHarness },
    )

    assert.deepEqual(jsonDocuments(stdout), [expected])
  }

  assert.equal(existsSync(path.join(notHarness, 'runtime')), false)
})

test('AC-009: concurrent tool calls and stops keep every event line and a valid index', async () => {
  const root = harnessRoot()
  const env = { PANCREATOR_ROOT: root }
  const agents = Array.from({ length: 6 }, (_, i) => `concurrent-${i}`)

  for (const agent of agents) {
    runHook('subagentStart', { subagent_id: agent }, env)
  }

  const outputs = await Promise.all(
    agents.flatMap((agent) => [
      runHookAsync(
        'preToolUse',
        {
          conversation_id: agent,
          tool_name: 'Read',
          tool_use_id: `tu-${agent}`,
          tool_input: { path: 'README.md' },
        },
        env,
      ),
      runHookAsync(
        'subagentStop',
        { subagent_id: agent, status: 'completed' },
        env,
      ),
    ]),
  )

  for (const stdout of outputs) {
    assert.equal(jsonDocuments(stdout).length, 1, 'one JSON response per hook')
  }

  const index = JSON.parse(
    readFileSync(path.join(root, 'runtime/logs/agents/index.json'), 'utf8'),
  ) as { agents: Array<{ agent_id: string }> }

  assert.deepEqual(
    index.agents.map((agent) => agent.agent_id).sort(),
    [...agents].sort(),
  )

  for (const agent of agents) {
    const lines = readFileSync(
      path.join(root, 'runtime/logs/agents', `${agent}.jsonl`),
      'utf8',
    )

    assert.match(lines, /"kind":"call_started"/u)
    assert.match(lines, /"kind":"stopped"/u)
  }

  assert.equal(
    existsSync(path.join(root, 'runtime/logs/agents/index.lock')),
    false,
  )
})
