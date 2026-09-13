import assert from 'node:assert/strict'
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createFixture } from '../fixture-template.js'
import { createRun } from '../helpers.js'
import { evaluateDeterministicCriteria } from '../../src/lib/validation.js'
import {
  gateCacheKey,
  gateCacheLookup,
  gateCacheStore,
} from '../../src/lib/gate-cache.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import {
  agentGatePassSuiteProfile,
  recordProfileGatePass,
  runRepositoryCheck,
} from '../../src/lib/repository-checks.js'
import { TEST_PROFILE_ENV } from '../../src/lib/suite-profile.js'
import type { RunState, StageDefinition } from '../../src/lib/types.js'
import { createTestTempDirectory } from '../temp.js'

function fixtureState(
  root: string,
  runId: string,
): {
  state: RunState
  workspaceBefore: ReturnType<typeof gitWorkspaceSnapshot>
  runDirectory: string
} {
  const runDirectory = path.join(root, 'runtime', 'logs', 'workflows', runId)

  mkdirSync(runDirectory, { recursive: true })

  return {
    state: {
      run_id: runId,
      workspace_root: root,
      state_root: 'runtime',
      stage_history: [],
      gate_overrides: {},
    } as unknown as RunState,
    workspaceBefore: gitWorkspaceSnapshot(root),
    runDirectory,
  }
}

/**
 * A gate stage that appends one byte to `runtime/gate-marker.log`. The marker
 * sits outside the workspace fingerprint, so it counts executions without
 * changing that fingerprint.
 */
function markerStage(passing: boolean): StageDefinition {
  const append =
    `node -e "require('fs').appendFileSync('runtime/gate-marker.log','x')` +
    `${passing ? '' : ';process.exit(3)'}"`

  return {
    slug: 'implement',
    title: 'Implementation',
    persona: 'coder',
    workspace_policy: 'source_allowed',
    gate: 'next_stage',
    context: { request: 'omit' },
    criteria: [
      {
        id: 'implement.marker',
        type: 'shell',
        hard: true,
        statement: 'Marker gate.',
        command: append,
      },
    ],
    transitions: { success: 'verify', failure: 'implement', blocked: 'paused' },
  }
}

function scratchRoot(): string {
  return createTestTempDirectory('pancreator-gate-cache-')
}

function markerCount(root: string): number {
  const markerPath = path.join(root, 'runtime', 'gate-marker.log')

  return existsSync(markerPath) ? readFileSync(markerPath, 'utf8').length : 0
}

test('a clean gate pass is cached and accepted at an unchanged fingerprint', () => {
  const root = createFixture()
  const { state, workspaceBefore, runDirectory } = fixtureState(root, 'run-a')
  const stage = markerStage(true)

  const first = evaluateDeterministicCriteria(
    root,
    runDirectory,
    state,
    stage,
    workspaceBefore,
    root,
  )
  const firstResult = first.results.find(
    (item) => item.id === 'implement.marker',
  )

  assert.ok(firstResult)
  assert.equal(firstResult.passed, true)
  assert.equal(firstResult.cached, undefined)
  assert.equal(markerCount(root), 1)

  const second = fixtureState(root, 'run-b')
  const evaluated = evaluateDeterministicCriteria(
    root,
    second.runDirectory,
    second.state,
    stage,
    second.workspaceBefore,
    root,
  )
  const cachedResult = evaluated.results.find(
    (item) => item.id === 'implement.marker',
  )

  assert.ok(cachedResult)
  assert.equal(cachedResult.passed, true)
  assert.equal(cachedResult.cached, true)
  assert.match(cachedResult.explanation ?? '', /cached clean pass/u)
  assert.equal(markerCount(root), 1)

  const evidence = readFileSync(
    path.join(root, cachedResult.evidence_path ?? ''),
    'utf8',
  )

  assert.match(evidence, /cached=true/u)
  assert.match(evidence, /source_run=run-a/u)

  writeFileSync(path.join(root, 'cache-buster.txt'), 'changed\n')

  const third = fixtureState(root, 'run-c')
  const rerun = evaluateDeterministicCriteria(
    root,
    third.runDirectory,
    third.state,
    stage,
    third.workspaceBefore,
    root,
  )
  const rerunResult = rerun.results.find(
    (item) => item.id === 'implement.marker',
  )

  assert.ok(rerunResult)
  assert.equal(rerunResult.cached, undefined)
  assert.equal(markerCount(root), 2)
})

