import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abortRun,
  decideRun,
  delegateInvocation,
  getRunState,
  prepareInvocation,
} from '../../src/lib/engine.js'
import { loadPipelineConfigSnapshot } from '../../src/lib/pipeline-config.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import type {
  ExternalDelegationRecord,
  Invocation,
  StageOutput,
} from '../../src/lib/types.js'
import { delegationValidationPath } from '../../src/lib/validation.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import { createFixture, makeOutput } from '../helpers.js'
import { createRun, submitAsSupervisor } from '../run-helpers.js'
import { installOpenAiFixture, runWorkflow } from './delivery-helpers.js'
import {
  OPENAI_SENTINEL_KEY,
  startFakeOpenAi,
  withFakeOpenAi,
  type FakeScript,
} from './fake-openai-endpoint.js'

function invocationFile(
  root: string,
  runId: string,
  invocationId: string,
  extension: string,
): string {
  return resolveRunLayout(root, runId).invocation(invocationId, extension)
    .absolute
}

function executionRecord(
  root: string,
  runId: string,
  invocationId: string,
): ExternalDelegationRecord {
  return JSON.parse(
    readFileSync(
      invocationFile(root, runId, invocationId, '.delegation-execution.json'),
      'utf8',
    ),
  ) as ExternalDelegationRecord
}

/**
 * The stage output the scripted model "writes" through its `write_file` tool.
 * The fixture builds it here because the fake endpoint's script is static
 * while the invocation id is not.
 */
function scriptedStageOutput(
  root: string,
  invocation: Invocation,
  runId: string,
): string {
  const state = getRunState(root, runId)
  const stage = stageBySlug(runWorkflow(root, state), invocation.stage.slug)

  return JSON.stringify(
    makeOutput(root, invocation, stage, 'success', state) satisfies StageOutput,
  )
}

/** A transcript that exercises every tool, then writes the stage output. */
function fullToolScript(
  root: string,
  invocation: Invocation,
  runId: string,
): FakeScript {
  return {
    turns: [
      {
        tool_calls: [
          { name: 'list_directory', arguments: { path: '.' } },
          { name: 'glob_files', arguments: { pattern: 'src/**/*.ts' } },
        ],
      },
      {
        tool_calls: [
          { name: 'search_text', arguments: { pattern: 'schema_version' } },
          { name: 'run_shell', arguments: { command: 'echo probe' } },
        ],
      },
      {
        tool_calls: [
          {
            name: 'read_file',
            arguments: { path: path.join(root, 'request.md') },
          },
        ],
      },
      {
        tool_calls: [
          {
            name: 'write_file',
            arguments: {
              path: path.join(root, invocation.output.path),
              content: scriptedStageOutput(root, invocation, runId),
            },
          },
        ],
      },
      {
        tool_calls: [
          {
            name: 'edit_file',
            arguments: {
              path: path.join(root, invocation.output.path),
              old_string: '"schema_version"',
              new_string: '"schema_version"',
            },
          },
        ],
      },
      { text: 'Stage output written.' },
    ],
  }
}

function everyFileUnder(directory: string): string[] {
  const found: string[] = []
  const pending = [directory]

  while (pending.length > 0) {
    const current = pending.pop() as string

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name)

      if (entry.isDirectory()) {
        pending.push(child)
      } else if (entry.isFile() && statSync(child).size < 4 * 1024 * 1024) {
        found.push(child)
      }
    }
  }

  return found
}

/**
 * Every Astra request parameter at once. The delegation crosses a process
 * boundary, so this is the only place that proves each option survives the
 * mapping, the adapter, the agent entrypoint, and the session loop.
 */
const ASTRA_SPEC =
  'openai:gpt-6-astra[context=current_turn,effort=high,mode=pro,' +
  'session-resume=true,summary=concise,verbosity=low]'

