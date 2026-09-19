import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  agentProfileExecutionAllowance,
  agentRecordedProfilePasses,
} from '../../src/lib/agent-ledger-evidence.js'
import { buildInvocationInputs } from '../../src/lib/context.js'
import { renderEvidenceWorkerBrief } from '../../src/lib/render.js'
import { AGENT_REPOSITORY_CHECK_RUNS_FILE } from '../../src/lib/repository-checks.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { BUILT_IN_VERIFICATION_LEVELS } from '../../src/lib/verification.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import type {
  Invocation,
  InvocationEvidenceWorker,
  InvocationReference,
  RunState,
  StageDefinition,
  StageHistoryItem,
} from '../../src/lib/types.js'
import { createFixture, writeJson } from '../helpers.js'

const RUN_ID = 'ledger-run'

function historyItem(
  stage: string,
  invocationId: string,
  fingerprint: string,
): StageHistoryItem {
  return {
    stage,
    attempt: 1,
    invocation_id: invocationId,
    output_path: `runtime/logs/workflows/${RUN_ID}/agent/outputs/${invocationId}.json`,
    outcome: 'success',
    submitted_at: '2026-09-13T00:00:00.000Z',
    workspace_fingerprint: fingerprint,
    validation_errors: [],
    deterministic: [],
    record_path: `runtime/logs/workflows/${RUN_ID}/agent/artifacts/json/${invocationId}.json`,
  }
}

function stateWith(history: StageHistoryItem[]): RunState {
  return {
    schema_version: 1,
    run_id: RUN_ID,
    workflow_slug: 'delivery',
    workflow_snapshot: {
      path: `runtime/logs/workflows/${RUN_ID}/agent/workflow.snapshot.json`,
      sha256: 'workflow-sha',
    },
    workspace_root: '.',
    title: 'Agent ledger evidence fixture',
    status: 'running',
    current_stage: 'verify',
    pending_action: { type: 'prepare_invocation' },
    current_invocation: null,
    request: {
      source_path: 'request.md',
      stored_path: `runtime/logs/workflows/${RUN_ID}/operator/request.md`,
      sha256: 'request-sha',
    },
    limits: {
      max_total_transitions: 18,
      max_stage_attempts: 3,
      max_consecutive_failures: 3,
    },
    attempts: {},
    transition_count: history.length,
    consecutive_failures: 0,
    stage_history: history,
    revision: 1,
    created_at: '2026-09-13T00:00:00.000Z',
    updated_at: '2026-09-13T00:00:00.000Z',
  }
}

/** Append one agent-recorded profile execution to the run's ledger. */
function recordLedgerEntry(
  root: string,
  entry: Record<string, unknown>,
): string {
  const ledger = resolveRunLayout(root, RUN_ID).evidence(
    AGENT_REPOSITORY_CHECK_RUNS_FILE,
  )

  mkdirSync(path.dirname(ledger.absolute), { recursive: true })
  writeFileSync(ledger.absolute, `${JSON.stringify(entry)}\n`, { flag: 'a' })

  return ledger.relative
}

/** The smallest invocation `renderEvidenceWorkerBrief` reads. */
function baseInvocation(root: string): Invocation {
  const stage = stageBySlug(loadWorkflow(root, 'delivery'), 'verify')

  return {
    $operator: { headline: '', summary: '', next_action: '' },
    schema_version: 1,
    invocation_id: 'verify-2',
    run_id: RUN_ID,
    attempt: 1,
    created_at: '2026-09-13T00:00:00.000Z',
    workspace_root: '.',
    workflow: {
      slug: 'delivery',
      snapshot_path: `runtime/logs/workflows/${RUN_ID}/agent/workflow.snapshot.json`,
      snapshot_sha256: 'workflow-sha',
    },
    stage: {
      slug: stage.slug,
      title: stage.title,
      persona: stage.persona,
      model: 'model',
      model_config: 'advanced',
      workspace_policy: 'read_only',
      gate: 'next_stage',
    },
    prompt: 'Verify the change.',
    workspace_before: { kind: 'git', fingerprint: 'fp-current', entries: [] },
    inputs: { references: [] },
    output: {
      path: `runtime/logs/workflows/${RUN_ID}/agent/outputs/verify-2.json`,
      schema: 'library/schemas/stage-output.schema.json',
      template: 'library/templates/stage-output.example.json',
      required_data: {},
    },
    policies: [],
    rubric: [],
    boundaries: [],
  }
}

