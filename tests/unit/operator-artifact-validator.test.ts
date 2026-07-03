import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validateOperatorArtifact } from '../../src/lib/validators/operator-artifact.js'
import { createFixture } from '../helpers.js'

function input(root: string, targetPath: string) {
  return {
    root,
    targetPath,
    requirement: {
      policy_id: 'GLOBAL-001',
      requirement_id: 'operator-artifact-validate',
      registry_id: 'OPERATOR-ARTIFACT-VALIDATE-001',
      arguments: {},
    },
  }
}

test('operator artifact validator accepts semantic HTML briefs', () => {
  const root = createFixture()
  const targetPath = 'runtime/implementation.html'

  mkdirSync(path.dirname(path.join(root, targetPath)), { recursive: true })
  writeFileSync(
    path.join(root, targetPath),
    `<!doctype html><main class="pc-brief" data-brief-type="general">
      <section data-section-semantic="executive-summary"><h2>Summary</h2><article><h3>Outcome</h3><p>The implementation is complete and ready for the operator to review.</p></article></section>
      <section data-section-semantic="changes"><h2>Changes</h2></section>
      <section data-section-semantic="validation"><h2>Acceptance</h2></section>
    </main>`,
  )

  const result = validateOperatorArtifact(
    input(root, targetPath),
    'implementation',
  )

  assert.equal(result.status, 'passed', JSON.stringify(result.issues))
})

test('operator artifact validator requires the executive summary first', () => {
  const root = createFixture()
  const targetPath = 'runtime/implementation.html'

  mkdirSync(path.dirname(path.join(root, targetPath)), { recursive: true })
  writeFileSync(
    path.join(root, targetPath),
    `<!doctype html><main class="pc-brief" data-brief-type="general">
      <section data-section-semantic="changes"><h2>Changes</h2></section>
      <section data-section-semantic="executive-summary"><h2>Summary</h2><p>Late summary with enough text to otherwise pass validation.</p></section>
      <section><h2>Acceptance</h2></section>
    </main>`,
  )

  const result = validateOperatorArtifact(
    input(root, targetPath),
    'implementation',
  )

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'operator.executive_summary_missing',
    ),
  )
})
