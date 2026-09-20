import assert from 'node:assert/strict'
import test from 'node:test'

import { loadRegistry } from '../../src/lib/requirements/registry.js'
import {
  inferTargetKind,
  resolveRequirementTargetPath,
} from '../../src/lib/requirements/run.js'

const REPO_ROOT = process.cwd()

test('named artifact targets resolve when precomputation is absent', () => {
  assert.equal(
    resolveRequirementTargetPath(
      { target: 'artifact:pr_description' } as never,
      'runtime/output.json',
      {
        artifact_targets: {
          pr_description: 'runtime/pr-descriptions/final.md',
        },
      },
    ),
    'runtime/pr-descriptions/final.md',
  )
})

test('a source file resolves the source-file target kind', () => {
  assert.equal(inferTargetKind('src/cli.ts'), 'source-file')
  assert.equal(inferTargetKind('src/App.tsx'), 'source-file')
  assert.equal(inferTargetKind('tools/report.py'), 'source-file')
  assert.equal(inferTargetKind('docs/guide.md'), 'markdown-artifact')
  assert.equal(inferTargetKind('Makefile'), 'unknown')
})

test('an instruction surface resolves the target kind its STE entry accepts', () => {
  assert.equal(
    inferTargetKind('governance/policies/STE-001.json'),
    'policy-json',
  )
  assert.equal(
    inferTargetKind('library/cursor/rules/pancreator-embedded.mdc'),
    'markdown-artifact',
  )
  assert.equal(
    inferTargetKind('governance/registries/validation_registry.json'),
    'unknown',
    'only a policy file carries the policy-json kind',
  )

  const entry = loadRegistry(REPO_ROOT).entries.get(
    'SIMPLIFIED-ENGLISH-VALIDATE-001',
  )

  assert.ok(entry, 'SIMPLIFIED-ENGLISH-VALIDATE-001 MUST be registered')

  for (const target of [
    'governance/policies/STE-001.json',
    'library/cursor/rules/pancreator-embedded.mdc',
    'library/personas/librarian.md',
  ]) {
    assert.ok(
      entry.target_types.includes(inferTargetKind(target)),
      `pan requirements run MUST reach the writing check for ${target}`,
    )
  }
})

test('a tune record resolves the target kind its registry entry accepts', () => {
  const record = 'runtime/tune-harness/records/tune-1789154168355.json'

  assert.equal(inferTargetKind(record), 'tune-record-json')
  assert.equal(
    inferTargetKind('runtime/tune-harness/reports/tune-1789154168355.md'),
    'markdown-artifact',
    'only the immutable record under records/ carries the tune-record kind',
  )

  const entry = loadRegistry(REPO_ROOT).entries.get('TUNE-RECORD-VALIDATE-001')

  assert.ok(entry, 'TUNE-RECORD-VALIDATE-001 MUST be registered')
  assert.ok(
    entry.target_types.includes(inferTargetKind(record)),
    'pan requirements run MUST reach the tune record validator by target kind',
  )
})
