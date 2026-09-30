import assert from 'node:assert/strict'
import test from 'node:test'

import { policySectionDigest } from '../../src/lib/policy-guidance.js'
import { policyDeliveryPlan } from '../../src/lib/projection.js'
import { GATE_CACHE_ACCEPTANCE_RULE } from '../../src/lib/gate-cache.js'
import {
  orderedWorkerActions,
  renderEvidenceWorkerBrief,
  renderInvocationMarkdown,
  renderSupervisorProcedureMarkdown,
} from '../../src/lib/render.js'
import { loadPolicyCatalog, resolvePolicies } from '../../src/lib/policies.js'
import { validateInvocationMarkdown } from '../../src/lib/validation.js'
import { sharedFixture } from '../fixture-template.js'
import { policyInstructionAppliesToCard } from '../../src/lib/policy-instructions.js'
import type {
  Invocation,
  InvocationEvidenceWorker,
  Policy,
} from '../../src/lib/types.js'
import { baseInvocation, delegatedInvocation } from './render-helpers.js'

function evidenceWorkerFixture(): InvocationEvidenceWorker {
  return {
    persona: 'qa-tester',
    role: 'qa',
    scope: 'Execute the ratified test plan.',
    agent: 'pan-qa-tester',
    model: 'fixture-model',
    brief_path: 'runtime/logs/workflows/run-fixture/agent/briefs/qa.md',
    evidence_path: 'runtime/logs/workflows/run-fixture/agent/evidence/qa.md',
  }
}

test('the evidence brief names the fast command only when no passed fast gate is current', () => {
  const root = sharedFixture()
  const invocation = baseInvocation(root, 'delivery', 'verify')
  // The two evidence workers of a verify stage share this invocation id, so
  // the role is what separates their recorded passes; the brief hands each
  // worker the command that records its own.
  const command =
    '`./bin/pan repository-check fast --run run-fixture --role qa`'

  // No gate evidence at all, as on a release run that never ran implement:
  // the brief names the command, and the harness checkout is the place to
  // run it from.
  const withoutEvidence = renderEvidenceWorkerBrief(
    invocation,
    evidenceWorkerFixture(),
  )

  assert.ok(withoutEvidence.includes(command))
  assert.ok(
    renderEvidenceWorkerBrief(invocation, {
      ...evidenceWorkerFixture(),
      persona: 'reviewer',
      role: 'review',
    }).includes(
      '`./bin/pan repository-check fast --run run-fixture --role review`',
    ),
    'the other worker of the same invocation is handed its own command',
  )
  assert.match(withoutEvidence, /from this checkout so the run records/u)
  assert.doesNotMatch(withoutEvidence, /Harness root/u)
  assert.doesNotMatch(withoutEvidence, /already ran `fast`/u)

  // A passed fast gate at the current fingerprint is what the scope tells the
  // worker to cite, so the brief says so instead of ordering a rerun.
  invocation.inputs.references = [
    {
      path: 'runtime/logs/workflows/run-fixture/agent/evidence/fast.json',
      description: 'Gate evidence',
      retrieval: 'conditional',
      condition: 'Cite this evidence.',
      gate_evidence: {
        profile: 'fast',
        fingerprint: 'fixture-fingerprint',
        current: true,
      },
    },
  ]

  const withEvidence = renderEvidenceWorkerBrief(
    invocation,
    evidenceWorkerFixture(),
  )

  assert.ok(!withEvidence.includes(command))
  assert.match(
    withEvidence,
    /The implement gate already ran `fast` at this workspace fingerprint\. Cite that gate evidence reference from your card/u,
  )

  // Superseded fast evidence, or a passed profile other than fast, does not
  // stand in: the command returns.
  invocation.inputs.references[0].gate_evidence = {
    profile: 'fast',
    fingerprint: 'older-fingerprint',
    current: false,
  }
  assert.ok(
    renderEvidenceWorkerBrief(invocation, evidenceWorkerFixture()).includes(
      command,
    ),
  )
  invocation.inputs.references[0].gate_evidence = {
    profile: 'static',
    fingerprint: 'fixture-fingerprint',
    current: true,
  }
  assert.ok(
    renderEvidenceWorkerBrief(invocation, evidenceWorkerFixture()).includes(
      command,
    ),
  )

  // A run bound to a worktree carries the harness root, as the card does, so
  // the brief names that directory instead of assuming this checkout.
  invocation.workspace_root = 'worktrees/operator/delivery-abc123-alpha'
  invocation.harness_root = '/srv/harness'
  invocation.installation_mode = 'self_development'
  invocation.managed_worktree = {
    name: 'delivery-abc123-alpha',
    path: invocation.workspace_root,
    branch: 'delivery-abc123-alpha',
  }

  const fromHarnessRoot = renderEvidenceWorkerBrief(
    invocation,
    evidenceWorkerFixture(),
  )

  assert.ok(fromHarnessRoot.includes('/srv/harness'))
  assert.match(
    fromHarnessRoot,
    /PANCREATOR_EXEC_ROOT=\/srv\/harness\/worktrees\/operator\/delivery-abc123-alpha \.\/bin\/pan/u,
  )
  assert.match(
    fromHarnessRoot,
    /Bare `\.\/bin\/pan` remains the installation-root form for lifecycle and evidence commands/u,
  )
  assert.doesNotMatch(fromHarnessRoot, /from this checkout/u)
})

