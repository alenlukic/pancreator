import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { copilotToolPolicy } from '../../src/lib/engine/executors.js'
import {
  copilotArgv,
  COPILOT_MAX_OUTPUT_BYTES,
  parseCopilotJsonl,
  resolveCopilotCredential,
} from '../../src/lib/executors/copilot-cli.js'
import {
  absoluteHookCommands,
  provisionCopilotWorkspace,
} from '../../src/lib/executors/copilot-workspace.js'
import { parsePersonaMapping } from '../../src/lib/executors/mapping.js'
import type { Invocation, StageDefinition } from '../../src/lib/types.js'
import { delegationExecutionPath } from '../../src/lib/validation/artifacts.js'
import { assertWorkerNotStillActive } from '../../src/lib/engine/submit-checks.js'
import { executorProcessActivity } from '../../src/lib/watch/executor-process.js'
import { watchedAgentActivity } from '../../src/lib/watch/observe.js'
import { createTestTempDirectory } from '../temp.js'
import {
  CopilotStreamRedactor,
  COPILOT_RELAY_LIMITS,
  copilotRedactionSecrets,
  runCopilotRelay,
} from '../../src/lib/executors/copilot-relay.js'
import {
  delegationLivePaths,
  loadDelegationLiveRecord,
  updateDelegationLiveRecord,
  writeDelegationLiveLaunch,
  type DelegationLiveRecord,
} from '../../src/lib/executors/delegation-live.js'

const FAKE_KEY = 'sk-fake-copilot-key-0123456789'

test('relay production bounds remain independent at 4 Mi characters and 64 MiB', () => {
  assert.equal(COPILOT_MAX_OUTPUT_BYTES, 64 * 1024 * 1024)
  assert.deepEqual(COPILOT_RELAY_LIMITS, {
    frameCharacters: 4 * 1024 * 1024,
    eventFileBytes: 64 * 1024 * 1024,
  })
})

test('relay rejects absent or invalid adapter ownership before launch', async () => {
  for (const adapterParentPid of [
    undefined,
    null,
    0,
    -1,
    1.5,
    '123',
    2 ** 53,
  ]) {
    await assert.rejects(
      runCopilotRelay(
        JSON.stringify({
          prompt: 'fixture',
          cwd: '.',
          model: 'fixture',
          availableTools: [],
          addDirs: [],
          adapterParentPid,
        }),
        {},
        () => assert.fail('invalid requests must not emit progress'),
      ),
      /Invalid Copilot relay adapter parent PID/u,
    )
  }
})

test('session argv binds a fresh UUID and resumes without assigning a different session', () => {
  const request = {
    cwd: '.',
    model: 'fixture',
    availableTools: [],
    addDirs: [],
  }
  const session = '7ebc3016-ded1-45a6-b1e3-1c2731066482'
  assert.ok(copilotArgv(request, session).includes(`--session-id=${session}`))
  const resumed = copilotArgv(
    { ...request, resumeSessionId: session },
    'unused-fresh',
  )
  assert.ok(resumed.includes(`--resume=${session}`))
  assert.equal(
    resumed.some((arg) => arg.startsWith('--session-id=')),
    false,
  )
})

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

test('hook commands that reach the harness through a relative prefix become absolute', () => {
  const root = harnessRoot()
  const spaced = createTestTempDirectory('copilot root-')
  const content = JSON.stringify({
    version: 1,
    hooks: {
      preToolUse: [
        { type: 'command', bash: 'bin/pan-hook-adapter preToolUse x' },
        { type: 'command', bash: '/usr/local/bin/other-hook' },
      ],
      agentStop: [{ type: 'command', command: 'bin/pan-hook-adapter stop y' }],
    },
  })
  const rewritten = JSON.parse(absoluteHookCommands(root, content)) as {
    hooks: Record<string, Record<string, string>[]>
  }

  writeFileSync(
    path.join(spaced, 'config.json'),
    JSON.stringify({ schema_version: 1, workspace_root: '.' }),
  )

  assert.equal(
    rewritten.hooks.preToolUse?.[0]?.bash,
    `${path.resolve(root)}/bin/pan-hook-adapter preToolUse x`,
  )
  assert.equal(
    rewritten.hooks.preToolUse?.[1]?.bash,
    '/usr/local/bin/other-hook',
  )
  assert.equal(
    rewritten.hooks.agentStop?.[0]?.command,
    `${path.resolve(root)}/bin/pan-hook-adapter stop y`,
  )
  assert.match(
    absoluteHookCommands(spaced, content),
    /"bash": "'[^']+copilot root-[^']+'\/bin\/pan-hook-adapter preToolUse x"/u,
  )
})

