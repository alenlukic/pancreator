import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createFixture } from '../helpers.js'
import { evaluateDeterministicCriteria } from '../../src/lib/validation.js'
import {
  gateCacheKey,
  gateCacheLookup,
  gateCacheStore,
} from '../../src/lib/gate-cache.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import type { RunState, StageDefinition } from '../../src/lib/types.js'

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
 * A gate stage whose command appends one byte to `runtime/gate-marker.log`.
 * The marker sits under `runtime/`, which is outside the workspace
 * fingerprint, so executions are countable without changing the fingerprint.
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
  return mkdtempSync(path.join(tmpdir(), 'pancreator-gate-cache-'))
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

  // Same command, unchanged workspace: the recorded pass is accepted and the
  // command does not execute again — even from a different run.
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

  // The cached acceptance writes its own evidence log with provenance.
  const evidence = readFileSync(
    path.join(root, cachedResult.evidence_path ?? ''),
    'utf8',
  )

  assert.match(evidence, /cached=true/u)
  assert.match(evidence, /source_run=run-a/u)

  // A workspace change invalidates the fingerprint and the command runs.
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

  // Both submissions executed: a failure must re-run to observe its repair.
  assert.equal(markerCount(root), 2)
})

test('PAN_GATE_CACHE=0 disables lookup and store', () => {
  // The cache only needs a runtime/ directory, not a full fixture.
  const root = scratchRoot()

  mkdirSync(path.join(root, 'runtime'), { recursive: true })

  // The key binds the repository-check configuration bytes: profile semantics
  // can change without a workspace fingerprint change, so the key must change
  // with the configuration bytes.
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
  // Without git, every state of the tree fingerprints identically, so a
  // recorded pass would be accepted for a workspace that has since changed.
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

  // A verifier holding the accepting run's log holds the bytes the pass rests
  // on, not a pointer into another run directory.
  const cachedEvidence = readFileSync(
    path.join(root, cachedResult.evidence_path),
    'utf8',
  )

  assert.match(cachedEvidence, /--- source evidence ---/u)
  assert.ok(cachedEvidence.includes(sourceEvidence))
  assert.equal(markerCount(root), 1)

  // Archival or pruning removes the source run: the entry no longer proves
  // anything the harness can show, so the gate executes again.
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

  // Run A baselined under a verification level that does not baseline `fast`,
  // so the gate is judged on its own result: a clean pass, and cacheable.
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

  // Run B expects a `fast` baseline and has none. The uncached path fails
  // that gate closed; a recorded pass must not step around that rule.
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

  // Run C matches run A: the recorded pass is accepted, and the entry carried
  // the repository result a baseline comparison would need.
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
