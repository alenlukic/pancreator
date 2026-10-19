import assert from 'node:assert/strict'
import test from 'node:test'

import { sha256 } from '../../src/lib/io.js'
import {
  resolvePolicyCoverage,
  initialPolicyReminder,
  withInitialPolicyReminder,
} from '../../src/lib/policy-delivery.js'
import { filterPolicyInstructionsForCard } from '../../src/lib/policy-instructions.js'
import {
  invocationPolicyPointers,
  renderInvocationMarkdown,
} from '../../src/lib/render/invocation-markdown.js'
import { policySectionDigest } from '../../src/lib/policy-guidance.js'
import { policyDeliveryPlan } from '../../src/lib/projection.js'
import { resolvePolicies } from '../../src/lib/policies.js'
import { resolveRequirements } from '../../src/lib/requirements/resolve.js'
import { renderEvidenceWorkerBrief } from '../../src/lib/render/evidence-worker-brief.js'
import {
  validateDelegationMarkdown,
  validateInvocationMarkdown,
} from '../../src/lib/validation/invocation-markdown.js'
import { expectedDelegationContent } from '../../src/lib/validation/artifacts.js'
import { renderGovernanceCardMarkdown } from '../../src/lib/governance-card/render.js'
import { STANDALONE_MODES } from '../../src/lib/governance-card/modes.js'
import { resolvePromptContext } from '../../src/lib/governance/prompt-context/routing.js'
import type { PolicyDeliveryCoverage } from '../../src/lib/types.js'
import { sharedFixture } from '../helpers.js'
import { baseInvocation } from './render-helpers.js'

test('delegation validation requires the exact fresh external packet and preserves native resumed and legacy bodies', () => {
  const invocation = baseInvocation(sharedFixture(), 'delivery', 'implement')
  invocation.capabilities = { shell: true, delegation: false }
  invocation.initial_policy_reminder = initialPolicyReminder(
    invocation,
    'initial.md',
  ).reminder
  for (const executor of ['copilot', 'claude-code', 'openai'] as const) {
    invocation.stage.persona_executor = executor
    const expected = expectedDelegationContent(
      invocation,
      'contract',
      'verbatim',
    )
    assert.equal(
      expected,
      `${invocation.initial_policy_reminder.content}\n\ncontract`,
    )
    assert.equal(validateDelegationMarkdown(expected, expected).passed, true)
    assert.equal(
      validateDelegationMarkdown(
        expected,
        expected.replace('contract', 'contracT'),
      ).passed,
      false,
    )
    assert.equal(validateDelegationMarkdown(expected, 'contract').passed, false)
    assert.equal(
      validateDelegationMarkdown(expected, `${expected}\nshadow instruction`)
        .passed,
      false,
    )
    assert.equal(
      expectedDelegationContent(invocation, 'directive', 'referenced'),
      'directive',
    )
  }
  delete invocation.stage.persona_executor
  assert.equal(
    expectedDelegationContent(invocation, 'native', 'verbatim'),
    'native',
  )
  invocation.stage.persona_executor = 'copilot'
  invocation.initial_policy_reminder.sha256 = 'stale'
  assert.throws(
    () => expectedDelegationContent(invocation, 'contract', 'verbatim'),
    /digest/,
  )
  delete invocation.initial_policy_reminder
  assert.equal(
    expectedDelegationContent(invocation, 'legacy', 'verbatim'),
    'legacy',
  )
})

test('fresh delivery suppresses only exact covered instructions and preserves legacy snapshots', () => {
  const root = sharedFixture()
  const invocation = baseInvocation(root, 'delivery', 'implement')
  invocation.context_contract_version = 1
  invocation.capabilities = { shell: true, delegation: false }
  const policy = invocation.policies.find(
    (entry) => entry.id === 'PRINCIPLES-001',
  )!
  const instruction = policy.instructions[0]!
  const coverage: PolicyDeliveryCoverage = {
    invocation_id: invocation.invocation_id,
    role: 'worker',
    executor: 'cursor',
    host: 'cursor',
    route: 'initial_reminder',
    status: 'verified',
    source: 'reminder.md',
    content: instruction.text,
    content_sha256: sha256(instruction.text),
    instruction_sha256: [sha256(instruction.text)],
  }
  invocation.policy_delivery = policyDeliveryPlan(root, [policy], {
    invocationId: invocation.invocation_id,
    executor: 'cursor',
    host: 'cursor',
    mode: 'self_development',
    coverage: { [policy.id]: coverage },
  })
  const markdown = renderInvocationMarkdown(invocation)
  assert.ok(!markdown.includes(instruction.text))
  assert.ok(markdown.includes(policy.instructions[1]!.text))
  assert.equal(
    invocationPolicyPointers(invocation).get(policy.id)?.instruction_sha256
      ?.length,
    1,
  )
  invocation.policy_delivery = {
    [policy.id]: {
      mode: 'pointer',
      target: 'old.mdc',
      sha256: policySectionDigest(policy, 'agent'),
    },
  }
  assert.ok(renderInvocationMarkdown(invocation).includes(instruction.text))
  delete invocation.context_contract_version
  assert.ok(!renderInvocationMarkdown(invocation).includes(instruction.text))
})

