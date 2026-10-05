import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

const BIN = path.join(process.cwd(), 'bin')

interface HookResult {
  status: number | null
  stdout: string
  stderr: string
}

function runAdapter(
  args: string[],
  payload: unknown,
  bin: string = BIN,
): HookResult {
  const result = spawnSync(path.join(bin, 'pan-hook-adapter'), args, {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 20_000,
  })

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

const copilotShell = (command: string) => ({
  sessionId: 'session-1',
  toolName: 'bash',
  toolArgs: { command, description: 'probe' },
})

const vscodeTool = (toolName: string, toolInput: unknown = {}) => ({
  hook_event_name: 'PreToolUse',
  session_id: 'session-2',
  tool_name: toolName,
  tool_input: toolInput,
  tool_use_id: 'call-1',
})

/** A bin directory holding the adapter and one stub hook that prints `response`. */
function stubBin(response: string): string {
  const bin = path.join(createTestTempDirectory('hook-adapter-'), 'bin')

  mkdirSync(bin, { recursive: true })
  copyFileSync(
    path.join(BIN, 'pan-hook-adapter'),
    path.join(bin, 'pan-hook-adapter'),
  )
  chmodSync(path.join(bin, 'pan-hook-adapter'), 0o755)
  writeFileSync(
    path.join(bin, 'pan-hook-stub'),
    `#!/usr/bin/env bash\ncat >/dev/null\nprintf '%s\\n' '${response}'\n`,
    { mode: 0o755 },
  )

  return bin
}

test('the shell guard denies an unwrapped command with exit 2 for both hosts and prints nothing on allow', async (t) => {
  const guard = [
    '--fail-closed',
    'beforeShellExecution',
    'pan-hook-shell-monitor',
  ]

  await t.test('Copilot CLI bash, unwrapped', () => {
    const result = runAdapter(guard, copilotShell('npm test'))
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /bin\/pan-run/u)
  })

  await t.test('VS Code run_in_terminal, unwrapped', () => {
    const result = runAdapter(
      guard,
      vscodeTool('run_in_terminal', { command: 'npm test' }),
    )
    assert.equal(result.status, 2)
    assert.match(result.stderr, /bin\/pan-run/u)
  })

  for (const [label, payload] of [
    ['Copilot CLI bash, allowlisted', copilotShell('ls')],
    [
      'VS Code run_in_terminal, wrapped',
      vscodeTool('run_in_terminal', { command: './bin/pan-run -- npm test' }),
    ],
    [
      'VS Code non-shell tool, whose matcher the host discards',
      vscodeTool('read_file', { filePath: '/x' }),
    ],
  ] as const) {
    await t.test(`${label} allows with no output`, () => {
      const result = runAdapter(guard, payload)
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stdout, '')
    })
  }
})

test('the deny hook refuses a foreground subagent tool on hosts without a background mode', async (t) => {
  const guard = ['--fail-closed', 'preToolUse', 'pan-hook-deny-await-shell']

  for (const [label, payload] of [
    ['VS Code runSubagent', vscodeTool('runSubagent', { prompt: 'x' })],
    [
      'Copilot CLI task',
      { sessionId: 's', toolName: 'task', toolArgs: { mode: 'sync' } },
    ],
  ] as const) {
    await t.test(label, () => {
      const result = runAdapter(guard, payload)
      assert.equal(result.status, 2)
      assert.match(result.stderr, /pan delegate <run-id> --headless/u)
    })
  }

  await t.test('another tool allows with no output', () => {
    const result = runAdapter(guard, vscodeTool('read_file'))
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '')
  })
})

test('fail-closed decides an unreadable payload and an unknown script', () => {
  const args = ['preToolUse', 'pan-hook-deny-await-shell']

  assert.equal(runAdapter(['--fail-closed', ...args], 'not json').status, 2)
  assert.equal(runAdapter(args, 'not json').status, 0)
  assert.equal(
    runAdapter(['--fail-closed', 'preToolUse', 'rm'], vscodeTool('x')).status,
    2,
  )
})