test('a failing gate is never cached', () => {
  const root = createFixture()
  const stage = markerStage(false)

  for (const runId of ['run-a', 'run-b']) {
    const { state, workspaceBefore, runDirectory } = fixtureState(root, runId)
    const evaluated = evaluateDeterministicCriteria(
      root,
      runDirectory,
      state,
      stage,
      workspaceBefore,
      root,
    )
    const result = evaluated.results.find(
      (item) => item.id === 'implement.marker',
    )

    assert.ok(result)
    assert.equal(result.passed, false)
    assert.equal(result.cached, undefined)
  }

  // A failure must re-run to show its repair, so both submissions executed.
  assert.equal(markerCount(root), 2)
})

test('PAN_GATE_CACHE=0 disables lookup and store', () => {
  // The cache only needs a runtime/ directory, not a full fixture.
  const root = scratchRoot()

  mkdirSync(path.join(root, 'runtime'), { recursive: true })

  // Profile semantics change without a fingerprint change, so the key binds
  // the repository-check configuration bytes.
  const before = gateCacheKey(root, 'fingerprint', 'npm test')

  writeFileSync(
    path.join(root, 'runtime', 'repository-checks.json'),
    `${JSON.stringify({ schema_version: 1, profiles: {} }, null, 2)}\n`,
  )

  const key = gateCacheKey(root, 'fingerprint', 'npm test')

  assert.notEqual(key, before)

  const evidencePath = 'runtime/logs/workflows/run-a/evidence/x.log'

  mkdirSync(path.dirname(path.join(root, evidencePath)), { recursive: true })
  writeFileSync(path.join(root, evidencePath), '$ npm test\nexit_code=0\n')

  const entry = {
    key,
    criterion_id: 'implement.unit_tests',
    command: 'npm test',
    workspace_fingerprint: 'fingerprint',
    run_id: 'run-a',
    cached_at: new Date().toISOString(),
    evidence_path: evidencePath,
  }

  gateCacheStore(root, entry)
  assert.ok(gateCacheLookup(root, key))

  // An entry older than the acceptance window is not accepted.
  const expiredKey = gateCacheKey(root, 'fingerprint', 'npm run lint')

  gateCacheStore(root, {
    ...entry,
    key: expiredKey,
    command: 'npm run lint',
    cached_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
  })
  assert.equal(gateCacheLookup(root, expiredKey), null)

  process.env.PAN_GATE_CACHE = '0'

  try {
    assert.equal(gateCacheLookup(root, key), null)
  } finally {
    delete process.env.PAN_GATE_CACHE
  }
})

test('a non-git workspace is never cached: its fingerprint is a constant', () => {
  const root = createFixture()

  rmSync(path.join(root, '.git'), { recursive: true, force: true })

  const stage = markerStage(true)

  for (const runId of ['run-a', 'run-b']) {
    const { state, workspaceBefore, runDirectory } = fixtureState(root, runId)

    assert.equal(workspaceBefore.kind, 'filesystem')

    const evaluated = evaluateDeterministicCriteria(
      root,
      runDirectory,
      state,
      stage,
      workspaceBefore,
      root,
    )
    const result = evaluated.results.find(
      (item) => item.id === 'implement.marker',
    )

    assert.ok(result)
    assert.equal(result.passed, true)
    assert.equal(result.cached, undefined)
  }

  assert.equal(markerCount(root), 2)
  assert.equal(
    existsSync(path.join(root, 'runtime', 'cache', 'gate-results.json')),
    false,
  )
})

