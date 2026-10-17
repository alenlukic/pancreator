import assert from 'node:assert/strict'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
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

const PRINCIPLES_PREFIX =
  'Remember the operating principles; you MUST abide by these:'

function principlesReminder(root: string): string {
  const section = readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
    .split(/\n(?=## )/u)
    .find((part) => part.startsWith('## Mission and operating principles\n'))

  assert.ok(section)
  return `${PRINCIPLES_PREFIX}\n${section.trim()}`
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
      /^Active card: .+ \(sha256:[a-f0-9]{64}\)$/mu,
    )
    assert.ok(response.additional_context?.endsWith(principlesReminder(root)))
    assert.equal(
      response.additional_context?.split(PRINCIPLES_PREFIX).length,
      2,
    )
  }
})

test('prompt and session hooks end with the current operating principles', () => {
  const root = createFixture()

  for (const event of [
    'beforeSubmitPrompt',
    'UserPromptSubmit',
    'sessionStart',
    'SessionStart',
  ]) {
    const response = invoke(root, event, 'ordinary operator request', event)

    assert.ok(response.additional_context?.endsWith(principlesReminder(root)))
  }

  const card = path.join(root, 'AGENTS.md')
  writeFileSync(
    card,
    readFileSync(card, 'utf8').replace(
      '## Invariants',
      'Fixture principle added after the first prompt.\n\n## Invariants',
    ),
  )

  const updated = invoke(root, 'updated-principles', 'ordinary request')

  assert.ok(updated.additional_context?.endsWith(principlesReminder(root)))
  assert.match(
    updated.additional_context ?? '',
    /Fixture principle added after the first prompt\.$/u,
  )
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

test('an expanded bounded read-only command body carries only the principles reminder', () => {
  const root = createFixture()

  for (const command of ['pan-status', 'pan-validate']) {
    const expanded = readFileSync(
      path.join(root, '.cursor', 'commands', `${command}.md`),
      'utf8',
    )

    assert.deepEqual(invoke(root, `expanded-${command}`, expanded), {
      continue: true,
      additional_context: principlesReminder(root),
    })
    assert.deepEqual(
      invoke(
        root,
        `expanded-arguments-${command}`,
        expanded.replaceAll('$ARGUMENTS', '63287_Sep-22-0314_fixture'),
      ),
      { continue: true, additional_context: principlesReminder(root) },
    )
  }
})

test('excluded sessions retain the principles and other hook events stay permissive', () => {
  const root = createFixture()

  for (const prompt of [
    '/pan-meta-orchestrator',
    '/pan-orchestrator',
    '/pan-status',
    './bin/pan horizon start fixture --headless',
  ]) {
    assert.deepEqual(invoke(root, prompt, prompt), {
      continue: true,
      additional_context: principlesReminder(root),
    })
  }

  assert.deepEqual(invoke(root, 'subagent', '/pan-pair', 'subagentStart'), {
    continue: true,
  })
})

test('hook entry reaches the CLI from a working directory outside the harness', () => {
  const entry = path.join(process.cwd(), 'bin', 'pan-hook-governance-reminder')
  const environment = { ...process.env }

  // Cursor runs the hook from the operator's workspace, so an inherited root
  // would hide the entry's own root resolution.
  delete environment.PANCREATOR_ROOT

  const result = spawnSync(entry, {
    cwd: path.parse(process.cwd()).root,
    encoding: 'utf8',
    env: environment,
    input: JSON.stringify({
      hook_event_name: 'beforeSubmitPrompt',
      prompt: '/pan-pair',
    }),
    timeout: 30_000,
  })

  assert.equal(result.status, 0, result.stderr)

  const response = JSON.parse(result.stdout) as HookResponse

  assert.equal(response.continue, true)
  assert.match(response.additional_context ?? '', /^Role: pair$/mu)
  assert.ok(
    response.additional_context?.endsWith(principlesReminder(process.cwd())),
  )
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
