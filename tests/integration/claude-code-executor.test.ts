import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abortRun,
  createRun,
  decideRun,
  delegateInvocation,
  getRunState,
  prepareInvocation,
  submitOutput,
} from '../../src/lib/engine.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { delegationValidationPath } from '../../src/lib/validation.js'
import { loadPipelineConfigSnapshot } from '../../src/lib/pipeline-config.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import type {
  ExternalDelegationRecord,
  Invocation,
  StageOutput,
} from '../../src/lib/types.js'
import { syncCursorProjection } from '../../src/lib/projection.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'
import {
  CLAUDE_CODE_SPEC,
  checkpoint,
  claudeStubPath,
  installClaudeCodeFixture,
  withStub,
} from './delivery-helpers.js'

function invocationFile(
  root: string,
  runId: string,
  invocationId: string,
  extension: string,
): string {
  return resolveRunLayout(root, runId).invocation(invocationId, extension)
    .absolute
}

function readExecutionRecord(
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

function submitFixtureStage(
  root: string,
  runId: string,
  invocation: Invocation,
  result: 'success' | 'failure' = 'success',
  mutate?: (output: StageOutput) => void,
): ReturnType<typeof submitOutput> {
  const workflow = loadWorkflow(root, 'delivery')
  const stage = stageBySlug(workflow, invocation.stage.slug)
  const output = makeOutput(
    root,
    invocation,
    stage,
    result,
    getRunState(root, runId),
  )

  mutate?.(output)
  writeJson(path.join(root, invocation.output.path), output)

  return submitOutput(root, runId, invocation.output.path)
}

test('a mixed-executor delivery run completes with claude-code plan and verify', () => {
  const root = createFixture()
  const stubPath = installClaudeCodeFixture(root, ['planner', 'verifier'])

  withStub(stubPath, null, () => {
    const state = createRun(root, {
      workflowSlug: 'delivery',
      requestPath: 'request.md',
      title: 'Mixed executor run',
    })
    const runId = state.run_id

    // The snapshot records the executor dimension for every persona.
    const snapshot = loadPipelineConfigSnapshot(
      root,
      state.pipeline_config?.path ?? '',
    )

    assert.equal(snapshot.executors?.planner, 'claude-code')
    assert.equal(snapshot.executors?.verifier, 'claude-code')
    assert.equal(snapshot.executors?.coder, 'cursor')
    assert.equal(snapshot.personas.planner, CLAUDE_CODE_SPEC)

    const externalStages = new Set(['plan', 'verify'])
    const workflow = loadWorkflow(root, 'delivery')

    for (const stageSlug of ['plan', 'implement', 'verify', 'ship']) {
      const prepared = prepareInvocation(root, runId)
      const invocation = prepared.invocation

      assert.ok(invocation)
      assert.equal(invocation.stage.slug, stageSlug)

      const stage = stageBySlug(workflow, stageSlug)
      const markdown = readFileSync(
        path.join(root, prepared.state.current_invocation?.markdown_path ?? ''),
        'utf8',
      )

      if (externalStages.has(stageSlug)) {
        // The card renders the executor and routes delivery through the harness.
        assert.equal(invocation.stage.persona_executor, 'claude-code')
        assert.equal(
          invocation.stage.model,
          'claude-opus-5[permission-mode=default,session-resume=true]',
        )
        assert.equal(invocation.delegation?.executor, 'claude-code')
        assert.equal(invocation.delegation?.cursor_agent_path, undefined)
        assert.ok(markdown.includes('**Executor** `claude-code`'))
        // The delegate command is supervisor-owned: it lives in the sibling
        // procedure document, never on the worker-visible card.
        assert.ok(!markdown.includes(`pan delegate ${runId}`))
        assert.ok(invocation.delegation?.supervisor_procedure_path)

        const procedure = readFileSync(
          path.join(root, invocation.delegation.supervisor_procedure_path),
          'utf8',
        )

        assert.ok(procedure.includes(`pan delegate ${runId}`))
        // Harness-piped delivery needs no read attestation machinery.
        assert.equal(invocation.contract_manifest, undefined)

        const delegated = delegateInvocation(root, runId)

        assert.ok(delegated.execution)
        assert.equal(delegated.execution.delegation_kind, 'fresh')
        assert.equal(delegated.execution.executor, 'claude-code')
        assert.ok(delegated.execution.session_id)
        assert.ok(delegated.execution.argv.includes('--model'))
        assert.ok(delegated.execution.argv.includes('claude-opus-5'))
        assert.ok(delegated.execution.argv.includes('--permission-mode'))
        assert.ok(!delegated.execution.argv.includes('--resume'))

        // Non-source stages get write tools only inside the runtime tree.
        if (stage.workspace_policy !== 'source_allowed') {
          assert.ok(delegated.execution.argv.includes('Write(runtime/**)'))
          assert.ok(!delegated.execution.argv.includes('Write'))
        }

        // The delegation artifact is the canonical card byte for byte.
        const delegationArtifact = readFileSync(
          invocationFile(
            root,
            runId,
            invocation.invocation_id,
            '.delegation.md',
          ),
          'utf8',
        )

        assert.equal(delegationArtifact, markdown)
        assert.ok(
          existsSync(
            invocationFile(
              root,
              runId,
              invocation.invocation_id,
              '.session.json',
            ),
          ),
        )
        assert.ok(
          existsSync(
            resolveRunLayout(root, runId).evidence(
              `${invocation.invocation_id}.claude-code.stdout.json`,
            ).absolute,
          ),
        )
      } else {
        assert.equal(invocation.stage.persona_executor, undefined)

        if (stage.persona !== 'orchestrator') {
          writeCanonicalDelegation(root, invocation)
        }
      }

      const submitted = submitFixtureStage(root, runId, invocation, 'success')

      assert.equal(
        submitted.record.outcome,
        'success',
        `${stageSlug}: ${JSON.stringify(submitted.record.evaluation)}`,
      )

      if (externalStages.has(stageSlug)) {
        // Delegation validation passes on the harness-authored record.
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
      }

      if (stageSlug === 'plan' || stageSlug === 'ship') {
        // Plan and ship keep their operator gates under the standard profile.
        assert.equal(submitted.state.status, 'awaiting_operator')
        decideRun(root, runId, 'approve', 'fixture approval')
      }
    }

    const final = getRunState(root, runId)

    assert.equal(final.status, 'succeeded')

    // stage_history records the executor per attempt.
    const planHistory = final.stage_history.find(
      (item) => item.stage === 'plan',
    )
    const verifyHistory = final.stage_history.find(
      (item) => item.stage === 'verify',
    )
    const implementHistory = final.stage_history.find(
      (item) => item.stage === 'implement',
    )

    assert.equal(planHistory?.executor, 'claude-code')
    assert.equal(verifyHistory?.executor, 'claude-code')
    assert.equal(implementHistory?.executor, undefined)
  })
})

test('run creation fails closed when the executor binary is missing', () => {
  const root = createFixture()

  installClaudeCodeFixture(root, ['planner'])

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
    'delivery[claude-code:planner]@plan-prepared',
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
    'delivery[claude-code:planner]@plan-prepared',
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

test('operator revision resumes the session; fallback and post-failure retries do not', () => {
  const root = createFixture()
  const stubPath = installClaudeCodeFixture(root, ['planner'])

  withStub(stubPath, null, () => {
    const state = createRun(root, {
      workflowSlug: 'delivery',
      requestPath: 'request.md',
      involvement: 'technical-director',
    })
    const runId = state.run_id

    // Round 1: fresh delegation, session recorded.
    const round1 = prepareInvocation(root, runId)

    assert.ok(round1.invocation)

    const first = delegateInvocation(root, runId)

    assert.equal(first.execution?.delegation_kind, 'fresh')

    const firstSession = first.execution?.session_id

    assert.ok(firstSession)
    submitFixtureStage(root, runId, round1.invocation)

    // Plan stops at the operator checkpoint under the technical-director
    // contract (and carries an operator gate in delivery regardless).
    assert.equal(getRunState(root, runId).status, 'awaiting_operator')
    decideRun(root, runId, 'revise', 'Tighten the rollout plan for phase two.')

    // Round 2: the revision resumes the recorded session with the directive.
    const round2 = prepareInvocation(root, runId)

    assert.ok(round2.invocation)

    const resumed = delegateInvocation(root, runId)

    assert.equal(resumed.execution?.delegation_kind, 'resumed')
    assert.equal(resumed.execution?.resumed_from_session_id, firstSession)
    assert.ok(resumed.execution?.argv.includes('--resume'))

    const round2Id = round2.invocation.invocation_id
    const delegationArtifact = readFileSync(
      invocationFile(root, runId, round2Id, '.delegation.md'),
      'utf8',
    )

    assert.ok(
      delegationArtifact.includes('Tighten the rollout plan for phase two.'),
    )
    assert.ok(delegationArtifact.includes(round2Id))
    // The delivered directive is also persisted as the delivery prompt so
    // delegation validation compares like with like.
    assert.equal(
      readFileSync(
        invocationFile(root, runId, round2Id, '.delivery.md'),
        'utf8',
      ),
      delegationArtifact,
    )

    const submittedRound2 = submitFixtureStage(root, runId, round2.invocation)

    assert.equal(submittedRound2.record.outcome, 'success')

    const round2Validation = JSON.parse(
      readFileSync(
        path.join(root, delegationValidationPath(runId, round2Id, root)),
        'utf8',
      ),
    ) as { status: string }

    assert.equal(round2Validation.status, 'pass')

    // Round 3: a failed resume falls back to a fresh full-card delegation.
    decideRun(root, runId, 'revise', 'One more pass on the risks section.')

    const round3 = prepareInvocation(root, runId)

    assert.ok(round3.invocation)

    const fallback = withStub(stubPath, 'resume-fail', () =>
      delegateInvocation(root, runId),
    )

    assert.equal(fallback.execution?.delegation_kind, 'resume_fallback')
    assert.ok(fallback.execution?.resume_attempt)
    assert.ok(!(fallback.execution?.argv ?? []).includes('--resume'))

    const round3Id = round3.invocation.invocation_id
    const round3Markdown = readFileSync(
      invocationFile(root, runId, round3Id, '.md'),
      'utf8',
    )

    assert.equal(
      readFileSync(
        invocationFile(root, runId, round3Id, '.delegation.md'),
        'utf8',
      ),
      round3Markdown,
    )

    // Fail this attempt so the retry contract applies.
    submitFixtureStage(root, runId, round3.invocation, 'failure')
    assert.equal(getRunState(root, runId).status, 'awaiting_operator')
    decideRun(root, runId, 'approve', 'accept the failure route')

    // Round 4: a retry after a failed attempt must not resume.
    const round4 = prepareInvocation(root, runId)

    assert.ok(round4.invocation)
    assert.equal(round4.invocation.stage.slug, 'plan')

    const retry = delegateInvocation(root, runId)

    assert.equal(retry.execution?.delegation_kind, 'fresh')
    assert.ok(!(retry.execution?.argv ?? []).includes('--resume'))

    abortRun(root, runId, 'fixture complete')
  })
})

test('an external stage writing outside its permitted scope fails the scope gate', () => {
  const { root, runId, invocation } = checkpoint(
    'delivery[claude-code:planner]@plan-prepared',
  )

  assert.ok(invocation)

  withStub(claudeStubPath(root), null, () => {
    delegateInvocation(root, runId)

    // Simulate the executor mutating source during a runtime_only stage.
    writeFileSync(path.join(root, 'src', 'rogue.ts'), 'export const x = 1\n')

    const submitted = submitFixtureStage(root, runId, invocation)

    assert.equal(submitted.record.outcome, 'failure')

    const scopeResult = submitted.record.evaluation.deterministic.find(
      (item) => item.id === 'scope.no_unapproved_changes',
    )

    assert.equal(scopeResult?.passed, false)
  })
})

test('moving a persona cursor→claude-code→cursor leaves .cursor clean', () => {
  const root = createFixture()
  const agentPath = path.join(root, '.cursor', 'agents', 'pan-planner.md')
  const before = readFileSync(agentPath, 'utf8')
  const configPath = path.join(root, 'config.json')
  const original = readFileSync(configPath, 'utf8')
  const config = JSON.parse(original) as {
    defaults: Record<string, string>
    configs?: Record<string, { personas?: Record<string, string> }>
  }

  // A named entry under `configs` overrides `defaults`, so the persona is
  // cleared there too.
  config.defaults.planner = CLAUDE_CODE_SPEC

  for (const named of Object.values(config.configs ?? {})) {
    delete named.personas?.planner
  }

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

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
  syncCursorProjection(root, { write: true })
  assert.equal(readFileSync(agentPath, 'utf8'), before)

  const settled = syncCursorProjection(root)

  assert.equal(
    settled.some((entry) => entry.changed),
    false,
  )
})

test('prepare skips frontmatter drift for external personas and still catches cursor drift', () => {
  const prepared = checkpoint('delivery[claude-code:planner]@plan-prepared')

  assert.equal(
    existsSync(path.join(prepared.root, '.cursor', 'agents', 'pan-planner.md')),
    false,
  )
  assert.ok(prepared.invocation)
  assert.equal(prepared.invocation.stage.persona_executor, 'claude-code')

  const { root, runId } = checkpoint(
    'delivery[claude-code:planner]@plan-approved',
  )

  withStub(claudeStubPath(root), null, () => {
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

test('the orchestrator persona rejects external executors', () => {
  const root = createFixture()
  const stubPath = installClaudeCodeFixture(root, ['orchestrator'])

  withStub(stubPath, null, () => {
    assert.throws(
      () =>
        createRun(root, {
          workflowSlug: 'delivery',
          requestPath: 'request.md',
        }),
      /orchestrator.*MUST use the cursor executor/u,
    )
  })
})
