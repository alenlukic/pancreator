import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { auditDirectives } from '../../src/lib/governance/audit-directives.js'
import { createFixture } from '../helpers.js'

test('directive audit passes on fixture repository', () => {
  const root = createFixture()
  const criteriaRoot = path.join(root, 'governance', 'criteria')

  mkdirSync(criteriaRoot, { recursive: true })
  writeFileSync(path.join(criteriaRoot, 'index.md'), '# Criteria\n')

  const result = auditDirectives(root)

  assert.equal(result.errors.length, 0)
  assert.deepEqual(
    new Set(result.source_coverage.map((item) => item.category)),
    new Set([
      'bootstrap',
      'criterion',
      'cursor_source',
      'generated_projection',
      'guidance',
      'persona',
      'policy',
      'projection_manifest',
      'selector',
      'skill',
      'workflow_prompt',
    ]),
  )
  assert.ok(result.duplicate_groups.length > 0)
  assert.equal(
    result.source_coverage
      .flatMap((item) => item.paths)
      .some((item) => item.startsWith('.cursor/')),
    false,
  )
})

function dispositionRecord(root: string): {
  entries: Array<Record<string, unknown>>
} {
  const filePath = path.join(
    root,
    'governance',
    'registries',
    'context_bloat_dispositions.json',
  )

  return JSON.parse(readFileSync(filePath, 'utf8')) as {
    entries: Array<Record<string, unknown>>
  }
}

function writeDispositionRecord(
  root: string,
  record: { entries: Array<Record<string, unknown>> },
): void {
  writeFileSync(
    path.join(
      root,
      'governance',
      'registries',
      'context_bloat_dispositions.json',
    ),
    `${JSON.stringify({ schema_version: 1, ...record }, null, 2)}\n`,
  )
}

test('directive audit rejects an undisposed duplicate group', () => {
  const root = createFixture()
  const record = dispositionRecord(root)

  record.entries = record.entries.filter(
    (entry) => entry.id !== 'reviewer-hard-evidence-boundary',
  )
  writeDispositionRecord(root, record)

  const result = auditDirectives(root)

  assert.ok(
    result.errors.some((item) =>
      item.includes('duplicate group lacks a disposition'),
    ),
  )
})

test('directive audit rejects stale sources and missing retain evidence', () => {
  const root = createFixture()
  const record = dispositionRecord(root)

  record.entries.push({
    id: 'stale-retain',
    category: 'duplicate',
    sources: ['library/personas/missing.md'],
    disposition: 'retain',
    rationale: 'A stale fixture.',
    evidence: ['tests/unit/directive-audit.test.ts'],
  })
  const retained = record.entries.find(
    (entry) => entry.id === 'language-appendix-boundaries',
  )

  assert.ok(retained)
  retained.evidence = []
  writeDispositionRecord(root, record)

  const result = auditDirectives(root)

  assert.ok(result.errors.some((item) => item.includes('is invalid')))
  assert.ok(
    result.errors.some((item) => item.includes('stale disposition source')),
  )
})
