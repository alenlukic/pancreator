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

function writeDispositionExtension(
  root: string,
  extensionId: string,
  entries: Array<Record<string, unknown>>,
): void {
  const directory = path.join(
    root,
    'governance',
    'registries',
    'context_bloat_dispositions.d',
  )

  mkdirSync(directory, { recursive: true })
  writeFileSync(
    path.join(directory, `${extensionId}.json`),
    `${JSON.stringify(
      { schema_version: 1, extension_id: extensionId, entries },
      null,
      2,
    )}\n`,
  )
}

test('a target extension restating a harness directive needs no disposition', () => {
  const root = createFixture()
  const harnessSkill = path.join(root, 'library', 'skills', 'write-pr.md')
  const directive =
    '- A rejected alternative MAY be named only when an artifact records it.\n'

  mkdirSync(path.dirname(harnessSkill), { recursive: true })
  writeFileSync(harnessSkill, `# Write a PR\n\n${directive}`)

  // A target extension declares its own policy and handbook, the way an
  // installed target does, and restates the harness rule in its own wording.
  const handbook = 'governance/handbooks/acme/pull-requests.md'

  mkdirSync(path.join(root, path.dirname(handbook)), { recursive: true })
  writeFileSync(path.join(root, handbook), `# Acme PRs\n\n${directive}`)
  writeFileSync(
    path.join(root, 'governance', 'policies', 'ACME-001.json'),
    `${JSON.stringify(
      {
        id: 'ACME-001',
        title: 'Acme pull requests',
        target_extension: 'acme',
        severity: 'soft',
        summary: 'Target-owned pull-request guidance.',
        instructions: ['Follow the Acme handbook.'],
        guidance_sources: [
          {
            path: handbook,
            read_trigger: 'Read before writing an Acme pull request.',
          },
        ],
      },
      null,
      2,
    )}\n`,
  )

  const result = auditDirectives(root)
  const group = result.duplicate_groups.find((item) =>
    item.sources.some((entry) => entry.path === handbook),
  )

  // The collision is still reported, so it stays visible.
  assert.ok(group)
  assert.deepEqual(
    new Set(group.sources.map((entry) => entry.owner)),
    new Set(['harness', 'target']),
  )

  // It just MUST NOT demand a disposition from the target.
  assert.equal(
    result.errors.some((item) => item.includes(handbook)),
    false,
  )
})

test('a wrapped RFC 2119 preamble is not a duplicate directive', () => {
  const root = createFixture()
  const directory = path.join(root, 'governance', 'handbooks', 'target-owned')
  // Two files carrying the preamble wrapped the way a formatter emits it.
  const preamble =
    '# Guidance\n\nThe terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate\nrequirement levels as defined by RFC 2119 and RFC 8174.\n'

  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, 'first.md'), preamble)
  writeFileSync(path.join(directory, 'second.md'), preamble)

  const result = auditDirectives(root)

  assert.equal(
    result.errors.some(
      (item) =>
        item.includes('duplicate group lacks a disposition') &&
        item.includes('target-owned'),
    ),
    false,
  )
})

test('a target-authored disposition layer covers a duplicate group', () => {
  const root = createFixture()
  const record = dispositionRecord(root)
  const moved = record.entries.find(
    (entry) => entry.id === 'reviewer-hard-evidence-boundary',
  )

  assert.ok(moved)

  // An installation replaces the harness registry wholesale, so the same entry
  // must satisfy the audit from a target-owned layer.
  record.entries = record.entries.filter((entry) => entry !== moved)
  writeDispositionRecord(root, record)
  writeDispositionExtension(root, 'target-layer', [moved])

  const result = auditDirectives(root)

  assert.equal(
    result.errors.some((item) =>
      item.includes('duplicate group lacks a disposition'),
    ),
    false,
  )
})

test('a disposition layer filename MUST match its extension id', () => {
  const root = createFixture()
  const directory = path.join(
    root,
    'governance',
    'registries',
    'context_bloat_dispositions.d',
  )

  mkdirSync(directory, { recursive: true })
  writeFileSync(
    path.join(directory, 'mismatched.json'),
    `${JSON.stringify({
      schema_version: 1,
      extension_id: 'target-layer',
      entries: [],
    })}\n`,
  )

  const result = auditDirectives(root)

  assert.ok(
    result.errors.some((item) =>
      item.includes('MUST match extension_id target-layer'),
    ),
  )
})

test('a disposition layer MUST NOT reuse a harness disposition id', () => {
  const root = createFixture()
  const record = dispositionRecord(root)
  const existing = record.entries[0]

  assert.ok(existing)
  writeDispositionExtension(root, 'target-layer', [existing])

  const result = auditDirectives(root)

  assert.ok(
    result.errors.some((item) =>
      item.includes(`duplicates disposition id ${String(existing.id)}`),
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
