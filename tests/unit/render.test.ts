import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { sha256 } from '../../src/lib/io.js'
import {
  guidanceSelectedRange,
  renderGuidanceBlock,
  renderPolicyBlocks,
} from '../../src/lib/policy-guidance.js'
import {
  buildInvocationContractManifest,
  renderInvocationDeliveryPrompt,
  renderInvocationMarkdown,
  renderStatus,
  renderSupervisorProcedureMarkdown,
  splitInvocationContract,
} from '../../src/lib/render.js'
import { resolvePolicies } from '../../src/lib/policies.js'
import {
  buildValidationArtifact,
  invocationValidationPath,
  validateInvocationMarkdown,
} from '../../src/lib/validation.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createFixture } from '../helpers.js'
import type { Invocation } from '../../src/lib/types.js'

test('status summary includes the pause reason when present', () => {
  const status = renderStatus({
    schema_version: 1,
    run_id: 'run-1',
    workflow_slug: 'delivery',
    workflow_snapshot: { path: 'workflow.json', sha256: 'abc' },
    workspace_root: '.',
    title: 'Run',
    status: 'paused',
    current_stage: 'implement',
    pending_action: { type: 'operator_decision' },
    current_invocation: null,
    request: {
      source_path: 'request.md',
      stored_path: 'runtime/request.md',
      sha256: 'abc',
    },
    revision: 4,
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
    pause_reason: 'Maximum consecutive failures exceeded.',
  })

  assert.match(status, /Status: paused/)
  assert.match(status, /Pause reason: Maximum consecutive failures exceeded\./)
})

function baseInvocation(
  root: string,
  workflowSlug: string,
  stageSlug: string,
): Invocation {
  const workflow = loadWorkflow(root, workflowSlug)
  const stage = stageBySlug(workflow, stageSlug)
  const policies = resolvePolicies(root, {
    persona: stage.persona,
    workflow: workflow.slug,
    stage: stage.slug,
  })

  return {
    $operator: {
      headline: `${stage.title} is ready`,
      summary: 'Fixture summary',
      next_action: 'Invoke worker',
    },
    schema_version: 1,
    invocation_id: `${stageSlug}-1-fixture`,
    run_id: 'run-fixture',
    attempt: 1,
    created_at: '2026-06-24T00:00:00.000Z',
    workspace_root: '.',
    workflow: {
      slug: workflow.slug,
      snapshot_path: 'workflow.snapshot.json',
      snapshot_sha256: 'abc',
    },
    stage: {
      slug: stage.slug,
      title: stage.title,
      persona: stage.persona,
      model: 'fixture-model',
      model_config: 'default',
      workspace_policy: stage.workspace_policy,
      gate: stage.gate,
    },
    prompt: 'Fixture prompt',
    inputs: { references: [] },
    policies,
    rubric: stage.criteria,
    output: {
      path: `runtime/logs/workflows/run-fixture/outputs/${stageSlug}.json`,
      template: 'library/templates/stage-output.example.json',
      schema: 'library/schemas/stage-output.schema.json',
      required_data: stage.required_data ?? {},
      operator_brief: {
        source_path: `runtime/logs/workflows/run-fixture/artifacts/json/${stageSlug}.brief.json`,
        rendered_path: `runtime/logs/workflows/run-fixture/artifacts/html/${stageSlug}.html`,
        schema: 'library/schemas/operator-brief.schema.json',
        renderer: 'pan briefs render',
        profile:
          stageSlug === 'plan'
            ? 'plan'
            : stageSlug === 'ship'
              ? 'release'
              : 'implementation',
        required_headings: [],
      },
    },
    boundaries: ['Fixture boundary'],
    workspace_before: {
      kind: 'filesystem',
      fingerprint: 'fixture-fingerprint',
      entries: [],
    },
  }
}

