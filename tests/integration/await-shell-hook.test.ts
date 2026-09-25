import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const HOOK = path.join(process.cwd(), 'bin', 'pan-hook-deny-await-shell')
const PERMISSION_KEYS = new Set([
  'permission',
  'user_message',
  'agent_message',
  'updated_input',
])

function runHook(stdin: string): Record<string, unknown> {
  const result = spawnSync(HOOK, [], {
    input: stdin,
    encoding: 'utf8',
    timeout: 10_000,
  })

  assert.equal(result.status, 0, `exits 0: ${result.stderr}`)
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>

  for (const key of Object.keys(parsed)) {
    assert.ok(PERMISSION_KEYS.has(key), `preToolUse output key ${key}`)
  }

  return parsed
}

function payload(toolName: string): string {
  return JSON.stringify({
    hook_event_name: 'preToolUse',
    tool_name: toolName,
    tool_input: {},
  })
}

test('AC-003: pan-hook-deny-await-shell prints the preToolUse permission schema', async (t) => {
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
    ['Shell', payload('Shell')],
    ['empty input', ''],
    ['non-JSON input', 'not json at all'],
    ['a JSON array', '[]'],
  ] as const) {
    await t.test(`allows ${label}`, () => {
      assert.deepEqual(runHook(stdin), { permission: 'allow' })
    })
  }
})

test('AC-002: the hooks source matches only the await tool names', () => {
  const hooks = JSON.parse(
    readFileSync(path.join(process.cwd(), 'library/cursor/hooks.json'), 'utf8'),
  ) as { hooks: { preToolUse: { matcher: string; failClosed: boolean }[] } }
  const [entry] = hooks.hooks.preToolUse
  assert.ok(entry)
  assert.equal(entry.failClosed, true)
  const matcher = new RegExp(entry.matcher, 'u')

  for (const name of ['AwaitShell', 'Await']) {
    assert.match(name, matcher)
  }

  for (const name of ['Shell', 'Read', 'Task']) {
    assert.doesNotMatch(name, matcher)
  }
})
