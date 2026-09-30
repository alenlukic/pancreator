import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { sha256 } from '../../src/lib/io.js'
import {
  renderGuidanceBlock,
  renderPolicyBlocks,
} from '../../src/lib/policy-guidance.js'
import {
  renderInvocationMarkdown,
  renderSupervisorProcedureMarkdown,
} from '../../src/lib/render.js'
import { loadPolicyCatalog, resolvePolicies } from '../../src/lib/policies.js'
import { validateInvocationMarkdown } from '../../src/lib/validation.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { sharedFixture } from '../fixture-template.js'
import { policyInstructionAppliesToCard } from '../../src/lib/policy-instructions.js'
import type { Invocation, Policy } from '../../src/lib/types.js'
import { baseInvocation, delegatedInvocation } from './render-helpers.js'

test('implementation cards render structured field contracts', () => {
  const root = sharedFixture()
  const invocation = baseInvocation(root, 'delivery', 'implement')

  invocation.output.field_contract = {
    validators: [
      {
        registry_id: 'IMPLEMENTATION-CLAIMS-VALIDATE-001',
        enforcement: 'blocks',
      },
    ],
    fields: [
      {
        path: 'data.acceptance_results[].evidence[]',
        type: 'string',
        format: 'path reference, prose observation, or pytest node id',
        accepted_shapes: [
          'path_reference',
          'prose_observation',
          'pytest_node_id',
        ],
      },
      {
        path: 'data.implementation.tests_added[]',
        type: 'object',
        required: ['path', 'contract'],
      },
      {
        path: 'data.implementation.remediation[]',
        type: 'object',
        required: ['cause', 'action', 'evidence'],
      },
    ],
  }

  const card = renderInvocationMarkdown(invocation)

  assert.match(card, /`IMPLEMENTATION-CLAIMS-VALIDATE-001` blocks the stage/u)
  assert.match(card, /path reference, prose observation, or pytest node id/u)
  assert.match(card, /required keys: path, contract/u)
  assert.match(card, /required keys: cause, action, evidence/u)
})

test('verify cards render finding id and evidence contracts', () => {
  const root = sharedFixture()
  const invocation = baseInvocation(root, 'delivery', 'verify')
  const shared = JSON.parse(
    readFileSync(
      path.join(root, 'library/schemas/stage-output-requirements.json'),
      'utf8',
    ),
  ) as {
    stages: Record<string, Invocation['output']['field_contract']>
  }

  invocation.output.field_contract = shared.stages.verify

  const card = renderInvocationMarkdown(invocation)

  assert.match(card, /data\.verify\.findings\[\]\.id/u)
  assert.match(card, /data\.verify\.findings\[\]\.evidence\[\]/u)
  assert.match(
    card,
    /non-empty string array of paths, commands, or observations/u,
  )
})

function mixedAudiencePolicy(): Policy {
  return {
    id: 'FIXTURE-001',
    title: 'Mixed audience fixture',
    severity: 'hard',
    summary: 'Agents MUST preserve audience boundaries.',
    instructions: [
      { text: 'Agents MUST see agent content.', audience: ['agent'] },
      {
        text: 'Supervisors MUST see supervisor content.',
        audience: ['supervisor'],
      },
      {
        text: 'The harness MUST retain harness content.',
        audience: ['harness'],
      },
      {
        text: 'Operators MUST see operator content.',
        audience: ['operator'],
      },
    ],
  }
}

test('worker and supervisor cards filter mixed audiences while snapshots retain all', () => {
  const root = sharedFixture()
  const invocation = delegatedInvocation(root)
  const policy = mixedAudiencePolicy()

  invocation.policies = [policy]
  assert.ok(invocation.delegation)
  invocation.delegation.policies = [policy]

  const card = renderInvocationMarkdown(invocation)
  const procedure = renderSupervisorProcedureMarkdown(invocation)

  assert.match(card, /- Agents MUST see agent content\./u)
  assert.doesNotMatch(card, /Supervisors MUST see supervisor content\./u)
  assert.doesNotMatch(card, /The harness MUST retain harness content\./u)
  assert.doesNotMatch(card, /Operators MUST see operator content\./u)

  assert.match(procedure, /- Agents MUST see agent content\./u)
  assert.match(procedure, /- Supervisors MUST see supervisor content\./u)
  assert.doesNotMatch(procedure, /The harness MUST retain harness content\./u)
  assert.doesNotMatch(procedure, /Operators MUST see operator content\./u)

  const result = validateInvocationMarkdown(invocation, card, procedure)

  assert.equal(result.passed, true)

  const snapshot = JSON.parse(JSON.stringify(invocation)) as Invocation

  assert.deepEqual(
    snapshot.policies[0]?.instructions.map((instruction) => instruction.text),
    policy.instructions.map((instruction) => instruction.text),
  )
  assert.ok(
    snapshot.policies[0]?.instructions.some((instruction) =>
      instruction.audience.includes('harness'),
    ),
  )
})