// Run 63310 genre-label: two supervisors let a backgrounded launch continue
// unwatched. The rule was on the attested card, 300 lines from the launch
// step. The launch step itself has to carry the digest pointer, the exact
// command, and the ordering that makes the watch precede its verdict.
test('the launch step carries the watch pointer, command, and ordering', () => {
  const root = sharedFixture()
  const invocation = delegatedInvocation(root)

  const delegateDigest = 'd'.repeat(64)
  const redlineRecordPath =
    'runtime/logs/workflows/run-fixture/agent/delegation-redlines.md'
  const watchCommand = './bin/pan delegate watch run-fixture'

  assert.ok(invocation.delegation)
  invocation.delegation.policies = resolvePolicies(root, {
    persona: 'orchestrator',
    workflow: 'delivery',
    stage: 'implement',
  }).filter((policy) => policy.id === 'DELEGATE-001')
  invocation.delegation.watch_command = watchCommand
  invocation.delegation.redline_record_path = redlineRecordPath
  assert.ok(invocation.delegation.supervisor_card)
  invocation.delegation.supervisor_card.policy_sections = [
    { policy_id: 'DELEGATE-001', sha256: delegateDigest },
  ]

  const procedure = renderSupervisorProcedureMarkdown(invocation)

  assert.ok(
    procedure.includes(`\`DELEGATE-001\`: \`sha256:${delegateDigest}\``),
    procedure,
  )
  assert.ok(procedure.includes(redlineRecordPath))
  assert.ok(procedure.includes(`${watchCommand} --mark-background`))
  // The handle and the launch time exist only in the supervisor's hands. A
  // procedure that never asks for them leaves `worker_handle` null on every
  // run and makes the arming its own launch time, so `DELEGATION_WATCH_LATE`
  // can never fire.
  assert.ok(
    procedure.includes('--launched-at <iso-8601>'),
    'the procedure asks the supervisor to record the launch time',
  )
  assert.ok(
    procedure.includes('--handle <platform-handle>'),
    'the procedure asks the supervisor to record the platform handle',
  )
  assert.ok(
    procedure.includes(
      '--mark-background --launched-at <iso-8601> --handle <platform-handle>',
    ),
    'the background arming form carries mark-background, launched-at, and handle',
  )

  const launchIndex = procedure.indexOf('2a. Arm the watch')
  const verdictIndex = procedure.indexOf('3a. Read the verdict')

  assert.ok(launchIndex > 0)
  assert.ok(launchIndex < verdictIndex)
})

// AC-006. A supervisor that read "launch the evidence workers, then the stage
// worker" as one instruction launched the verifier first and got a stage that
// reported `blocked` on reports nobody had produced. The ordering is numbered
// so there is one place to count.
test('a prepared verify stage orders every evidence worker before the stage worker', () => {
  const root = sharedFixture()
  const invocation = baseInvocation(root, 'delivery', 'verify')

  invocation.delegation = delegatedInvocation(root).delegation
  assert.ok(invocation.delegation)
  invocation.delegation.cursor_agent_path = '.cursor/agents/pan-verifier.md'
  invocation.delegation.watch_command =
    './bin/pan watch run-fixture --invocation inv-fixture'
  invocation.evidence_workers = [
    {
      persona: 'reviewer',
      role: 'review',
      scope: 'Implementation correctness',
      agent: 'pan-reviewer',
      model: 'review-model',
      brief_path: 'runtime/logs/workflows/run-fixture/briefs/review.md',
      evidence_path: 'runtime/logs/workflows/run-fixture/evidence/review.md',
    },
    {
      persona: 'qa-tester',
      role: 'qa',
      scope: 'Acceptance evidence',
      agent: 'pan-qa-tester',
      model: 'qa-model',
      brief_path: 'runtime/logs/workflows/run-fixture/briefs/qa.md',
      evidence_path: 'runtime/logs/workflows/run-fixture/evidence/qa.md',
    },
  ]

  const actions = orderedWorkerActions(invocation)

  assert.deepEqual(
    actions.map((action) => [action.order, action.role, action.agent]),
    [
      [1, 'evidence', 'pan-reviewer'],
      [2, 'evidence', 'pan-qa-tester'],
      [3, 'stage', 'pan-verifier'],
    ],
  )

  const procedure = renderSupervisorProcedureMarkdown(invocation)

  for (const action of actions) {
    assert.ok(
      procedure.includes(`${action.order}. \`${action.agent}\``),
      procedure,
    )
  }

  assert.ok(
    procedure.indexOf('1. `pan-reviewer`') <
      procedure.indexOf('3. `pan-verifier`'),
    procedure,
  )

  // The supervisor blocks on the harness evidence watch rather than a timer
  // script, and launches the stage worker when it returns.
  assert.ok(
    procedure.includes(
      '`./bin/pan watch run-fixture --invocation inv-fixture --until-evidence-complete`',
    ),
    procedure,
  )
  assert.match(procedure, /Never poll the reports with a timer or a script/u)
})