function delegatedInvocation(root: string): Invocation {
  const invocation = baseInvocation(root, 'delivery', 'implement')
  const prefix = 'runtime/logs/workflows/run-fixture/invocations/implement-1'

  invocation.output.scaffold_command =
    `./bin/pan output scaffold run-fixture --invocation ${prefix}.json ` +
    `--output ${invocation.output.path}`
  invocation.delegation = {
    persona: invocation.stage.persona,
    cursor_agent_path: '.cursor/agents/pan-coder.md',
    canonical_markdown_path: `${prefix}.md`,
    invocation_validation_path: `${prefix}.invocation-validation.json`,
    delegation_artifact_path: `${prefix}.delegation.md`,
    supervisor_procedure_path: `${prefix}.supervisor.md`,
    submit_command: `./bin/pan submit run-fixture ${invocation.output.path}`,
    mode: 'referenced',
    delivery_prompt_path: `${prefix}.delivery.md`,
    policies: resolvePolicies(root, {
      persona: 'orchestrator',
      workflow: 'delivery',
      stage: 'implement',
    }).filter((policy) => policy.id === 'INVOCATION-001'),
  }

  return invocation
}

test('the worker card names the supervisor procedure and prints no lifecycle command', () => {
  const root = createFixture()
  const invocation = delegatedInvocation(root)
  const card = renderInvocationMarkdown(invocation)
  const procedure = renderSupervisorProcedureMarkdown(invocation)

  assert.ok(invocation.delegation)
  assert.ok(
    card.includes(invocation.delegation.supervisor_procedure_path ?? ''),
  )
  assert.ok(!card.includes(invocation.delegation.submit_command))
  assert.doesNotMatch(
    card,
    /pan\s+(submit|decide|set-stage|waive-gate|delegate|abort)\b/u,
  )
  // The exact scaffold command, and the artifact-type warning beside it.
  assert.ok(card.includes(invocation.output.scaffold_command ?? ''))
  assert.match(card, /fails by artifact type/u)
  // The procedure document owns the resolved lifecycle commands.
  assert.ok(procedure.includes(invocation.delegation.submit_command))
  assert.ok(
    procedure.includes(invocation.delegation.delivery_prompt_path ?? ''),
  )

  const result = validateInvocationMarkdown(invocation, card, procedure)

  assert.equal(
    result.passed,
    true,
    result.checks
      .filter((check) => !check.passed)
      .map((check) => check.message)
      .join('; '),
  )
})

test('validation rejects a worker card that prints a lifecycle command', () => {
  const root = createFixture()
  const invocation = delegatedInvocation(root)
  const procedure = renderSupervisorProcedureMarkdown(invocation)
  const card = renderInvocationMarkdown(invocation).replace(
    '## 🚧 Boundaries',
    'Run `./bin/pan submit run-fixture out.json` when done.\n\n## 🚧 Boundaries',
  )
  const result = validateInvocationMarkdown(invocation, card, procedure)

  assert.equal(result.passed, false)
  assert.ok(
    result.checks.some(
      (check) => check.id === 'delegation.worker_isolation' && !check.passed,
    ),
  )
})

test('validation rejects a split delegation without its procedure document', () => {
  const root = createFixture()
  const invocation = delegatedInvocation(root)
  const card = renderInvocationMarkdown(invocation)
  const result = validateInvocationMarkdown(invocation, card)

  assert.equal(result.passed, false)
  assert.ok(
    result.checks.some(
      (check) => check.id === 'delegation.procedure_document' && !check.passed,
    ),
  )
})