/** The QA evidence worker of the verify stage. */
function qaWorker(): InvocationEvidenceWorker {
  return {
    role: 'qa',
    persona: 'qa-tester',
    agent: 'pan-qa-tester',
    model: 'model',
    scope: 'Acceptance-focused QA.',
    brief_path: `runtime/logs/workflows/${RUN_ID}/agent/invocations/verify-2.qa.md`,
    evidence_path: `runtime/logs/workflows/${RUN_ID}/agent/evidence/qa.md`,
  }
}

/** Gate-evidence references of a verify card built at `fingerprint`. */
function verifyGateEvidence(
  root: string,
  state: RunState,
  fingerprint: string,
): InvocationReference[] {
  return buildInvocationInputs({
    root,
    state,
    stage: stageBySlug(loadWorkflow(root, 'delivery'), 'verify'),
    attempt: 1,
    invocationId: 'verify-1',
    workspaceFingerprint: fingerprint,
  }).references.filter((item) => item.gate_evidence)
}

test('the ledger yields the latest passing execution of each profile', () => {
  const root = createFixture()

  assert.deepEqual(agentRecordedProfilePasses(root, RUN_ID), [])

  const ledgerPath = recordLedgerEntry(root, {
    profile: 'fast',
    invocation_id: 'implement-1',
    workspace_fingerprint: 'fp-current',
    status: 'passed',
    started_at: '2026-09-13T09:00:00.000Z',
    invoked_by: 'agent',
    evidence_log: 'agent/evidence/first.log',
  })

  // A failure proves nothing, and a pass that named no log sends a reader
  // nowhere, so neither can stand in for the execution.
  recordLedgerEntry(root, {
    profile: 'static',
    invocation_id: 'implement-1',
    workspace_fingerprint: 'fp-current',
    status: 'failed',
    started_at: '2026-09-13T09:05:00.000Z',
    invoked_by: 'agent',
    evidence_log: 'agent/evidence/static.log',
  })
  recordLedgerEntry(root, {
    profile: 'static',
    invocation_id: 'implement-1',
    workspace_fingerprint: 'fp-current',
    status: 'passed',
    started_at: '2026-09-13T09:06:00.000Z',
    invoked_by: 'agent',
  })
  recordLedgerEntry(root, {
    profile: 'fast',
    invocation_id: 'verify-1',
    workspace_fingerprint: 'fp-current',
    status: 'passed',
    started_at: '2026-09-13T10:00:00.000Z',
    invoked_by: 'agent',
    evidence_log: 'agent/evidence/second.log',
  })

  assert.deepEqual(agentRecordedProfilePasses(root, RUN_ID), [
    {
      profile: 'fast',
      invokedBy: 'agent',
      workerRole: null,
      evidencePath: 'agent/evidence/second.log',
      fingerprint: 'fp-current',
      invocationId: 'verify-1',
      startedAt: '2026-09-13T10:00:00.000Z',
      ledgerPath: ledgerPath,
    },
  ])
})

