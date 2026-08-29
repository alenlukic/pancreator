import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { buildInvocationInputs } from '../../src/lib/context.js'
import type {
  OperatorGateWaiver,
  PrDescriptionContext,
  RunState,
  StageHistoryItem,
} from '../../src/lib/types.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createFixture, writeJson } from '../helpers.js'

function historyItem(
  stage: string,
  invocationId: string,
  outcome: StageHistoryItem['outcome'],
  fingerprint = 'fp-current',
): StageHistoryItem {
  return {
    stage,
    attempt: 1,
    invocation_id: invocationId,
    output_path: `runtime/logs/workflows/run/outputs/${invocationId}.json`,
    outcome,
    submitted_at: '2026-06-26T00:00:00.000Z',
    workspace_fingerprint: fingerprint,
    validation_errors: [],
    deterministic: [],
    record_path: `runtime/logs/workflows/run/artifacts/json/${invocationId}.json`,
  }
}

function stateWith(history: StageHistoryItem[]): RunState {
  return {
    schema_version: 1,
    run_id: 'run',
    workflow_slug: 'delivery',
    workflow_snapshot: {
      path: 'runtime/logs/workflows/run/workflow.snapshot.json',
      sha256: 'workflow-sha',
    },
    workspace_root: '.',
    title: 'Context fixture',
    status: 'running',
    current_stage: 'ship',
    pending_action: { type: 'prepare_invocation' },
    current_invocation: null,
    request: {
      source_path: 'request.md',
      stored_path: 'runtime/logs/workflows/run/request.md',
      sha256: 'request-sha',
    },
    limits: {
      max_total_transitions: 18,
      max_stage_attempts: 3,
      max_consecutive_failures: 3,
    },
    attempts: { ship: 0 },
    transition_count: 10,
    consecutive_failures: 0,
    stage_history: history,
    revision: 1,
    created_at: '2026-06-26T00:00:00.000Z',
    updated_at: '2026-06-26T00:00:00.000Z',
  }
}

function waiverFor(item: StageHistoryItem, suffix: string): OperatorGateWaiver {
  return {
    waiver_id: `waiver-${suffix}`,
    stage: item.stage,
    source_invocation_id: item.invocation_id,
    source_attempt: item.attempt,
    source_evidence_path: item.record_path ?? item.output_path,
    criterion_ids: ['verify.acceptance_met'],
    workspace_fingerprint: item.workspace_fingerprint,
    note: 'Operator accepted bounded residual risk.',
    artifact_path: `runtime/logs/workflows/run/artifacts/markdown/waiver-${suffix}.md`,
    deferred_acceptance_criteria: [],
    timestamp: '2026-06-26T00:00:00.000Z',
  }
}

test('implementation context retains approvals beyond the remediation limit', () => {
  const root = createFixture()
  const state = stateWith([])

  state.current_stage = 'implement'
  state.operator_feedback = [
    {
      decision: 'approve',
      from_stage: 'plan',
      to_stage: 'implement',
      attempt: 1,
      note: 'Preserve the approved compatibility boundary.',
      path: 'runtime/approval.md',
      timestamp: '2026-06-24T00:00:00.000Z',
    },
    {
      decision: 'revise',
      from_stage: 'verify',
      to_stage: 'implement',
      attempt: 1,
      note: 'Older remediation.',
      path: 'runtime/older.md',
      timestamp: '2026-06-25T00:00:00.000Z',
    },
    {
      decision: 'reject',
      from_stage: 'verify',
      to_stage: 'implement',
      attempt: 1,
      note: 'Newest remediation.',
      path: 'runtime/newest.md',
      timestamp: '2026-06-26T00:00:00.000Z',
    },
  ]

  const inputs = buildInvocationInputs({
    root,
    state,
    stage: stageBySlug(loadWorkflow(root, 'delivery'), 'implement'),
    attempt: 1,
    invocationId: 'implement-1',
    workspaceFingerprint: 'fp-current',
  })
  const selectedPaths = inputs.references
    .filter((item) => item.retrieval === 'required')
    .map((item) => item.path)

  assert.ok(selectedPaths.includes('runtime/approval.md'))
  assert.ok(selectedPaths.includes('runtime/newest.md'))
  assert.ok(!selectedPaths.includes('runtime/older.md'))
})