test('invocation cards inline policy text and reference guidance for every stage', () => {
  const root = createFixture()
  const stages = ['plan', 'implement', 'verify', 'remediate', 'ship']

  for (const stageSlug of stages) {
    const markdown = renderInvocationMarkdown(
      baseInvocation(root, 'delivery', stageSlug),
    )
    const policies = resolvePolicies(root, {
      persona: stageBySlug(loadWorkflow(root, 'delivery'), stageSlug).persona,
      workflow: 'delivery',
      stage: stageSlug,
    })

    assert.match(markdown, /## 📜 Policies in force/)

    for (const policy of policies) {
      assert.match(
        markdown,
        new RegExp(`\\*\\*${policy.id} · ${policy.title}\\*\\*`),
      )
      assert.match(
        markdown,
        new RegExp(policy.summary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      )

      for (const instruction of policy.instructions) {
        assert.match(
          markdown,
          new RegExp(instruction.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        )
      }

      for (const guidance of policy.guidance ?? []) {
        const { reference } = guidance

        assert.ok(reference, `${policy.id} guidance MUST resolve a reference`)
        assert.ok(
          markdown.includes(
            `### Guidance reference · \`${guidance.source_path}\``,
          ),
        )
        assert.ok(markdown.includes(`Read when: ${reference.read_trigger}`))
        assert.ok(markdown.includes(`sha256:${reference.content_sha256}`))
        assert.equal(reference.content_sha256, sha256(guidance.content))
        assert.ok(
          !markdown.includes(guidance.content),
          `${policy.id} MUST NOT inline the body of ${guidance.source_path}`,
        )
      }
    }
  }
})

test('model configurations receive the same normative invocation contract', () => {
  const root = createFixture()
  const configs = ['simple', 'default', 'complex', 'auto']
  const contracts = configs.map((modelConfig) => {
    const invocation = baseInvocation(root, 'delivery', 'implement')

    invocation.stage.model = `fixture-${modelConfig}`
    invocation.stage.model_config = modelConfig

    return renderInvocationMarkdown(invocation)
      .replaceAll(`fixture-${modelConfig}`, 'fixture-model')
      .replace(`"model_config": "${modelConfig}"`, '"model_config": "fixture"')
  })

  assert.ok(contracts.every((contract) => contract === contracts[0]))
})

test('Python invocation cards reference PY-001 guidance for embedded targets', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  config.installation_mode = 'embedded'
  config.workspace_root = 'target'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  mkdirSync(path.join(root, 'target'), { recursive: true })
  writeFileSync(path.join(root, 'target', 'pyproject.toml'), '[project]\n')

  const invocation = baseInvocation(root, 'delivery', 'implement')
  const markdown = renderInvocationMarkdown(invocation)
  const pythonPolicy = invocation.policies.find(
    (policy) => policy.id === 'PY-001',
  )

  assert.ok(pythonPolicy)

  const guidance = pythonPolicy.guidance?.[0]

  assert.ok(guidance)
  assert.ok(
    markdown.includes(
      '### Guidance reference · `governance/handbooks/python/style-guide.md`',
    ),
  )
  assert.ok(
    markdown.includes(
      `\`sha256:${sha256(guidance.content)}\`` +
        ` — ${guidance.content.split('\n').length} lines,` +
        ` ${Buffer.byteLength(guidance.content, 'utf8')} bytes.`,
    ),
  )
  // The selected range stops short of the formatter appendix, and the card
  // carries the pointer rather than either body.
  assert.match(guidance.content, /Mutable default arguments MUST NOT be used/u)
  assert.doesNotMatch(guidance.content, /Appendix A: Formatter-owned rules/u)
  assert.doesNotMatch(markdown, /Mutable default arguments MUST NOT be used/u)
})

test('planning cards exclude implementation language guidance', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  config.installation_mode = 'embedded'
  config.workspace_root = 'target'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  mkdirSync(path.join(root, 'target'), { recursive: true })
  writeFileSync(path.join(root, 'target', 'pyproject.toml'), '[project]\n')

  const invocation = baseInvocation(root, 'delivery', 'plan')
  const policyIds = new Set(invocation.policies.map((policy) => policy.id))
  const markdown = renderInvocationMarkdown(invocation)

  for (const policyId of ['CONTRACT-001', 'ENG-001', 'PLAN-002']) {
    assert.ok(policyIds.has(policyId), `plan card MUST include ${policyId}`)
  }
  for (const policyId of ['LANG-001', 'PY-001', 'TS-001']) {
    assert.equal(policyIds.has(policyId), false)
  }
  assert.doesNotMatch(markdown, /governance\/handbooks\/python/u)
  assert.doesNotMatch(markdown, /governance\/handbooks\/target\//u)
})

test('a guidance reference names the selected heading range', () => {
  const root = createFixture()
  const invocation = baseInvocation(root, 'delivery', 'implement')
  const markdown = renderInvocationMarkdown(invocation)
  const bounded = invocation.policies
    .flatMap((policy) => policy.guidance ?? [])
    .find((guidance) => guidance.reference?.start_heading)

  assert.ok(bounded?.reference?.start_heading)
  assert.ok(
    markdown.includes(
      `Selected range: from \`${bounded.reference.start_heading}\``,
    ),
  )
})

test('a guidance reference states its digest basis', () => {
  const root = createFixture()
  const invocation = baseInvocation(root, 'delivery', 'implement')
  const markdown = renderInvocationMarkdown(invocation)

  // An honest verifier who hashes the raw range gets a different digest, so
  // the reference itself must say what the digest covers.
  assert.ok(
    markdown.includes(
      '- Digest basis: SHA-256 of the selected text after leading and ' +
        'trailing whitespace is trimmed.',
    ),
  )
})

test('invocation validation accepts a card rendered before the digest-basis line', () => {
  const root = createFixture()
  const invocation = baseInvocation(root, 'delivery', 'implement')
  const legacyMarkdown = renderInvocationMarkdown(invocation).replaceAll(
    '\n- Digest basis: SHA-256 of the selected text after leading and ' +
      'trailing whitespace is trimmed.',
    '',
  )
  const result = validateInvocationMarkdown(invocation, legacyMarkdown)

  assert.equal(result.passed, true)
})

test('a guidance reference describes an end-only heading range', () => {
  const block = renderGuidanceBlock(3, {
    source_path: 'guide.md',
    content: 'Selected guidance',
    reference: {
      end_heading: '# Appendix',
      content_sha256: sha256('Selected guidance'),
      line_count: 1,
      byte_length: Buffer.byteLength('Selected guidance', 'utf8'),
      read_trigger: 'Read this guidance before the governed work.',
    },
  })

  assert.ok(
    block.includes(
      '- Selected range: from the start of the file to `# Appendix`.',
    ),
  )
})

test('shared policy blocks remove exact statement duplication', () => {
  const statement = 'Agents MUST preserve one authority.'
  const blocks = renderPolicyBlocks(
    [
      {
        id: 'FIXTURE-001',
        title: 'Fixture policy',
        severity: 'hard',
        summary: statement,
        instructions: [statement, statement],
      },
    ],
    3,
  )
  const rendered = blocks.join('\n')

  assert.equal(rendered.match(new RegExp(statement, 'gu'))?.length, 1)
  assert.match(rendered, /\*\*FIXTURE-001 · Fixture policy\*\*/u)
})

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
  const root = createFixture()
  const invocation = baseInvocation(root, 'delivery', 'implement')
  const markdown = renderInvocationMarkdown(invocation)
  const { guidance } = engineeringGuidance(invocation)
  const heading = `### Guidance reference · \`${guidance.source_path}\``

  assert.ok(
    failedCheckIds(invocation, markdown.replace(heading, '')).has(
      'policy.ENG-001.guidance.1.heading',
    ),
  )
})

