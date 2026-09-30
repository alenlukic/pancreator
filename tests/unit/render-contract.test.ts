import assert from 'node:assert/strict'
import test from 'node:test'

import { sha256 } from '../../src/lib/io.js'
import {
  GUIDANCE_DIGEST_OWNERSHIP,
  guidanceSelectedRange,
} from '../../src/lib/policy-guidance.js'
import {
  buildInvocationContractManifest,
  renderInvocationDeliveryPrompt,
  renderInvocationMarkdown,
  renderStatus,
  splitInvocationContract,
} from '../../src/lib/render.js'
import {
  buildValidationArtifact,
  invocationValidationPath,
  validateInvocationMarkdown,
} from '../../src/lib/validation.js'
import { sharedFixture } from '../fixture-template.js'
import type { Invocation } from '../../src/lib/types.js'
import { baseInvocation } from './render-helpers.js'

const RUN_LIMITS = {
  max_total_transitions: 18,
  max_stage_attempts: 3,
  max_consecutive_failures: 3,
}

function engineeringGuidance(invocation: Invocation) {
  const policy = invocation.policies.find((entry) => entry.id === 'ENG-001')
  const guidance = policy?.guidance?.[0]

  assert.ok(guidance, 'ENG-001 MUST resolve engineering guidance')

  const { reference } = guidance

  assert.ok(reference, 'ENG-001 guidance MUST resolve a reference')

  return { guidance, reference }
}

function failedCheckIds(invocation: Invocation, markdown: string): Set<string> {
  const result = validateInvocationMarkdown(invocation, markdown)

  assert.equal(result.passed, false)

  return new Set(
    result.checks.filter((check) => !check.passed).map((check) => check.id),
  )
}

test('invocation validation fails when a guidance reference is omitted', () => {
  const root = sharedFixture()
  const invocation = baseInvocation(root, 'delivery', 'implement')
  const markdown = renderInvocationMarkdown(invocation)

  const { guidance, reference } = engineeringGuidance(invocation)
  const prefix = 'policy.ENG-001.guidance.1'

  const cardMutations: Array<[string, string, string[]]> = [
    [
      'guidance reference omitted',
      markdown.replace(
        `### Guidance reference · \`${guidance.source_path}\``,
        '',
      ),
      ['heading'],
    ],
    [
      'read trigger omitted',
      markdown.replace(reference.read_trigger, 'whenever you feel like it'),
      ['read_trigger'],
    ],
    [
      'selected range stale',
      markdown.replace(
        `Selected range: ${guidanceSelectedRange(reference)}.`,
        'Selected range: the complete file.',
      ),
      ['selected_range', 'reference_block'],
    ],
    [
      'rendered digest stale',
      markdown.replace(reference.content_sha256, sha256('drifted content')),
      ['digest'],
    ],
    [
      'guidance body leaks into the card',
      `${markdown}\n\n${guidance.content}\n`,
      ['body_absent'],
    ],
  ]

  for (const [label, mutated, checkIds] of cardMutations) {
    assert.notEqual(mutated, markdown, `${label}: mutation MUST apply`)

    const failed = failedCheckIds(invocation, mutated)

    for (const checkId of checkIds) {
      assert.ok(failed.has(`${prefix}.${checkId}`), `${label}: ${checkId}`)
    }
  }

  // The card tells the worker the harness owns the digest, and a card
  // rendered before that line existed (with no line, or with the older
  // digest-basis line) is still accepted.
  const ownershipLine = `\n- Digest check: ${GUIDANCE_DIGEST_OWNERSHIP}`

  assert.ok(markdown.includes(ownershipLine))
  assert.ok(!markdown.includes('Digest basis'))

  for (const legacyLine of [
    '',
    '\n- Digest basis: SHA-256 of the selected text after leading and ' +
      'trailing whitespace is trimmed.',
  ]) {
    const legacyMarkdown = markdown.replaceAll(ownershipLine, legacyLine)

    assert.notEqual(legacyMarkdown, markdown)
    assert.equal(
      validateInvocationMarkdown(invocation, legacyMarkdown).passed,
      true,
    )
  }

  const staleDigest = structuredClone(invocation)
  const staleDigestGuidance = engineeringGuidance(staleDigest)

  staleDigestGuidance.guidance.reference = {
    ...staleDigestGuidance.reference,
    content_sha256: sha256('stale body'),
  }
  assert.ok(
    failedCheckIds(staleDigest, renderInvocationMarkdown(staleDigest)).has(
      `${prefix}.digest_matches_snapshot`,
    ),
  )

  const staleSize = structuredClone(invocation)
  const staleSizeGuidance = engineeringGuidance(staleSize)

  staleSizeGuidance.guidance.reference = {
    ...staleSizeGuidance.reference,
    line_count: staleSizeGuidance.reference.line_count + 1,
    byte_length: staleSizeGuidance.reference.byte_length + 1,
  }

  const sizeFailed = failedCheckIds(
    staleSize,
    renderInvocationMarkdown(staleSize),
  )

  assert.ok(sizeFailed.has(`${prefix}.line_count_matches_snapshot`))
  assert.ok(sizeFailed.has(`${prefix}.byte_length_matches_snapshot`))

  // Legacy guidance without a reference keeps the inline contract.
  const legacy = structuredClone(invocation)
  const legacyGuidance = engineeringGuidance(legacy).guidance

  delete legacyGuidance.reference

  const legacyCard = renderInvocationMarkdown(legacy)

  assert.ok(
    legacyCard.includes(
      `### Unrolled guidance · \`${legacyGuidance.source_path}\``,
    ),
  )
  assert.ok(legacyCard.includes(legacyGuidance.content))
  assert.equal(validateInvocationMarkdown(legacy, legacyCard).passed, true)
  assert.ok(
    failedCheckIds(legacy, legacyCard.replace(legacyGuidance.content, '')).has(
      `${prefix}.content`,
    ),
  )
})

