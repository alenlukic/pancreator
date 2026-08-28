import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
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
import { syncCursorProjection } from '../../src/lib/projection.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { delegationValidationPath } from '../../src/lib/validation.js'
import {
  loadPipelineConfigSnapshot,
  makePipelineConfigSnapshot,
  loadPipelineConfig,
} from '../../src/lib/pipeline-config.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import type {
  ExternalDelegationRecord,
  Invocation,
  StageOutput,
} from '../../src/lib/types.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'

const CLAUDE_CODE_SPEC =
  'claude-code:claude-opus-5[permission-mode=default,session-resume=true]'

/**
 * Stand-in for the Claude Code CLI. It answers `--version`, treats a positional
 * `-p` prompt as the credential probe, and reads real invocations from stdin —
 * the same interface the executor drives. CLAUDE_STUB_MODE selects the failure
 * being simulated.
 */
const CLAUDE_STUB = `#!/usr/bin/env node
const args = process.argv.slice(2)
const mode = process.env.CLAUDE_STUB_MODE || 'success'

if (args.includes('--version')) {
  console.log('2.1.0 (Claude Code)')
  process.exit(0)
}

const pIndex = args.indexOf('-p')
const positional =
  pIndex !== -1 && args[pIndex + 1] && !args[pIndex + 1].startsWith('--')
    ? args[pIndex + 1]
    : null

if (positional !== null) {
  if (mode === 'auth-failure') {
    console.log(JSON.stringify({
      type: 'result', subtype: 'error', is_error: true,
      result: 'Not authenticated',
    }))
    process.exit(1)
  }
  console.log(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false,
    result: 'pong', session_id: 'stub-probe',
  }))
  process.exit(0)
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  const resumeIndex = args.indexOf('--resume')
  const resumedFrom = resumeIndex === -1 ? null : args[resumeIndex + 1]

  if (mode === 'nonzero') { process.stderr.write('stub failure\\n'); process.exit(3) }
  if (mode === 'malformed') { console.log('not json at all'); process.exit(0) }
  if (mode === 'resume-fail' && resumedFrom !== null) {
    process.stderr.write('no conversation found\\n')
    process.exit(1)
  }

  const sessionId = resumedFrom !== null
    ? 'resumed-from-' + resumedFrom
    : 'stub-session-' + String(input.length)

  console.log(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false,
    result: 'stage complete', session_id: sessionId,
  }))
})
`

/**
 * Route personas to the claude-code executor and install the stub binary,
 * committing both so the workspace stays clean for fingerprinting. Returns the
 * stub path for PANCREATOR_CLAUDE_BIN.
 */
function installClaudeCodeFixture(root: string, personas: string[]): string {
  const stubPath = path.join(root, 'claude-stub.cjs')

  writeFileSync(stubPath, CLAUDE_STUB)
  chmodSync(stubPath, 0o755)

  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    defaults: Record<string, string>
    configs?: Record<string, { personas?: Record<string, string> }>
  }

  // A named entry under `configs` overrides `defaults`, so the routing has to be
  // cleared there too. Otherwise the fixture silently depends on whichever
  // `active_config` the checked-in configuration declares.
  for (const persona of personas) {
    config.defaults[persona] = CLAUDE_CODE_SPEC

    for (const named of Object.values(config.configs ?? {})) {
      delete named.personas?.[persona]
    }
  }

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  syncCursorProjection(root, { write: true })
  execFileSync('git', ['add', 'config.json', 'claude-stub.cjs'], { cwd: root })
  // Amend rather than commit: the ship-stage release validator requires the
  // baseline commit to be the one that introduced the current VERSION.
  execFileSync('git', ['commit', '-q', '--amend', '-m', 'fixture'], {
    cwd: root,
  })

  return stubPath
}

function withStub<T>(stubPath: string, mode: string | null, body: () => T): T {
  const previousBin = process.env.PANCREATOR_CLAUDE_BIN
  const previousMode = process.env.CLAUDE_STUB_MODE

  process.env.PANCREATOR_CLAUDE_BIN = stubPath

  if (mode === null) {
    delete process.env.CLAUDE_STUB_MODE
  } else {
    process.env.CLAUDE_STUB_MODE = mode
  }

  try {
    return body()
  } finally {
    if (previousBin === undefined) {
      delete process.env.PANCREATOR_CLAUDE_BIN
    } else {
      process.env.PANCREATOR_CLAUDE_BIN = previousBin
    }

    if (previousMode === undefined) {
      delete process.env.CLAUDE_STUB_MODE
    } else {
      process.env.CLAUDE_STUB_MODE = previousMode
    }
  }
}

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