test('an openai stage runs the tool loop and submits its own output', async () => {
  const root = createFixture()

  installOpenAiFixture(root, ['planner'], ASTRA_SPEC)

  const state = withFakeOpenAi('http://127.0.0.1:1/unused', () =>
    createRun(root, {
      workflowSlug: 'planning',
      requestPath: 'request.md',
      title: 'OpenAI executor run',
    }),
  )
  const runId = state.run_id

  // The snapshot records the executor dimension for the mapped persona.
  const snapshot = loadPipelineConfigSnapshot(
    root,
    state.pipeline_config?.path ?? '',
  )

  assert.equal(snapshot.executors?.planner, 'openai')
  assert.equal(snapshot.personas.planner, ASTRA_SPEC)

  const prepared = prepareInvocation(root, runId)
  const invocation = prepared.invocation

  assert.ok(invocation)
  // The prepared invocation carries the executor, with the prefix stripped
  // from the model spec.
  assert.equal(invocation.stage.persona_executor, 'openai')
  assert.equal(
    invocation.stage.model,
    'gpt-6-astra[context=current_turn,effort=high,mode=pro,' +
      'session-resume=true,summary=concise,verbosity=low]',
  )
  assert.equal(invocation.delegation?.executor, 'openai')

  const cardPath = path.join(
    root,
    prepared.state.current_invocation?.markdown_path ?? '',
  )
  const card = readFileSync(cardPath, 'utf8')

  assert.ok(card.includes('**Executor** `openai`'))

  const endpoint = await startFakeOpenAi(
    fullToolScript(root, invocation, runId),
  )

  try {
    const delegated = withFakeOpenAi(endpoint.url, () =>
      delegateInvocation(root, runId),
    )
    const execution = delegated.execution

    assert.ok(execution)
    assert.equal(execution.executor, 'openai')
    assert.equal(execution.delegation_kind, 'fresh')
    assert.equal(execution.timed_out, false)
    assert.equal(execution.exit_code, 0)

    // The delegation artifact reproduces the delivered card byte for byte,
    // and so does the first input item the endpoint received.
    assert.equal(
      readFileSync(
        invocationFile(root, runId, invocation.invocation_id, '.delegation.md'),
        'utf8',
      ),
      card,
    )

    const requests = endpoint.requests()
    const firstInput = requests[0]?.body.input as { content?: string }[]

    assert.equal(firstInput[0]?.content, card)
    assert.equal(requests.length, 6)

    for (const request of requests) {
      assert.equal(request.body.store, false)
      assert.equal(request.body.previous_response_id, undefined)
      // Each mapped Astra parameter reaches the API body on every round.
      assert.deepEqual(request.body.reasoning, {
        effort: 'high',
        mode: 'pro',
        context: 'current_turn',
        summary: 'concise',
      })
      assert.deepEqual(request.body.text, { verbosity: 'low' })
    }

    // Every tool ran, and the result of each returned to the model.
    assert.deepEqual(execution.tool_summary, {
      list_directory: 1,
      glob_files: 1,
      search_text: 1,
      run_shell: 1,
      read_file: 1,
      write_file: 1,
      edit_file: 1,
    })
    assert.deepEqual(execution.response_ids, [
      'resp_0',
      'resp_1',
      'resp_2',
      'resp_3',
      'resp_4',
      'resp_5',
    ])

    // Non-secret request settings, duration, continuation id, and both
    // sanitized captures are all on the record.
    assert.deepEqual(execution.request_settings, {
      model: 'gpt-6-astra',
      store: false,
      reasoning_effort: 'high',
      reasoning_mode: 'pro',
      reasoning_context: 'current_turn',
      reasoning_summary: 'concise',
      text_verbosity: 'low',
      max_tool_rounds: 60,
      timeout_ms: 3_600_000,
      max_tool_result_bytes: 262_144,
    })
    assert.ok((execution.duration_ms ?? 0) >= 0)
    assert.ok(execution.session_id?.startsWith('openai-'))
    assert.ok(execution.usage)
    assert.ok(existsSync(path.join(root, execution.stdout_path)))
    assert.ok(existsSync(path.join(root, execution.stderr_path)))

    // The offered MCP capability set is stated, empty, and explained.
    assert.deepEqual(execution.mcp_capabilities?.offered, [])
    assert.match(
      execution.mcp_capabilities?.reason ?? '',
      /no MCP-backed tool, including isolated browser inspection/u,
    )

    // The model's own write produced the stage output the run submits.
    assert.ok(existsSync(path.join(root, invocation.output.path)))

    const submitted = submitAsSupervisor(root, runId, invocation.output.path)

    assert.equal(
      submitted.record.outcome,
      'success',
      JSON.stringify(submitted.record.evaluation),
    )

    const validation = JSON.parse(
      readFileSync(
        path.join(
          root,
          delegationValidationPath(runId, invocation.invocation_id, root),
        ),
        'utf8',
      ),
    ) as { status: string }

    assert.equal(validation.status, 'pass')
    assert.equal(
      getRunState(root, runId).stage_history.at(-1)?.executor,
      'openai',
    )
  } finally {
    endpoint.close()
  }
})

