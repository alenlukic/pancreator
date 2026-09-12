import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  resetCursorAgentCapabilities,
  runCursorAgentJson,
} from '../../src/lib/executors/cursor-agent.js'
import { createTestTempDirectory } from '../fixture-template.js'

function makeRoot(): string {
  return createTestTempDirectory('cursor-agent-spawn-')
}

function withCursorApiKey<T>(value: string | undefined, run: () => T): T {
  const original = process.env.CURSOR_API_KEY

  if (value === undefined) {
    delete process.env.CURSOR_API_KEY
  } else {
    process.env.CURSOR_API_KEY = value
  }

  try {
    return run()
  } finally {
    if (original === undefined) {
      delete process.env.CURSOR_API_KEY
    } else {
      process.env.CURSOR_API_KEY = original
    }
  }
}

test('every cursor-agent spawn receives the .env credential, not only the probe', () => {
  // The away evaluator, the hypervisor, and external-executor stages all go
  // through runCursorAgent. The fake binary echoes the key it was given, so a
  // regression to a bare inherited environment shows up as a missing key.
  const root = makeRoot()
  const binary = path.join(root, 'fake-cursor-agent')
  const previousBinary = process.env.PANCREATOR_CURSOR_AGENT_BIN

  writeFileSync(path.join(root, '.env'), 'CURSOR_API_KEY=key-from-dotenv\n')
  writeFileSync(
    binary,
    '#!/bin/sh\n' +
      'if [ -z "$CURSOR_API_KEY" ]; then\n' +
      "  echo 'Error: Authentication required.' >&2\n" +
      '  exit 1\n' +
      'fi\n' +
      'printf \'{"type":"result","result":"{\\\\"seen\\\\":\\\\"%s\\\\"}"}\\n\' "$CURSOR_API_KEY"\n',
  )
  chmodSync(binary, 0o755)
  process.env.PANCREATOR_CURSOR_AGENT_BIN = binary
  resetCursorAgentCapabilities()

  try {
    withCursorApiKey(undefined, () => {
      const result = runCursorAgentJson({
        cwd: root,
        installationRoot: root,
        prompt: 'rank',
      })

      assert.equal(result.ok, true, result.error ?? 'spawn failed')
      assert.deepEqual(result.value, { seen: 'key-from-dotenv' })
    })

    // The child's working directory is not the credential search root. A
    // worker spawned in a worktree that carries no .env still authenticates
    // from the installation's .env.
    const worktree = path.join(root, 'worktrees', 'operator', 'chunk-a')

    mkdirSync(worktree, { recursive: true })
    withCursorApiKey(undefined, () => {
      const result = runCursorAgentJson({
        cwd: worktree,
        installationRoot: root,
        prompt: 'rank',
      })

      assert.equal(result.ok, true, result.error ?? 'spawn failed')
      assert.deepEqual(result.value, { seen: 'key-from-dotenv' })
    })
  } finally {
    if (previousBinary === undefined) {
      delete process.env.PANCREATOR_CURSOR_AGENT_BIN
    } else {
      process.env.PANCREATOR_CURSOR_AGENT_BIN = previousBinary
    }
    resetCursorAgentCapabilities()
  }
})

test('the prompt reaches cursor-agent over stdin and never as an argument', () => {
  // Endpoint security on an operator machine SIGKILLed the cursor-agent
  // wrapper at exec time whenever one argv element reached 1000 bytes. Every
  // real prompt is larger, so the prompt is piped and argv stays short.
  const root = makeRoot()
  const binary = path.join(root, 'fake-cursor-agent')
  const previousBinary = process.env.PANCREATOR_CURSOR_AGENT_BIN
  const prompt = `rank ${'x'.repeat(4_000)}`

  writeFileSync(
    binary,
    '#!/bin/sh\n' +
      'longest=0\n' +
      'for arg in "$@"; do\n' +
      '  n=${#arg}\n' +
      '  [ "$n" -gt "$longest" ] && longest=$n\n' +
      'done\n' +
      'stdin_bytes=$(wc -c | tr -d " ")\n' +
      'printf \'{"type":"result","result":"{\\\\"longest_arg\\\\":%s,\\\\"stdin_bytes\\\\":%s}"}\\n\' "$longest" "$stdin_bytes"\n',
  )
  chmodSync(binary, 0o755)
  process.env.PANCREATOR_CURSOR_AGENT_BIN = binary
  resetCursorAgentCapabilities()

  try {
    withCursorApiKey('key', () => {
      const result = runCursorAgentJson({
        cwd: root,
        installationRoot: root,
        prompt,
      })

      assert.equal(result.ok, true, result.error ?? 'spawn failed')
      assert.deepEqual(result.value, {
        longest_arg: '--output-format'.length,
        stdin_bytes: prompt.length,
      })
      assert.ok(!result.argv.includes(prompt), 'argv excludes the prompt body')
    })
  } finally {
    if (previousBinary === undefined) {
      delete process.env.PANCREATOR_CURSOR_AGENT_BIN
    } else {
      process.env.PANCREATOR_CURSOR_AGENT_BIN = previousBinary
    }
    resetCursorAgentCapabilities()
  }
})

test('a failed cursor-agent spawn names the cause from its stderr', () => {
  const root = makeRoot()
  const binary = path.join(root, 'fake-cursor-agent')
  const previousBinary = process.env.PANCREATOR_CURSOR_AGENT_BIN

  writeFileSync(
    binary,
    "#!/bin/sh\necho 'Error: Authentication required. Run agent login.' >&2\nexit 1\n",
  )
  chmodSync(binary, 0o755)
  process.env.PANCREATOR_CURSOR_AGENT_BIN = binary
  resetCursorAgentCapabilities()

  try {
    withCursorApiKey(undefined, () => {
      const result = runCursorAgentJson({
        cwd: root,
        installationRoot: root,
        prompt: 'rank',
      })

      assert.equal(result.ok, false)
      assert.equal(
        result.error,
        'Cursor agent exited with status 1. Error: Authentication required. Run agent login.',
      )
    })
  } finally {
    if (previousBinary === undefined) {
      delete process.env.PANCREATOR_CURSOR_AGENT_BIN
    } else {
      process.env.PANCREATOR_CURSOR_AGENT_BIN = previousBinary
    }
    resetCursorAgentCapabilities()
  }
})
