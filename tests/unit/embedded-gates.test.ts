import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createFixture } from '../helpers.js'
import { evaluateDeterministicCriteria } from '../../src/lib/validation.js'
import { resolveRoots } from '../../src/lib/workspace/roots.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import type { RunState, StageDefinition } from '../../src/lib/types.js'

function configureEmbeddedFixture(root: string): void {
  const projectPath = path.join(root, 'project.json')
  const project = JSON.parse(readFileSync(projectPath, 'utf8')) as Record<
    string,
    unknown
  >
  const packagePath = path.join(root, 'package.json')
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
    scripts: Record<string, string>
  }

  project.installation_mode = 'embedded'
  project.workspace_root = '.'
  packageJson.scripts.lint = 'node -e "process.exit(9)"'

  writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`)
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
  writeFileSync(
    path.join(root, 'runtime', 'repository-checks.json'),
    `${JSON.stringify(
      {
        schema_version: 1,
        profiles: {
          static: {
            probes: ['node --version'],
            commands: ['node -e "process.exit(0)"'],
          },
        },
      },
      null,
      2,
    )}\n`,
  )
}

function fixtureState(root: string): {
  state: RunState
  workspaceBefore: ReturnType<typeof gitWorkspaceSnapshot>
  runDirectory: string
} {
  const roots = resolveRoots({
    installation_root: root,
    workspace_root: root,
    state_root: 'runtime',
  })
  const runDirectory = path.join(root, 'runtime', 'logs', 'workflows', 'legacy')

  mkdirSync(runDirectory, { recursive: true })

  return {
    state: {
      run_id: 'legacy',
      workspace_root: root,
      state_root: roots.state_root,
      stage_history: [],
      gate_overrides: {},
    } as unknown as RunState,
    workspaceBefore: gitWorkspaceSnapshot(roots.workspace_root),
    runDirectory,
  }
}

test('embedded legacy npm gates route through target-owned profiles', () => {
  const root = createFixture()

  configureEmbeddedFixture(root)

  const { state, workspaceBefore, runDirectory } = fixtureState(root)
  const stage: StageDefinition = {
    slug: 'implement',
    title: 'Implementation',
    persona: 'coder',
    workspace_policy: 'source_allowed',
    gate: 'next_stage',
    context: { request: 'omit' },
    criteria: [
      {
        id: 'implement.lint',
        type: 'shell',
        hard: true,
        statement: 'Legacy static gate.',
        command: 'npm run lint',
      },
    ],
    transitions: { success: 'review', failure: 'implement', blocked: 'paused' },
  }

  const evaluated = evaluateDeterministicCriteria(
    root,
    runDirectory,
    state,
    stage,
    workspaceBefore,
    root,
  )
  const result = evaluated.results[0]

  assert.ok(result)
  assert.equal(result.command, 'pan repository-check static')
  assert.equal(result.passed, true)
  assert.equal(result.disabled, undefined)
})

test('embedded legacy standalone coverage gates are removed, not passed', () => {
  const root = createFixture()

  configureEmbeddedFixture(root)

  const { state, workspaceBefore, runDirectory } = fixtureState(root)
  const stage: StageDefinition = {
    slug: 'test',
    title: 'Quality assurance',
    persona: 'qa-tester',
    workspace_policy: 'read_only',
    gate: 'stage_verdict',
    context: { request: 'omit' },
    criteria: [
      {
        id: 'test.coverage',
        type: 'shell',
        hard: true,
        statement: 'Legacy coverage gate.',
        command: 'npm run test:coverage',
      },
    ],
    transitions: { success: 'ship', failure: 'implement', blocked: 'paused' },
  }

  const evaluated = evaluateDeterministicCriteria(
    root,
    runDirectory,
    state,
    stage,
    workspaceBefore,
    root,
  )
  const result = evaluated.results.find((item) => item.id === 'test.coverage')

  assert.ok(result)
  assert.equal(result.disabled, true)
  assert.equal(result.passed, false)
  assert.match(result.explanation ?? '', /standalone coverage gate removed/u)
})