test('implementation context resolves planned target instruction paths', () => {
  const root = createFixture()
  const plan = historyItem('plan', 'plan-1', 'success')
  const state = stateWith([plan])

  state.current_stage = 'implement'
  mkdirSync(path.join(root, 'src', 'feature'), { recursive: true })
  writeFileSync(path.join(root, 'src', 'AGENTS.md'), '# Source rules\n')
  writeJson(path.join(root, plan.output_path), {
    data: {
      engineering_plan: {
        files: [{ path: 'src/feature/new.ts' }],
      },
    },
  })

  const inputs = buildInvocationInputs({
    root,
    state,
    stage: stageBySlug(loadWorkflow(root, 'delivery'), 'implement'),
    attempt: 1,
    invocationId: 'implement-1',
    workspaceFingerprint: 'fp-current',
  })

  assert.deepEqual(inputs.target_instructions, {
    changed_paths: ['src/feature/new.ts'],
    read_paths: ['AGENTS.md', 'src/AGENTS.md'],
  })
})

test('ship context selects effective records and indexes superseded history', () => {
  const root = createFixture()
  const planFailed = historyItem('plan', 'plan-1', 'failure')
  const planCurrent = historyItem('plan', 'plan-2', 'success')
  const implementOld = historyItem('implement', 'implement-1', 'success')
  const verifyOld = historyItem('verify', 'verify-1', 'failure')
  const remediateCurrent = historyItem('remediate', 'remediate-1', 'success')
  const implementCurrent = historyItem('implement', 'implement-2', 'success')
  const verifyCurrent = historyItem('verify', 'verify-2', 'success')
  const history = [
    planFailed,
    planCurrent,
    implementOld,
    verifyOld,
    remediateCurrent,
    implementCurrent,
    verifyCurrent,
  ]
  const state = stateWith(history)
  state.governance_artifact_issues_path =
    'runtime/logs/workflows/run/artifacts/json/governance-artifact-issues.json'
  state.operator_feedback = [
    {
      decision: 'resume',
      from_stage: 'verify',
      to_stage: 'implement',
      attempt: 1,
      note: 'Old remediation note.',
      path: 'runtime/logs/workflows/run/artifacts/markdown/feedback-old.md',
      timestamp: '2026-06-25T00:00:00.000Z',
    },
    {
      decision: 'set-stage',
      from_stage: 'verify',
      to_stage: 'ship',
      attempt: 1,
      note: 'Current ship repair.',
      path: 'runtime/logs/workflows/run/artifacts/markdown/feedback-current.md',
      timestamp: '2026-06-26T00:00:00.000Z',
    },
  ]
  state.operator_gate_waivers = [
    waiverFor(verifyOld, 'old'),
    waiverFor(verifyCurrent, 'current'),
  ]
  state.operator_workspace_ratifications = [
    {
      ratification_id: 'ratification-current',
      stage: 'ship',
      workspace_fingerprint: 'fp-current',
      changed_paths: [],
      deleted_paths: [],
      note: 'Current workspace accepted.',
      artifact_path:
        'runtime/logs/workflows/run/artifacts/markdown/ratification-current.md',
      timestamp: '2026-06-26T00:00:00.000Z',
    },
  ]

  const stage = stageBySlug(loadWorkflow(root, 'delivery'), 'ship')
  const inputs = buildInvocationInputs({
    root,
    state,
    stage,
    attempt: 1,
    invocationId: 'ship-1',
    workspaceFingerprint: 'fp-current',
  })
  const byPath = new Map(inputs.references.map((item) => [item.path, item]))

  for (const item of [planCurrent, implementCurrent, verifyCurrent]) {
    assert.equal(byPath.get(item.output_path)?.retrieval, 'required')
    assert.equal(byPath.get(item.record_path ?? '')?.retrieval, 'conditional')
  }

  // Remediation is declared conditional ship context, not required reading.
  assert.equal(
    byPath.get(remediateCurrent.output_path)?.retrieval,
    'conditional',
  )

  for (const item of [planFailed, implementOld, verifyOld]) {
    assert.equal(byPath.has(item.output_path), false)
  }

  assert.equal(byPath.get(state.request.stored_path)?.retrieval, 'conditional')
  assert.equal(
    byPath.get(
      'runtime/logs/workflows/run/artifacts/markdown/feedback-current.md',
    )?.retrieval,
    'required',
  )
  assert.equal(
    byPath.has('runtime/logs/workflows/run/artifacts/markdown/feedback-old.md'),
    false,
  )
  assert.equal(
    byPath.get(
      'runtime/logs/workflows/run/artifacts/markdown/waiver-current.md',
    )?.retrieval,
    'required',
  )
  assert.equal(
    byPath.has('runtime/logs/workflows/run/artifacts/markdown/waiver-old.md'),
    false,
  )

  const manifest = inputs.references.find(
    (item) => item.retrieval === 'index_only',
  )
  assert.ok(manifest)
  assert.equal(existsSync(path.join(root, manifest.path)), true)

  const manifestValue = JSON.parse(
    readFileSync(path.join(root, manifest.path), 'utf8'),
  ) as { omitted: Array<{ path: string }> }
  assert.equal(
    manifestValue.omitted.some((item) => item.path === planFailed.output_path),
    true,
  )
  assert.deepEqual(inputs.missing_required, undefined)
  assert.equal(byPath.get('VERSION')?.retrieval, 'required')
  assert.equal(byPath.get('release/index.json')?.retrieval, 'required')

  const prDescription: PrDescriptionContext = {
    mode: 'target',
    template_path: '.github/PULL_REQUEST_TEMPLATE.md',
    instruction_paths: ['AGENTS.md', '.github/AGENTS.md', 'docs/pr-rules.md'],
    heading_order: ['Why', 'Confidence & risk', 'What changed'],
    required_headings: ['Why', 'Confidence & risk'],
    optional_headings: ['What changed'],
    allows_body_title: false,
  }
  const withPr = buildInvocationInputs({
    root,
    state,
    stage,
    attempt: 1,
    invocationId: 'ship-pr-context',
    workspaceFingerprint: 'fp-current',
    prDescription,
  })

  assert.deepEqual(withPr.pr_description, prDescription)

  for (const referencePath of [
    '.github/PULL_REQUEST_TEMPLATE.md',
    'AGENTS.md',
    '.github/AGENTS.md',
    'docs/pr-rules.md',
  ]) {
    assert.equal(
      withPr.references.find((item) => item.path === referencePath)?.retrieval,
      'required',
    )
  }
})

