import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { prepareInvocation } from '../../src/lib/engine.js'
import {
  AGENT_REPOSITORY_CHECK_RUNS_FILE,
  loadRepositoryChecks,
} from '../../src/lib/repository-checks.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { loadState, statePath } from '../../src/lib/state.js'
import type { RunState } from '../../src/lib/types.js'
import { createWorktree as createWorktreeRecord } from '../../src/lib/worktrees.js'
import { createFixture, writeJson } from '../helpers.js'
import { createRun } from '../run-helpers.js'

import { CLI, runCli } from './worktree-helpers.js'

test('init --worktree creates a missing worktree and setup commands prepare it', () => {
  const root = createFixture()

  writeJson(path.join(root, 'config_overrides.json'), {
    worktrees: {
      setup: [`node -e "require('fs').writeFileSync('setup-ran.txt', 'ok')"`],
    },
  })

  const initialized = runCli<{
    run_id: string
    workspace_root: string
  }>(root, ['init', '--request', 'request.md', '--worktree', 'fresh'])

  assert.equal(initialized.workspace_root, 'worktrees/operator/fresh')
  assert.equal(
    existsSync(path.join(root, initialized.workspace_root, 'setup-ran.txt')),
    true,
  )

  const listed = runCli<{
    worktrees: Array<{ name: string; branch: string }>
  }>(root, ['worktree', 'list'])

  assert.deepEqual(
    listed.worktrees.map((entry) => entry.name),
    ['fresh'],
  )

  const conflicting = spawnSync(
    process.execPath,
    [
      CLI,
      'init',
      '--request',
      'request.md',
      '--worktree',
      'fresh',
      '--workspace',
      '.',
      '--json',
    ],
    { cwd: root, encoding: 'utf8', timeout: 120_000 },
  )

  assert.notEqual(conflicting.status, 0)
  assert.match(conflicting.stderr, /cannot be used together/u)
})

test('workspace setup runs only for a worktree run whose workflow works in the tree', () => {
  const root = createFixture()
  const markerName = 'workspace-setup-marker.txt'

  writeJson(path.join(root, 'runtime', 'repository-checks.json'), {
    ...loadRepositoryChecks(root),
    setup: [
      `node -e "require('node:fs').writeFileSync('${markerName}', 'provisioned')"`,
    ],
  })

  const marker = (record: { path: string }) =>
    path.join(root, record.path, markerName)
  const reprepare = (runId: string, patch: Partial<RunState>) => {
    writeJson(statePath(root, runId), {
      ...loadState(root, runId),
      pending_action: { type: 'prepare_invocation' },
      current_invocation: null,
      ...patch,
    })

    return prepareInvocation(root, runId)
  }

  // A planning run edits nothing, runs no shell gate, and launches no
  // evidence worker, so its worktree needs no dependencies or build output.
  // The run records that nothing was configured to run and does not read the
  // declared setup again.
  const planningWorktree = createWorktreeRecord(root, 'plan-tree')
  const planning = createRun(root, {
    workflowSlug: 'planning',
    requestPath: 'request.md',
    workspace: planningWorktree.path,
    worktree: planningWorktree,
  })
  const plannedPrepare = prepareInvocation(root, planning.run_id)

  assert.equal(plannedPrepare.invocation?.stage.slug, 'plan')
  assert.equal(existsSync(marker(planningWorktree)), false)
  assert.equal(
    loadState(root, planning.run_id).workspace_setup?.status,
    'not_configured',
  )

  // A delivery run that starts at verify never edits source, but its shell
  // gate and evidence workers test the tree, so setup runs before the stage.
  const releaseWorktree = createWorktreeRecord(root, 'release-tree')
  const release = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    workspace: releaseWorktree.path,
    worktree: releaseWorktree,
    startStage: 'verify',
  })
  const verifyPrepare = prepareInvocation(root, release.run_id)

  assert.equal(verifyPrepare.invocation?.stage.slug, 'verify')
  assert.equal(readFileSync(marker(releaseWorktree), 'utf8'), 'provisioned')
  assert.equal(
    loadState(root, release.run_id).workspace_setup?.status,
    'passed',
  )
  assert.equal(existsSync(path.join(root, markerName)), false)

  // A run that captured its repository-check baselines before the record
  // existed proved its tree was provisioned: the upgrade infers the pass
  // instead of running setup again on that tree.
  rmSync(marker(releaseWorktree))

  const upgraded = loadState(root, release.run_id)

  delete upgraded.workspace_setup
  writeJson(statePath(root, release.run_id), upgraded)

  const inferredPrepare = reprepare(release.run_id, {
    repository_check_baselines: {},
  })

  assert.equal(inferredPrepare.invocation?.stage.slug, 'verify')
  assert.equal(existsSync(marker(releaseWorktree)), false)
  assert.deepEqual(
    {
      status: loadState(root, release.run_id).workspace_setup?.status,
      inferred_from: loadState(root, release.run_id).workspace_setup
        ?.inferred_from,
    },
    { status: 'passed', inferred_from: 'repository_check_baselines' },
  )

  // With no setup command declared, a run that needs the tree records that
  // nothing was configured, so later prepares do not read the declaration.
  writeJson(path.join(root, 'runtime', 'repository-checks.json'), {
    ...loadRepositoryChecks(root),
    setup: [],
  })

  const unconfiguredWorktree = createWorktreeRecord(root, 'bare-tree')
  const unconfigured = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    workspace: unconfiguredWorktree.path,
    worktree: unconfiguredWorktree,
    startStage: 'verify',
  })

  assert.equal(
    prepareInvocation(root, unconfigured.run_id).invocation?.stage.slug,
    'verify',
  )
  assert.equal(
    loadState(root, unconfigured.run_id).workspace_setup?.status,
    'not_configured',
  )
})