// A stage with no evidence worker has nothing to order, so its procedure is
// unchanged.
test('a stage with no evidence worker reports no worker actions', () => {
  const root = sharedFixture()

  assert.deepEqual(orderedWorkerActions(delegatedInvocation(root)), [])
})

// AC-005. The supervisor used to assemble this command from three fields on
// three different lines of the card and reliably dropped one.
test('the supervisor procedure carries the resolved output validate command', () => {
  const root = sharedFixture()
  const invocation = delegatedInvocation(root)

  assert.ok(invocation.delegation)
  invocation.delegation.output_validate_command =
    './bin/pan output validate --run run-fixture ' +
    `--file ${invocation.output.path} ` +
    '--invocation runtime/logs/workflows/run-fixture/invocations/implement-1.json'

  const procedure = renderSupervisorProcedureMarkdown(invocation)

  assert.ok(
    procedure.includes(invocation.delegation.output_validate_command),
    procedure,
  )
})

// AC-017. The tracked configuration file states the profile's own budget; the
// run snapshot states the bound this gate enforces, and only the second one
// tells the worker when its command will be killed.
test('a worker card names the resolved gate timeout beside its profile command', () => {
  const root = sharedFixture()
  const invocation = baseInvocation(root, 'delivery', 'implement')
  const card = renderInvocationMarkdown(invocation)
  const gate = invocation.rubric.find(
    (criterion) => criterion.command === 'pan repository-check fast',
  )

  assert.ok(gate?.timeout_ms)
  assert.match(
    card,
    new RegExp(
      `Gate: \`pan repository-check fast\`, resolved timeout ${gate.timeout_ms} ms from the run snapshot`,
      'u',
    ),
  )
})

test('a verification level remap moves the gate command the card names', () => {
  const root = sharedFixture()
  const invocation = baseInvocation(root, 'delivery', 'implement')

  invocation.verification = {
    level: 'light',
    summary: 'Fixture level',
    gates: { 'implement.unit_tests': 'static', 'implement.lint': false },
  }

  const card = renderInvocationMarkdown(invocation)

  assert.match(card, /Gate: `pan repository-check static`, resolved timeout/u)
  assert.match(card, /Gate: skipped at verification level `light`/u)
})

// AC-018. One statement, in one term, wherever a worker meets the mark.
test('a card that owns a repository-check gate carries the gate-cache rule', () => {
  const root = sharedFixture()
  const card = renderInvocationMarkdown(
    baseInvocation(root, 'delivery', 'implement'),
  )

  assert.ok(card.includes(GATE_CACHE_ACCEPTANCE_RULE), card)
})

test('a card handed gate evidence carries the same gate-cache rule', () => {
  const root = sharedFixture()
  const invocation = baseInvocation(root, 'delivery', 'verify')

  assert.ok(
    !renderInvocationMarkdown(invocation).includes(GATE_CACHE_ACCEPTANCE_RULE),
  )

  invocation.inputs.references = [
    {
      path: 'runtime/logs/workflows/run-fixture/evidence/implement-fast.log',
      description: 'Implement gate evidence',
      gate_evidence: {
        profile: 'fast',
        current: true,
        fingerprint: 'fixture-fingerprint',
      },
      // The reference exists so the card is handed gate evidence.
    },
  ]

  assert.ok(
    renderInvocationMarkdown(invocation).includes(GATE_CACHE_ACCEPTANCE_RULE),
  )
})

