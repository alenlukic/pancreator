import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  claudeCodeToolPolicy,
  delegateInvocation,
  getRunState,
  openAiToolPolicy,
  prepareInvocation,
} from '../../src/lib/engine.js'
import { OPENAI_TOOL_NAMES } from '../../src/lib/executors/openai-tools.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import type { ExternalDelegationRecord } from '../../src/lib/types.js'
import { syncCursorProjection } from '../../src/lib/projection.js'
import { createFixture } from '../helpers.js'
import { createRun } from '../run-helpers.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import {
  CLAUDE_CODE_SPEC,
  checkpoint,
  claudeStubPath,
  installClaudeCodeFixture,
  withStub,
} from './delivery-helpers.js'

function readExecutionRecord(
  root: string,
  runId: string,
  invocationId: string,
): ExternalDelegationRecord {
  return JSON.parse(
    readFileSync(
      resolveRunLayout(root, runId).invocation(
        invocationId,
        '.delegation-execution.json',
      ).absolute,
      'utf8',
    ),
  ) as ExternalDelegationRecord
}

test('external executors withhold shell from read-only stages', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const source = stageBySlug(workflow, 'implement')
  const readOnly = stageBySlug(workflow, 'verify')

  const bounds = { maxResultBytes: 4096, shellTimeoutMs: 5000 }

  assert.ok(
    claudeCodeToolPolicy(root, root, source).allowedTools.includes('Bash'),
  )
  assert.ok(
    !claudeCodeToolPolicy(root, root, readOnly).allowedTools.includes('Bash'),
  )
  assert.deepEqual(openAiToolPolicy(root, root, source, bounds).allowedTools, [
    ...OPENAI_TOOL_NAMES,
  ])
  assert.ok(
    !openAiToolPolicy(root, root, readOnly, bounds).allowedTools.includes(
      'run_shell',
    ),
  )
})

test('run creation fails closed when the executor binary is missing', () => {
  const root = createFixture()

  installClaudeCodeFixture(root, ['coder'])

  withStub(path.join(root, 'no-such-binary.cjs'), null, () => {
    assert.throws(
      () =>
        createRun(root, {
          workflowSlug: 'delivery',
          requestPath: 'request.md',
        }),
      /Executor preflight failed/u,
    )
  })
})

test('an unauthenticated executor pauses delegation with an operator decision', () => {
  const { root, runId, invocation } = checkpoint(
    'planning[claude-code:planner]@plan-prepared',
  )

  assert.ok(invocation)

  withStub(claudeStubPath(root), 'auth-failure', () => {
    const delegated = delegateInvocation(root, runId)

    assert.equal(delegated.execution, null)
    assert.equal(delegated.state.status, 'paused')
    assert.equal(delegated.state.pending_action.type, 'operator_decision')
    assert.match(delegated.state.pause_reason ?? '', /preflight failed/u)
    assert.match(delegated.state.pause_reason ?? '', /falsify/u)
  })
})

test('executor process failures are audited and surface as errors', () => {
  const { root, runId, invocation } = checkpoint(
    'planning[claude-code:planner]@plan-prepared',
  )
  const stubPath = claudeStubPath(root)

  assert.ok(invocation)

  withStub(stubPath, null, () => {
    const invocationId = invocation.invocation_id

    // Nonzero exit throws, records the audit, and leaves the run delegatable.
    withStub(stubPath, 'nonzero', () => {
      assert.throws(
        () => delegateInvocation(root, runId),
        /External delegation failed/u,
      )
    })

    const failedRecord = readExecutionRecord(root, runId, invocationId)

    assert.equal(failedRecord.exit_code, 3)
    assert.equal(failedRecord.delegation_kind, 'fresh')
    assert.equal(
      getRunState(root, runId).pending_action.type,
      'invoke_agent',
      'a failed delegation must stay retryable',
    )

    // Malformed JSON output is also a failure, not a silent success.
    withStub(stubPath, 'malformed', () => {
      assert.throws(
        () => delegateInvocation(root, runId),
        /did not contain the expected JSON result/u,
      )
    })

    // A later healthy delegation succeeds without re-preparing.
    const recovered = delegateInvocation(root, runId)

    assert.equal(recovered.execution?.delegation_kind, 'fresh')
  })
})

test('moving a persona cursor→claude-code→cursor leaves .cursor clean', () => {
  const root = createFixture()
  const agentPath = path.join(root, '.cursor', 'agents', 'pan-planner.md')
  const before = readFileSync(agentPath, 'utf8')

  const configPath = path.join(root, 'config.json')
  const original = readFileSync(configPath, 'utf8')
  const config = JSON.parse(original) as {
    configs?: Record<string, Record<string, unknown>>
  }
  const overridesPath = path.join(root, 'config_overrides.json')
  const originalOverrides = readFileSync(overridesPath, 'utf8')
  const overrides = JSON.parse(originalOverrides) as {
    defaults?: Record<string, string>
  }
  overrides.defaults ??= {}

  // A named entry under `configs` overrides local defaults, so clear it there.
  overrides.defaults.planner = CLAUDE_CODE_SPEC

  for (const named of Object.values(config.configs ?? {})) {
    delete named.planner

    if (typeof named.personas === 'object' && named.personas !== null) {
      delete (named.personas as Record<string, unknown>).planner
    }
  }

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  writeFileSync(overridesPath, `${JSON.stringify(overrides, null, 2)}\n`)

  const changes = syncCursorProjection(root, { write: true })
  const removal = changes.find(
    (entry) => entry.path.endsWith('pan-planner.md') && entry.removed,
  )

  assert.ok(removal, 'sync must report the stale projected agent as removed')
  assert.equal(existsSync(agentPath), false)

  // Idempotent: a second sync reports no change for the external persona.
  const again = syncCursorProjection(root, { write: true })

  assert.equal(
    again.some((entry) => entry.path.endsWith('pan-planner.md')),
    false,
  )

  // Moving back re-projects the identical file.
  writeFileSync(configPath, original)
  writeFileSync(overridesPath, originalOverrides)
  syncCursorProjection(root, { write: true })
  assert.equal(readFileSync(agentPath, 'utf8'), before)

  const settled = syncCursorProjection(root)

  assert.equal(
    settled.some((entry) => entry.changed),
    false,
  )
})