// The fixture template deletes the `worktrees` block so no fixture installs
// real dependencies, so a case that wants the readiness branch has to
// declare its own cheap setup and readiness paths.
test('a worktree creation already provisioned is not provisioned twice', () => {
  const root = createFixture()
  const readinessPath = 'creation-provisioned'
  const repositorySetupMarker = 'repository-setup-marker.txt'

  writeJson(path.join(root, 'config_overrides.json'), {
    marker: 'readiness',
    worktrees: {
      setup: [`node -e "require('node:fs').mkdirSync('${readinessPath}')"`],
      readiness_paths: [readinessPath],
    },
  })
  writeJson(path.join(root, 'runtime', 'repository-checks.json'), {
    ...loadRepositoryChecks(root),
    setup: [
      `node -e "require('node:fs').writeFileSync('${repositorySetupMarker}', 'again')"`,
    ],
  })

  const ready = createWorktreeRecord(root, 'ready-tree')

  assert.equal(existsSync(path.join(root, ready.path, readinessPath)), true)

  const readyRun = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    workspace: ready.path,
    worktree: ready,
    startStage: 'verify',
  })

  assert.equal(
    prepareInvocation(root, readyRun.run_id).invocation?.stage.slug,
    'verify',
  )
  assert.deepEqual(
    {
      status: loadState(root, readyRun.run_id).workspace_setup?.status,
      inferred_from: loadState(root, readyRun.run_id).workspace_setup
        ?.inferred_from,
    },
    { status: 'passed', inferred_from: 'worktree_readiness' },
  )
  // Creation already installed the tree, so the first prepare must not run
  // the repository-check setup array over it again.
  assert.equal(
    existsSync(path.join(root, ready.path, repositorySetupMarker)),
    false,
  )

  // Readiness is asserted, not assumed. A tree missing a declared path falls
  // through and the first prepare provisions it.
  const stripped = createWorktreeRecord(root, 'stripped-tree')

  rmSync(path.join(root, stripped.path, readinessPath), {
    recursive: true,
    force: true,
  })

  const strippedRun = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    workspace: stripped.path,
    worktree: stripped,
    startStage: 'verify',
  })

  assert.equal(
    prepareInvocation(root, strippedRun.run_id).invocation?.stage.slug,
    'verify',
  )
  assert.deepEqual(
    {
      status: loadState(root, strippedRun.run_id).workspace_setup?.status,
      inferred_from: loadState(root, strippedRun.run_id).workspace_setup
        ?.inferred_from,
    },
    { status: 'passed', inferred_from: undefined },
  )
  assert.equal(
    existsSync(path.join(root, stripped.path, repositorySetupMarker)),
    true,
  )
})

test('repository-check --worktree creates the worktree and runs inside it', () => {
  const root = createFixture()

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      fast: {
        probes: [],
        commands: ['node -e "process.stdout.write(process.cwd())"'],
      },
    },
  })

  const result = runCli<{
    status: string
    workspace_root: string
    results: Array<{ kind: string; stdout: string }>
  }>(root, ['repository-check', 'fast', '--worktree', 'checks'])

  assert.equal(result.status, 'passed')
  assert.equal(path.basename(result.workspace_root), 'checks')
  assert.equal(
    result.results.find((entry) => entry.kind === 'command')?.stdout,
    path.resolve(result.workspace_root),
  )

  const listed = runCli<{
    worktrees: Array<{ name: string }>
  }>(root, ['worktree', 'list'])

  assert.deepEqual(
    listed.worktrees.map((entry) => entry.name),
    ['checks'],
  )

  const baseline = runCli<{ languages: Array<{ id: string }> }>(root, [
    'technologies',
    'detect',
  ])

  assert.equal(
    baseline.languages.some((language) => language.id === 'python'),
    false,
  )

  writeFileSync(
    path.join(root, 'worktrees/operator/checks', 'requirements.txt'),
    'requests\n',
  )

  const targeted = runCli<{
    languages: Array<{ id: string; evidence: string[] }>
  }>(root, ['technologies', 'detect', '--worktree', 'checks'])

  assert.deepEqual(
    targeted.languages.find((language) => language.id === 'python'),
    { id: 'python', evidence: ['requirements.txt'] },
  )

  const conflicting = spawnSync(
    process.execPath,
    [
      CLI,
      'repository-check',
      'fast',
      '--worktree',
      'checks',
      '--workspace',
      '.',
      '--json',
    ],
    { cwd: root, encoding: 'utf8', timeout: 120_000 },
  )

  assert.notEqual(conflicting.status, 0)
  assert.match(conflicting.stderr, /cannot be used together/u)
})

