import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
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

test('C-013: a fault in the Task path allows the Task and keeps the AwaitShell ban', async (t) => {
  await t.test('an unparsable JSON-string tool_input allows the Task', () => {
    assert.deepEqual(runHook(payload('Task', '{not json')), {
      permission: 'allow',
    })
  })

  await t.test('a non-object tool_input allows the Task', () => {
    assert.deepEqual(runHook(payload('Task', [1, 2])), { permission: 'allow' })
  })

  const withoutPython = { ...process.env, PATH: pathWithoutPython() }
  await t.test('without python3 on PATH the Task is allowed', () => {
    assert.deepEqual(runHook(payload('Task'), withoutPython), {
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

test('the deny hook applies each host tool registry entry, and its built-in fallback matches the registry', () => {
  const registry = JSON.parse(
    readFileSync(
      path.join(process.cwd(), 'governance/registries/host_tools.json'),
      'utf8',
    ),
  ) as {
    terms: Record<string, { tools: Record<string, string[]> }>
  }
  const bin = path.join(createTestTempDirectory('deny-hook-fallback-'), 'bin')

  mkdirSync(bin, { recursive: true })
  copyFileSync(HOOK, path.join(bin, 'pan-hook-deny-await-shell'))
  chmodSync(path.join(bin, 'pan-hook-deny-await-shell'), 0o755)

  const decide = (hook: string, host: string, toolName: string): unknown => {
    const result = spawnSync(hook, [], {
      input: payload(toolName),
      encoding: 'utf8',
      env: { ...process.env, PAN_HOOK_HOST: host },
      timeout: 10_000,
    })

    return (JSON.parse(result.stdout) as { permission: unknown }).permission
  }

  for (const host of ['cursor', 'vscode', 'copilot-cli']) {
    const awaitTools = registry.terms.platform_await?.tools[host] ?? []
    const launchTools = registry.terms.subagent_launch?.tools[host] ?? []

    for (const toolName of [...awaitTools, ...launchTools, 'Read']) {
      const expected =
        awaitTools.includes(toolName) || launchTools.includes(toolName)
          ? 'deny'
          : 'allow'

      assert.equal(
        decide(HOOK, host, toolName),
        expected,
        `${host} ${toolName}`,
      )
      assert.equal(
        decide(path.join(bin, 'pan-hook-deny-await-shell'), host, toolName),
        expected,
        `fallback ${host} ${toolName}`,
      )
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