test('prepare skips frontmatter drift for external personas and still catches cursor drift', () => {
  const prepared = checkpoint('planning[claude-code:planner]@plan-prepared')

  assert.equal(
    existsSync(path.join(prepared.root, '.cursor', 'agents', 'pan-planner.md')),
    false,
  )
  assert.ok(prepared.invocation)
  assert.equal(prepared.invocation.stage.persona_executor, 'claude-code')

  // A delivery run whose verifier is external still prepares its cursor
  // implement stage against the projected agent files.
  const root = createFixture()
  const stubPath = installClaudeCodeFixture(root, ['verifier'])

  withStub(stubPath, null, () => {
    const runId = createRun(root, {
      workflowSlug: 'delivery',
      requestPath: 'request.md',
    }).run_id
    const coderAgent = path.join(root, '.cursor', 'agents', 'pan-coder.md')
    const coderContent = readFileSync(coderAgent, 'utf8')

    writeFileSync(
      coderAgent,
      coderContent.replace(/^model: .*$/mu, 'model: drifted-model'),
    )

    const drifted = prepareInvocation(root, runId)

    assert.equal(drifted.invocation?.stage.slug, 'implement')
    assert.ok(
      drifted.advisories.some((advisory) =>
        advisory.includes('Projected Cursor agent models do not match'),
      ),
      `expected a projection advisory, got ${JSON.stringify(drifted.advisories)}`,
    )

    // Restoring the projection lets the run continue.
    writeFileSync(coderAgent, coderContent)

    const implement = prepareInvocation(root, runId)

    assert.equal(implement.invocation?.stage.slug, 'implement')
    assert.equal(implement.invocation?.stage.persona_executor, undefined)
  })
})

test('a Copilot supervisor requires the VS Code host and stays in the operator session', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    hosts: string[]
    active_config: string
    defaults: Record<string, string>
    configs: Record<
      string,
      { personas?: Record<string, string>; orchestrator?: string }
    >
  }

  config.defaults.orchestrator =
    'copilot:gpt-5.6-sol[provider=openai,effort=high]'
  for (const profile of Object.values(config.configs)) {
    delete profile.orchestrator
    if (profile.personas) delete profile.personas.orchestrator
  }
  writeFileSync(configPath, JSON.stringify(config))
  syncCursorProjection(root, { write: true })

  assert.throws(
    () =>
      createRun(root, {
        workflowSlug: 'planning',
        requestPath: 'request.md',
      }),
    /orchestrator.*copilot executor with the vscode host enabled/u,
  )

  config.hosts = ['cursor', 'vscode']
  writeFileSync(configPath, JSON.stringify(config))
  syncCursorProjection(root, { write: true })
  const run = createRun(root, {
    workflowSlug: 'planning',
    requestPath: 'request.md',
  })
  const state = getRunState(root, run.run_id)
  assert.equal(state.pending_action.type, 'prepare_invocation')
  assert.equal(
    existsSync(path.join(root, '.github/agents/pan-supervisor.agent.md')),
    true,
  )
})

test('the orchestrator persona rejects unsupported external executors', () => {
  const root = createFixture()
  const stubPath = installClaudeCodeFixture(root, ['orchestrator'])

  withStub(stubPath, null, () => {
    assert.throws(
      () =>
        createRun(root, {
          workflowSlug: 'delivery',
          requestPath: 'request.md',
        }),
      /orchestrator.*MUST use the active in-host executor/u,
    )
  })
})

test('the orchestrator may use Copilot when VS Code is enabled', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    defaults: Record<string, string>
    configs: Record<string, Record<string, unknown>>
    hosts?: string[]
  }
  const overridesPath = path.join(root, 'config_overrides.json')
  const overrides = JSON.parse(readFileSync(overridesPath, 'utf8')) as {
    model_config: Record<string, Record<string, string>>
  }

  config.hosts = ['cursor', 'vscode']
  config.defaults.orchestrator = 'open:ultra'

  for (const named of Object.values(config.configs)) {
    delete named.orchestrator
  }

  overrides.model_config.open = {
    ultra: 'copilot:gpt-6-astra[provider=openai]',
  }

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  writeFileSync(overridesPath, `${JSON.stringify(overrides, null, 2)}\n`)
  syncCursorProjection(root, { write: true })

  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  assert.equal(state.status, 'running')
})