// HR3-008: a worker of this run had already paid for `fast` at the very
// fingerprint the card was judging, and the card still reported a gap and
// described the only evidence it could see as superseded.
test('a card cites an agent-recorded pass at the current fingerprint', () => {
  const root = createFixture()
  const implement = historyItem('implement', 'implement-1', 'fp-before')

  implement.deterministic = [
    {
      id: 'implement.unit_tests',
      type: 'shell',
      hard: true,
      passed: true,
      command: 'pan repository-check fast',
      exit_code: 0,
      timed_out: false,
      evidence_path: `runtime/logs/workflows/${RUN_ID}/agent/evidence/implement-1.fast.log`,
      workspace_fingerprint: 'fp-before',
    },
  ]
  writeJson(path.join(root, implement.output_path), {
    data: { implementation: { changed_files: [] } },
  })

  const state = stateWith([implement])
  const ledgerPath = recordLedgerEntry(root, {
    profile: 'fast',
    invocation_id: 'verify-1',
    workspace_fingerprint: 'fp-current',
    status: 'passed',
    started_at: '2026-09-13T10:00:00.000Z',
    invoked_by: 'agent',
    worker_role: 'review',
    evidence_log: `runtime/logs/workflows/${RUN_ID}/agent/evidence/agent-fast.log`,
  })

  // Without the ledger the only `fast` evidence is the implement gate, taken
  // against a workspace that has since moved.
  const staleOnly = verifyGateEvidence(
    root,
    stateWith([implement]),
    'fp-before',
  )

  assert.equal(staleOnly.length, 1)
  assert.match(staleOnly[0].description, /the current workspace/u)

  const references = verifyGateEvidence(root, state, 'fp-current')
  const fast = references.find((item) => item.gate_evidence?.profile === 'fast')

  assert.ok(fast)
  assert.equal(
    fast.path,
    `runtime/logs/workflows/${RUN_ID}/agent/evidence/agent-fast.log`,
  )
  assert.equal(fast.gate_evidence?.current, true)
  assert.equal(fast.gate_evidence?.fingerprint, 'fp-current')

  // The card names the recorded pass and the ledger it came from, and stops
  // calling the workspace superseded.
  assert.match(fast.description, /agent-recorded pass/u)
  assert.match(fast.description, /role `review`/u)
  assert.match(fast.description, /`verify-1`/u)
  assert.ok(fast.description.includes(ledgerPath))
  assert.match(fast.description, /the current workspace/u)
  assert.doesNotMatch(fast.description, /superseded/u)
  assert.match(fast.condition ?? '', /gate_evidence_citations/u)
})

test('a harness ledger pass renders as a prepare prefetch', () => {
  const root = createFixture()
  const implement = historyItem('implement', 'implement-1', 'fp-before')

  implement.deterministic = [
    {
      id: 'implement.unit_tests',
      type: 'shell',
      hard: true,
      passed: true,
      command: 'pan repository-check fast',
      exit_code: 0,
      timed_out: false,
      evidence_path: 'agent/evidence/implement-fast.log',
      workspace_fingerprint: 'fp-before',
    },
  ]
  writeJson(path.join(root, implement.output_path), {
    data: { implementation: { changed_files: [] } },
  })
  recordLedgerEntry(root, {
    profile: 'fast',
    invocation_id: 'verify-1',
    workspace_fingerprint: 'fp-current',
    status: 'passed',
    started_at: '2026-09-13T10:00:00.000Z',
    invoked_by: 'harness',
    evidence_log: 'agent/evidence/prefetch-fast.log',
  })

  const fast = verifyGateEvidence(
    root,
    stateWith([implement]),
    'fp-current',
  ).find((item) => item.gate_evidence?.profile === 'fast')

  assert.ok(fast)
  assert.match(fast.description, /harness prefetch at prepare/u)
  assert.doesNotMatch(fast.description, /agent-recorded pass/u)
})

test('a ledger pass does not displace evidence already at the current fingerprint', () => {
  const root = createFixture()
  const implement = historyItem('implement', 'implement-1', 'fp-current')
  const gatePath = `runtime/logs/workflows/${RUN_ID}/agent/evidence/implement-1.fast.log`

  implement.deterministic = [
    {
      id: 'implement.unit_tests',
      type: 'shell',
      hard: true,
      passed: true,
      command: 'pan repository-check fast',
      exit_code: 0,
      timed_out: false,
      evidence_path: gatePath,
      workspace_fingerprint: 'fp-current',
    },
  ]
  writeJson(path.join(root, implement.output_path), {
    data: { implementation: { changed_files: [] } },
  })
  recordLedgerEntry(root, {
    profile: 'fast',
    invocation_id: 'verify-1',
    workspace_fingerprint: 'fp-current',
    status: 'passed',
    started_at: '2026-09-13T10:00:00.000Z',
    invoked_by: 'agent',
    evidence_log: `runtime/logs/workflows/${RUN_ID}/agent/evidence/agent-fast.log`,
  })

  // The harness-run gate is the stronger record of the same workspace, so the
  // ledger adds nothing and must not replace it.
  const fast = verifyGateEvidence(
    root,
    stateWith([implement]),
    'fp-current',
  ).find((item) => item.gate_evidence?.profile === 'fast')

  assert.ok(fast)
  assert.equal(fast.path, gatePath)
})