test('repository-check records run evidence only when a run is named', () => {
  const root = createFixture()

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      fast: {
        probes: [],
        commands: ['node -e "process.exit(0)"'],
      },
    },
  })

  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const evidence = resolveRunLayout(root, run.run_id).evidence(
    AGENT_REPOSITORY_CHECK_RUNS_FILE,
  )

  // A bare invocation is an operator's own check from the base checkout. It
  // is evidence of no run, although this run happens to share the workspace.
  const bare = runCli<{
    status: string
    run_evidence_paths?: string[]
  }>(root, ['repository-check', 'fast'])

  assert.equal(bare.status, 'passed')
  assert.equal('run_evidence_paths' in bare, false)
  assert.equal(existsSync(evidence.absolute), false)

  // `--run` names the run the execution is evidence for, so the record lands
  // in that run's evidence and the response names the file.
  const recorded = runCli<{
    status: string
    run_evidence_paths?: string[]
  }>(root, ['repository-check', 'fast', '--run', run.run_id])

  assert.equal(recorded.status, 'passed')
  assert.deepEqual(recorded.run_evidence_paths, [evidence.relative])

  const lines = readFileSync(evidence.absolute, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)

  assert.equal(lines.length, 1)
  assert.equal(lines[0].profile, 'fast')
  assert.equal(lines[0].status, 'passed')
  assert.equal(lines[0].invoked_by, 'agent')
})

// The short-circuit is what makes a second agent request free, and no case
// drove it, so deleting it from the CLI left the suite green.
test('repository-check reuses a recorded pass until --force-repeat asks again', () => {
  const root = createFixture()
  // The marker lives under the ignored runtime tree, so counting executions
  // never moves the workspace fingerprint the reuse lookup compares.
  const marker = path.join(root, 'runtime', 'fast-ran.txt')
  const executions = () =>
    existsSync(marker) ? readFileSync(marker, 'utf8').length : 0

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      fast: {
        probes: [],
        commands: [
          `node -e "require('node:fs').appendFileSync('runtime/fast-ran.txt','x')"`,
        ],
      },
    },
  })

  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const check = (extra: string[] = []) =>
    runCli<{
      status: string
      reused_execution?: { profile: string; workspace_fingerprint: string }
    }>(root, ['repository-check', 'fast', '--run', run.run_id, ...extra])

  const executed = check()

  assert.equal(executed.status, 'passed')
  assert.equal('reused_execution' in executed, false)
  assert.equal(executions(), 1)

  const reused = check()

  assert.equal(reused.status, 'passed')
  assert.equal(reused.reused_execution?.profile, 'fast')
  assert.equal(executions(), 1)

  const forced = check(['--force-repeat'])

  assert.equal(forced.status, 'passed')
  assert.equal('reused_execution' in forced, false)
  assert.equal(executions(), 2)

  // A reuse records nothing, and the forced repeat says why it ran.
  const ledger = readFileSync(
    resolveRunLayout(root, run.run_id).evidence(
      AGENT_REPOSITORY_CHECK_RUNS_FILE,
    ).absolute,
    'utf8',
  )
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)

  assert.equal(ledger.length, 2)
  assert.equal(ledger[0].forced_repeat, undefined)
  assert.equal(ledger[1].forced_repeat, true)
})

test('repository-check refuses full for a verify-stage worker before execution', () => {
  const root = createFixture()
  const marker = path.join(root, 'runtime', 'forbidden-full-ran.txt')

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      full: {
        probes: [],
        commands: [
          `node -e "require('node:fs').writeFileSync('runtime/forbidden-full-ran.txt','x')"`,
        ],
      },
    },
  })

  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    startStage: 'verify',
  })
  const refused = spawnSync(
    process.execPath,
    [CLI, 'repository-check', 'full', '--run', run.run_id, '--json'],
    { cwd: root, encoding: 'utf8', timeout: 120_000 },
  )

  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /VERIFY-001/u)
  assert.match(refused.stderr, /ship release gate/u)
  assert.equal(existsSync(marker), false)

  // R-02 of run 63290: the refusal read an argv flag as the permission, so
  // the subject of the check could grant itself the exemption. Authority is
  // now the launch token the harness hands the child it spawns, and a caller
  // that declares harness authority without one is refused before the
  // profile runs.
  const claimed = spawnSync(
    process.execPath,
    [
      CLI,
      'repository-check',
      'full',
      '--run',
      run.run_id,
      '--harness-initiated',
      '--json',
    ],
    { cwd: root, encoding: 'utf8', timeout: 120_000 },
  )

  assert.notEqual(claimed.status, 0)
  assert.match(claimed.stderr, /HARNESS_INITIATION_UNVERIFIED/u)
  assert.equal(existsSync(marker), false)
})