test('status summary renders a dedicated validation section for pass state', () => {
  const invocationId = 'implement-1-abcd'
  const runId = 'run-1'

  const invocationValidation = buildValidationArtifact({
    run_id: runId,
    invocation_id: invocationId,
    kind: 'invocation',
    status: 'pass',
    checks: [{ id: 'policies.heading', passed: true, message: 'ok' }],
    artifact_path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.md`,
  })
  const request = {
    source_path: 'request.md',
    stored_path: 'runtime/request.md',
    sha256: 'abc',
  }
  const invocationPaths = (id: string, persona: string) => ({
    pending_action: {
      type: 'invoke_agent' as const,
      persona,
      path: `runtime/logs/workflows/${runId}/invocations/${id}.md`,
    },
    current_invocation: {
      id,
      json_path: `runtime/logs/workflows/${runId}/invocations/${id}.json`,
      markdown_path: `runtime/logs/workflows/${runId}/invocations/${id}.md`,
      output_path: `runtime/logs/workflows/${runId}/outputs/${id}.json`,
    },
    invocation_validation_path: invocationValidationPath(runId, id),
    delegation_validation_path: `runtime/logs/workflows/${runId}/invocations/${id}.delegation-validation.json`,
    delegation_path: `runtime/logs/workflows/${runId}/invocations/${id}.delegation.md`,
  })
  const implementPaths = invocationPaths(invocationId, 'coder')

  const status = renderStatus(
    {
      schema_version: 1,
      run_id: runId,
      workflow_slug: 'delivery',
      workflow_snapshot: { path: 'workflow.json', sha256: 'abc' },
      workspace_root: '.',
      title: 'Run',
      status: 'running',
      current_stage: 'implement',
      pending_action: implementPaths.pending_action,
      current_invocation: implementPaths.current_invocation,
      request,
      revision: 1,
      transition_count: 1,
      consecutive_failures: 0,
      attempts: { implement: 1 },
      stage_history: [],
      created_at: '2026-06-22T00:00:00.000Z',
      updated_at: '2026-06-22T00:00:00.000Z',
      limits: RUN_LIMITS,
    },
    {
      invocation: invocationValidation,
      delegation: { state: 'missing' },
      invocation_validation_path: implementPaths.invocation_validation_path,
      delegation_validation_path: implementPaths.delegation_validation_path,
      delegation_path: implementPaths.delegation_path,
    },
  )

  assert.match(status, /## Validation/)
  assert.match(status, /Invocation validation: pass/)
  assert.match(status, /Delegation validation: missing/)

  const planId = 'plan-1-abcd'
  const planPaths = invocationPaths(planId, 'planner')
  const delegationValidation = buildValidationArtifact({
    run_id: runId,
    invocation_id: planId,
    kind: 'delegation',
    status: 'fail',
    checks: [
      {
        id: 'delegation.canonical_equality',
        passed: false,
        message: 'Delegation artifact MUST equal the canonical invocation card',
      },
    ],
    artifact_path: `runtime/logs/workflows/${runId}/invocations/${planId}.delegation.md`,
  })
  const failing = renderStatus(
    {
      schema_version: 1,
      run_id: runId,
      workflow_slug: 'delivery',
      workflow_snapshot: { path: 'workflow.json', sha256: 'abc' },
      workspace_root: '.',
      title: 'Run',
      status: 'running',
      current_stage: 'plan',
      pending_action: planPaths.pending_action,
      current_invocation: planPaths.current_invocation,
      request,
      revision: 1,
      transition_count: 1,
      consecutive_failures: 0,
      attempts: { plan: 1 },
      stage_history: [],
      created_at: '2026-06-22T00:00:00.000Z',
      updated_at: '2026-06-22T00:00:00.000Z',
      limits: RUN_LIMITS,
    },
    {
      invocation: { state: 'missing' },
      delegation: delegationValidation,
      invocation_validation_path: planPaths.invocation_validation_path,
      delegation_validation_path: planPaths.delegation_validation_path,
      delegation_path: planPaths.delegation_path,
    },
  )

  assert.match(failing, /Delegation validation: fail/)
  assert.match(failing, /delegation\.canonical_equality/)

  const paused = renderStatus({
    schema_version: 1,
    run_id: runId,
    workflow_slug: 'delivery',
    workflow_snapshot: { path: 'workflow.json', sha256: 'abc' },
    workspace_root: '.',
    title: 'Run',
    status: 'paused',
    current_stage: 'implement',
    pending_action: { type: 'operator_decision' },
    current_invocation: null,
    request,
    revision: 4,
    transition_count: 2,
    consecutive_failures: 0,
    attempts: {},
    stage_history: [],
    created_at: '2026-06-22T00:00:00.000Z',
    updated_at: '2026-06-22T00:00:00.000Z',
    limits: RUN_LIMITS,
    pause_reason: 'Maximum consecutive failures exceeded.',
  })

  assert.match(paused, /Status: paused/)
  assert.match(paused, /Pause reason: Maximum consecutive failures exceeded\./)
})

test('invocation cards distinguish required, conditional, and indexed context', () => {
  const root = sharedFixture()
  const invocation = baseInvocation(root, 'delivery', 'verify')
  invocation.inputs = {
    references: [
      {
        path: 'required.json',
        description: 'Effective implementation output',
        retrieval: 'required',
      },
      {
        path: 'conditional.json',
        description: 'Execution provenance',
        retrieval: 'conditional',
        condition: 'Read only to verify provenance.',
      },
      {
        path: 'manifest.json',
        description: 'Complete workflow context index',
        retrieval: 'index_only',
        condition: 'Read only to resolve a named inconsistency.',
      },
    ],
    missing_required: ["latest success output for stage 'plan'"],
  }

  const markdown = renderInvocationMarkdown(invocation)

  assert.match(markdown, /### Required inputs/u)
  assert.match(markdown, /`required\.json` — Effective implementation output/u)
  assert.match(markdown, /### Conditional references/u)
  assert.match(markdown, /Read when: Read only to verify provenance\./u)
  assert.match(markdown, /### Context index/u)
  assert.match(markdown, /### Missing required context/u)
  assert.match(markdown, /latest success output for stage 'plan'/u)
})

function referencedInvocation(root: string): Invocation {
  const invocation = baseInvocation(root, 'delivery', 'implement')
  const contractPath = `runtime/logs/workflows/run-fixture/invocations/${invocation.invocation_id}.md`

  invocation.delegation = {
    persona: 'coder',
    cursor_agent_path: '.cursor/agents/pan-coder.md',
    canonical_markdown_path: contractPath,
    invocation_validation_path: `${contractPath}.invocation-validation.json`,
    delegation_artifact_path: contractPath.replace('.md', '.delegation.md'),
    submit_command: './bin/pan submit run-fixture output.json',
    mode: 'referenced',
    delivery_prompt_path: contractPath.replace('.md', '.delivery.md'),
    policies: [],
  }
  invocation.contract_manifest = buildInvocationContractManifest(
    contractPath,
    renderInvocationMarkdown(invocation),
    invocation.policies,
  )

  return invocation
}

test('contract sections concatenate back to the exact contract', () => {
  const root = sharedFixture()
  const invocation = referencedInvocation(root)
  const contract = renderInvocationMarkdown(invocation)
  const blocks = splitInvocationContract(contract)

  assert.equal(blocks.map((block) => block.markdown).join(''), contract)
  assert.equal(blocks[0]?.owner, 'worker')
  assert.equal(blocks[blocks.length - 1]?.owner, 'supervisor')

  for (const block of blocks) {
    assert.equal(sha256(block.markdown).length, 64)
  }

  const manifest = invocation.contract_manifest

  assert.ok(manifest)
  assert.deepEqual(
    manifest.sections.map((section) => section.id),
    blocks.map((block) => block.id),
  )
  assert.deepEqual(
    manifest.sections.map((section) => section.sha256),
    blocks.map((block) => sha256(block.markdown)),
  )
  assert.equal(
    new Set(manifest.sections.map((section) => section.id)).size,
    manifest.sections.length,
  )

  const expected = invocation.policies.flatMap((policy) =>
    (policy.guidance ?? []).flatMap((guidance) =>
      guidance.reference
        ? [
            {
              policy_id: policy.id,
              source_path: guidance.source_path,
              content_sha256: guidance.reference.content_sha256,
              read_trigger: guidance.reference.read_trigger,
            },
          ]
        : [],
    ),
  )

  assert.ok(expected.length > 0, 'the fixture card references guidance')
  assert.deepEqual(manifest.guidance, expected)

  const legacyManifest = buildInvocationContractManifest(
    'runtime/logs/workflows/run-fixture/invocations/legacy.md',
    contract,
  )

  assert.equal(legacyManifest.guidance, undefined)
  assert.doesNotMatch(
    renderInvocationDeliveryPrompt(invocation, legacyManifest),
    /## Referenced guidance/u,
  )
})

test('the delivery prompt references the contract without reproducing it', () => {
  const root = sharedFixture()
  const invocation = referencedInvocation(root)
  const manifest = invocation.contract_manifest

  assert.ok(manifest)

  const prompt = renderInvocationDeliveryPrompt(invocation, manifest)

  assert.match(prompt, /Persona: `coder`/u)
  assert.ok(prompt.includes(manifest.contract_path))
  assert.ok(prompt.includes(manifest.contract_sha256))
  assert.match(prompt, /## Contract sections/u)
  assert.match(prompt, /## Read attestation/u)
  assert.ok(prompt.includes(invocation.output.path))
  // The prompt tells the worker what to read; it does not restate the contract.
  assert.ok(!prompt.includes(invocation.prompt))
  assert.ok(prompt.length < manifest.byte_length)

  // The harness owns the digest check: the prompt says so and never asks the
  // worker to compare or recompute a digest itself.
  assert.match(prompt, /re-hashes the contract file when you submit/u)
  assert.match(prompt, /Do not recompute the\s+digest/u)
  assert.doesNotMatch(prompt, /Compare the digest/u)
  assert.doesNotMatch(prompt, /digest differs/u)
  assert.doesNotMatch(prompt, /no\s+longer matches its digest/u)
  assert.match(prompt, /When the file is unreadable, stop and report/u)

  assert.ok(manifest.guidance?.length)
  assert.match(prompt, /## Referenced guidance/u)
  assert.match(prompt, /only when the source file is missing\s+or unreadable/u)

  for (const entry of manifest.guidance) {
    assert.ok(prompt.includes(entry.source_path))
    assert.ok(prompt.includes(`sha256:${entry.content_sha256}`))
  }

  // AC-001, second half. The two attestation prose fields are split because
  // the shapes are different, and a worker that wrote its skip reason into
  // `final_line` fails validation. The block names each field in the shape
  // that owns it, so a merged or swapped instruction is caught here.
  const completed = prompt.slice(
    prompt.indexOf('- A completed read:'),
    prompt.indexOf('- A skipped read:'),
  )
  const skipped = prompt.slice(prompt.indexOf('- A skipped read:'))

  assert.ok(completed.length > 0 && skipped.length > 0, prompt)
  assert.match(completed, /in `final_line`/u)
  assert.match(completed, /Leave\s+`reason` empty/u)
  assert.match(skipped, /in `reason`/u)
  assert.match(skipped, /Leave\s+`final_line` empty/u)

  const markdown = renderInvocationMarkdown(invocation)

  assert.ok(invocation.delegation?.delivery_prompt_path)
  assert.ok(markdown.includes(invocation.delegation.delivery_prompt_path))
  assert.ok(markdown.includes(invocation.delegation.canonical_markdown_path))
  assert.match(markdown, /referenced delivery/u)
})

test('status summary lists recorded advisories with their stage context', () => {
  const status = renderStatus({
    schema_version: 1,
    run_id: 'run-1',
    workflow_slug: 'delivery',
    workflow_snapshot: { path: 'workflow.json', sha256: 'abc' },
    workspace_root: '.',
    title: 'Run',
    status: 'running',
    current_stage: 'implement',
    pending_action: { type: 'none' },
    current_invocation: null,
    request: {
      source_path: 'request.md',
      stored_path: 'runtime/request.md',
      sha256: 'abc',
    },
    revision: 3,
    transition_count: 2,
    consecutive_failures: 0,
    attempts: {},
    stage_history: [],
    created_at: '2026-06-22T00:00:00.000Z',
    updated_at: '2026-06-22T00:00:00.000Z',
    limits: {
      max_total_transitions: 18,
      max_stage_attempts: 3,
      max_consecutive_failures: 3,
    },
    advisories: [
      {
        kind: 'model_evidence',
        source: 'supervisor_evidence',
        message: 'The supervisor model changed during this run.',
        recorded_at: '2026-06-22T00:00:00.000Z',
      },
      {
        kind: 'model_evidence',
        source: 'submit',
        stage: 'plan',
        invocation_id: 'plan-1-abcd',
        message: 'Worker model evidence is unverified.',
        recorded_at: '2026-06-22T00:00:01.000Z',
      },
    ],
  })

  assert.match(status, /## Advisories/)
  assert.match(
    status,
    /- supervisor_evidence: The supervisor model changed during this run\./,
  )
  assert.match(
    status,
    /- plan \(submit\): Worker model evidence is unverified\./,
  )
})