test('provisioning skips the projection home and copies only projected surfaces', () => {
  const root = harnessRoot()
  const workspace = createTestTempDirectory('copilot-worktree-')

  assert.deepEqual(provisionCopilotWorkspace(root, workspace, 'coder'), [])

  mkdirSync(path.join(root, '.github', 'hooks'), { recursive: true })
  writeFileSync(
    path.join(root, '.github/hooks/pan-hooks.json'),
    '{"version":1,"hooks":{}}',
  )

  assert.deepEqual(provisionCopilotWorkspace(root, root, 'coder'), [])
  assert.deepEqual(provisionCopilotWorkspace(root, workspace, 'coder'), [
    '.github/hooks/pan-hooks.json',
  ])
  assert.deepEqual(provisionCopilotWorkspace(root, workspace, 'coder'), [])
  assert.match(
    readFileSync(path.join(workspace, '.github/hooks/pan-hooks.json'), 'utf8'),
    /"hooks": \{\}/u,
  )
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

test('stream redaction hides every split credential and escaped prompt boundary', () => {
  const prompt = 'private\n"prompt" \u2603'
  const secrets = copilotRedactionSecrets(
    {
      OPENAI_API_KEY: FAKE_KEY,
      GITHUB_TOKEN: 'github-secret',
    },
    prompt,
  )

  for (const secret of [
    FAKE_KEY,
    'github-secret',
    prompt,
    JSON.stringify(prompt).slice(1, -1),
  ]) {
    for (let split = 0; split <= secret.length; split++) {
      const redactor = new CopilotStreamRedactor(secrets)
      const actual =
        redactor.write(`before ${secret.slice(0, split)}`) +
        redactor.write(`${secret.slice(split)} after`) +
        redactor.write('', true)

      assert.equal(actual, 'before [REDACTED] after')
    }
  }

  const redactor = new CopilotStreamRedactor(['ababac'])
  assert.equal(redactor.write('abab'), '')
  assert.equal(redactor.write('abac!'), 'ab[REDACTED]!')

  for (const prefix of ['sk-fixture-common', 'private\\n\\"prompt\\"']) {
    const longer = `${prefix}-credential-tail`

    for (let split = 0; split <= longer.length; split++) {
      const overlapping = new CopilotStreamRedactor([prefix, longer])
      assert.equal(
        overlapping.write(longer.slice(0, split)) +
          overlapping.write(longer.slice(split)) +
          overlapping.write('', true),
        '[REDACTED]',
      )
    }

    for (const continuation of ['', '-different']) {
      const overlapping = new CopilotStreamRedactor([prefix, longer])
      assert.equal(
        overlapping.write(prefix) +
          overlapping.write(continuation) +
          overlapping.write('', true),
        `[REDACTED]${continuation}`,
      )
    }
  }
})

test('live paths reject escape and snapshots reject stale attempts and terminal reuse', () => {
  const root = harnessRoot()
  const identity = {
    run_id: 'run-1',
    invocation_id: 'inv-1',
    role: 'stage',
    attempt: 1,
    launch_id: 'launch-1',
  }
  const timestamp = new Date().toISOString()
  const record: DelegationLiveRecord = {
    ...identity,
    schema_version: 1,
    executor: 'copilot',
    launched_at: timestamp,
    heartbeat_at: timestamp,
    relay_pid: process.pid,
    relay_start_identity: null,
    sequence: 0,
    stream_sequences: { stdout: 0, stderr: 0 },
    truncated: false,
  }

  assert.equal(loadDelegationLiveRecord(root, identity), null)
  assert.throws(
    () => delegationLivePaths(root, { ...identity, role: '../escape' }),
    /Invalid/u,
  )
  writeDelegationLiveLaunch(root, record)
  assert.deepEqual(loadDelegationLiveRecord(root, identity), record)
  assert.throws(
    () =>
      updateDelegationLiveRecord(root, {
        ...record,
        requested_session_id: 'changed',
      }),
    /reuse or regress/u,
  )
  assert.throws(
    () => writeDelegationLiveLaunch(root, record),
    /already exists/u,
  )
  updateDelegationLiveRecord(root, {
    ...record,
    sequence: 1,
    stream_sequences: { stdout: 1, stderr: 0 },
  })
  assert.throws(
    () =>
      updateDelegationLiveRecord(root, {
        ...record,
        sequence: 2,
      }),
    /reuse or regress/u,
  )

  const paths = delegationLivePaths(root, identity)
  writeFileSync(
    paths.record,
    JSON.stringify({ ...record, requested_session_id: 123 }),
  )
  assert.throws(
    () => loadDelegationLiveRecord(root, identity),
    /Invalid delegation live field requested_session_id/u,
  )
  writeFileSync(paths.record, JSON.stringify({ ...record, attempt: 2 }))
  assert.throws(() => loadDelegationLiveRecord(root, identity), /Invalid/u)
  writeFileSync(paths.record, JSON.stringify(record))
  assert.throws(
    () =>
      updateDelegationLiveRecord(root, {
        ...record,
        sequence: 1,
        ended_at: timestamp,
        exit_code: 0,
      }),
    /reuse or regress/u,
  )
  updateDelegationLiveRecord(root, {
    ...record,
    sequence: 2,
    stream_sequences: { stdout: 1, stderr: 0 },
    ended_at: timestamp,
    exit_code: 0,
  })
  assert.throws(
    () => updateDelegationLiveRecord(root, record),
    /reuse or regress/u,
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

  const submitStage = { persona: 'coder' } as StageDefinition
  assert.equal(executorProcessActivity(root, invocation, Date.now()), null)
  assert.equal(watchedAgentActivity(root, invocation, Date.now(), 60), null)
  assert.throws(
    () => assertWorkerNotStillActive(root, invocation, 'copilot', submitStage),
    (error: unknown) =>
      (error as { code?: string }).code === 'WORKER_STILL_ACTIVE',
  )

  writeRecord({})
  assertWorkerNotStillActive(root, invocation, 'copilot', submitStage)
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
