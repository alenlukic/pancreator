import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createCopilotAdapter,
  copilotToolPolicy,
} from '../../src/lib/engine/executors.js'
import {
  COPILOT_CLI_REQUIRED_FLAGS,
  copilotArgv,
  copilotCliPreflight,
  parseCopilotJsonl,
  resolveCopilotCredential,
} from '../../src/lib/executors/copilot-cli.js'
import { parsePersonaMapping } from '../../src/lib/executors/mapping.js'
import type { Invocation, StageDefinition } from '../../src/lib/types.js'
import { delegationExecutionPath } from '../../src/lib/validation/artifacts.js'
import { executorProcessActivity } from '../../src/lib/watch/executor-process.js'
import { watchedAgentActivity } from '../../src/lib/watch/observe.js'
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
      'printf "%s\\n" "$COPILOT_ALLOW_ALL" "$COPILOT_PROVIDER_TYPE" > "$here/env.txt"',
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

test('copilot mappings validate provider, effort, and unknown options', () => {
  const mapping = parsePersonaMapping(
    'copilot:claude-opus-5-5[provider=anthropic,effort=high]',
  )

  assert.equal(mapping.executor, 'copilot')
  assert.equal(mapping.model, 'claude-opus-5-5')
  assert.deepEqual(mapping.options, { provider: 'anthropic', effort: 'high' })
  assert.throws(
    () => parsePersonaMapping('copilot:gpt-5.6-sol[provider=azure]'),
    /provider 'azure' is not supported/u,
  )
  assert.throws(
    () => parsePersonaMapping('copilot:gpt-5.6-sol[permission-mode=plan]'),
    /unknown copilot option 'permission-mode'/u,
  )
})

test('a read-only stage gets no shell tool and a source stage gets the bash family', () => {
  const root = harnessRoot()
  const readOnly = copilotToolPolicy(root, root, stage('read_only'), 'reviewer')
  const source = copilotToolPolicy(root, root, stage('source_allowed'), 'coder')

  assert.ok(!readOnly.availableTools.includes('bash'))
  assert.ok(!readOnly.availableTools.some((tool) => tool.endsWith('_bash')))
  assert.ok(readOnly.availableTools.includes('view'))
  assert.ok(source.availableTools.includes('bash'))

  for (const policy of [readOnly, source]) {
    assert.ok(!policy.availableTools.includes('task'))
    assert.ok(!policy.availableTools.includes('ask_user'))
    assert.deepEqual(policy.addDirs, [])
    assert.equal(policy.agent, undefined)
  }

  const argv = copilotArgv({
    cwd: root,
    model: 'gpt-5.6-sol',
    availableTools: readOnly.availableTools,
    addDirs: [],
  })

  assert.ok(argv.includes('--disable-builtin-mcps'))
  assert.ok(argv.includes('--no-ask-user'))
  assert.ok(
    argv.includes(`--available-tools=${readOnly.availableTools.join(',')}`),
  )
})

test('a worktree workspace adds the harness root, and a projected agent is named', () => {
  const root = harnessRoot()
  const workspace = createTestTempDirectory('copilot-worktree-')

  mkdirSync(path.join(root, '.github', 'agents'), { recursive: true })
  writeFileSync(path.join(root, '.github/agents/pan-coder.agent.md'), '---\n')

  const policy = copilotToolPolicy(
    root,
    workspace,
    stage('source_allowed'),
    'coder',
  )

  assert.deepEqual(policy.addDirs, [path.resolve(root)])
  assert.equal(policy.agent, 'pan-coder')
})

test('the JSONL parser needs a result event and keeps the last model', () => {
  assert.equal(parseCopilotJsonl('{"type":"assistant.message"}\n'), null)
  assert.deepEqual(
    parseCopilotJsonl(
      [
        '{"type":"model.call_start","data":{"model":"gpt-6-luna"}}',
        'not json',
        '{"type":"assistant.message","data":{"model":"gpt-6-luna","content":"ok"}}',
        '{"type":"result","sessionId":"s-1","exitCode":0}',
      ].join('\n'),
    ),
    {
      session_id: 's-1',
      exit_code: 0,
      model: 'gpt-6-luna',
      final_message: 'ok',
    },
  )
})

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

test('BYOK credentials come from the environment and a missing key reports no value', () => {
  const root = harnessRoot()

  withEnv({ ANTHROPIC_API_KEY: undefined }, () => {
    const missing = resolveCopilotCredential(root, 'anthropic')

    assert.equal(missing.ok, false)
    assert.match(
      missing.ok ? '' : (missing.report.error ?? ''),
      /ANTHROPIC_API_KEY/u,
    )
  })
  withEnv({ OPENAI_API_KEY: FAKE_KEY }, () => {
    const resolved = resolveCopilotCredential(root, 'openai')

    assert.ok(resolved.ok)
    assert.equal(resolved.credential.source, 'process_environment')
    assert.equal(
      resolved.credential.environment.COPILOT_PROVIDER_API_KEY,
      FAKE_KEY,
    )
    assert.equal(
      resolved.credential.environment.COPILOT_PROVIDER_WIRE_API,
      'responses',
    )
  })
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
          .slice(0, 2),
        ['true', 'openai'],
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

test('a copilot worker stops on its execution record and not before', () => {
  const root = harnessRoot()
  const invocation = {
    run_id: 'run-1',
    invocation_id: 'inv-1',
    stage: { slug: 'implement', persona: 'coder', persona_executor: 'copilot' },
  } as unknown as Invocation
  const recordPath = path.join(
    root,
    delegationExecutionPath('run-1', 'inv-1', root),
  )
  const writeRecord = (fields: Record<string, unknown>): void => {
    mkdirSync(path.dirname(recordPath), { recursive: true })
    writeFileSync(
      recordPath,
      JSON.stringify({
        schema_version: 1,
        run_id: 'run-1',
        invocation_id: 'inv-1',
        executor: 'copilot',
        exit_code: 0,
        timed_out: false,
        session_id: 'sess-1',
        recorded_at: new Date().toISOString(),
        ...fields,
      }),
    )
  }

  assert.equal(executorProcessActivity(root, invocation, Date.now()), null)
  assert.equal(watchedAgentActivity(root, invocation, Date.now(), 60), null)

  writeRecord({})
  const stop = watchedAgentActivity(root, invocation, Date.now(), 60)?.stop
  assert.equal(stop?.status, 'completed')
  assert.equal(stop?.source, 'process')

  writeRecord({ is_error: true })
  assert.equal(
    executorProcessActivity(root, invocation, Date.now())?.stop?.status,
    'error',
  )

  const cursorInvocation = {
    ...invocation,
    stage: { ...invocation.stage, persona_executor: 'cursor' },
  } as Invocation
  assert.equal(
    executorProcessActivity(root, cursorInvocation, Date.now()),
    null,
  )
})
