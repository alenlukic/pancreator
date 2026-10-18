import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { renderTurnReminder } from '../../src/lib/governance/prompt-context.js'
import { createFixture } from '../fixture-template.js'
import { createTestTempDirectory } from '../temp.js'

const BIN = path.join(process.cwd(), 'bin')

function runGuard(
  tool: string,
  args: unknown,
  host: 'copilot-cli' | 'vscode' = 'copilot-cli',
  bin = BIN,
  hook = tool === 'bash' || tool === 'run_in_terminal'
    ? 'pan-hook-shell-monitor'
    : 'pan-hook-deny-await-shell',
) {
  const payload =
    host === 'copilot-cli'
      ? { sessionId: 'startup-test', toolName: tool, toolArgs: args }
      : { session_id: 'startup-test', tool_name: tool, tool_input: args }

  return spawnSync(
    path.join(bin, 'pan-hook-adapter'),
    [
      '--fail-closed',
      hook === 'pan-hook-shell-monitor' ? 'beforeShellExecution' : 'preToolUse',
      hook,
    ],
    {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 2 * 1024 * 1024,
    },
  )
}

function assertDenied(result: ReturnType<typeof runGuard>, reason: RegExp) {
  assert.equal(result.status, 0, result.stderr)

  const output = JSON.parse(result.stdout) as {
    permissionDecision: string
    permissionDecisionReason: string
    hookSpecificOutput: Record<string, unknown>
  }

  assert.equal(output.permissionDecision, 'deny')
  assert.match(output.permissionDecisionReason, reason)
  assert.deepEqual(output.hookSpecificOutput, {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: output.permissionDecisionReason,
  })
}

test('startup commands reach the wrapper that already bounds lifecycle output', () => {
  for (const command of [
    'bin/pan-run -- ./bin/pan governance card --mode unbound',
    'bin/pan-run -- ./bin/pan governance card --mode pair --worktree selected',
    'bin/pan-run -- ./bin/pan init --request input.md',
    'bin/pan-run -- ./bin/pan status run --summary',
    'bin/pan-run -- ./bin/pan worktree --help',
  ]) {
    const result = runGuard('bash', { command })

    assert.equal(result.status, 0, command)
    assert.equal(result.stdout, '', command)
  }
})

test('read-only Git commands accept pager suppression and working directory options', () => {
  for (const command of [
    'git --no-pager status --short',
    'git --no-pager diff --stat',
    'git -C /workspace status --short --branch',
    'git --no-pager -C /workspace log --oneline -5',
    'git -C/workspace --no-pager rev-parse HEAD',
  ]) {
    const result = runGuard('bash', { command })

    assert.equal(result.status, 0, command)
    assert.equal(result.stdout, '', command)
  }
})

test('intentional denials expose the same reason to both hosts without a hook failure', () => {
  for (const host of ['copilot-cli', 'vscode'] as const) {
    const tool = host === 'copilot-cli' ? 'bash' : 'run_in_terminal'

    for (const command of [
      'npm test',
      'git --no-pager -C /workspace push',
      'git --no-pager -c alias.status=push status',
      'git --no-pager diff --output=result',
      'git --no-pager diff --ext-diff',
      'git --no-pager log --textconv',
    ]) {
      assertDenied(runGuard(tool, { command }, host), /bin\/pan-run/u)
    }
  }

  assertDenied(
    runGuard('read_bash', { shellId: 'worker', delay: 30 }),
    /pan watch/u,
  )
  assertDenied(runGuard('task', { mode: 'sync' }), /background/u)
})

test('large tool payloads preserve file-edit access and subagent restrictions', () => {
  for (const host of ['copilot-cli', 'vscode'] as const) {
    const result = runGuard(
      'edit',
      { new_str: 'x'.repeat(2 * 1024 * 1024) },
      host,
    )

    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '')

    const tool = host === 'copilot-cli' ? 'task' : 'runSubagent'

    assertDenied(
      runGuard(
        tool,
        { prompt: 'x'.repeat(2 * 1024 * 1024), mode: 'sync' },
        host,
      ),
      /background|foreground/u,
    )
  }
})

test('fail-closed guards reject a child crash even when it printed an allow response', () => {
  const bin = path.join(createTestTempDirectory('startup-guard-crash-'), 'bin')

  mkdirSync(bin, { recursive: true })
  copyFileSync(
    path.join(BIN, 'pan-hook-adapter'),
    path.join(bin, 'pan-hook-adapter'),
  )
  writeFileSync(
    path.join(bin, 'pan-hook-stub'),
    '#!/usr/bin/env bash\ncat >/dev/null\nprintf \'%s\\n\' \'{"permission":"allow"}\'\nexit 1\n',
    { mode: 0o755 },
  )

  assertDenied(
    runGuard('edit', {}, 'copilot-cli', bin, 'pan-hook-stub'),
    /failed|exit/u,
  )
})

test('a guard timeout returns a denial before the host timeout can allow the call', () => {
  const bin = path.join(
    createTestTempDirectory('startup-guard-timeout-'),
    'bin',
  )

  mkdirSync(bin, { recursive: true })
  copyFileSync(
    path.join(BIN, 'pan-hook-adapter'),
    path.join(bin, 'pan-hook-adapter'),
  )
  writeFileSync(
    path.join(bin, 'pan-hook-stub'),
    '#!/usr/bin/env bash\nexec python3 -c "import time; time.sleep(30)"\n',
    { mode: 0o755 },
  )

  assertDenied(
    runGuard('edit', {}, 'copilot-cli', bin, 'pan-hook-stub'),
    /timed out/u,
  )
})

test('reminders cite common governance instead of another session worktree card', () => {
  const root = createFixture()
  const session = path.join(root, 'runtime/logs/sessions/unrelated-session')

  mkdirSync(session, { recursive: true })
  writeFileSync(
    path.join(session, 'pair-card.md'),
    '# Pair\nWorktree: unrelated-worktree\n',
  )

  for (const role of ['pair', 'regular-supervisor'] as const) {
    const reminder = renderTurnReminder(root, role, {
      mode: 'pair',
      liveRuns: [],
    })

    assert.equal(reminder.card.path, 'AGENTS.md')
    assert.doesNotMatch(
      reminder.content,
      /unrelated-session|unrelated-worktree|worktrees\//u,
    )
  }
})
