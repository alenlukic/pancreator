import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createCopilotAdapter } from '../../src/lib/engine/executors.js'
import {
  COPILOT_CLI_REQUIRED_FLAGS,
  copilotCliPreflight,
} from '../../src/lib/executors/copilot-cli.js'
import { parsePersonaMapping } from '../../src/lib/executors/mapping.js'
import type { StageDefinition } from '../../src/lib/types.js'
import { createTestTempDirectory } from '../temp.js'

const FAKE_KEY = 'sk-fake-copilot-key-0123456789'

function stage(policy: StageDefinition['workspace_policy']): StageDefinition {
  return { slug: 'implement', workspace_policy: policy } as StageDefinition
}

function harnessRoot(): string {
  const root = createTestTempDirectory('copilot-root-')
  writeFileSync(
    path.join(root, 'config.json'),
    JSON.stringify({ schema_version: 1, workspace_root: '.' }),
  )
  return root
}

/** A fake `copilot` that records its stdin and argv and prints JSONL. */
function fakeCopilot(options: { omitFlag?: string } = {}): string {
  const dir = createTestTempDirectory('copilot-bin-')
  const help = COPILOT_CLI_REQUIRED_FLAGS.filter(
    (flag) => flag !== options.omitFlag,
  )
    .map((flag) => `      ${flag} <value>`)
    .join('\n')

  writeFileSync(path.join(dir, 'help.txt'), `Options:\n${help}\n`)
  writeFileSync(
    path.join(dir, 'copilot'),
    [
      '#!/bin/bash',
      'here="$(dirname "$0")"',
      'if [ "$1" = "--version" ]; then echo "GitHub Copilot CLI 1.0.90."; exit 0; fi',
      'if [ "$1" = "--help" ]; then cat "$here/help.txt"; exit 0; fi',
      'cat > "$here/stdin.txt"',
      'printf "%s\\n" "$@" > "$here/argv.txt"',
      'printf "%s\\n" "$COPILOT_ALLOW_ALL" "$COPILOT_PROVIDER_TYPE" "$PAN_HOST" "${CURSOR_CONVERSATION_ID-unset}" > "$here/env.txt"',
      'echo "{\\"type\\":\\"assistant.message\\",\\"data\\":{\\"model\\":\\"${FAKE_MODEL}\\",\\"content\\":\\"done $COPILOT_PROVIDER_API_KEY\\"}}"',
      'echo "{\\"type\\":\\"result\\",\\"sessionId\\":\\"sess-1\\",\\"exitCode\\":0}"',
      '',
    ].join('\n'),
  )
  chmodSync(path.join(dir, 'copilot'), 0o755)
  return path.join(dir, 'copilot')
}

function withEnv<T>(
  values: Record<string, string | undefined>,
  run: () => T,
): T {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  )

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    return run()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test('preflight names a flag the installed CLI no longer offers', () => {
  withEnv({ PANCREATOR_COPILOT_BIN: fakeCopilot() }, () => {
    assert.deepEqual(copilotCliPreflight().ok, true)
  })
  withEnv(
    { PANCREATOR_COPILOT_BIN: fakeCopilot({ omitFlag: '--available-tools' }) },
    () => {
      const result = copilotCliPreflight()

      assert.equal(result.ok, false)
      assert.deepEqual(result.missing_flags, ['--available-tools'])
    },
  )
})