test('invocation validation fails when a read trigger is omitted', () => {
  const root = createFixture()
  const invocation = baseInvocation(root, 'delivery', 'implement')
  const markdown = renderInvocationMarkdown(invocation)
  const { reference } = engineeringGuidance(invocation)

  assert.ok(
    failedCheckIds(
      invocation,
      markdown.replace(reference.read_trigger, 'whenever you feel like it'),
    ).has('policy.ENG-001.guidance.1.read_trigger'),
  )
})

test('invocation validation fails when a selected range is stale', () => {
  const root = createFixture()
  const invocation = baseInvocation(root, 'delivery', 'implement')
  const markdown = renderInvocationMarkdown(invocation)
  const { reference } = engineeringGuidance(invocation)
  const selectedRange = `Selected range: ${guidanceSelectedRange(reference)}.`
  const failed = failedCheckIds(
    invocation,
    markdown.replace(selectedRange, 'Selected range: the complete file.'),
  )

  assert.ok(failed.has('policy.ENG-001.guidance.1.selected_range'))
  assert.ok(failed.has('policy.ENG-001.guidance.1.reference_block'))
})

test('invocation validation fails when a rendered digest is stale', () => {
  const root = createFixture()
  const invocation = baseInvocation(root, 'delivery', 'implement')
  const markdown = renderInvocationMarkdown(invocation)
  const { reference } = engineeringGuidance(invocation)
  const failed = failedCheckIds(
    invocation,
    markdown.replace(reference.content_sha256, sha256('drifted content')),
  )

  assert.ok(failed.has('policy.ENG-001.guidance.1.digest'))
})

test('invocation validation fails when reference metadata contradicts the snapshot', () => {
  const root = createFixture()
  const invocation = baseInvocation(root, 'delivery', 'implement')
  const { guidance, reference } = engineeringGuidance(invocation)

  guidance.reference = { ...reference, content_sha256: sha256('stale body') }

  const markdown = renderInvocationMarkdown(invocation)
  const failed = failedCheckIds(invocation, markdown)

  assert.ok(failed.has('policy.ENG-001.guidance.1.digest_matches_snapshot'))
})

