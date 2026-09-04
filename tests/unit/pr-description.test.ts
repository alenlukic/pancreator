import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { resolvePrDescriptionContext } from '../../src/lib/pr-description.js'
import type { Policy, PrDescriptionContext } from '../../src/lib/types.js'
import { validatePrDescription } from '../../src/lib/validators/pr-description.js'
import { createTestTempDirectory } from '../temp.js'

function makeRoot(): string {
  return createTestTempDirectory('pancreator-pr-description-')
}

function write(root: string, relativePath: string, content: string): void {
  const absolute = path.join(root, relativePath)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
}

function targetPolicy(
  templatePath: string,
  instructionPaths: string[] = [],
): Policy {
  return {
    id: 'TARGET-001',
    title: 'Target policy',
    severity: 'hard',
    summary: 'Agents MUST obey target PR authority.',
    instructions: ['Agents MUST obey target PR authority.'],
    artifact_authority: {
      pr_description: {
        template_path: templatePath,
        instruction_paths: instructionPaths,
      },
    },
  }
}

function rowspaceTemplate(): string {
  return [
    '<!-- ## Hidden -->',
    '```markdown',
    '## Example',
    '```',
    '## Why',
    '<!-- Explain why. -->',
    '',
    '## Confidence & risk',
    '<!-- Explain confidence and risk. -->',
    '',
    '## What changed',
    '<!-- Optional: describe the implementation. -->',
    '',
  ].join('\n')
}

function validationInput(
  root: string,
  context: PrDescriptionContext,
): Parameters<typeof validatePrDescription>[0] {
  return {
    root,
    targetPath: 'pr.md',
    requirement: {
      policy_id: 'PR-001',
      requirement_id: 'pr-description-validate',
      registry_id: 'PR-DESCRIPTION-VALIDATE-001',
      arguments: {},
    },
    invocation: { inputs: { pr_description: context } },
  }
}

test('PR authority resolves fallback, one template, and target instructions', () => {
  const root = makeRoot()

  try {
    assert.equal(resolvePrDescriptionContext(root, []).mode, 'fallback')

    write(root, 'AGENTS.md', '# Root instructions\n')
    write(root, '.github/AGENTS.md', '# GitHub instructions\n')
    write(root, '.github/PULL_REQUEST_TEMPLATE.md', rowspaceTemplate())
    write(root, 'docs/pr-rules.md', '# PR rules\n')

    const context = resolvePrDescriptionContext(root, [
      targetPolicy('.github/PULL_REQUEST_TEMPLATE.md', ['docs/pr-rules.md']),
    ])

    assert.equal(context.mode, 'target')
    assert.equal(context.template_path, '.github/PULL_REQUEST_TEMPLATE.md')
    assert.deepEqual(context.instruction_paths, [
      '.github/AGENTS.md',
      'AGENTS.md',
      'docs/pr-rules.md',
    ])
    assert.deepEqual(context.heading_order, [
      'Why',
      'Confidence & risk',
      'What changed',
    ])
    assert.deepEqual(context.required_headings, ['Why', 'Confidence & risk'])
    assert.deepEqual(context.optional_headings, ['What changed'])
    assert.equal(context.allows_body_title, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('PR authority stops on ambiguous discovery unless metadata selects one', () => {
  const root = makeRoot()

  try {
    write(root, '.github/PULL_REQUEST_TEMPLATE.md', rowspaceTemplate())
    write(root, '.github/PULL_REQUEST_TEMPLATE/feature.md', '## Feature\n')

    assert.throws(
      () => resolvePrDescriptionContext(root, []),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'PR_TEMPLATE_AMBIGUOUS',
    )

    const context = resolvePrDescriptionContext(root, [
      targetPolicy('.github/PULL_REQUEST_TEMPLATE.md'),
    ])

    assert.equal(context.template_path, '.github/PULL_REQUEST_TEMPLATE.md')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('target PR validation rejects generic copy and accepts Rowspace copy', () => {
  const root = makeRoot()

  try {
    write(root, '.github/PULL_REQUEST_TEMPLATE.md', rowspaceTemplate())

    const context = resolvePrDescriptionContext(root, [
      targetPolicy('.github/PULL_REQUEST_TEMPLATE.md'),
    ])

    write(
      root,
      'pr.md',
      'fix: generic body\n\n## Summary\nGeneric summary.\n\n## Changelist\n- Generic item.\n',
    )

    const rejected = validatePrDescription(validationInput(root, context))

    assert.equal(rejected.status, 'failed')
    assert.ok(
      rejected.issues.some((item) => item.code === 'pr.title_forbidden'),
    )
    assert.ok(
      rejected.issues.some((item) => item.code === 'pr.heading_missing'),
    )

    write(
      root,
      'pr.md',
      '## Why\nTarget policy now controls the body.\n\n## Confidence & risk\nFocused validation covers the target contract.\n',
    )

    const accepted = validatePrDescription(validationInput(root, context))

    assert.equal(accepted.status, 'passed')
    assert.deepEqual(accepted.issues, [])

    write(
      root,
      'pr.md',
      '## Confidence & risk\nRisk text.\n\n## Why\n\n## What changed\nChange text.\n',
    )

    const misordered = validatePrDescription(validationInput(root, context))

    assert.equal(misordered.status, 'failed')
    assert.ok(
      misordered.issues.some((item) => item.code === 'pr.heading_order'),
    )
    assert.ok(
      misordered.issues.some((item) => item.code === 'pr.section_empty'),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('instruction-only target authority passes bodies without a template contract', () => {
  const root = makeRoot()

  try {
    write(root, 'docs/pr-rules.md', '# PR rules\n')

    const policy: Policy = {
      id: 'TARGET-001',
      title: 'Target policy',
      severity: 'hard',
      summary: 'Agents MUST obey target PR authority.',
      instructions: ['Agents MUST obey target PR authority.'],
      artifact_authority: {
        pr_description: { instruction_paths: ['docs/pr-rules.md'] },
      },
    }
    const context = resolvePrDescriptionContext(root, [policy])

    assert.equal(context.mode, 'target')
    assert.equal(context.template_path, null)
    assert.deepEqual(context.instruction_paths, ['docs/pr-rules.md'])

    write(root, 'pr.md', 'Prose summary.\n\n## Anything\nContent.\n')

    const result = validatePrDescription(validationInput(root, context))

    assert.equal(result.status, 'passed')
    assert.deepEqual(result.issues, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('fallback PR validation keeps the Pancreator title and core sections', () => {
  const root = makeRoot()

  try {
    const context = resolvePrDescriptionContext(root, [])

    const missing = validatePrDescription(validationInput(root, context))

    assert.equal(missing.status, 'failed')
    assert.deepEqual(
      missing.issues.map((item) => item.code),
      ['pr.file_missing'],
    )

    write(
      root,
      'pr.md',
      'fix: preserve fallback\n\n## Summary\nSummary text.\n\n## Changelist\n- One change.\n',
    )

    const result = validatePrDescription(validationInput(root, context))

    assert.equal(result.status, 'passed')
    assert.deepEqual(result.issues, [])

    write(
      root,
      'pr.md',
      'fix: preserve fallback\n\n## Summary\nSummary text.\n\n## Changelist\n- One change.\n\n## Testing\n- Extra section.\n',
    )

    const extraSection = validatePrDescription(validationInput(root, context))

    assert.equal(extraSection.status, 'failed')
    assert.ok(
      extraSection.issues.some((item) => item.code === 'pr.heading_unexpected'),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