// HR3-009: every return to verify after a bounded remediation re-executed
// the whole case set, including cases over code the remediation never
// touched.
test('a returning verification bounds execution by the remediation blast radius', () => {
  const root = createFixture()
  const implement = historyItem('implement', 'implement-1', 'fp-before')
  const verify = historyItem('verify', 'verify-1', 'fp-before')
  const remediate = historyItem('remediate', 'remediate-1', 'fp-current')

  verify.outcome = 'failure'
  writeJson(path.join(root, implement.output_path), {
    data: { implementation: { changed_files: ['src/lib/wide.ts'] } },
  })
  writeJson(path.join(root, remediate.output_path), {
    data: { implementation: { changed_files: ['src/lib/narrow.ts'] } },
  })

  const stage = stageBySlug(loadWorkflow(root, 'delivery'), 'verify')
  const scopeOf = (history: StageHistoryItem[]) =>
    buildInvocationInputs({
      root,
      state: stateWith(history),
      stage,
      attempt: 2,
      invocationId: 'verify-2',
      workspaceFingerprint: 'fp-current',
    }).remediation_return

  // A first visit has no earlier result to carry, so nothing is bounded.
  assert.equal(scopeOf([implement]), undefined)

  // A remediation that declared no changed path is still a return visit. The
  // marker is present and only its radius is empty, because the profile
  // prohibition does not depend on how far the repair reached.
  writeJson(path.join(root, remediate.output_path), { data: {} })
  assert.deepEqual(scopeOf([implement, verify, remediate]), {
    remediation_invocation_id: 'remediate-1',
    blast_radius: [],
  })

  writeJson(path.join(root, remediate.output_path), {
    data: { implementation: { changed_files: ['src/lib/narrow.ts'] } },
  })

  const scope = scopeOf([implement, verify, remediate])

  assert.deepEqual(scope, {
    remediation_invocation_id: 'remediate-1',
    blast_radius: ['src/lib/narrow.ts'],
  })

  const brief = renderEvidenceWorkerBrief(
    {
      ...baseInvocation(root),
      attempt: 2,
      inputs: { references: [], remediation_return: scope },
    },
    qaWorker(),
  )

  // The brief asks for execution over the blast radius and citation for the
  // rest, and says plainly that no profile allowance moved.
  assert.match(brief, /return visit after remediation `remediate-1`/u)
  assert.match(brief, /Execute the cases your scope reaches/u)
  assert.ok(brief.includes('- `src/lib/narrow.ts`'))
  assert.doesNotMatch(brief, /src\/lib\/wide\.ts/u)
  assert.match(brief, /Carry every other case forward/u)
  assert.match(brief, /`carried_from`/u)
  assert.match(brief, /changes no profile allowance/u)
  assert.match(brief, /MUST NOT run a cost-bearing or mutating/u)
  assert.match(brief, /read-only single-command profile remains allowed/u)
  assert.doesNotMatch(brief, /When your scope allows one validation run/u)

  // An empty blast radius is the shape a successful remediation that
  // declared no changed path produces. It still forbids the profile run and
  // still tells the worker it is on a return visit.
  const unbounded = renderEvidenceWorkerBrief(
    {
      ...baseInvocation(root),
      attempt: 2,
      inputs: {
        references: [],
        remediation_return: {
          remediation_invocation_id: 'remediate-1',
          blast_radius: [],
        },
      },
    },
    qaWorker(),
  )

  assert.match(unbounded, /return visit after remediation `remediate-1`/u)
  assert.match(unbounded, /MUST NOT run a cost-bearing or mutating/u)
  assert.doesNotMatch(unbounded, /When your scope allows one validation run/u)
  assert.match(unbounded, /execute your scope in full and carry no case/u)
  assert.doesNotMatch(unbounded, /Carry every other case forward/u)

  // A first visit says none of it.
  const first = renderEvidenceWorkerBrief(baseInvocation(root), qaWorker())

  assert.doesNotMatch(first, /return visit after remediation/u)
})

