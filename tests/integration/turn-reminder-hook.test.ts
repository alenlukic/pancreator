import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { createFixture } from '../fixture-template.js'
import { createTestTempDirectory } from '../temp.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

interface HookResponse {
  continue: true
  additional_context?: string
}

function invoke(
  root: string,
  conversationId: string,
  prompt: string,
  hookEventName = 'beforeSubmitPrompt',
): HookResponse {
  const result = spawnSync(
    process.execPath,
    [CLI, 'governance', 'prompt-context'],
    {
      cwd: root,
      encoding: 'utf8',
      input: JSON.stringify({
        conversation_id: conversationId,
        hook_event_name: hookEventName,
        prompt,
      }),
      timeout: 10_000,
    },
  )

  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout) as HookResponse
}

test('the CLI emits the declared reminder for every governed role', () => {
  const root = createFixture()
  const cases: Array<[string, string]> = [
    ['regular-supervisor', '/pan-start'],
    ['cohort-supervisor', '/pan-cohort'],
    ['long-horizon-supervisor', '/pan-horizon'],
    ['unbound', 'ordinary operator request'],
    ['pair', '/pan-pair'],
    ['shepherd', '/pan-shepherd'],
    ['debloat', '/pan-debloat'],
    ['cleanup', '/pan-cleanup'],
    ['standalone-other', '/pan-style'],
  ]

  for (const [expectedRole, prompt] of cases) {
    const response = invoke(root, expectedRole, prompt)

    assert.equal(response.continue, true)
    assert.match(
      response.additional_context ?? '',
      new RegExp(`^Role: ${expectedRole}$`, 'mu'),
    )
    assert.match(response.additional_context ?? '', /^\[COMMS-001\]$/mu)
    assert.match(
      response.additional_context ?? '',
      /Active card: .+ \(sha256:[a-f0-9]{64}\)$/u,
    )
  }
})

test('expanded command content resolves through its canonical opening line', () => {
  const root = createFixture()
  const expanded = readFileSync(
    path.join(root, 'library', 'cursor', 'commands', 'pan-pair.md'),
    'utf8',
  )
  const response = invoke(root, 'expanded-pair', expanded)

  assert.match(response.additional_context ?? '', /^Role: pair$/mu)
})

test('an expanded bounded read-only command body carries no reminder', () => {
  const root = createFixture()

  for (const command of ['pan-status', 'pan-validate']) {
    const expanded = readFileSync(
      path.join(root, '.cursor', 'commands', `${command}.md`),
      'utf8',
    )

    assert.deepEqual(invoke(root, `expanded-${command}`, expanded), {
      continue: true,
    })
    assert.deepEqual(
      invoke(
        root,
        `expanded-arguments-${command}`,
        expanded.replaceAll('$ARGUMENTS', '63287_Sep-22-0314_fixture'),
      ),
      { continue: true },
    )
  }
})

test('excluded sessions and other hook events receive a permissive response', () => {
  const root = createFixture()

  for (const prompt of [
    '/pan-meta-orchestrator',
    '/pan-orchestrator',
    '/pan-status',
    './bin/pan horizon start fixture --headless',
  ]) {
    assert.deepEqual(invoke(root, prompt, prompt), { continue: true })
  }

  assert.deepEqual(invoke(root, 'subagent', '/pan-pair', 'subagentStart'), {
    continue: true,
  })
})

test('hook entry uses the built CLI and degrades permissively when it is missing', () => {
  const root = createTestTempDirectory('prompt-context-hook')
  const bin = path.join(root, 'bin')
  const hook = path.join(bin, 'pan-hook-governance-reminder')
  const source = path.join(process.cwd(), 'bin', 'pan-hook-governance-reminder')

  mkdirSync(bin, { recursive: true })
  copyFileSync(source, hook)
  chmodSync(hook, 0o755)

  const result = spawnSync(hook, {
    cwd: root,
    encoding: 'utf8',
    input: '{"prompt":"hello"}',
    timeout: 5000,
  })

  assert.equal(result.status, 0)
  assert.deepEqual(JSON.parse(result.stdout), { continue: true })

  const script = readFileSync(source, 'utf8')

  assert.match(script, /dist\/src\/cli\.js/u)
  assert.doesNotMatch(script, /bin\/pan(?:\s|["'])/u)
  assert.doesNotMatch(script, /\b(?:npm|tsc)\b/u)
})
