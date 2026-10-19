import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abortRun,
  decideRun,
  delegateInvocation,
  getRunState,
  prepareInvocation,
} from '../../src/lib/engine.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { delegationValidationPath } from '../../src/lib/validation.js'
import { loadPipelineConfigSnapshot } from '../../src/lib/pipeline-config.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import type { Invocation, StageOutput } from '../../src/lib/types.js'
import { withInitialPolicyReminder } from '../../src/lib/policy-delivery.js'
import {
  claudeCodeToolPolicy,
  createClaudeCodeAdapter,
} from '../../src/lib/engine/executors.js'
import { parsePersonaMapping } from '../../src/lib/executors/mapping.js'
import { delegateEvidenceWorkers } from '../../src/lib/engine/evidence-workers.js'
import {
  attachTargetInstructionEvidence,
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'
import { createRun, submitAsSupervisor } from '../run-helpers.js'
import {
  CLAUDE_CODE_SPEC,
  checkpoint,
  installClaudeCodeFixture,
  routePersonas,
  submitStageOutput,
  withStub,
} from './delivery-helpers.js'

function capabilityFixture(root: string): string {
  const binary = path.join(root, 'claude-capability.cjs')
  writeFileSync(
    binary,
    `#!/usr/bin/env node
const fs = require('node:fs')
const cp = require('node:child_process')
const args = process.argv.slice(2)
const values = flag => { const i=args.indexOf(flag); if(i<0)return []; const out=[]; for(let j=i+1;j<args.length&&!args[j].startsWith('--');j++)out.push(...args[j].split(',')); return out }
const mode = values('--permission-mode')[0]
const tools = values('--tools')
const allowed = values('--allowed-tools')
const available = name => tools.length===0 || tools.includes(name)
const approved = name => mode==='bypassPermissions' || allowed.includes(name)
const shell = available('Bash') && approved('Bash')
if(shell) cp.execFileSync(process.execPath,['-e','require("node:fs").writeFileSync("runtime/shell-attempt.txt","executed")'])
const sourceWrite = available('Write') && approved('Write')
if(sourceWrite) fs.writeFileSync('source-attempt.txt','executed')
const runtime = ${JSON.stringify(path.join(root, 'runtime'))}
const runtimeWrite = available('Write') && (approved('Write') ||
  (process.cwd()===${JSON.stringify(root)} && allowed.includes('Write(runtime/**)')) ||
  allowed.includes('Write(//' + runtime + '/**)'))
if(runtimeWrite) fs.writeFileSync(runtime + '/capability-report.json',JSON.stringify({shell,sourceWrite,runtimeWrite}))
let prompt = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data',chunk=>prompt+=chunk)
process.stdin.on('end',()=>{
  const destination = /Write your complete evidence report as Markdown to \`([^\`]+)\`/.exec(prompt)?.[1]
  if(destination && runtimeWrite) fs.writeFileSync(destination,JSON.stringify({shell,sourceWrite,runtimeWrite}))
  console.log(JSON.stringify({session_id:'capability-session',result:JSON.stringify({shell,sourceWrite,runtimeWrite})}))
})
`,
  )
  chmodSync(binary, 0o755)

  return binary
}

test('read-only Claude tools reject shell and source writes even when bypass is requested or resumed', () => {
  const root = createFixture()
  const binary = capabilityFixture(root)
  const workflow = loadWorkflow(root, 'delivery')
  const mapping = parsePersonaMapping(
    'claude-code:claude-opus-5[permission-mode=bypassPermissions,session-resume=true]',
  )

  withStub(binary, null, () => {
    for (const { slug, workspaceDir } of [
      { slug: 'verify', workspaceDir: root },
      { slug: 'verify', workspaceDir: createFixture() },
      { slug: 'ship', workspaceDir: root },
      { slug: 'implement', workspaceDir: root },
    ]) {
      const stage = stageBySlug(workflow, slug)
      const policy = claudeCodeToolPolicy(root, workspaceDir, stage)
      const adapter = createClaudeCodeAdapter({
        workspaceDir,
        mapping,
        policy,
        timeoutMs: 3000,
      })

      for (const session of [undefined, 'prior-session']) {
        const result = adapter.run(
          'Attempt harmless actions and write the report.',
          session,
        )
        assert.equal(result.ok, true, result.error ?? result.stderr)
        const output = JSON.parse(result.stdout) as { result: string }
        const capabilities: unknown = JSON.parse(output.result)
        const writable = ['source_allowed', 'release_metadata_only'].includes(
          stage.workspace_policy,
        )
        assert.deepEqual(capabilities, {
          shell: writable,
          sourceWrite: writable,
          runtimeWrite: true,
        })
        assert.ok(result.argv.includes('claude-opus-5'))
        assert.equal(result.argv.includes('--resume'), session !== undefined)
        assert.deepEqual(policy.addDirs, workspaceDir === root ? [] : [root])
      }
    }
  })
})

test('Claude QA and review dispatch remove shell capability under bypass mode', () => {
  const { root, runId, workflow } = checkpoint('delivery@implement-prepared', {
    key: 'claude-readonly-capability',
    fixture: (root) => {
      installClaudeCodeFixture(root, ['qa-tester', 'reviewer'])
      routePersonas(
        root,
        ['qa-tester', 'reviewer'],
        'claude-code:claude-opus-5[permission-mode=bypassPermissions,session-resume=true]',
      )
    },
  })
  const implemented = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'implement'),
    'success',
    [],
    (output) => {
      output.data.verification_execution_operations = []
      attachTargetInstructionEvidence(root, output, ['AGENTS.md'])
    },
  )
  assert.equal(
    implemented.record.outcome,
    'success',
    JSON.stringify(implemented.record.evaluation),
  )
  assert.ok(prepareInvocation(root, runId).invocation)
  const binary = capabilityFixture(root)
  const results = withStub(binary, null, () =>
    delegateEvidenceWorkers(root, runId, { roles: ['qa', 'review'] }),
  )
  assert.deepEqual(results.map((result) => result.role).sort(), [
    'qa',
    'review',
  ])

  for (const result of results) {
    assert.equal(result.ok, true, JSON.stringify(result))
    const report: unknown = JSON.parse(
      readFileSync(path.join(root, result.evidence_path), 'utf8'),
    )
    assert.deepEqual(report, {
      shell: false,
      sourceWrite: false,
      runtimeWrite: true,
    })
  }

  assert.equal(existsSync(path.join(root, 'runtime/shell-attempt.txt')), false)
  assert.equal(existsSync(path.join(root, 'source-attempt.txt')), false)
})

