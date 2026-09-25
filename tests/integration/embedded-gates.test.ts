import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createFixture } from '../fixture-template.js'
import {
  buildFastWallReport,
  FAST_WALL_CRITERION_ID,
  formatFastWallReport,
} from '../../src/lib/fast-wall-series.js'
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

test('embedded preflight test gates resolve the target fast profile', () => {
  const root = createFixture()

  configureEmbeddedFixture(root, {
    fast: {
      probes: ['node --version'],
      commands: ['node -e "process.exit(0)"'],
    },
  })

  // The local decision is the criterion-to-profile mapping; running the
  // profile is the runner's contract, proven in repository-checks.test.ts.
  const resolution = resolveShellCheck(
    root,
    preflightStage().criteria[0] as Criterion,
    HARNESS_TEST_COMMAND,
    false,
  )

  assert.equal(resolution.command, 'pan repository-check fast')
  assert.equal(resolution.profile_name, 'fast')
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

function fastWallCriterion(command: string, id = FAST_WALL_CRITERION_ID) {
  return {
    id,
    type: 'shell',
    hard: true,
    statement: 'The rolling fast-lane wall average is within the ceiling.',
    command,
  } satisfies Criterion
}

// `runShellCheck` attaches this gate's report to the criterion id. Resolution
// reads the same key, so a re-spelled command still reaches `pan tests wall`
// and a criterion that merely borrows the command text does not.
test('the fast-wall gate resolves by criterion id, not by command text', () => {
  const root = createFixture()
  const resolved = resolveShellCheck(
    root,
    fastWallCriterion('pan tests wall'),
    'pan tests wall',
    false,
  )

  assert.match(resolved.command, /bin\/pan' tests wall$/u)
  assert.equal(resolved.profile_name, null)

  const respelled = resolveShellCheck(
    root,
    fastWallCriterion('./bin/pan tests wall'),
    './bin/pan tests wall',
    false,
  )

  assert.equal(respelled.command, resolved.command)

  const borrowed = resolveShellCheck(
    root,
    fastWallCriterion('pan tests wall', 'ship.release_packet'),
    'pan tests wall',
    false,
  )

  assert.equal(borrowed.command, 'pan tests wall')
})

// C-7: an embedded installation resolves the criterion the same way. A fresh
// install ships no ceiling, so the command reports it as not calibrated, the
// gate passes, and a fresh install gets no warning. A target that drops the
// block entirely reports not applicable.
test('the embedded fast-wall gate resolves and reports an uncalibrated ceiling', () => {
  const root = createFixture()

  configureEmbeddedFixture(root)

  const projectPath = path.join(root, 'config.json')
  const project = JSON.parse(readFileSync(projectPath, 'utf8')) as {
    fast_wall?: Record<string, unknown>
  }

  assert.ok(project.fast_wall)
  writeFileSync(
    projectPath,
    `${JSON.stringify({ ...project, fast_wall: { ...project.fast_wall, ceiling_ms: null } }, null, 2)}\n`,
  )

  const uncalibrated = buildFastWallReport(root)

  assert.equal(uncalibrated.status, 'not_calibrated')
  assert.equal(uncalibrated.permitted_ceiling_ms, null)
  assert.match(formatFastWallReport(uncalibrated), /no ceiling yet/u)

  delete project.fast_wall
  writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`)

  const resolved = resolveShellCheck(
    root,
    fastWallCriterion('pan tests wall'),
    'pan tests wall',
    false,
  )

  assert.match(resolved.command, /bin\/pan' tests wall$/u)
  assert.equal(resolved.profile_name, null)
  assert.equal(resolved.removed_reason, undefined)

  const report = buildFastWallReport(root)

  assert.equal(report.status, 'not_applicable')
  assert.equal(report.rolling_average_ms, null)
  assert.equal(report.permitted_ceiling_ms, null)
  assert.match(formatFastWallReport(report), /not applicable.*PASS/u)
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