test('delivery diagnostics reject unsupported, stale, partial and misattributed receipts', () => {
  const invocation = baseInvocation(sharedFixture(), 'delivery', 'implement')
  const policy = invocation.policies[0]!
  const content = policy.instructions[0]!.text
  const expected = {
    invocationId: invocation.invocation_id,
    executor: 'copilot',
    host: null,
  }
  const receipt: PolicyDeliveryCoverage = {
    invocation_id: invocation.invocation_id,
    role: 'worker',
    executor: 'copilot',
    host: null,
    route: 'initial_reminder',
    status: 'verified',
    source: 'reminder.md',
    content,
    content_sha256: sha256(content),
    instruction_sha256: [sha256(content)],
  }
  assert.equal(
    resolvePolicyCoverage(policy, receipt, expected).diagnostic,
    null,
  )
  const cases: [Partial<PolicyDeliveryCoverage>, string][] = [
    [{ invocation_id: 'other' }, 'wrong_invocation'],
    [{ role: 'supervisor' }, 'wrong_role'],
    [{ executor: 'cursor' }, 'misrouted_delivery'],
    [{ host: 'vscode' }, 'misrouted_delivery'],
    [{ status: 'prepared' }, 'unsupported_or_unverified_delivery'],
    [{ route: 'projection' }, 'unsupported_route'],
    [{ content: 'stale' }, 'stale_delivery'],
    [{ instruction_sha256: [] }, 'empty_coverage'],
    [
      { instruction_sha256: [sha256(content), sha256(content)] },
      'duplicate_coverage',
    ],
    [
      { instruction_sha256: [sha256(content), 'unknown'] },
      'unknown_or_stale_instruction',
    ],
  ]
  for (const [mutation, diagnostic] of cases)
    assert.equal(
      resolvePolicyCoverage(policy, { ...receipt, ...mutation }, expected)
        .diagnostic,
      diagnostic,
    )
  assert.equal(
    resolvePolicyCoverage(policy, undefined, expected).diagnostic,
    'missing_delivery_evidence',
  )
  const unavailable = resolvePromptContext(sharedFixture(), '{')
  assert.equal(unavailable.continue, true)
  assert.match(
    unavailable.additional_context ?? '',
    /reminder delivery unavailable/,
  )
  assert.match(
    unavailable.additional_context ?? '',
    /no recurring delivery is verified/,
  )
})

test('worker reminders and cards follow actual capabilities and are snapshotted in launch bytes', () => {
  const invocation = baseInvocation(sharedFixture(), 'delivery', 'implement')
  invocation.context_contract_version = 1
  invocation.capabilities = { shell: false, delegation: false }
  const policy = invocation.policies.find(
    (entry) => entry.id === 'DELEGATE-001',
  )!
  const readonly = filterPolicyInstructionsForCard(
    policy.instructions,
    'agent',
    invocation.capabilities,
  )
  assert.ok(
    readonly.every(
      (entry) =>
        entry.capabilities?.shell !== true &&
        entry.capabilities?.delegation !== true,
    ),
  )
  const { reminder } = initialPolicyReminder(invocation, 'initial.md')
  invocation.initial_policy_reminder = reminder
  assert.ok(
    withInitialPolicyReminder(invocation, 'contract').startsWith(
      reminder.content,
    ),
  )
  assert.ok(!reminder.content.includes('heartbeat.json'))
  invocation.capabilities.shell = true
  assert.ok(
    initialPolicyReminder(invocation, 'initial.md').reminder.content.includes(
      'heartbeat.json',
    ),
  )
  assert.ok(
    filterPolicyInstructionsForCard(policy.instructions, 'agent', {
      shell: true,
      delegation: true,
    }).some((entry) => entry.text.includes('mark-background')),
  )
  invocation.initial_policy_reminder.sha256 = 'stale'
  assert.throws(
    () => withInitialPolicyReminder(invocation, 'contract'),
    /digest/,
  )
})

