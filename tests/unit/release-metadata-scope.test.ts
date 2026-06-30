import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createFixture } from '../helpers.js'
import { evaluateDeterministicCriteria } from '../../src/lib/validation.js'
import { snapshotWorkspace } from '../../src/lib/workspace/index.js'
import { resolveRoots } from '../../src/lib/workspace/roots.js'
import type { RunState, StageDefinition } from '../../src/lib/types.js'

function stage(): StageDefinition {
  return {
    slug: 'ship',
    title: 'Release preparation',
    persona: 'release-steward',
    workspace_policy: 'release_metadata_only',
    gate: 'operator',
    context: { request: 'omit' },
    criteria: [],
    transitions: {
      success: 'succeeded',
      failure: 'implement',
      blocked: 'paused',
    },
  }
}

function evaluate(root: string, mutate: () => void) {
  const roots = resolveRoots({
    installation_root: root,
    workspace_root: root,
    state_root: 'runtime',
  })
  const before = snapshotWorkspace(roots, false).snapshot
  const runDirectory = path.join(root, 'runtime', 'logs', 'workflows', 'scope')

  mkdirSync(runDirectory, { recursive: true })
  mutate()

  return evaluateDeterministicCriteria(
    root,
    runDirectory,
    {
      run_id: 'scope',
      workspace_root: root,
      state_root: roots.state_root,
      stage_history: [],
      gate_overrides: {},
    } as unknown as RunState,
    stage(),
    before,
    root,
  ).results.find((result) => result.id === 'scope.no_unapproved_changes')
}

test('self-development release metadata policy permits bounded docs changes', () => {
  const root = createFixture()
  const result = evaluate(root, () => {
    const readmePath = path.join(root, 'README.md')

    writeFileSync(readmePath, `${readFileSync(readmePath, 'utf8')}\n`)
  })

  assert.ok(result)
  assert.equal(result.passed, true)
  assert.match(result.explanation ?? '', /permitted release metadata/u)
})

test('self-development release metadata policy rejects source changes', () => {
  const root = createFixture()
  const result = evaluate(root, () => {
    writeFileSync(
      path.join(root, 'src', 'base.ts'),
      'export const base = false\n',
    )
  })

  assert.ok(result)
  assert.equal(result.passed, false)
  assert.match(result.explanation ?? '', /src\/base\.ts/u)
})

test('embedded release metadata policy remains read-only', () => {
  const root = createFixture()
  const projectPath = path.join(root, 'project.json')
  const project = JSON.parse(readFileSync(projectPath, 'utf8')) as Record<
    string,
    unknown
  >

  project.installation_mode = 'embedded'
  writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`)

  const result = evaluate(root, () => {
    const readmePath = path.join(root, 'README.md')

    writeFileSync(readmePath, `${readFileSync(readmePath, 'utf8')}\n`)
  })

  assert.ok(result)
  assert.equal(result.passed, false)
  assert.match(result.explanation ?? '', /README\.md/u)
})
