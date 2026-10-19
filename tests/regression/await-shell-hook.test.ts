import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

const HOOK = path.join(process.cwd(), 'bin', 'pan-hook-deny-await-shell')
const PERMISSION_KEYS = new Set([
  'permission',
  'user_message',
  'agent_message',
  'updated_input',
])

function runHook(
  stdin: string,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const result = spawnSync(HOOK, [], {
    input: stdin,
    encoding: 'utf8',
    env,
    timeout: 10_000,
  })

  assert.equal(result.status, 0, `exits 0: ${result.stderr}`)
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>

  for (const key of Object.keys(parsed)) {
    assert.ok(PERMISSION_KEYS.has(key), `preToolUse output key ${key}`)
  }

  return parsed
}

function findOnPath(command: string): string {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(directory, command)

    if (directory.length > 0 && existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error(`${command} is not on PATH`)
}

// The hook needs bash, cat, and grep; python3 is deliberately absent.
function pathWithoutPython(): string {
  const directory = createTestTempDirectory('deny-hook-path-')

  for (const command of ['bash', 'cat', 'grep']) {
    symlinkSync(findOnPath(command), path.join(directory, command))
  }

  return directory
}

function payload(toolName: string, toolInput: unknown = {}): string {
  return JSON.stringify({
    hook_event_name: 'preToolUse',
    tool_name: toolName,
    tool_input: toolInput,
  })
}

test('AC-002: pan-hook-deny-await-shell denies AwaitShell and Await and allows other tools', async (t) => {
  for (const toolName of ['AwaitShell', 'Await']) {
    await t.test(`denies ${toolName} with a pan watch agent_message`, () => {
      const parsed = runHook(payload(toolName))
      assert.equal(parsed.permission, 'deny')
      assert.ok(
        typeof parsed.agent_message === 'string' &&
          parsed.agent_message.includes('pan watch'),
        `agent_message names pan watch: ${String(parsed.agent_message)}`,
      )
    })
  }

  for (const [label, stdin] of [
    ['Shell', payload('Shell', { command: 'ls' })],
    ['empty input', ''],
    ['non-JSON input', 'not json at all'],
    ['a JSON array', '[]'],
  ] as const) {
    await t.test(`allows ${label}`, () => {
      assert.deepEqual(runHook(stdin), { permission: 'allow' })
    })
  }
})

test('indexed invocation workers cannot launch primary or alternate agents and missing identity evidence fails closed', () => {
  const root = createTestTempDirectory('worker-launch-hook-')
  const directory = path.join(root, 'runtime/logs/agents')
  mkdirSync(directory, { recursive: true })
  const index = path.join(directory, 'index.json')
  writeFileSync(
    index,
    JSON.stringify({
      agents: [
        { agent_id: 'worker', run_id: 'run', invocation_id: 'invocation' },
      ],
      aliases: { session: 'worker' },
    }),
  )
  const env = { ...process.env, PANCREATOR_ROOT: root }
  const withoutPython = { ...env, PATH: pathWithoutPython() }
  for (const tool_name of [
    'Task',
    'task',
    'runSubagent',
    'create_session',
    'send_message',
    'functions.task',
  ]) {
    assert.equal(
      runHook(
        JSON.stringify({
          conversation_id: 'session',
          tool_name,
          tool_input: { mode: 'background', run_in_background: true },
        }),
        env,
      ).permission,
      'deny',
      tool_name,
    )
    const fallback = runHook(
      JSON.stringify({
        conversation_id: 'session',
        tool_name,
        tool_input: { mode: 'background', run_in_background: true },
      }),
      withoutPython,
    )
    assert.equal(fallback.permission, 'deny', `${tool_name} without Python`)
    assert.match(String(fallback.agent_message), /authority.*unavailable/iu)
  }
  assert.equal(
    runHook(
      JSON.stringify({
        conversation_id: 'session',
        tool_name: 'view',
      }),
      env,
    ).permission,
    'allow',
  )
  writeFileSync(index, 'not JSON')
  const denied = runHook(
    JSON.stringify({
      conversation_id: 'session',
      tool_name: 'Task',
      tool_input: { run_in_background: true },
    }),
    env,
  )
  assert.equal(denied.permission, 'deny')
  assert.match(
    String(denied.agent_message),
    /index is unavailable or malformed/,
  )
})

test('authority interpreter execution failure denies launches and sessions while allowing ordinary reads', () => {
  const tools = pathWithoutPython()
  const python = path.join(tools, 'python3')
  writeFileSync(python, '#!/bin/sh\nexit 19\n')
  chmodSync(python, 0o755)
  const env = { ...process.env, PATH: tools }
  for (const tool of [
    'Task',
    'task',
    'runSubagent',
    'create_session',
    'send_message',
    'functions.task',
    'AwaitShell',
  ]) {
    const result = runHook(
      payload(tool, { mode: 'background', run_in_background: true }),
      env,
    )
    assert.equal(result.permission, 'deny', tool)
    assert.match(
      String(result.agent_message),
      /authority.*unavailable|pan watch/iu,
    )
  }
  assert.equal(runHook(payload('view'), env).permission, 'allow')
})

test('AC-002: pan-hook-deny-await-shell denies a Task unless run_in_background is true', async (t) => {
  for (const [label, toolInput] of [
    ['an empty tool_input', {}],
    ['run_in_background false', { run_in_background: false }],
    ['the string "true"', { run_in_background: 'true' }],
    ['a JSON-string tool_input with false', '{"run_in_background":false}'],
  ] as const) {
    await t.test(
      `denies ${label} and names the relaunch and both watch forms`,
      () => {
        const parsed = runHook(payload('Task', toolInput))
        assert.equal(parsed.permission, 'deny')
        const message = String(parsed.agent_message)
        assert.ok(message.includes('run_in_background: true'), message)
        assert.ok(
          message.includes(
            'pan watch <run-id> --mark-background --handle <agent-id>',
          ),
          message,
        )
        assert.ok(message.includes('pan watch --agent <agent-id>'), message)
      },
    )
  }

  for (const [label, toolInput] of [
    ['run_in_background true', { run_in_background: true }],
    ['a JSON-string tool_input with true', '{"run_in_background":true}'],
  ] as const) {
    await t.test(`allows ${label}`, () => {
      assert.deepEqual(runHook(payload('Task', toolInput)), {
        permission: 'allow',
      })
    })
  }
})

test('C-013: malformed inputs preserve ordinary routing but unavailable authority denies launches', async (t) => {
  await t.test('an unparsable JSON-string tool_input allows the Task', () => {
    assert.deepEqual(runHook(payload('Task', '{not json')), {
      permission: 'allow',
    })
  })

  await t.test('a non-object tool_input allows the Task', () => {
    assert.deepEqual(runHook(payload('Task', [1, 2])), { permission: 'allow' })
  })

  const withoutPython = { ...process.env, PATH: pathWithoutPython() }
  await t.test('without python3 on PATH launch authority stays denied', () => {
    assert.equal(runHook(payload('Task'), withoutPython).permission, 'deny')
    assert.deepEqual(runHook(payload('view'), withoutPython), {
      permission: 'allow',
    })
  })

  await t.test('without python3 on PATH AwaitShell is still denied', () => {
    assert.equal(
      runHook(payload('AwaitShell'), withoutPython).permission,
      'deny',
    )
  })
})

test('completed Copilot agent results may be read immediately while running and unproven targets retain the await ban', () => {
  const root = createTestTempDirectory('completed-agent-read-')
  const directory = path.join(root, 'runtime/logs/agents')
  mkdirSync(directory, { recursive: true })
  const index = path.join(directory, 'index.json')
  const env = {
    ...process.env,
    PAN_HOOK_HOST: 'copilot-cli',
    PANCREATOR_ROOT: root,
  }

  for (const status of ['completed', 'error', 'aborted', 'running']) {
    writeFileSync(
      index,
      JSON.stringify({
        agents: [
          {
            agent_id: 'terminal-agent',
            status,
            last_event_kind: 'stopped',
            stop: { status },
          },
        ],
        aliases: { 'platform-id': 'terminal-agent' },
      }),
    )
    assert.equal(
      runHook(
        payload('read_agent', { agent_id: 'platform-id', wait: true }),
        env,
      ).permission,
      status === 'running' ? 'deny' : 'allow',
    )
  }

  writeFileSync(
    index,
    JSON.stringify({
      agents: [
        {
          agent_id: 'terminal-agent',
          status: 'completed',
          last_event_kind: 'call_finished',
        },
      ],
      aliases: {},
    }),
  )
  assert.equal(
    runHook(
      payload('read_agent', { agent_id: 'terminal-agent', wait: true }),
      env,
    ).permission,
    'deny',
  )
  assert.equal(
    runHook(payload('read_agent', { agent_id: 'unknown', wait: true }), env)
      .permission,
    'deny',
  )
  assert.equal(
    runHook(payload('read_agent', { agent_id: 'unknown', wait: false }), env)
      .permission,
    'allow',
  )
  writeFileSync(index, 'invalid index')
  assert.equal(
    runHook(
      payload('read_agent', { agent_id: 'terminal-agent', wait: true }),
      env,
    ).permission,
    'deny',
  )
})

test('the deny hook applies each host tool registry entry, and its built-in fallback matches the registry', () => {
  const registry = JSON.parse(
    readFileSync(
      path.join(process.cwd(), 'governance/registries/host_tools.json'),
      'utf8',
    ),
  ) as {
    terms: Record<
      string,
      {
        tools: Record<string, string[]>
        when_argument?: Record<string, Record<string, string>>
      }
    >
  }
  const bin = path.join(createTestTempDirectory('deny-hook-fallback-'), 'bin')

  mkdirSync(bin, { recursive: true })
  copyFileSync(HOOK, path.join(bin, 'pan-hook-deny-await-shell'))
  chmodSync(path.join(bin, 'pan-hook-deny-await-shell'), 0o755)

  const decide = (
    hook: string,
    host: string,
    toolName: string,
    toolInput: Record<string, unknown> = {},
  ): unknown => {
    const result = spawnSync(hook, [], {
      input: payload(toolName, toolInput),
      encoding: 'utf8',
      env: { ...process.env, PAN_HOOK_HOST: host },
      timeout: 10_000,
    })

    return (JSON.parse(result.stdout) as { permission: unknown }).permission
  }
  const fallbackHook = path.join(bin, 'pan-hook-deny-await-shell')

  for (const host of ['cursor', 'vscode', 'copilot-cli']) {
    const awaitTools = registry.terms.platform_await?.tools[host] ?? []
    const awaitWhen = registry.terms.platform_await?.when_argument?.[host] ?? {}
    const launchTools = registry.terms.subagent_launch?.tools[host] ?? []
    const sessionTools = registry.terms.agent_session?.tools[host] ?? []

    for (const toolName of [
      ...awaitTools,
      ...launchTools,
      ...sessionTools,
      'Read',
    ]) {
      const condition = awaitWhen[toolName]
      const toolInput = condition ? { [condition]: 30 } : {}
      const expected = toolName === 'Read' ? 'allow' : 'deny'

      for (const hook of [HOOK, fallbackHook]) {
        assert.equal(
          decide(hook, host, toolName, toolInput),
          expected,
          `${hook === HOOK ? '' : 'fallback '}${host} ${toolName}`,
        )

        if (condition) {
          assert.equal(
            decide(hook, host, toolName),
            'allow',
            `${host} ${toolName} without ${condition}`,
          )
        }
      }
    }
  }
})

test('AC-002: the hooks source routes AwaitShell, Await, and Task to the fail-closed deny hook', () => {
  const hooks = JSON.parse(
    readFileSync(path.join(process.cwd(), 'library/cursor/hooks.json'), 'utf8'),
  ) as {
    hooks: {
      preToolUse: { command: string; matcher: string; failClosed: boolean }[]
    }
  }
  const entry = hooks.hooks.preToolUse.find((candidate) =>
    candidate.command.includes('pan-hook-deny-await-shell'),
  )
  assert.ok(entry)
  assert.equal(entry.failClosed, true)
  const matcher = new RegExp(entry.matcher, 'u')

  for (const name of ['AwaitShell', 'Await', 'Task']) {
    assert.match(name, matcher)
  }

  for (const name of ['Shell', 'Read']) {
    assert.doesNotMatch(name, matcher)
  }
})