function invocationFile(
  root: string,
  runId: string,
  invocationId: string,
  extension: string,
): string {
  return resolveRunLayout(root, runId).invocation(invocationId, extension)
    .absolute
}

function submitFixtureStage(
  root: string,
  runId: string,
  invocation: Invocation,
  result: 'success' | 'failure' = 'success',
  mutate?: (output: StageOutput) => void,
): ReturnType<typeof submitAsSupervisor> {
  const state = getRunState(root, runId)
  const workflow = loadWorkflow(root, state.workflow_slug)
  const stage = stageBySlug(workflow, invocation.stage.slug)
  const output = makeOutput(root, invocation, stage, result, state)

  mutate?.(output)
  writeJson(path.join(root, invocation.output.path), output)

  return submitAsSupervisor(root, runId, invocation.output.path)
}

test('a mixed-executor delivery run completes with a claude-code verify', () => {
  const root = createFixture()
  const stubPath = installClaudeCodeFixture(root, ['verifier'])

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

    assert.equal(snapshot.executors?.verifier, 'claude-code')
    assert.equal(snapshot.executors?.coder, 'cursor')
    assert.equal(snapshot.personas.verifier, CLAUDE_CODE_SPEC)

    const externalStages = new Set(['verify'])
    const workflow = loadWorkflow(root, 'delivery')

    for (const stageSlug of ['implement', 'verify', 'ship']) {
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

        // The artifact preserves the reminder and canonical card byte for byte.
        const delegationArtifact = readFileSync(
          invocationFile(
            root,
            runId,
            invocation.invocation_id,
            '.delegation.md',
          ),
          'utf8',
        )

        assert.equal(
          delegationArtifact,
          withInitialPolicyReminder(invocation, markdown),
        )
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

      if (stageSlug === 'ship') {
        // Ship keeps its operator gate under the standard profile.
        assert.equal(submitted.state.status, 'awaiting_operator')
        decideRun(root, runId, 'approve', 'fixture approval')
      }
    }

    const final = getRunState(root, runId)

    assert.equal(final.status, 'succeeded')

    // stage_history records the executor per attempt.
    const verifyHistory = final.stage_history.find(
      (item) => item.stage === 'verify',
    )
    const implementHistory = final.stage_history.find(
      (item) => item.stage === 'implement',
    )

    assert.equal(verifyHistory?.executor, 'claude-code')
    assert.equal(implementHistory?.executor, undefined)
  })
})

test('operator revision resumes the session; fallback and post-failure retries do not', () => {
  const root = createFixture()
  const stubPath = installClaudeCodeFixture(root, ['planner'])

  withStub(stubPath, null, () => {
    const state = createRun(root, {
      workflowSlug: 'planning',
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
    // contract (and carries an operator gate in the planning workflow
    // regardless).
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
      withInitialPolicyReminder(round3.invocation, round3Markdown),
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