test('the adapter pipes the card on stdin, trusts the workspace, and redacts the key', () => {
  const root = harnessRoot()
  const binary = fakeCopilot()
  const binDir = path.dirname(binary)

  withEnv(
    {
      PANCREATOR_COPILOT_BIN: binary,
      OPENAI_API_KEY: FAKE_KEY,
      FAKE_MODEL: 'gpt-5.6-sol',
      CURSOR_CONVERSATION_ID: 'supervisor-conversation',
    },
    () => {
      const adapter = createCopilotAdapter({
        root,
        workspaceDir: root,
        stage: stage('read_only'),
        persona: 'reviewer',
        mapping: parsePersonaMapping(
          'copilot:gpt-5.6-sol[provider=openai,effort=high]',
        ),
      })
      const result = adapter.run('# Card body', 'sess-0')

      assert.equal(result.ok, true, result.error ?? 'adapter failed')
      assert.equal(result.session_id, 'sess-1')
      assert.equal(result.reported_model, 'gpt-5.6-sol')
      assert.deepEqual(result.model_verification, {
        status: 'compared',
        expected_model: 'gpt-5.6-sol',
      })
      assert.equal(
        readFileSync(path.join(binDir, 'stdin.txt'), 'utf8'),
        '# Card body',
      )
      assert.deepEqual(
        readFileSync(path.join(binDir, 'env.txt'), 'utf8')
          .split('\n')
          .slice(0, 4),
        ['true', 'openai', 'copilot-cli', 'unset'],
      )

      const argv = readFileSync(path.join(binDir, 'argv.txt'), 'utf8')

      assert.match(argv, /^--reasoning-effort\nhigh$/mu)
      assert.match(argv, /^--resume=sess-0$/mu)
      assert.ok(!argv.includes('Card body'))
      assert.ok(!argv.includes(FAKE_KEY))
      assert.ok(!result.argv.join(' ').includes(FAKE_KEY))
      assert.ok(!result.stdout.includes(FAKE_KEY))
      assert.match(result.stdout, /done \[REDACTED\]/u)
    },
  )
})

test('the adapter fails when the stream names another model', () => {
  const root = harnessRoot()

  withEnv(
    {
      PANCREATOR_COPILOT_BIN: fakeCopilot(),
      OPENAI_API_KEY: FAKE_KEY,
      FAKE_MODEL: 'gpt-6-luna',
    },
    () => {
      const result = createCopilotAdapter({
        root,
        workspaceDir: root,
        stage: stage('source_allowed'),
        persona: 'coder',
        mapping: parsePersonaMapping('copilot:gpt-5.6-sol[provider=openai]'),
      }).run('# Card')

      assert.equal(result.ok, false)
      assert.equal(result.is_error, true)
      assert.match(result.error ?? '', /reported model 'gpt-6-luna'/u)
    },
  )
})

test('a worktree worker launches with the projected hooks and its persona agent beside it', () => {
  const root = harnessRoot()
  const workspace = createTestTempDirectory('copilot-worktree-')
  const binary = fakeCopilot()

  mkdirSync(path.join(root, '.github', 'hooks'), { recursive: true })
  mkdirSync(path.join(root, '.github', 'agents'), { recursive: true })
  writeFileSync(
    path.join(root, '.github/hooks/pan-hooks.json'),
    JSON.stringify({
      version: 1,
      hooks: {
        preToolUse: [
          {
            type: 'command',
            bash: 'bin/pan-hook-adapter --fail-closed preToolUse pan-hook-deny-await-shell',
          },
        ],
      },
    }),
  )
  writeFileSync(path.join(root, '.github/agents/pan-coder.agent.md'), '---\n')

  withEnv(
    {
      PANCREATOR_COPILOT_BIN: binary,
      OPENAI_API_KEY: FAKE_KEY,
      FAKE_MODEL: 'gpt-5.6-sol',
    },
    () => {
      const result = createCopilotAdapter({
        root,
        workspaceDir: workspace,
        stage: stage('source_allowed'),
        persona: 'coder',
        mapping: parsePersonaMapping('copilot:gpt-5.6-sol[provider=openai]'),
      }).run('# Card')

      assert.equal(result.ok, true, result.error ?? 'adapter failed')
    },
  )

  const hooks = JSON.parse(
    readFileSync(path.join(workspace, '.github/hooks/pan-hooks.json'), 'utf8'),
  ) as { hooks: { preToolUse: { bash: string }[] } }
  const argv = readFileSync(path.join(path.dirname(binary), 'argv.txt'), 'utf8')

  assert.equal(
    hooks.hooks.preToolUse[0]?.bash,
    `${path.resolve(root)}/bin/pan-hook-adapter --fail-closed preToolUse pan-hook-deny-await-shell`,
  )
  assert.equal(
    readFileSync(
      path.join(workspace, '.github/agents/pan-coder.agent.md'),
      'utf8',
    ),
    '---\n',
  )
  assert.match(argv, /^--agent\npan-coder$/mu)
  assert.ok(argv.includes(`--add-dir\n${path.resolve(root)}\n`))
})