// HR3-008: the citable branch permitted an evidence worker one `fast` run
// while the superseded branch forbade running the profile at all, so a worker
// that read both had no rule it could follow.
test('a card states one rule about agent-side profile execution', () => {
  const root = createFixture()
  const implement = historyItem('implement', 'implement-1', 'fp-before')

  implement.deterministic = [
    {
      id: 'implement.unit_tests',
      type: 'shell',
      hard: true,
      passed: true,
      command: 'pan repository-check fast',
      exit_code: 0,
      timed_out: false,
      evidence_path: `runtime/logs/workflows/${RUN_ID}/agent/evidence/implement-1.fast.log`,
      workspace_fingerprint: 'fp-before',
    },
    {
      id: 'implement.lint',
      type: 'shell',
      hard: true,
      passed: true,
      command: 'pan repository-check static',
      exit_code: 0,
      timed_out: false,
      evidence_path: `runtime/logs/workflows/${RUN_ID}/agent/evidence/implement-1.static.log`,
      workspace_fingerprint: 'fp-current',
    },
  ]
  writeJson(path.join(root, implement.output_path), {
    data: { implementation: { changed_files: [] } },
  })

  const references = verifyGateEvidence(
    root,
    stateWith([implement]),
    'fp-current',
  )
  const currency = references.map((item) => item.gate_evidence?.current)

  // The card carries both branches, which is what let them disagree.
  assert.deepEqual(currency.sort(), [false, true])

  const allowance = agentProfileExecutionAllowance(false)
  const rules = new Set(
    references.map((item) =>
      (item.condition ?? '').includes(allowance)
        ? allowance
        : (item.condition ?? ''),
    ),
  )

  // One rule, stated once, whichever branch the evidence fell into.
  assert.deepEqual([...rules], [allowance])

  for (const reference of references) {
    assert.doesNotMatch(reference.condition ?? '', /Do not run the/u)
  }

  // And it agrees with the allowance the run's own verification level
  // declares: one fast run as final validation, and never full.
  const declared = BUILT_IN_VERIFICATION_LEVELS.light.summary

  assert.match(declared, /fast profile once/u)
  assert.match(allowance, /fast profile once/u)
  assert.match(declared, /never run full/u)
  assert.match(allowance, /never runs the full profile/u)
})

/**
 * Anything that reads as permission to execute a repository-check profile.
 *
 * The pattern is deliberately wider than the sentence any one surface
 * writes, because the defect this guard exists for was an offer on a surface
 * nobody thought to check.
 */
const PROFILE_RUN_OFFER =
  /may run the fast|run the fast profile once|allows one validation run|You may run the fast|fast profile once, only as/iu

/** Every shipped verify stage that delegates evidence workers. */
function shippedVerifyStages(
  root: string,
): Array<{ slug: string; stage: StageDefinition }> {
  return ['delivery', 'delivery-chunk', 'delivery-candidate', 'metacritic']
    .map((slug) => ({
      slug,
      stage: stageBySlug(loadWorkflow(root, slug), 'verify'),
    }))
    .filter(({ stage }) => (stage.evidence_workers ?? []).length > 0)
}