test('no OPENAI_API_KEY value reaches the run directory or the argument vector', async () => {
  const root = createFixture()

  installOpenAiFixture(root, ['planner'])

  const runId = withFakeOpenAi('http://127.0.0.1:1/unused', () =>
    createRun(root, { workflowSlug: 'planning', requestPath: 'request.md' }),
  ).run_id
  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  // The endpoint echoes the bearer token back inside an error body, which is
  // the way a real API failure could leak the credential into evidence.
  const endpoint = await startFakeOpenAi({
    turns: [{ status: 401, error: 'invalid key', echo_key: true }],
  })

  try {
    assert.throws(
      () => withFakeOpenAi(endpoint.url, () => delegateInvocation(root, runId)),
      /External delegation failed/u,
    )

    const execution = executionRecord(root, runId, invocation.invocation_id)

    assert.equal(execution.is_error, true)
    assert.equal(execution.failure_reason, 'request_failed')
    assert.equal(
      JSON.stringify(execution.argv).includes(OPENAI_SENTINEL_KEY),
      false,
    )

    const runDirectory = resolveRunLayout(root, runId).root.absolute
    const leaking = everyFileUnder(runDirectory).filter((file) =>
      readFileSync(file, 'utf8').includes(OPENAI_SENTINEL_KEY),
    )

    assert.deepEqual(leaking, [], 'no run file may carry the credential')

    // The captured stdout holds the redaction marker where the key was.
    assert.match(
      readFileSync(path.join(root, execution.stdout_path), 'utf8'),
      /\[redacted:OPENAI_API_KEY\]/u,
    )
  } finally {
    endpoint.close()
  }
})

test('a revision resumes the session and a failed resume falls back', async () => {
  const root = createFixture()

  installOpenAiFixture(root, ['planner'])

  const runId = withFakeOpenAi('http://127.0.0.1:1/unused', () =>
    createRun(root, {
      workflowSlug: 'planning',
      requestPath: 'request.md',
      involvement: 'technical-director',
    }),
  ).run_id

  const round1 = prepareInvocation(root, runId).invocation

  assert.ok(round1)

  const first = await startFakeOpenAi({
    turns: [
      {
        tool_calls: [
          {
            name: 'write_file',
            arguments: {
              path: path.join(root, round1.output.path),
              content: scriptedStageOutput(root, round1, runId),
            },
          },
        ],
      },
      { text: 'round one complete' },
    ],
  })
  let firstSession: string | undefined

  try {
    const delegated = withFakeOpenAi(first.url, () =>
      delegateInvocation(root, runId),
    )

    assert.equal(delegated.execution?.delegation_kind, 'fresh')
    firstSession = delegated.execution?.session_id
    assert.ok(firstSession)
    submitAsSupervisor(root, runId, round1.output.path)
  } finally {
    first.close()
  }

  assert.equal(getRunState(root, runId).status, 'awaiting_operator')
  decideRun(root, runId, 'revise', 'Tighten the rollout plan for phase two.')

  const round2 = prepareInvocation(root, runId).invocation

  assert.ok(round2)

  const resumed = await startFakeOpenAi({
    turns: [
      {
        tool_calls: [
          {
            name: 'write_file',
            arguments: {
              path: path.join(root, round2.output.path),
              content: scriptedStageOutput(root, round2, runId),
            },
          },
        ],
      },
      { text: 'revision complete' },
    ],
  })

  try {
    const delegated = withFakeOpenAi(resumed.url, () =>
      delegateInvocation(root, runId),
    )

    assert.equal(delegated.execution?.delegation_kind, 'resumed')
    assert.equal(delegated.execution?.resumed_from_session_id, firstSession)

    // The continuation is local: the prior transcript is replayed as input
    // items rather than referenced by a server-side response id.
    const input = resumed.requests()[0]?.body.input as { content?: string }[]

    assert.ok(input.length > 1, 'the prior conversation is resent')
    assert.match(String(input.at(-1)?.content), /Operator revision directive/u)

    const artifact = readFileSync(
      invocationFile(root, runId, round2.invocation_id, '.delegation.md'),
      'utf8',
    )

    assert.match(artifact, /Tighten the rollout plan for phase two\./u)
    assert.equal(
      readFileSync(
        invocationFile(root, runId, round2.invocation_id, '.delivery.md'),
        'utf8',
      ),
      artifact,
    )
    submitAsSupervisor(root, runId, round2.output.path)
  } finally {
    resumed.close()
  }

  decideRun(root, runId, 'revise', 'One more pass on the risks section.')

  const round3 = prepareInvocation(root, runId).invocation

  assert.ok(round3)

  // The endpoint refuses any request carrying the revision directive, so the
  // resume fails and the harness falls back to a fresh full-card delegation.
  const fallback = await startFakeOpenAi({
    fail_if_input_contains: 'Operator revision directive',
    turns: [
      {
        tool_calls: [
          {
            name: 'write_file',
            arguments: {
              path: path.join(root, round3.output.path),
              content: scriptedStageOutput(root, round3, runId),
            },
          },
        ],
      },
      { text: 'fallback complete' },
    ],
  })

  try {
    const delegated = withFakeOpenAi(fallback.url, () =>
      delegateInvocation(root, runId),
    )
    const execution = delegated.execution

    assert.equal(execution?.delegation_kind, 'resume_fallback')
    assert.ok(execution?.resume_attempt, 'the failed attempt is retained')
    assert.ok(
      existsSync(path.join(root, execution.resume_attempt.stdout_path)),
      'the failed attempt keeps its captures',
    )

    // The fallback delivers the canonical card, not a directive.
    assert.equal(
      readFileSync(
        invocationFile(root, runId, round3.invocation_id, '.delegation.md'),
        'utf8',
      ),
      readFileSync(
        invocationFile(root, runId, round3.invocation_id, '.md'),
        'utf8',
      ),
    )
  } finally {
    fallback.close()
  }

  abortRun(root, runId, 'fixture complete')
})