test('a crashing guard denies only when registered fail-closed', () => {
  const bin = stubBin('not json')

  assert.equal(
    runAdapter(
      ['--fail-closed', 'preToolUse', 'pan-hook-stub'],
      vscodeTool('x'),
      bin,
    ).status,
    2,
  )
  assert.equal(
    runAdapter(['preToolUse', 'pan-hook-stub'], vscodeTool('x'), bin).status,
    0,
  )
})

test('Cursor context responses become VS Code hookSpecificOutput and Copilot CLI gets none', async (t) => {
  await t.test('postToolUse additional_context', () => {
    const bin = stubBin('{"additional_context":"say something"}')
    const vscode = runAdapter(
      ['postToolUse', 'pan-hook-stub'],
      vscodeTool('x'),
      bin,
    )
    assert.deepEqual(JSON.parse(vscode.stdout), {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: 'say something',
      },
    })
    const copilot = runAdapter(
      ['postToolUse', 'pan-hook-stub'],
      copilotShell('ls'),
      bin,
    )
    assert.equal(copilot.status, 0)
    assert.equal(copilot.stdout, '')
  })

  await t.test('beforeSubmitPrompt additional_context', () => {
    const bin = stubBin('{"continue":true,"additional_context":"card"}')
    const result = runAdapter(
      ['beforeSubmitPrompt', 'pan-hook-stub'],
      { hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'hi' },
      bin,
    )
    assert.deepEqual(JSON.parse(result.stdout), {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: 'card',
      },
    })
  })

  await t.test('stop followup_message', () => {
    const bin = stubBin('{"followup_message":"report now"}')
    const result = runAdapter(
      ['stop', 'pan-hook-stub'],
      { hook_event_name: 'Stop', session_id: 's', stop_hook_active: false },
      bin,
    )
    assert.deepEqual(JSON.parse(result.stdout), {
      decision: 'block',
      reason: 'report now',
    })
  })

  await t.test('allow and continue print nothing', () => {
    for (const response of [
      '{"permission":"allow"}',
      '{"continue":true}',
      '{}',
    ]) {
      const result = runAdapter(
        ['preToolUse', 'pan-hook-stub'],
        vscodeTool('x'),
        stubBin(response),
      )
      assert.equal(result.status, 0)
      assert.equal(result.stdout, '')
    }
  })
})

test('the adapter hands the script a Cursor payload with the host dialect', () => {
  const bin = stubBin('{}')

  writeFileSync(
    path.join(bin, 'pan-hook-stub'),
    '#!/usr/bin/env bash\npayload="$(cat)"\nprintf \'{"additional_context":%s}\\n\' "$(printf \'%s\' "$PAN_HOOK_HOST|$payload" | python3 -c \'import json,sys; print(json.dumps(sys.stdin.read()))\')"\n',
    { mode: 0o755 },
  )

  const result = runAdapter(
    ['postToolUse', 'pan-hook-stub'],
    {
      hook_event_name: 'PostToolUse',
      session_id: 'session-9',
      transcript_path: '/tmp/t.jsonl',
      tool_name: 'run_in_terminal',
      tool_input: { command: 'ls' },
      tool_use_id: 'call-9',
      tool_response: 'out',
    },
    bin,
  )
  const context = (
    JSON.parse(result.stdout) as {
      hookSpecificOutput: { additionalContext: string }
    }
  ).hookSpecificOutput.additionalContext
  const [host, payloadText] = context.split(/\|(.*)/su)

  assert.equal(host, 'vscode')
  assert.deepEqual(JSON.parse(payloadText ?? ''), {
    hook_event_name: 'postToolUse',
    host: 'vscode',
    conversation_id: 'session-9',
    transcript_path: '/tmp/t.jsonl',
    tool_name: 'run_in_terminal',
    tool_input: { command: 'ls' },
    tool_use_id: 'call-9',
    tool_output: 'out',
    workspace_roots: [],
  })
})