test('the worker card names the supervisor procedure and prints no lifecycle command', () => {
  const root = sharedFixture()
  const invocation = delegatedInvocation(root)
  const card = renderInvocationMarkdown(invocation)
  const procedure = renderSupervisorProcedureMarkdown(invocation)

  // The procedure delivers the supervisor's complete governance pointer, not
  // only the delivery policy, and the worker card never carries it.
  assert.ok(
    procedure.includes(invocation.delegation?.supervisor_card?.path ?? '!'),
  )
  assert.ok(procedure.includes(`sha256:${'a'.repeat(64)}`))
  assert.ok(procedure.includes('governance attest-supervisor run-fixture'))
  assert.ok(procedure.includes('SUPERVISOR_CARD_UNATTESTED'))
  assert.ok(!card.includes('attest-supervisor'))

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

  const leaking = validateInvocationMarkdown(
    invocation,
    card.replace(
      '## 🚧 Boundaries',
      'Run `./bin/pan submit run-fixture out.json` when done.\n\n## 🚧 Boundaries',
    ),
    procedure,
  )

  assert.equal(leaking.passed, false)
  assert.ok(
    leaking.checks.some(
      (check) => check.id === 'delegation.worker_isolation' && !check.passed,
    ),
  )

  const undocumented = validateInvocationMarkdown(invocation, card)

  assert.equal(undocumented.passed, false)
  assert.ok(
    undocumented.checks.some(
      (check) => check.id === 'delegation.procedure_document' && !check.passed,
    ),
  )
})

// The renderer branch does not vary by stage, so one stage that carries a
// bounded guidance reference proves it. Render and validate agreement is
// proven by validation-invocation.test.ts.
test('an invocation card inlines policy text and references guidance', () => {
  const root = sharedFixture()
  const stageSlug = 'implement'

  let boundedReferences = 0

  {
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

      const cardAudience = 'agent'
      const renderedInstructions = policy.instructions
        .filter((instruction) =>
          policyInstructionAppliesToCard(instruction, cardAudience),
        )
        .map((instruction) => instruction.text)
      const hiddenInstructions = policy.instructions
        .filter(
          (instruction) =>
            !policyInstructionAppliesToCard(instruction, cardAudience),
        )
        .map((instruction) => instruction.text)

      for (const instruction of renderedInstructions) {
        assert.match(
          markdown,
          new RegExp(`- ${instruction.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
        )
      }

      for (const instruction of hiddenInstructions) {
        assert.doesNotMatch(
          markdown,
          new RegExp(`- ${instruction.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
          `${policy.id} MUST NOT render hidden instruction for ${cardAudience}`,
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

        if (reference.start_heading) {
          boundedReferences += 1
          assert.ok(
            markdown.includes(
              `Selected range: from \`${reference.start_heading}\``,
            ),
            `${policy.id} MUST name the selected range of ${guidance.source_path}`,
          )
        }
      }
    }
  }

  assert.ok(boundedReferences > 0, 'the fixture MUST carry a bounded reference')
})

test('model configurations receive the same normative invocation contract', () => {
  const root = sharedFixture()
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

test('Python guidance selection stops short of the formatter appendix', () => {
  const catalog = loadPolicyCatalog(process.cwd())
  const guidance = catalog.get('PYSTYLE-001')?.guidance?.[0]

  // The style handbook moved to the batch-pass policy, so the toolchain policy
  // no longer carries a guidance reference at all.
  assert.deepEqual(catalog.get('PY-001')?.guidance ?? [], [])
  assert.ok(guidance)
  assert.equal(
    guidance.source_path,
    'governance/handbooks/python/style-guide.md',
  )
  assert.ok(guidance.reference?.end_heading)
  assert.match(guidance.content, /Mutable default arguments MUST NOT be used/u)
  assert.doesNotMatch(guidance.content, /Appendix A: Formatter-owned rules/u)
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
        instructions: [
          { text: statement, audience: ['agent'] },
          { text: statement, audience: ['agent'] },
        ],
      },
    ],
    3,
  )
  const rendered = blocks.join('\n')

  assert.equal(rendered.match(new RegExp(statement, 'gu'))?.length, 1)
  assert.match(rendered, /\*\*FIXTURE-001 · Fixture policy\*\*/u)
})

test('policy blocks render PRINCIPLES-001 first and keep the rest in order', () => {
  const policy = (id: string): Policy => ({
    id,
    title: `${id} title`,
    severity: 'hard',
    summary: `${id} summary.`,
    instructions: [{ text: `${id} instruction.`, audience: ['agent'] }],
  })
  const rendered = renderPolicyBlocks(
    ['GLOBAL-001', 'ORCH-001', 'PRINCIPLES-001', 'VERIFY-001'].map(policy),
    3,
  ).join('\n')
  const positions = [
    'PRINCIPLES-001',
    'GLOBAL-001',
    'ORCH-001',
    'VERIFY-001',
  ].map((id) => rendered.indexOf(`**${id} · ${id} title**`))

  assert.ok(positions.every((position) => position >= 0))
  assert.deepEqual(
    positions,
    [...positions].sort((left, right) => left - right),
  )
})