test('cached evidence carries the original output, and a gone source is a miss', () => {
  const root = createFixture()
  const stage = markerStage(true)
  const first = fixtureState(root, 'run-a')
  const firstResult = evaluateDeterministicCriteria(
    root,
    first.runDirectory,
    first.state,
    stage,
    first.workspaceBefore,
    root,
  ).results.find((item) => item.id === 'implement.marker')

  assert.ok(firstResult?.evidence_path)

  const sourceEvidence = readFileSync(
    path.join(root, firstResult.evidence_path),
    'utf8',
  )
  const second = fixtureState(root, 'run-b')
  const cachedResult = evaluateDeterministicCriteria(
    root,
    second.runDirectory,
    second.state,
    stage,
    second.workspaceBefore,
    root,
  ).results.find((item) => item.id === 'implement.marker')

  assert.ok(cachedResult?.evidence_path)
  assert.equal(cachedResult.cached, true)

  // The accepting run's log holds the bytes the pass rests on, not a pointer
  // into another run directory.
  const cachedEvidence = readFileSync(
    path.join(root, cachedResult.evidence_path),
    'utf8',
  )

  assert.match(cachedEvidence, /--- source evidence ---/u)
  assert.ok(cachedEvidence.includes(sourceEvidence))
  assert.equal(markerCount(root), 1)

  // The source run is gone, so the entry proves nothing and the gate runs
  // again.
  rmSync(path.join(root, 'runtime', 'logs', 'workflows', 'run-a'), {
    recursive: true,
    force: true,
  })

  const third = fixtureState(root, 'run-c')
  const rerun = evaluateDeterministicCriteria(
    root,
    third.runDirectory,
    third.state,
    stage,
    third.workspaceBefore,
    root,
  ).results.find((item) => item.id === 'implement.marker')

  assert.ok(rerun)
  assert.equal(rerun.cached, undefined)
  assert.equal(markerCount(root), 2)
})

/** A `full` profile whose one command writes the suite profile it is handed. */
function profiledFullProfileCommand(): string {
  const body =
    "const fs=require('fs');const target=process.env.PAN_TEST_PROFILE;" +
    "if(target){fs.mkdirSync(require('path').dirname(target),{recursive:true});" +
    'fs.writeFileSync(target,JSON.stringify({schema_version:1,lane:' +
    "'unit',recorded_at:'2026-09-12T00:00:00.000Z',test_count:1,pass_count:1," +
    'fail_count:0,wall_clock_ms:10,files:[],slowest_tests:[]}));}'

  return `node -e "${body}"`
}

