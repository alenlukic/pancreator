import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

const HOOK = path.join(process.cwd(), 'bin', 'pan-hook-deny-await-shell')

function runHook(stdin: string): { stdout: string; exitCode: number } {
  const result = spawnSync(HOOK, [], {
    input: stdin,
    encoding: 'utf8',
    timeout: 10_000,
  })

  return {
    stdout: result.stdout,
    exitCode: result.status ?? -1,
  }
}

test('AC-003: pan-hook-deny-await-shell', async (t) => {
  await t.test(
    'denies AwaitShell and includes pan watch in agent_message',
    () => {
      const { stdout, exitCode } = runHook(
        JSON.stringify({ tool_name: 'AwaitShell' }),
      )
      const parsed = JSON.parse(stdout) as Record<string, unknown>
      assert.equal(exitCode, 0, 'exits 0')
      assert.equal(parsed.continue, false, 'continue is false for AwaitShell')
      assert.ok(
        typeof parsed.agentMessage === 'string' &&
          parsed.agentMessage.includes('pan watch'),
        `agentMessage names pan watch: ${String(parsed.agentMessage)}`,
      )
    },
  )

  await t.test('denies Await (alias)', () => {
    const { stdout, exitCode } = runHook(JSON.stringify({ tool_name: 'Await' }))
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    assert.equal(exitCode, 0, 'exits 0')
    assert.equal(parsed.continue, false, 'continue is false for Await')
  })

  await t.test('allows Shell (any other tool)', () => {
    const { stdout, exitCode } = runHook(JSON.stringify({ tool_name: 'Shell' }))
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    assert.equal(exitCode, 0, 'exits 0')
    assert.equal(parsed.continue, true, 'continue is true for Shell')
  })

  await t.test('allows empty input (unparsable)', () => {
    const { stdout, exitCode } = runHook('')
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    assert.equal(exitCode, 0, 'exits 0')
    assert.equal(parsed.continue, true, 'continue is true for empty input')
  })

  await t.test('allows non-JSON input', () => {
    const { stdout, exitCode } = runHook('not json at all')
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    assert.equal(exitCode, 0, 'exits 0')
    assert.equal(parsed.continue, true, 'continue is true for non-JSON')
  })
})