test('embedded ship context omits Pancreator self-development release metadata', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  config.installation_mode = 'embedded'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const inputs = buildInvocationInputs({
    root,
    state: stateWith([]),
    stage: stageBySlug(loadWorkflow(root, 'delivery'), 'ship'),
    attempt: 1,
    invocationId: 'ship-embedded',
    workspaceFingerprint: 'fp-current',
  })

  assert.equal(
    inputs.references.some((item) => item.path === 'VERSION'),
    false,
  )
  assert.equal(
    inputs.references.some((item) => item.path === 'release/index.json'),
    false,
  )
})

test('missing required stage outputs are explicit instead of triggering broad scans', () => {
  const root = createFixture()
  const state = stateWith([])
  state.current_stage = 'verify'
  const stage = stageBySlug(loadWorkflow(root, 'delivery'), 'verify')

  const inputs = buildInvocationInputs({
    root,
    state,
    stage,
    attempt: 1,
    invocationId: 'verify-1',
    workspaceFingerprint: 'fp-current',
  })

  assert.deepEqual(inputs.missing_required, [
    "latest success output for stage 'plan'",
    "latest output for stage 'implement'",
  ])
  assert.equal(
    inputs.references.some((item) => item.path === state.request.stored_path),
    false,
  )
  assert.equal(
    inputs.references.some((item) => item.retrieval === 'index_only'),
    true,
  )
})

test('legacy workflow snapshots preserve all-history reference behavior', () => {
  const root = createFixture()
  const history = [
    historyItem('plan', 'plan-1', 'success'),
    historyItem('implement', 'implement-1', 'failure'),
  ]
  const state = stateWith(history)
  const stage = {
    ...stageBySlug(loadWorkflow(root, 'delivery'), 'ship'),
    context: { request: 'required' as const, legacy_full_history: true },
  }

  const inputs = buildInvocationInputs({
    root,
    state,
    stage,
    attempt: 1,
    invocationId: 'ship-legacy',
    workspaceFingerprint: 'fp-current',
  })

  assert.equal(
    inputs.references.every((item) => item.retrieval === 'required'),
    true,
  )
  assert.equal(
    inputs.references.some((item) => item.path === history[1].output_path),
    true,
  )
  assert.equal(
    inputs.references.some((item) => item.retrieval === 'index_only'),
    false,
  )
})