test('invocation validation fails when size metadata contradicts the snapshot', () => {
  const root = createFixture()
  const invocation = baseInvocation(root, 'delivery', 'implement')
  const { guidance, reference } = engineeringGuidance(invocation)

  guidance.reference = {
    ...reference,
    line_count: reference.line_count + 1,
    byte_length: reference.byte_length + 1,
  }

  const markdown = renderInvocationMarkdown(invocation)
  const failed = failedCheckIds(invocation, markdown)

  assert.ok(failed.has('policy.ENG-001.guidance.1.line_count_matches_snapshot'))
  assert.ok(
    failed.has('policy.ENG-001.guidance.1.byte_length_matches_snapshot'),
  )
})

test('invocation validation fails when a guidance body leaks into the card', () => {
  const root = createFixture()
  const invocation = baseInvocation(root, 'delivery', 'implement')
  const markdown = renderInvocationMarkdown(invocation)
  const { guidance } = engineeringGuidance(invocation)
  const failed = failedCheckIds(
    invocation,
    `${markdown}\n\n${guidance.content}\n`,
  )

  assert.ok(failed.has('policy.ENG-001.guidance.1.body_absent'))
})

test('invocation validation keeps the inline contract for legacy guidance', () => {
  const root = createFixture()
  const invocation = baseInvocation(root, 'delivery', 'implement')
  const { guidance } = engineeringGuidance(invocation)

  delete guidance.reference

  const markdown = renderInvocationMarkdown(invocation)

  assert.ok(
    markdown.includes(`### Unrolled guidance · \`${guidance.source_path}\``),
  )
  assert.ok(markdown.includes(guidance.content))
  assert.equal(validateInvocationMarkdown(invocation, markdown).passed, true)
  assert.ok(
    failedCheckIds(invocation, markdown.replace(guidance.content, '')).has(
      'policy.ENG-001.guidance.1.content',
    ),
  )
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
      pending_action: {
        type: 'invoke_agent',
        persona: 'coder',
        path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.md`,
      },
      current_invocation: {
        id: invocationId,
        json_path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.json`,
        markdown_path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.md`,
        output_path: `runtime/logs/workflows/${runId}/outputs/${invocationId}.json`,
      },
      request: {
        source_path: 'request.md',
        stored_path: 'runtime/request.md',
        sha256: 'abc',
      },
      revision: 1,
      transition_count: 1,
      consecutive_failures: 0,
      attempts: { implement: 1 },
      stage_history: [],
      created_at: '2026-06-22T00:00:00.000Z',
      updated_at: '2026-06-22T00:00:00.000Z',
      limits: {
        max_total_transitions: 18,
        max_stage_attempts: 3,
        max_consecutive_failures: 3,
      },
    },
    {
      invocation: invocationValidation,
      delegation: { state: 'missing' },
      invocation_validation_path: invocationValidationPath(runId, invocationId),
      delegation_validation_path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.delegation-validation.json`,
      delegation_path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.delegation.md`,
    },
  )

  assert.match(status, /## Validation/)
  assert.match(status, /Invocation validation: pass/)
  assert.match(status, /Delegation validation: missing/)
})

test('status summary surfaces validation failure reasons', () => {
  const invocationId = 'plan-1-abcd'
  const runId = 'run-1'
  const delegationValidation = buildValidationArtifact({
    run_id: runId,
    invocation_id: invocationId,
    kind: 'delegation',
    status: 'fail',
    checks: [
      {
        id: 'delegation.canonical_equality',
        passed: false,
        message: 'Delegation artifact MUST equal the canonical invocation card',
      },
    ],
    artifact_path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.delegation.md`,
  })

  const status = renderStatus(
    {
      schema_version: 1,
      run_id: runId,
      workflow_slug: 'delivery',
      workflow_snapshot: { path: 'workflow.json', sha256: 'abc' },
      workspace_root: '.',
      title: 'Run',
      status: 'running',
      current_stage: 'plan',
      pending_action: {
        type: 'invoke_agent',
        persona: 'planner',
        path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.md`,
      },
      current_invocation: {
        id: invocationId,
        json_path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.json`,
        markdown_path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.md`,
        output_path: `runtime/logs/workflows/${runId}/outputs/${invocationId}.json`,
      },
      request: {
        source_path: 'request.md',
        stored_path: 'runtime/request.md',
        sha256: 'abc',
      },
      revision: 1,
      transition_count: 1,
      consecutive_failures: 0,
      attempts: { plan: 1 },
      stage_history: [],
      created_at: '2026-06-22T00:00:00.000Z',
      updated_at: '2026-06-22T00:00:00.000Z',
      limits: {
        max_total_transitions: 18,
        max_stage_attempts: 3,
        max_consecutive_failures: 3,
      },
    },
    {
      invocation: { state: 'missing' },
      delegation: delegationValidation,
      invocation_validation_path: invocationValidationPath(runId, invocationId),
      delegation_validation_path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.delegation-validation.json`,
      delegation_path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.delegation.md`,
    },
  )

  assert.match(status, /Delegation validation: fail/)
  assert.match(status, /delegation\.canonical_equality/)
})

test('invocation cards distinguish required, conditional, and indexed context', () => {
  const root = createFixture()
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
  const root = createFixture()
  const invocation = referencedInvocation(root)
  const contract = renderInvocationMarkdown(invocation)
  const blocks = splitInvocationContract(contract)

  assert.equal(blocks.map((block) => block.markdown).join(''), contract)
  assert.equal(blocks[0]?.owner, 'worker')
  assert.equal(blocks[blocks.length - 1]?.owner, 'supervisor')

  for (const block of blocks) {
    assert.equal(sha256(block.markdown).length, 64)
  }
})

test('the contract manifest indexes every section once, in order', () => {
  const root = createFixture()
  const invocation = referencedInvocation(root)
  const manifest = invocation.contract_manifest

  assert.ok(manifest)

  const blocks = splitInvocationContract(renderInvocationMarkdown(invocation))

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
})

test('the contract manifest indexes every referenced guidance selection', () => {
  const root = createFixture()
  const invocation = referencedInvocation(root)
  const manifest = invocation.contract_manifest

  assert.ok(manifest)

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
})

test('the delivery prompt demands final-line read evidence per guidance entry', () => {
  const root = createFixture()
  const invocation = referencedInvocation(root)
  const manifest = invocation.contract_manifest

  assert.ok(manifest?.guidance?.length)

  const prompt = renderInvocationDeliveryPrompt(invocation, manifest)

  assert.match(prompt, /## Referenced guidance/u)
  // Read evidence is a quote the card does not carry — never a digest
  // transcription, which stays prefilled by the scaffold.
  assert.match(prompt, /set `final_line` to the/u)
  assert.match(prompt, /verbatim last content line/u)

  for (const entry of manifest.guidance) {
    assert.ok(prompt.includes(entry.source_path))
    assert.ok(prompt.includes(`sha256:${entry.content_sha256}`))
  }
})

test('the delivery prompt requires only the contract digest, not section echoes', () => {
  const root = createFixture()
  const invocation = referencedInvocation(root)
  const manifest = invocation.contract_manifest

  assert.ok(manifest)

  const prompt = renderInvocationDeliveryPrompt(invocation, manifest)

  assert.match(prompt, /Do not transcribe the per-section digest table/u)
  assert.doesNotMatch(prompt, /Set `sections` to every section id/u)
})

test('a manifest without policies carries no guidance index', () => {
  const root = createFixture()
  const invocation = referencedInvocation(root)
  const manifest = buildInvocationContractManifest(
    'runtime/logs/workflows/run-fixture/invocations/legacy.md',
    renderInvocationMarkdown(invocation),
  )

  assert.equal(manifest.guidance, undefined)

  const prompt = renderInvocationDeliveryPrompt(invocation, manifest)

  assert.doesNotMatch(prompt, /## Referenced guidance/u)
})

test('the delivery prompt references the contract without reproducing it', () => {
  const root = createFixture()
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
})

test('the invocation card names the delivery prompt for its supervisor', () => {
  const root = createFixture()
  const invocation = referencedInvocation(root)
  const markdown = renderInvocationMarkdown(invocation)

  assert.ok(invocation.delegation?.delivery_prompt_path)
  assert.ok(markdown.includes(invocation.delegation.delivery_prompt_path))
  assert.ok(markdown.includes(invocation.delegation.canonical_markdown_path))
  assert.match(markdown, /referenced delivery/u)
})