// HR-004 of the 2026-09-29 efficiency audit: a Cursor worker already
// receives the projected always-apply policies as rules, so a second inline
// copy was a third of every remediate card.
test('a Cursor worker card points at projected always-apply policies and keeps their excerpt clauses', () => {
  const root = sharedFixture()
  const invocation = baseInvocation(root, 'delivery', 'remediate')
  const inline = renderInvocationMarkdown(invocation)
  const delivery = policyDeliveryPlan(root, invocation.policies, {
    executor: 'cursor',
    mode: 'self_development',
  })
  const pointed: Invocation = { ...invocation, policy_delivery: delivery }
  const markdown = renderInvocationMarkdown(pointed)
  const projected = ['PRINCIPLES-001', 'DELEGATE-001', 'COMMS-001']

  for (const policyId of projected) {
    const entry = delivery[policyId]

    assert.equal(entry?.mode, 'pointer', policyId)
  }

  assert.equal(delivery['GLOBAL-001']?.mode, 'inline')

  const catalog = loadPolicyCatalog(root)

  for (const policyId of projected) {
    const policy = catalog.get(policyId) as Policy
    const entry = delivery[policyId] as {
      mode: 'pointer'
      target: string
      sha256: string
    }

    assert.equal(entry.sha256, policySectionDigest(policy, 'agent'))
    assert.ok(markdown.includes(`**${policy.id} · ${policy.title}**`))
    assert.ok(markdown.includes(`\`${entry.target}\``))
    assert.ok(markdown.includes(`sha256:${entry.sha256}`))

    for (const instruction of policy.instructions) {
      if (!policyInstructionAppliesToCard(instruction, 'agent')) {
        continue
      }

      assert.equal(
        markdown.includes(`- ${instruction.text}`),
        instruction.excerpt === true,
        `${policyId}: ${instruction.text.slice(0, 60)}`,
      )
    }
  }

  const delegate = catalog.get('DELEGATE-001') as Policy

  assert.ok(
    delegate.instructions.some(
      (instruction) =>
        instruction.excerpt === true &&
        instruction.text.includes('bin/pan-run'),
    ),
  )
  // DELEGATE-001's stall decision procedure is supervisor-audience: a worker
  // card MUST NOT carry it, only the supervisor card the operator attests.
  assert.ok(
    !markdown.includes(
      'Only a watch verdict `stalled` (exit 2) is a stall signal.',
    ),
    'a worker card must not carry the supervisor-only stall procedure',
  )
  assert.ok(
    Buffer.byteLength(markdown) + 15_000 < Buffer.byteLength(inline),
    `pointer card ${Buffer.byteLength(markdown)} B, inline ${Buffer.byteLength(inline)} B`,
  )

  const validation = validateInvocationMarkdown(pointed, markdown)

  assert.equal(
    validation.passed,
    true,
    validation.checks
      .filter((check) => !check.passed)
      .map((check) => check.message)
      .join('\n'),
  )
})

test('a pointer whose digest no longer names its policy section fails card validation', () => {
  const root = sharedFixture()
  const invocation = baseInvocation(root, 'delivery', 'remediate')
  const delivery = policyDeliveryPlan(root, invocation.policies, {
    executor: 'cursor',
    mode: 'self_development',
  })
  const stale = {
    ...delivery,
    'COMMS-001': {
      mode: 'pointer' as const,
      target: '.cursor/rules/pan-chat-output.mdc',
      sha256: '0'.repeat(64),
    },
  }
  const pointed: Invocation = { ...invocation, policy_delivery: stale }
  const validation = validateInvocationMarkdown(
    pointed,
    renderInvocationMarkdown(pointed),
  )
  const check = validation.checks.find(
    (item) => item.id === 'policy.COMMS-001.pointer_digest',
  )

  assert.equal(validation.passed, false)
  assert.equal(check?.passed, false)
  assert.match(check?.message ?? '', /does not match its section digest/u)
})

test('an external executor card inlines every policy', () => {
  const root = sharedFixture()
  const invocation = baseInvocation(root, 'delivery', 'remediate')
  const delivery = policyDeliveryPlan(root, invocation.policies, {
    executor: 'claude-code',
    mode: 'self_development',
  })

  assert.ok(
    Object.values(delivery).every((entry) => entry.mode === 'inline'),
    JSON.stringify(delivery),
  )
  assert.equal(
    renderInvocationMarkdown({ ...invocation, policy_delivery: delivery }),
    renderInvocationMarkdown(invocation),
  )
})