/** The history that puts a verify stage on a return visit after repair. */
function returnHistory(root: string): StageHistoryItem[] {
  const implement = historyItem('implement', 'implement-1', 'fp-before')
  const verify = historyItem('verify', 'verify-1', 'fp-before')
  const remediate = historyItem('remediate', 'remediate-1', 'fp-current')

  verify.outcome = 'failure'
  implement.deterministic = [
    {
      id: 'implement.unit_tests',
      type: 'shell',
      hard: true,
      passed: true,
      command: 'pan repository-check fast',
      exit_code: 0,
      timed_out: false,
      evidence_path: `runtime/logs/workflows/${RUN_ID}/agent/evidence/implement-1.fast.log`,
      workspace_fingerprint: 'fp-current',
    },
  ]
  writeJson(path.join(root, implement.output_path), {
    data: { implementation: { changed_files: [] } },
  })
  writeJson(path.join(root, remediate.output_path), {
    data: { implementation: { changed_files: ['src/lib/narrow.ts'] } },
  })

  return [implement, verify, remediate]
}

/** One evidence worker of a shipped stage, with its real scope text. */
function shippedWorker(
  stage: StageDefinition,
  index: number,
): InvocationEvidenceWorker {
  const worker = (stage.evidence_workers ?? [])[index]

  assert.ok(worker)

  return {
    role: worker.role,
    persona: worker.persona,
    agent: `pan-${worker.persona}`,
    model: 'model',
    scope: worker.scope,
    brief_path: `runtime/logs/workflows/${RUN_ID}/agent/invocations/verify-2.${worker.role}.md`,
    evidence_path: `runtime/logs/workflows/${RUN_ID}/agent/evidence/${worker.role}.md`,
  }
}

// The previous guard asserted only that render.ts's own first-visit sentence
// was absent, from a fixture with a stand-in scope and no gate-evidence
// references. Both surviving offers lived outside what it could see: the
// stage definition's scope text and the allowance on every gate-evidence
// reference. This one renders the whole shipped document and reads all of it.
test('no shipped return-visit evidence brief offers a profile run anywhere', () => {
  const root = createFixture()
  const history = returnHistory(root)

  for (const { slug, stage } of shippedVerifyStages(root)) {
    const inputs = buildInvocationInputs({
      root,
      state: stateWith(history),
      stage,
      attempt: 2,
      invocationId: 'verify-2',
      workspaceFingerprint: 'fp-current',
    })

    // The fixture must reach both surfaces, or the assertion below proves
    // nothing about the document a worker actually receives.
    assert.ok(inputs.remediation_return, `${slug} must be a return visit`)
    assert.ok(
      inputs.references.some((item) => item.gate_evidence),
      `${slug} must carry gate-evidence references`,
    )

    for (const [index] of (stage.evidence_workers ?? []).entries()) {
      const worker = shippedWorker(stage, index)
      const brief = renderEvidenceWorkerBrief(
        { ...baseInvocation(root), attempt: 2, inputs },
        worker,
      )

      assert.ok(
        brief.includes(worker.scope),
        `${slug}/${worker.role} brief must carry the shipped scope`,
      )
      assert.doesNotMatch(
        brief,
        PROFILE_RUN_OFFER,
        `${slug}/${worker.role} return brief must not offer a profile run`,
      )
      assert.match(brief, /MUST NOT run a cost-bearing or mutating/u)
    }
  }
})

// The repair must withdraw the offer on a return, not delete it everywhere:
// a first visit still owes its worker one validation run.
test('a shipped first-visit evidence brief still offers its one validation run', () => {
  const root = createFixture()
  const implement = historyItem('implement', 'implement-1', 'fp-before')

  writeJson(path.join(root, implement.output_path), {
    data: { implementation: { changed_files: [] } },
  })

  const { slug, stage } = shippedVerifyStages(root)[0] ?? {
    slug: '',
    stage: undefined,
  }

  assert.ok(stage, 'the delivery verify stage must declare evidence workers')

  const inputs = buildInvocationInputs({
    root,
    state: stateWith([implement]),
    stage,
    attempt: 1,
    invocationId: 'verify-1',
    workspaceFingerprint: 'fp-current',
  })

  assert.equal(inputs.remediation_return, undefined, `${slug} is a first visit`)

  const brief = renderEvidenceWorkerBrief(
    { ...baseInvocation(root), inputs },
    shippedWorker(stage, 0),
  )

  assert.match(brief, PROFILE_RUN_OFFER)
  assert.doesNotMatch(brief, /MUST NOT run a cost-bearing or mutating/u)
})
