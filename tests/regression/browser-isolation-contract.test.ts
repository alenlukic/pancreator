import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { renderPolicyCursorRule } from '../../src/lib/cursor-content.js'
import { loadPolicyCatalog, resolvePolicies } from '../../src/lib/policies.js'

const REPO_ROOT = process.cwd()

/**
 * The previous version of this file required every isolation token to be
 * restated in six separate surfaces, which is exactly why those surfaces drifted
 * apart. It now asserts the opposite: `BROWSER-001` holds the contract, and every
 * surface that needs it receives it by policy delivery or generation, never by
 * restatement.
 */

/** Surfaces that used to restate the contract and must no longer do so. */
const NON_RESTATING_SURFACES = [
  'library/personas/qa-tester.md',
  'library/personas/design-qa.md',
  'library/personas/designer.md',
  'library/cursor/agents/qa-tester.md',
  'library/cursor/agents/design-qa.md',
  'library/cursor/agents/designer.md',
  'library/workflows/delivery/prompts/verify.md',
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

test('every surface defers to BROWSER-001 instead of restating it', () => {
  for (const surface of NON_RESTATING_SURFACES) {
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
  }
})

test('browser-touching personas resolve BROWSER-001', () => {
  const policy = loadPolicyCatalog(REPO_ROOT).get('BROWSER-001')

  assert.ok(policy)
  assert.equal(policy.severity, 'hard')
  assert.ok(
    (policy.guidance ?? []).some(
      (guidance) =>
        guidance.source_path === 'library/skills/browser-inspection.md',
    ),
    'BROWSER-001 MUST deliver the browser-inspection procedure',
  )

  for (const persona of PERSONAS_REQUIRING_BROWSER_POLICY) {
    const policies = resolvePolicies(REPO_ROOT, {
      persona,
      workflow: '*',
      stage: '*',
    })

    assert.ok(
      policies.some((resolved) => resolved.id === 'BROWSER-001'),
      `${persona} MUST resolve BROWSER-001`,
    )
  }
})

// unit/projection proves the installer's rendered rule is byte-identical to
// `renderPolicyCursorRule`, so the renderer is exercised directly here.
test('the generated rule reproduces the policy text and references its procedure', () => {
  const policy = loadPolicyCatalog(REPO_ROOT).get('BROWSER-001')

  assert.ok(policy)

  const content = renderPolicyCursorRule(policy)

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

  // No hand-maintained rule template may reappear alongside the generated one.
  assert.equal(
    existsSync(
      path.join(REPO_ROOT, 'library/cursor/rules/visual-qa-isolation.mdc'),
    ),
    false,
  )
})
