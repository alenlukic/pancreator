import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createFixture } from '../helpers.js'
import {
  evaluateDeterministicCriteria,
  resolveShellCheck,
} from '../../src/lib/validation.js'
import { resolveRoots } from '../../src/lib/workspace/roots.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import type {
  Criterion,
  RunState,
  StageDefinition,
} from '../../src/lib/types.js'

function configureEmbeddedFixture(
  root: string,
  extraProfiles: Record<string, { probes: string[]; commands: string[] }> = {},
): void {
  const projectPath = path.join(root, 'config.json')
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
          ...extraProfiles,
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
  const criterion: Criterion = {
    id: 'implement.lint',
    type: 'shell',
    hard: true,
    statement: 'Legacy static gate.',
    command: 'npm run lint',
  }
  const resolved = resolveShellCheck(
    root,
    criterion,
    criterion.command ?? '',
    false,
  )

  assert.equal(resolved.command, 'pan repository-check static')
  assert.equal(resolved.profile_name, 'static')
})

const HARNESS_TEST_COMMAND = 'npm --prefix "$PANCREATOR_ROOT" test'

function preflightStage(): StageDefinition {
  return {
    slug: 'inspect',
    title: 'Inspect repository',
    persona: 'reviewer',
    workspace_policy: 'read_only',
    gate: 'stage_verdict',
    context: { request: 'omit' },
    criteria: [
      {
        id: 'preflight.tests',
        type: 'shell',
        hard: true,
        statement: 'Automated tests pass.',
        command: HARNESS_TEST_COMMAND,
      },
    ],
    transitions: {
      success: 'succeeded',
      failure: 'failed',
      blocked: 'paused',
    },
  }
}

function preflightTestResult(root: string) {
  const { state, workspaceBefore, runDirectory } = fixtureState(root)
  const evaluated = evaluateDeterministicCriteria(
    root,
    runDirectory,
    state,
    preflightStage(),
    workspaceBefore,
    root,
  )

  return evaluated.results.find((item) => item.id === 'preflight.tests')
}

test('embedded preflight test gates run the target fast profile', () => {
  const root = createFixture()

  configureEmbeddedFixture(root, {
    fast: {
      probes: ['node --version'],
      commands: ['node -e "process.exit(0)"'],
    },
  })

  const result = preflightTestResult(root)

  assert.ok(result)
  assert.equal(result.command, 'pan repository-check fast')
  assert.equal(result.passed, true)
  assert.equal(result.disabled, undefined)
})

test('embedded preflight test gates no-op when no fast profile is configured', () => {
  const root = createFixture()

  configureEmbeddedFixture(root)

  const result = preflightTestResult(root)

  assert.ok(result)
  assert.equal(result.command, 'pan repository-check fast')
  assert.equal(result.disabled, true)
  assert.match(result.explanation ?? '', /not configured/u)
})

test('self-development preflight test gates still run the harness suite', () => {
  const root = createFixture()
  const criterion: Criterion = {
    id: 'preflight.tests',
    type: 'shell',
    hard: true,
    statement: 'Automated tests pass.',
    command: HARNESS_TEST_COMMAND,
  }
  const resolution = resolveShellCheck(
    root,
    criterion,
    HARNESS_TEST_COMMAND,
    false,
  )

  assert.equal(resolution.profile_name, null)
  assert.equal(resolution.command, HARNESS_TEST_COMMAND)
})

test('embedded legacy standalone coverage gates are removed, not passed', () => {
  const root = createFixture()

  configureEmbeddedFixture(root)

  const criterion: Criterion = {
    id: 'test.coverage',
    type: 'shell',
    hard: true,
    statement: 'Legacy coverage gate.',
    command: 'npm run test:coverage',
  }
  const resolution = resolveShellCheck(
    root,
    criterion,
    'npm run test:coverage',
    false,
  )

  assert.equal(resolution.profile_name, null)
  assert.match(
    resolution.removed_reason ?? '',
    /standalone coverage gate removed/u,
  )
})