// Disabled by operator decision (2026-08-28): the claude-code executor is
// not currently used. Re-enable when a claude-code pipeline returns to use.
test(
  'a mixed-executor delivery run completes with claude-code plan and verify',
  { skip: 'claude-code executor is not currently used' },
  () => {
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
          path.join(
            root,
            prepared.state.current_invocation?.markdown_path ?? '',
          ),
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
  },
)

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
  const root = createFixture()
  const stubPath = installClaudeCodeFixture(root, ['planner'])

  withStub(stubPath, 'auth-failure', () => {
    const state = createRun(root, {
      workflowSlug: 'delivery',
      requestPath: 'request.md',
    })
    const runId = state.run_id

    // Plan is the first delegated stage.
    const plan = prepareInvocation(root, runId)

    assert.ok(plan.invocation)

    const delegated = delegateInvocation(root, runId)

    assert.equal(delegated.execution, null)
    assert.equal(delegated.state.status, 'paused')
    assert.equal(delegated.state.pending_action.type, 'operator_decision')
    assert.match(delegated.state.pause_reason ?? '', /preflight failed/u)
    assert.match(delegated.state.pause_reason ?? '', /falsify/u)
  })
})

test('executor process failures are audited and surface as errors', () => {
  const root = createFixture()
  const stubPath = installClaudeCodeFixture(root, ['planner'])

  withStub(stubPath, null, () => {
    const state = createRun(root, {
      workflowSlug: 'delivery',
      requestPath: 'request.md',
    })
    const runId = state.run_id
    const plan = prepareInvocation(root, runId)

    assert.ok(plan.invocation)

    const invocationId = plan.invocation.invocation_id

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
  const root = createFixture()
  const stubPath = installClaudeCodeFixture(root, ['planner'])

  withStub(stubPath, null, () => {
    const state = createRun(root, {
      workflowSlug: 'delivery',
      requestPath: 'request.md',
    })
    const runId = state.run_id
    const plan = prepareInvocation(root, runId)

    assert.ok(plan.invocation)
    delegateInvocation(root, runId)

    // Simulate the executor mutating source during a runtime_only stage.
    writeFileSync(path.join(root, 'src', 'rogue.ts'), 'export const x = 1\n')

    const submitted = submitFixtureStage(root, runId, plan.invocation)

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
  const root = createFixture()
  const stubPath = installClaudeCodeFixture(root, ['planner'])

  withStub(stubPath, null, () => {
    const state = createRun(root, {
      workflowSlug: 'delivery',
      requestPath: 'request.md',
    })
    const runId = state.run_id

    // No projected agent exists for the external persona, yet prepare works.
    assert.equal(
      existsSync(path.join(root, '.cursor', 'agents', 'pan-planner.md')),
      false,
    )

    const plan = prepareInvocation(root, runId)

    assert.ok(plan.invocation)
    assert.equal(plan.invocation.stage.persona_executor, 'claude-code')

    // A cursor persona's projected frontmatter drifting is reported, not fatal.
    const coderAgent = path.join(root, '.cursor', 'agents', 'pan-coder.md')
    const coderContent = readFileSync(coderAgent, 'utf8')

    writeFileSync(
      coderAgent,
      coderContent.replace(/^model: .*$/mu, 'model: drifted-model'),
    )

    submitFixtureStage(root, runId, plan.invocation)
    decideRun(root, runId, 'approve', 'fixture approval')

    const drifted = prepareInvocation(root, runId)

    assert.equal(drifted.invocation?.stage.slug, 'implement')
    assert.ok(
      drifted.advisories.some((advisory) =>
        advisory.includes('Projected Cursor agent models do not match'),
      ),
      `expected a projection advisory, got ${JSON.stringify(drifted.advisories)}`,
    )

    // Restoring the projection clears the advisory.
    writeFileSync(coderAgent, coderContent)

    const implement = prepareInvocation(root, runId)

    assert.equal(implement.invocation?.stage.slug, 'implement')
    assert.equal(implement.invocation?.stage.persona_executor, undefined)
    assert.deepEqual(implement.advisories, [])
  })
})

test('mixed-executor snapshots report live mapping drift for any persona', () => {
  const root = createFixture()
  const stubPath = installClaudeCodeFixture(root, ['planner'])

  withStub(stubPath, null, () => {
    const state = createRun(root, {
      workflowSlug: 'delivery',
      requestPath: 'request.md',
    })
    const runId = state.run_id
    const configPath = path.join(root, 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      defaults: Record<string, string>
    }

    // Changing the external persona's mapping mid-run is drift too, and it is
    // reported against the run rather than blocking it.
    config.defaults.planner = 'claude-code:claude-sonnet-5'
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
    syncCursorProjection(root, { write: true })

    const prepared = prepareInvocation(root, runId)

    assert.ok(prepared.invocation)
    assert.ok(
      prepared.advisories.some(
        (advisory) =>
          advisory.includes('planner') &&
          advisory.includes('live model mapping changed'),
      ),
      `expected a planner drift advisory, got ${JSON.stringify(prepared.advisories)}`,
    )
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

test('snapshot executors derive from raw mappings for legacy snapshots', () => {
  const root = createFixture()

  installClaudeCodeFixture(root, ['reviewer'])

  const snapshot = makePipelineConfigSnapshot(loadPipelineConfig(root))

  assert.equal(snapshot.executors?.reviewer, 'claude-code')
  assert.equal(snapshot.executors?.coder, 'cursor')
})