test('verify context carries passed gate evidence with profile, path, and fingerprint', () => {
  const root = createFixture()
  const plan = historyItem('plan', 'plan-1', 'success')
  const implement = historyItem('implement', 'implement-1', 'success')
  implement.deterministic = [
    {
      id: 'implement.unit_tests',
      type: 'shell',
      hard: true,
      passed: true,
      command: 'pan repository-check fast',
      exit_code: 0,
      timed_out: false,
      evidence_path: 'runtime/logs/workflows/run/evidence/implement-1.fast.log',
      workspace_fingerprint: 'fp-current',
    },
    {
      id: 'implement.lint',
      type: 'shell',
      hard: true,
      passed: false,
      command: 'pan repository-check static',
      exit_code: 1,
      timed_out: false,
      evidence_path:
        'runtime/logs/workflows/run/evidence/implement-1.static.log',
      workspace_fingerprint: 'fp-current',
    },
  ]
  const bareImplement = historyItem('implement', 'implement-2', 'success')

  for (const item of [implement, bareImplement]) {
    writeJson(path.join(root, item.output_path), {
      data: { implementation: { changed_files: [] } },
    })
  }

  const state = stateWith([plan, implement])
  state.current_stage = 'verify'
  state.repository_check_baselines = {
    fast: {
      profile: 'fast',
      status: 'passed',
      artifact_path:
        'runtime/logs/workflows/run/evidence/pre-implementation-fast.json',
      workspace_fingerprint: 'fp-before',
      recorded_at: '2026-06-26T00:00:00.000Z',
    },
    static: {
      profile: 'static',
      status: 'passed',
      artifact_path:
        'runtime/logs/workflows/run/evidence/pre-implementation-static.json',
      workspace_fingerprint: 'fp-before',
      recorded_at: '2026-06-26T00:00:00.000Z',
    },
  }

  const stage = stageBySlug(loadWorkflow(root, 'delivery'), 'verify')
  const inputs = buildInvocationInputs({
    root,
    state,
    stage,
    attempt: 1,
    invocationId: 'verify-1',
    workspaceFingerprint: 'fp-current',
  })
  const byPath = new Map(inputs.references.map((item) => [item.path, item]))

  const fastGate = byPath.get(
    'runtime/logs/workflows/run/evidence/implement-1.fast.log',
  )
  assert.ok(fastGate)
  assert.equal(fastGate.retrieval, 'conditional')
  assert.match(fastGate.description, /`fast` repository-check gate evidence/u)
  assert.match(fastGate.description, /`fp-current`/u)
  assert.match(fastGate.description, /current workspace/u)
  assert.equal(
    byPath.has(
      'runtime/logs/workflows/run/evidence/pre-implementation-fast.json',
    ),
    false,
  )

  // A failed gate is not evidence, but the passed baseline for the profile is.
  assert.equal(
    byPath.has('runtime/logs/workflows/run/evidence/implement-1.static.log'),
    false,
  )
  const staticBaseline = byPath.get(
    'runtime/logs/workflows/run/evidence/pre-implementation-static.json',
  )
  assert.ok(staticBaseline)
  assert.match(staticBaseline.description, /`static`/u)
  assert.match(staticBaseline.description, /`fp-before`/u)
  assert.match(staticBaseline.description, /superseded workspace/u)
  // No supervisor command re-runs the verify submission gate, so the condition
  // must not send QA there.
  assert.match(staticBaseline.condition ?? '', /verify submission gate/u)
  assert.doesNotMatch(staticBaseline.condition ?? '', /supervisor/u)
  assert.deepEqual(staticBaseline.gate_evidence, {
    profile: 'static',
    fingerprint: 'fp-before',
    current: false,
  })
  assert.match(fastGate.condition ?? '', /gate_evidence_citations/u)
  assert.deepEqual(fastGate.gate_evidence, {
    profile: 'fast',
    fingerprint: 'fp-current',
    current: true,
  })

  const bare = buildInvocationInputs({
    root,
    state: stateWith([plan, bareImplement]),
    stage,
    attempt: 1,
    invocationId: 'verify-2',
    workspaceFingerprint: 'fp-current',
  })
  assert.equal(
    bare.references.some((item) =>
      /repository-check gate evidence/u.test(item.description),
    ),
    false,
  )
})