test('a retry after a failed attempt starts fresh with the full card', async () => {
  const root = createFixture()

  installOpenAiFixture(root, ['planner'])

  const runId = withFakeOpenAi('http://127.0.0.1:1/unused', () =>
    createRun(root, {
      workflowSlug: 'planning',
      requestPath: 'request.md',
      involvement: 'technical-director',
    }),
  ).run_id
  const round1 = prepareInvocation(root, runId).invocation

  assert.ok(round1)

  const state = getRunState(root, runId)
  const stage = stageBySlug(runWorkflow(root, state), round1.stage.slug)
  const failing = makeOutput(root, round1, stage, 'failure', state)
  const first = await startFakeOpenAi({
    turns: [
      {
        tool_calls: [
          {
            name: 'write_file',
            arguments: {
              path: path.join(root, round1.output.path),
              content: JSON.stringify(failing),
            },
          },
        ],
      },
      { text: 'round one failed' },
    ],
  })

  try {
    withFakeOpenAi(first.url, () => delegateInvocation(root, runId))
    submitAsSupervisor(root, runId, round1.output.path)
  } finally {
    first.close()
  }

  assert.equal(getRunState(root, runId).status, 'awaiting_operator')
  decideRun(root, runId, 'approve', 'accept the failure route')

  const retry = prepareInvocation(root, runId).invocation

  assert.ok(retry)

  const second = await startFakeOpenAi({ turns: [{ text: 'no work done' }] })

  try {
    const delegated = withFakeOpenAi(second.url, () =>
      delegateInvocation(root, runId),
    )

    // A retry after a failure never resumes: the contract requires the author
    // to confront the recorded failure on a fresh full-card invocation.
    assert.equal(delegated.execution?.delegation_kind, 'fresh')
    assert.equal(delegated.execution?.resumed_from_session_id, undefined)

    const input = second.requests()[0]?.body.input as { content?: string }[]

    assert.equal(input.length, 1)
    assert.equal(
      input[0]?.content,
      readFileSync(
        invocationFile(root, runId, retry.invocation_id, '.md'),
        'utf8',
      ),
    )
  } finally {
    second.close()
  }

  abortRun(root, runId, 'fixture complete')
})