test('both gate-cache writers build one entry shape, and a recorded agent pass carries its profile', () => {
  const root = createFixture()

  writeFileSync(
    path.join(root, 'runtime', 'repository-checks.json'),
    `${JSON.stringify(
      {
        schema_version: 1,
        profiles: {
          full: { probes: [], commands: [profiledFullProfileCommand()] },
        },
      },
      null,
      2,
    )}\n`,
  )

  // The gate writer: a profiled `full` gate that passes cleanly.
  const stage = markerStage(true)

  stage.criteria[0].command = 'pan repository-check full'

  const gateRun = fixtureState(root, 'run-gate')

  gateRun.state.repository_check_baselines = {}
  gateRun.state.verification = {
    level: 'standard',
    gates: {},
  } as unknown as RunState['verification']

  const gateResult = evaluateDeterministicCriteria(
    root,
    gateRun.runDirectory,
    gateRun.state,
    stage,
    gateRun.workspaceBefore,
    root,
  ).results.find((item) => item.id === 'implement.marker')

  assert.ok(gateResult)
  assert.equal(gateResult.passed, true)
  assert.ok(gateResult.suite_profile_path)

  const gateEntry = gateCacheLookup(
    root,
    gateCacheKey(
      root,
      gateRun.workspaceBefore.fingerprint,
      stage.criteria[0].command as string,
    ),
  )

  assert.ok(gateEntry)
  assert.equal(gateEntry.suite_profile_path, gateResult.suite_profile_path)

  // The command-line writer: the same profile run by an agent, profiled the
  // way `pan repository-check full --run <id>` profiles it.
  const agentRun = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const fingerprint = gitWorkspaceSnapshot(root).fingerprint
  const target = agentGatePassSuiteProfile(
    root,
    agentRun.run_id,
    'full',
    fingerprint,
  )

  assert.ok(target)

  const commandLine = runRepositoryCheck(root, 'full', {
    env: { [TEST_PROFILE_ENV]: target.absolute },
  })

  assert.equal(commandLine.status, 'passed')

  const recorded = recordProfileGatePass(root, 'full', commandLine, {
    run_ids: [agentRun.run_id],
    fingerprint_before: fingerprint,
    started_at: '2026-09-12T09:00:00.000Z',
  })

  assert.ok(recorded)

  const agentEntry = gateCacheLookup(root, recorded.cache_key)

  assert.ok(agentEntry)

  // A gate that accepts the recorded pass reports the same fields the gate
  // store would have written, including the profile the ship card compares.
  assert.deepEqual(
    Object.keys(agentEntry).sort(),
    Object.keys(gateEntry).sort(),
  )
  assert.equal(agentEntry.suite_profile_path, target.relative)
  assert.equal(existsSync(path.join(root, target.relative)), true)
})

test('a profile gate whose baseline cannot resolve is never served from the cache', () => {
  const root = createFixture()
  const append = `node -e "require('fs').appendFileSync('runtime/gate-marker.log','x')"`

  writeFileSync(
    path.join(root, 'runtime', 'repository-checks.json'),
    `${JSON.stringify(
      {
        schema_version: 1,
        profiles: { fast: { probes: [], commands: [append] } },
      },
      null,
      2,
    )}\n`,
  )

  const stage = markerStage(true)

  stage.criteria[0].command = 'pan repository-check fast'

  // Run A uses a level that does not baseline `fast`, so its clean pass is
  // cacheable.
  const first = fixtureState(root, 'run-a')

  first.state.repository_check_baselines = {}
  first.state.verification = {
    level: 'standard',
    gates: {},
  } as unknown as RunState['verification']

  const firstResult = evaluateDeterministicCriteria(
    root,
    first.runDirectory,
    first.state,
    stage,
    first.workspaceBefore,
    root,
  ).results.find((item) => item.id === 'implement.marker')

  assert.ok(firstResult)
  assert.equal(firstResult.passed, true)
  assert.equal(firstResult.cached, undefined)
  assert.equal(markerCount(root), 1)

  // Run B expects a `fast` baseline and has none, so the gate fails closed
  // even against a recorded pass.
  const second = fixtureState(root, 'run-b')

  second.state.repository_check_baselines = {}

  const gapResult = evaluateDeterministicCriteria(
    root,
    second.runDirectory,
    second.state,
    stage,
    second.workspaceBefore,
    root,
  ).results.find((item) => item.id === 'implement.marker')

  assert.ok(gapResult)
  assert.equal(gapResult.cached, undefined)
  assert.equal(gapResult.passed, false)
  assert.match(gapResult.explanation ?? '', /fails closed/u)
  assert.equal(markerCount(root), 2)

  // Run C matches run A, so the recorded pass is accepted.
  const third = fixtureState(root, 'run-c')

  third.state.repository_check_baselines = {}
  third.state.verification = first.state.verification

  const cachedResult = evaluateDeterministicCriteria(
    root,
    third.runDirectory,
    third.state,
    stage,
    third.workspaceBefore,
    root,
  ).results.find((item) => item.id === 'implement.marker')

  assert.ok(cachedResult)
  assert.equal(cachedResult.cached, true)
  assert.equal(markerCount(root), 2)
})
