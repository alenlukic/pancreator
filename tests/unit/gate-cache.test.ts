import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
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

test('the cache key binds the repository-check configuration bytes', () => {
  const root = createFixture()
  const before = gateCacheKey(root, 'fingerprint', 'npm test')

  writeFileSync(
    path.join(root, 'runtime', 'repository-checks.json'),
    `${JSON.stringify({ schema_version: 1, profiles: {} }, null, 2)}\n`,
  )

  // Profile semantics changed without a workspace fingerprint change, so the
  // key must change with the configuration bytes.
  assert.notEqual(gateCacheKey(root, 'fingerprint', 'npm test'), before)
})

test('PAN_GATE_CACHE=0 disables lookup and store', () => {
  const root = createFixture()
  const key = gateCacheKey(root, 'fingerprint', 'npm test')
  const entry = {
    key,
    criterion_id: 'implement.unit_tests',
    command: 'npm test',
    workspace_fingerprint: 'fingerprint',
    run_id: 'run-a',
    cached_at: new Date().toISOString(),
    evidence_path: 'runtime/logs/workflows/run-a/evidence/x.log',
  }

  gateCacheStore(root, entry)
  assert.ok(gateCacheLookup(root, key))

  process.env.PAN_GATE_CACHE = '0'

  try {
    assert.equal(gateCacheLookup(root, key), null)
  } finally {
    delete process.env.PAN_GATE_CACHE
  }
})

test('an expired cache entry is not accepted', () => {
  const root = createFixture()
  const key = gateCacheKey(root, 'fingerprint', 'npm test')

  gateCacheStore(root, {
    key,
    criterion_id: 'implement.unit_tests',
    command: 'npm test',
    workspace_fingerprint: 'fingerprint',
    run_id: 'run-a',
    cached_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    evidence_path: 'runtime/logs/workflows/run-a/evidence/x.log',
  })

  assert.equal(gateCacheLookup(root, key), null)
})
