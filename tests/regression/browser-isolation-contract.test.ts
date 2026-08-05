import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { loadPolicyCatalog, resolvePolicies } from '../../src/lib/policies.js'
import { syncCursorProjection } from '../../src/lib/projection.js'
import { createFixture } from '../helpers.js'

const REPO_ROOT = process.cwd()

/**
 * The previous version of this file required all twelve isolation tokens to be
 * restated in six separate surfaces, which is exactly why those surfaces drifted
 * apart. It now asserts the opposite: `BROWSER-001` holds the contract, and every
 * surface that needs it receives it by policy delivery or generation, never by
 * restatement.
 */
const ISOLATION_TOKENS = [
  'chrome-devtools',
  'new_page',
  'unique isolated context',
  'close_page',
  'including on failure',
  'personal browser',
  'Launch Services',
  'default browser',
  'Chrome preferences',
  'MCP Chrome',
  'com.google.Chrome',
  '--executablePath',
  'Chrome for Testing',
  'isolatedContext',
] as const

/** Surfaces that used to restate the contract and must no longer do so. */
const NON_RESTATING_SURFACES = [
  'library/personas/qa-tester.md',
  'library/personas/design-qa.md',
  'library/personas/designer.md',
  'library/cursor/agents/qa-tester.md',
  'library/cursor/agents/design-qa.md',
  'library/cursor/agents/designer.md',
  'library/workflows/dev/prompts/test.md',
  'library/workflows/design/prompts/test.md',
  'library/workflows/design/prompts/design.md',
  'docs/target-repo-primer.md',
] as const

/** Procedural detail that belongs only to the policy and its referenced skill. */
const PROCEDURE_TOKENS = [
  'new_page',
  'close_page',
  'isolatedContext',
  'Launch Services',
  'take_snapshot',
] as const

const PERSONAS_REQUIRING_BROWSER_POLICY = [
  'qa-tester',
  'design-qa',
  'designer',
  'design-reviewer',
  'spotfixer',
] as const

function readSurface(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
}

test('BROWSER-001 carries the complete browser isolation contract', () => {
  const policy = loadPolicyCatalog(REPO_ROOT).get('BROWSER-001')

  assert.ok(policy)
  assert.equal(policy.severity, 'hard')

  const text = [
    policy.summary,
    ...policy.instructions,
    ...(policy.guidance ?? []).map((guidance) => guidance.content),
  ].join('\n')

  for (const token of ISOLATION_TOKENS) {
    assert.ok(text.includes(token), `BROWSER-001 MUST own the '${token}' rule`)
  }

  assert.ok(
    (policy.guidance ?? []).some(
      (guidance) =>
        guidance.source_path === 'library/skills/browser-inspection.md',
    ),
    'BROWSER-001 MUST deliver the browser-inspection procedure',
  )
})

for (const surface of NON_RESTATING_SURFACES) {
  test(`${surface} defers to BROWSER-001 instead of restating it`, () => {
    const content = readSurface(surface)

    assert.ok(
      content.includes('BROWSER-001'),
      `${surface} MUST name BROWSER-001 as the governing contract`,
    )

    for (const token of PROCEDURE_TOKENS) {
      assert.ok(
        !content.includes(token),
        `${surface} MUST NOT restate '${token}'; the policy travels on the card`,
      )
    }
  })
}

test('browser-touching personas resolve BROWSER-001', () => {
  for (const persona of PERSONAS_REQUIRING_BROWSER_POLICY) {
    const policies = resolvePolicies(REPO_ROOT, {
      persona,
      workflow: '*',
      stage: '*',
    })

    assert.ok(
      policies.some((policy) => policy.id === 'BROWSER-001'),
      `${persona} MUST resolve BROWSER-001`,
    )
  }
})

test('the always-apply Cursor rule is generated from BROWSER-001', () => {
  const manifest = JSON.parse(
    readSurface('governance/registries/projection_manifest.json'),
  ) as {
    projections: Array<{
      id: string
      source: string
      target: string
      installation_modes: string[]
      transforms: string[]
    }>
  }
  const rule = manifest.projections.find(
    (projection) => projection.id === 'cursor-browser-policy-rule',
  )

  assert.ok(rule)
  assert.equal(rule.source, 'governance/policies/BROWSER-001.json')
  assert.equal(rule.target, '.cursor/rules/pan-browser-isolation.mdc')
  assert.deepEqual(rule.installation_modes, ['self_development', 'embedded'])
  assert.deepEqual(rule.transforms, ['policy-rule'])

  // No hand-maintained rule template may reappear alongside the generated one.
  assert.throws(() =>
    readSurface('library/cursor/rules/visual-qa-isolation.mdc'),
  )
})

test('the generated rule reproduces the policy text and references its procedure', () => {
  const root = createFixture()
  const policy = loadPolicyCatalog(root).get('BROWSER-001')
  const generated = syncCursorProjection(root, { write: true }).find(
    (change) => change.path === '.cursor/rules/pan-browser-isolation.mdc',
  )

  assert.ok(policy)
  assert.ok(generated)

  const content = readFileSync(path.join(root, generated.path), 'utf8')

  assert.match(content, /alwaysApply:\s*true/u)
  assert.ok(content.includes(policy.summary))

  for (const instruction of policy.instructions) {
    assert.ok(
      content.includes(instruction),
      `generated rule MUST include: ${instruction}`,
    )
  }

  // The rule applies outside a card, so it uses the same progressive disclosure
  // form: the isolation rules are inline and the procedure stays a reference.
  for (const guidance of policy.guidance ?? []) {
    const { reference } = guidance

    assert.ok(reference)
    assert.ok(
      content.includes(`## Guidance reference · \`${guidance.source_path}\``),
    )
    assert.ok(content.includes(`Read when: ${reference.read_trigger}`))
    assert.ok(content.includes(`sha256:${reference.content_sha256}`))
    assert.ok(!content.includes(guidance.content))
  }
})

test('library/cursor/mcp.json declares chrome-devtools with --isolated', () => {
  const mcp = JSON.parse(readSurface('library/cursor/mcp.json')) as {
    mcpServers: Record<string, { command: string; args: string[] }>
  }
  const chromeDevtools = mcp.mcpServers['chrome-devtools']

  assert.ok(chromeDevtools)
  assert.equal(chromeDevtools.command, 'npx')
  assert.ok(chromeDevtools.args.includes('chrome-devtools-mcp@latest'))
  assert.ok(chromeDevtools.args.includes('--isolated'))
  assert.ok(mcp.mcpServers.playwright)
})

test('qa-tester persona and dev test prompt classify intermittent full-suite timeouts', () => {
  for (const surface of [
    'library/personas/qa-tester.md',
    'library/workflows/dev/prompts/test.md',
  ]) {
    const content = readSurface(surface).toLowerCase()

    assert.match(content, /intermittent/u)
    assert.match(content, /full-suite/u)
    assert.match(content, /harness\/test/u)
    assert.match(content, /harness-owned evidence/u)
  }
})
