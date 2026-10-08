import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { readIndex } from '../../src/lib/agent-index/store.js'
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

test('the deny hook refuses foreground subagents, waits, and agent session tools', async (t) => {
  const guard = ['--fail-closed', 'preToolUse', 'pan-hook-deny-await-shell']
  const copilotTool = (toolName: string, toolArgs: unknown) => ({
    sessionId: 's',
    toolName,
    toolArgs,
  })

  await t.test('VS Code runSubagent', () => {
    const result = runAdapter(guard, vscodeTool('runSubagent', { prompt: 'x' }))
    assert.equal(result.status, 2)
    assert.match(result.stderr, /pan delegate <run-id> --headless/u)
  })

  await t.test('Copilot task in sync mode', () => {
    const result = runAdapter(guard, copilotTool('task', { mode: 'sync' }))
    assert.equal(result.status, 2)
    assert.match(result.stderr, /mode: "background"/u)
  })

  await t.test('Copilot task in background mode allows', () => {
    const result = runAdapter(
      guard,
      copilotTool('task', { prompt: 'x', mode: 'background' }),
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '')
  })

  await t.test('Copilot read_bash with a delay', () => {
    const result = runAdapter(
      guard,
      copilotTool('read_bash', { shellId: '2', delay: 30 }),
    )
    assert.equal(result.status, 2)
    assert.match(result.stderr, /platform await/u)
  })

  await t.test('Copilot read_bash without a delay allows', () => {
    const result = runAdapter(guard, copilotTool('read_bash', { shellId: '2' }))
    assert.equal(result.status, 0, result.stderr)
  })

  await t.test('Copilot read_agent with wait', () => {
    const result = runAdapter(
      guard,
      copilotTool('read_agent', { agent_id: 'a', wait: true, timeout: 120 }),
    )
    assert.equal(result.status, 2)
    assert.match(result.stderr, /platform await/u)
  })

  await t.test('Copilot read_agent without wait allows', () => {
    const result = runAdapter(
      guard,
      copilotTool('read_agent', { agent_id: 'a', wait: false }),
    )
    assert.equal(result.status, 0, result.stderr)
  })

  for (const toolName of ['create_session', 'send_message']) {
    await t.test(`Agent Host ${toolName}`, () => {
      const result = runAdapter(guard, copilotTool(toolName, {}))
      assert.equal(result.status, 2)
      assert.match(result.stderr, /cannot observe/u)
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

test('Cursor context and stop responses print both host shapes in one object', async (t) => {
  const contextOutput = (hookEventName: string, text: string) => ({
    additionalContext: text,
    hookSpecificOutput: { hookEventName, additionalContext: text },
  })

  await t.test('postToolUse additional_context on both hosts', () => {
    const bin = stubBin('{"additional_context":"say something"}')

    for (const payload of [vscodeTool('x'), copilotShell('ls')]) {
      const result = runAdapter(['postToolUse', 'pan-hook-stub'], payload, bin)
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(
        JSON.parse(result.stdout),
        contextOutput('PostToolUse', 'say something'),
      )
    }
  })

  await t.test('beforeSubmitPrompt additional_context', () => {
    const bin = stubBin('{"continue":true,"additional_context":"card"}')

    for (const payload of [
      { hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'hi' },
      { sessionId: 's', prompt: 'hi', timestamp: 1 },
    ]) {
      const result = runAdapter(
        ['beforeSubmitPrompt', 'pan-hook-stub'],
        payload,
        bin,
      )
      assert.deepEqual(
        JSON.parse(result.stdout),
        contextOutput('UserPromptSubmit', 'card'),
      )
    }
  })

  await t.test('sessionStart additional_context', () => {
    const bin = stubBin('{"continue":true,"additional_context":"card"}')

    for (const payload of [
      { hook_event_name: 'SessionStart', session_id: 's', source: 'new' },
      { sessionId: 's', source: 'new', initialPrompt: '/pan-start x' },
    ]) {
      const result = runAdapter(['sessionStart', 'pan-hook-stub'], payload, bin)
      assert.deepEqual(
        JSON.parse(result.stdout),
        contextOutput('SessionStart', 'card'),
      )
    }
  })

  await t.test('a hook response printed across several lines', () => {
    const bin = stubBin(
      JSON.stringify({ continue: true, additional_context: 'card' }, null, 2),
    )

    for (const payload of [
      { hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'hi' },
      { sessionId: 's', prompt: 'hi', timestamp: 1 },
    ]) {
      const result = runAdapter(
        ['beforeSubmitPrompt', 'pan-hook-stub'],
        payload,
        bin,
      )
      assert.deepEqual(
        JSON.parse(result.stdout),
        contextOutput('UserPromptSubmit', 'card'),
      )
    }
  })

  await t.test('stop followup_message on both hosts', () => {
    const bin = stubBin('{"followup_message":"report now"}')

    for (const payload of [
      { hook_event_name: 'Stop', session_id: 's', stop_hook_active: false },
      {
        sessionId: 's',
        transcriptPath: '/u/.copilot/session-state/s/events.jsonl',
        stopReason: 'end_turn',
        stop_hook_active: false,
      },
    ]) {
      const result = runAdapter(['stop', 'pan-hook-stub'], payload, bin)
      assert.deepEqual(JSON.parse(result.stdout), {
        decision: 'block',
        reason: 'report now',
        hookSpecificOutput: {
          hookEventName: 'Stop',
          decision: 'block',
          reason: 'report now',
        },
      })
    }
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

test('a payload larger than the environment limit still reaches a fail-closed hook', () => {
  const bin = stubBin('{}')

  writeFileSync(
    path.join(bin, 'pan-hook-stub'),
    '#!/usr/bin/env bash\nbytes="$(wc -c | tr -d " ")"\nprintf \'{"permission":"allow","additional_context":"%s"}\\n\' "$bytes"\n',
    { mode: 0o755 },
  )

  const content = 'x'.repeat(1_500_000)
  const result = runAdapter(
    ['--fail-closed', 'postToolUse', 'pan-hook-stub'],
    vscodeTool('create_file', { filePath: 'big.txt', content }),
    bin,
  )
  const context = (
    JSON.parse(result.stdout) as {
      hookSpecificOutput: { additionalContext: string }
    }
  ).hookSpecificOutput.additionalContext

  assert.equal(result.status, 0, result.stderr)
  assert.ok(Number(context) > content.length)
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

test('both hosts feed the agent index a launch, a linked child, and its stop', async (t) => {
  const indexRoot = (): string => {
    const root = createTestTempDirectory('hook-adapter-index-')
    mkdirSync(path.join(root, 'governance/registries'), { recursive: true })
    copyFileSync(
      path.join(process.cwd(), 'governance/registries/host_tools.json'),
      path.join(root, 'governance/registries/host_tools.json'),
    )
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'pancreator-v2-prototype' }),
    )
    return root
  }
  const feed = (root: string, event: string, payload: unknown): void => {
    const result = spawnSync(
      path.join(BIN, 'pan-hook-adapter'),
      [event, 'pan-hook-agent-index', event],
      {
        input: JSON.stringify(payload),
        encoding: 'utf8',
        timeout: 20_000,
        env: { ...process.env, PANCREATOR_ROOT: root },
      },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '')
  }

  await t.test('VS Code runSubagent', () => {
    const root = indexRoot()
    feed(root, 'preToolUse', vscodeTool('runSubagent', { prompt: 'Explore' }))
    feed(root, 'subagentStart', {
      hook_event_name: 'SubagentStart',
      session_id: 'session-2',
      agent_id: 'child-v',
      agent_type: 'Explore',
    })
    feed(root, 'subagentStop', {
      hook_event_name: 'SubagentStop',
      session_id: 'session-2',
      agent_id: 'child-v',
    })

    const index = readIndex(root)
    const child = index.agents.find((agent) => agent.agent_id === 'child-v')
    assert.equal(index.pending_launches.length, 1)
    assert.equal(child?.parent_agent_id, 'session-2')
    assert.equal(child?.subagent_type, 'Explore')
    assert.equal(child?.stop?.status, 'completed')
  })

  await t.test('Copilot task, keyed on the stop agentId', () => {
    // Payload shapes captured from Copilot CLI 1.0.88 and the VS Code Agent
    // Host on 2026-10-07: both events carry the parent's transcript, and only
    // the stop names the child.
    const root = indexRoot()
    const parentTranscript =
      '/home/u/.copilot/session-state/parent-c/events.jsonl'
    feed(root, 'preToolUse', {
      sessionId: 'parent-c',
      toolName: 'task',
      toolArgs: {
        prompt: 'Map the repo',
        agent_type: 'explore',
        mode: 'background',
      },
    })
    feed(root, 'subagentStart', {
      sessionId: 'parent-c',
      transcriptPath: parentTranscript,
      agentName: 'explore',
    })
    feed(root, 'subagentStop', {
      sessionId: 'parent-c',
      transcriptPath: parentTranscript,
      agentId: 'child-c',
      agentType: 'explore',
      agentName: 'explore',
      response: 'pong',
      stopReason: 'end_turn',
    })

    const index = readIndex(root)
    const child = index.agents.find((agent) => agent.agent_id === 'child-c')
    assert.equal(child?.parent_agent_id, 'parent-c')
    assert.equal(child?.stop?.status, 'completed')
    assert.equal(child?.transcript_path ?? null, null)
    assert.deepEqual(
      index.agents
        .filter((agent) => agent.parent_agent_id !== null)
        .map((agent) => agent.agent_id),
      ['child-c'],
    )
  })

  await t.test('a Copilot start registers nothing', () => {
    const root = indexRoot()
    feed(root, 'subagentStart', {
      sessionId: 'parent-c',
      transcriptPath: '/home/u/.copilot/session-state/parent-c/events.jsonl',
      agentName: 'x',
    })
    assert.deepEqual(readIndex(root).agents, [])
  })
})