test('bounded workers retain target instruction and guidance contracts without unconditional primer orientation', () => {
  for (const persona of ['coder', 'remediator', 'remediator-severe']) {
    const root = sharedFixture()
    const stage = persona === 'coder' ? 'implement' : 'remediate'
    const invocation = baseInvocation(root, 'delivery', stage)
    invocation.stage.persona = persona
    invocation.policies = resolvePolicies(root, {
      persona,
      workflow: 'delivery',
      stage,
    })
    invocation.context_contract_version = 1
    invocation.capabilities = { shell: true, delegation: false }
    const primer = invocation.policies.find(
      (entry) => entry.id === 'PRIMER-001',
    )!
    assert.ok(
      primer.instructions.some((entry) =>
        entry.text.includes('Before broad repository discovery'),
      ),
    )
    assert.ok(
      primer.instructions.some((entry) =>
        entry.text.includes('absent or unbuilt primer alone MUST NOT block'),
      ),
    )
    assert.ok(
      primer.instructions.some((entry) =>
        entry.text.includes('Target instruction discovery'),
      ),
    )
    const markdown = renderInvocationMarkdown(invocation)
    assert.equal(validateInvocationMarkdown(invocation, markdown).passed, true)
    const engineering = invocation.policies.find(
      (entry) => entry.id === 'ENG-001',
    )!
    assert.ok(
      markdown.includes(engineering.guidance![0]!.reference!.read_trigger),
    )
    assert.ok(
      !markdown.includes('worker MUST take its governance from a primer'),
    )
  }
})

test('compact harness prose retains the full manifest and actionable agent requirements', () => {
  const root = sharedFixture()
  const invocation = baseInvocation(root, 'delivery', 'implement')
  invocation.context_contract_version = 1
  invocation.requirements = resolveRequirements(root, {
    persona: 'coder',
    workflow: 'delivery',
    stage: 'implement',
  })
  const manifest = JSON.stringify(invocation.requirements)
  const requirements = [
    ...invocation.requirements.automation_requirements,
    ...invocation.requirements.validation_requirements,
  ]
  assert.ok(requirements.some((item) => item.executor === 'harness'))
  assert.ok(requirements.some((item) => item.executor !== 'harness'))
  const markdown = renderInvocationMarkdown(invocation)
  assert.match(
    markdown,
    /The harness runs and routes deterministic checks from the invocation manifest/,
  )
  assert.ok(!markdown.includes('harness-owned, no agent action'))
  for (const requirement of requirements.filter(
    (item) => item.executor !== 'harness',
  )) {
    assert.ok(markdown.includes(requirement.requirement_id))
    assert.ok(markdown.includes(requirement.success_condition))
    assert.ok(markdown.includes(requirement.failure_route))
  }
  assert.equal(JSON.stringify(invocation.requirements), manifest)
  assert.equal(validateInvocationMarkdown(invocation, markdown).passed, true)
})

test('evidence briefs keep caller coordination and procedural recovery separate from product verdicts', () => {
  const invocation = baseInvocation(sharedFixture(), 'delivery', 'verify')
  for (const role of ['review', 'qa']) {
    const brief = renderEvidenceWorkerBrief(invocation, {
      persona: role === 'qa' ? 'qa-tester' : 'reviewer',
      role,
      scope: 'Inspect current acceptance evidence.',
      agent: `pan-${role}`,
      model: 'fixture',
      brief_path: `${role}.brief.md`,
      evidence_path: `${role}.md`,
    })

    assert.match(brief, /MUST NOT launch subagents or alternate sessions/)
    assert.match(brief, /any shell command/)
    assert.match(
      brief,
      /imports these records independently of the report verdict/,
    )
    assert.match(
      brief,
      /preserve correctness, security, authorization, scope, target instructions/,
    )
    assert.ok(
      brief.indexOf('Procedural exceptions') < brief.indexOf('Write the line'),
    )
  }
})

test('supervisor cards retain delegated observation and exclude worker-only clauses', () => {
  const root = sharedFixture()
  const policies = resolvePolicies(root, {
    persona: 'orchestrator',
    workflow: 'delivery',
    stage: 'implement',
  })
  const markdown = renderGovernanceCardMarkdown({
    mode: STANDALONE_MODES.supervisor,
    policies,
    requirements: resolveRequirements(root, {
      persona: 'orchestrator',
      workflow: 'delivery',
      stage: 'implement',
      invocation_kind: 'supervisor',
    }),
    requestPath: null,
    harnessPrefixNote: null,
    worktree: null,
    baseConduct: null,
    proceduralExceptions: {
      command: 'pan exception list fixture --unresolved',
      unresolved: [
        {
          id: 'receipt',
          affected: 'fixture rule',
          follow_up: 'Repair the fixture.',
        },
      ],
    },
  })
  const delegate = policies.find((entry) => entry.id === 'DELEGATE-001')!
  assert.match(markdown, /receipt: fixture rule; Repair the fixture/)
  assert.match(markdown, /Recording grants no authorization/)
  for (const instruction of delegate.instructions.filter(
    (entry) => entry.capabilities?.delegation === true,
  )) {
    assert.ok(markdown.includes(instruction.text))
  }
  for (const instruction of delegate.instructions.filter(
    (entry) => entry.capabilities?.delegation === false,
  )) {
    assert.ok(!markdown.includes(instruction.text))
  }
})
