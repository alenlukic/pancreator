import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  getRunState,
  prepareInvocation,
  setRunStage,
} from '../../src/lib/engine.js'
import { gateCacheKey, gateCacheLookup } from '../../src/lib/gate-cache.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import {
  recordProfileGatePass,
  runRepositoryCheck,
} from '../../src/lib/repository-checks.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createFixture, createRun, writeJson } from '../helpers.js'
import {
  checkpoint,
  checksVariant,
  fullFailsUntil,
  fullRuns,
  PASS,
  submitStageOutput,
} from './delivery-helpers.js'

const FULL_MARKER_COMMAND = `node -e "require('node:fs').appendFileSync('runtime/full-ran.txt','x'); process.exit(0)"`

// Counts its executions, and emits enough output that the baseline summary
// elides it and writes the untruncated companion artifact too.
const STATIC_MARKER_COMMAND =
  `node -e "require('node:fs').appendFileSync('runtime/static-ran.txt','x'); ` +
  `process.stdout.write('baseline output '.repeat(8192)); process.exit(0)"`

function staticRuns(root: string): number {
  const marker = path.join(root, 'runtime', 'static-ran.txt')

  return existsSync(marker) ? readFileSync(marker, 'utf8').length : 0
}

function baselineCheckProfiles(root: string): void {
  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: [STATIC_MARKER_COMMAND] },
      fast: { probes: [], commands: [PASS] },
      full: { probes: [], commands: [FULL_MARKER_COMMAND] },
      configuration: { probes: [], commands: [PASS] },
    },
  })
}

function startedRun(root: string, title: string): string {
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title,
  })

  setRunStage(root, state.run_id, 'implement', 'Baseline the implement loop.')
  prepareInvocation(root, state.run_id)

  return state.run_id
}

test('a second run adopts the recorded baseline for an unchanged workspace', () => {
  // The baseline answers "what already failed in this tree under this
  // verification configuration". Two runs against one unchanged tree ask the
  // identical question, and the second one waited minutes for an answer the
  // first had already written down.
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')

  baselineCheckProfiles(root)

  const firstRun = startedRun(root, 'Baseline author')

  assert.equal(staticRuns(root), 1)

  const firstBaseline = getRunState(root, firstRun).repository_check_baselines
    ?.static

  assert.ok(firstBaseline)

  const artifact = JSON.parse(
    readFileSync(path.join(root, firstBaseline.artifact_path), 'utf8'),
  ) as Record<string, unknown>

  // The digest is what makes the artifact re-usable: a fingerprint alone
  // cannot tell that the commands themselves changed.
  assert.match(String(artifact.checks_config_sha256), /^[0-9a-f]{64}$/u)

  const full = JSON.parse(
    readFileSync(path.join(root, String(artifact.full_result_path)), 'utf8'),
  ) as Record<string, unknown>

  assert.equal(full.checks_config_sha256, artifact.checks_config_sha256)

  const messages: string[] = []
  const secondState = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Baseline adopter',
  })

  setRunStage(root, secondState.run_id, 'implement', 'Adopt the baseline.')
  prepareInvocation(root, secondState.run_id, {
    onProgress: (message) => messages.push(message),
  })

  const adopted = getRunState(root, secondState.run_id)
    .repository_check_baselines?.static

  assert.ok(adopted)
  assert.equal(adopted.artifact_path, firstBaseline.artifact_path)
  assert.equal(adopted.status, 'passed')
  assert.equal(staticRuns(root), 1)
  assert.ok(
    messages.some((message) =>
      message.includes(`adopted the recorded pre-implementation 'static'`),
    ),
    `progress output did not name the adopted artifact: ${messages.join(' | ')}`,
  )

  // A changed tree is a different question, so the next run pays for it.
  writeFileSync(path.join(root, 'src/base.ts'), 'export const base = 2\n')

  const thirdRun = startedRun(root, 'Baseline after an edit')

  assert.equal(staticRuns(root), 2)
  assert.notEqual(
    getRunState(root, thirdRun).repository_check_baselines?.static
      ?.artifact_path,
    firstBaseline.artifact_path,
  )

  assert.ok(workflow)
})

test('the ship entry gate accepts a clean profile pass an agent already paid for', () => {
  // The agent runs the profile from the command line, and minutes later the
  // gate runs the identical command against the identical tree. Recording the
  // agent's pass is what collapses the second run into a lookup.
  const { root, runId, workflow } = checkpoint(
    'delivery@verify-prepared',
    checksVariant('checks=full-marker-adopted', {
      static: { probes: [], commands: [PASS] },
      fast: { probes: [], commands: [PASS] },
      full: { probes: [], commands: [FULL_MARKER_COMMAND] },
      configuration: { probes: [], commands: [PASS] },
    }),
  )

  submitStageOutput(root, runId, stageBySlug(workflow, 'verify'), 'success')
  assert.equal(fullRuns(root), 0)

  // Stand in for the command-line runner: run the profile and record the
  // clean pass exactly as `pan repository-check full --run <id>` does.
  const fingerprint = gitWorkspaceSnapshot(root).fingerprint
  const recorded = recordProfileGatePass(
    root,
    'full',
    runRepositoryCheck(root, 'full'),
    {
      run_ids: [runId],
      fingerprint_before: fingerprint,
      started_at: new Date().toISOString(),
    },
  )

  assert.ok(recorded)
  assert.equal(fullRuns(root), 1)

  const prepared = prepareInvocation(root, runId)
  const gate = prepared.state.entry_gates?.ship

  assert.ok(prepared.invocation)
  assert.ok(gate)
  assert.equal(gate.criterion_id, 'ship.full_suite')
  assert.equal(gate.last_result.passed, true)
  assert.equal(gate.last_result.cached, true)
  // The gate did not execute the profile: the marker still counts one run.
  assert.equal(fullRuns(root), 1)
  assert.ok(existsSync(path.join(root, gate.last_result.evidence_path ?? '')))
})

/** The repository-check profiles every prefetch case runs against. */
const PREFETCH_PROFILES = {
  static: { probes: [], commands: [PASS] },
  fast: { probes: [], commands: [PASS] },
  full: { probes: [], commands: [FULL_MARKER_COMMAND] },
  configuration: { probes: [], commands: [PASS] },
}

/**
 * Run `body` with the named variables set, restoring the previous values
 * afterwards. A null value unsets the variable. `bin/run-tests` switches the
 * prefetch off for the whole suite so profile-execution counts stay
 * deterministic, so every prefetch case states the switch it wants instead of
 * inheriting one.
 */
function withEnv<T>(
  variables: Record<string, string | null>,
  body: () => T,
): T {
  const previous = Object.keys(variables).map(
    (name) => [name, process.env[name]] as const,
  )

  for (const [name, value] of Object.entries(variables)) {
    if (value === null) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }

  try {
    return body()
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
  }
}

/** The record a started prefetch wrote, or null when none started. */
function prefetchRecord(
  root: string,
  runId: string,
): Record<string, unknown> | null {
  const recordPath = resolveRunLayout(root, runId).evidence(
    'prefetch-full.json',
  ).absolute

  return existsSync(recordPath)
    ? (JSON.parse(readFileSync(recordPath, 'utf8')) as Record<string, unknown>)
    : null
}

/**
 * End a detached prefetch child. The fixture root is scratch space that
 * `bin/run-tests` removes when the run ends, so a child left running keeps a
 * profile executing against a tree that is being deleted underneath it.
 */
function endPrefetchChild(record: Record<string, unknown> | null): void {
  const pid = record?.pid

  if (typeof pid !== 'number') {
    return
  }

  try {
    // The child leads its own process group, so the negated pid reaches the
    // profile commands it spawned as well as the child itself.
    process.kill(-pid, 'SIGKILL')
  } catch {
    // Already gone: the profile finished before this test did.
  }
}

test('a passing source stage starts one release-profile prefetch for the evidence stage', () => {
  // The ship entry gate is the longest wait on the critical path, and its
  // answer is knowable the moment implementation submits. The run spends the
  // verify stage computing it instead of the operator waiting for it later.
  const { root, runId, workflow } = checkpoint(
    'delivery@implement-prepared',
    checksVariant('checks=prefetch', PREFETCH_PROFILES),
  )
  const submitted = withEnv({ PAN_PREFETCH_FULL: null }, () =>
    submitStageOutput(
      root,
      runId,
      stageBySlug(workflow, 'implement'),
      'success',
    ),
  )
  const record = prefetchRecord(root, runId)

  try {
    assert.equal(submitted.state.current_stage, 'verify')
    assert.ok(record)
    assert.equal(record.profile, 'full')
    assert.equal(record.run_id, runId)
    assert.equal(typeof record.pid, 'number')
    assert.match(String(record.workspace_fingerprint), /^[0-9a-f]{64}$/u)
    // Without a start time the record cannot be matched to the submission
    // that began it, and a stalled child is indistinguishable from a fresh
    // one when the operator reads the evidence directory.
    assert.match(
      String(record.started_at),
      /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/u,
      'the prefetch record carries no start time',
    )

    // The gate the prefetch answers for is the one the run reaches next.
    assert.equal(
      gateCacheLookup(
        root,
        gateCacheKey(
          root,
          String(record.workspace_fingerprint),
          'pan repository-check full',
        ),
      ),
      null,
      'the parent waited for the prefetch instead of detaching it',
    )
  } finally {
    endPrefetchChild(record)
  }
})

test('the prefetch stays unstarted when the operator switches it off', () => {
  const { root, runId, workflow } = checkpoint(
    'delivery@implement-prepared',
    checksVariant('checks=prefetch-off', PREFETCH_PROFILES),
  )

  // The switch is off, which is how the suite runs and how an operator opts
  // out of spending background capacity.
  withEnv({ PAN_PREFETCH_FULL: '0' }, () =>
    submitStageOutput(
      root,
      runId,
      stageBySlug(workflow, 'implement'),
      'success',
    ),
  )

  assert.equal(prefetchRecord(root, runId), null)
  assert.equal(fullRuns(root), 0)
})

test('a failed submission starts no prefetch', () => {
  // The prefetch answers for the tree the stage just handed over. A stage
  // that failed hands over nothing: the run returns to the same source stage
  // and the workspace changes again before any gate reads it.
  const { root, runId, workflow } = checkpoint(
    'delivery@implement-prepared',
    checksVariant('checks=prefetch', PREFETCH_PROFILES),
  )
  const submitted = withEnv({ PAN_PREFETCH_FULL: null }, () =>
    submitStageOutput(
      root,
      runId,
      stageBySlug(workflow, 'implement'),
      'failure',
      ['implement.acceptance_claimed'],
    ),
  )

  assert.equal(submitted.record.outcome, 'failure')
  assert.equal(submitted.state.current_stage, 'implement')
  assert.equal(prefetchRecord(root, runId), null)
  assert.equal(fullRuns(root), 0)
})

test('a remediation returning to ship starts no prefetch', () => {
  // Ship is not a read-only evidence stage. Its entry gate runs the profile
  // the moment the run arrives, so a background child would race the gate it
  // exists to spare rather than answer it.
  const { root, runId, workflow } = checkpoint(
    'delivery@verify-prepared',
    checksVariant('checks=full-fails-once', {
      static: { probes: [], commands: [PASS] },
      fast: { probes: [], commands: [PASS] },
      full: { probes: [], commands: [fullFailsUntil(1)] },
      configuration: { probes: [], commands: [PASS] },
    }),
  )

  submitStageOutput(root, runId, stageBySlug(workflow, 'verify'), 'success')

  // The release gate fails once and routes the run back to remediate.
  const routed = prepareInvocation(root, runId)

  assert.equal(routed.invocation, null)
  assert.equal(routed.state.current_stage, 'remediate')

  const executions = fullRuns(root)
  const remediated = withEnv({ PAN_PREFETCH_FULL: null }, () =>
    submitStageOutput(
      root,
      runId,
      stageBySlug(workflow, 'remediate'),
      'success',
    ),
  )

  assert.equal(remediated.state.current_stage, 'ship')
  assert.equal(prefetchRecord(root, runId), null)
  assert.equal(fullRuns(root), executions)
})

test('a level with no release gate starts no prefetch', () => {
  // Minimal disables the ship release gate, so no gate result exists to
  // compute ahead of time and the child would spend the machine on nothing.
  const { root, runId, workflow } = checkpoint(
    'delivery@implement-prepared',
    checksVariant('verification=minimal,checks=prefetch', PREFETCH_PROFILES, {
      verification: 'minimal',
    }),
  )
  const submitted = withEnv({ PAN_PREFETCH_FULL: null }, () =>
    submitStageOutput(
      root,
      runId,
      stageBySlug(workflow, 'implement'),
      'success',
    ),
  )

  assert.equal(submitted.state.verification?.level, 'minimal')
  assert.equal(submitted.state.current_stage, 'verify')
  assert.equal(prefetchRecord(root, runId), null)
  assert.equal(fullRuns(root), 0)
})

test('a disabled gate cache starts no prefetch', () => {
  // The gate cache is the only channel the child has to hand its answer to
  // the gate. With the cache off the gate executes the profile itself, so
  // the child is duplicated work against the same machine.
  const { root, runId, workflow } = checkpoint(
    'delivery@implement-prepared',
    checksVariant('checks=prefetch', PREFETCH_PROFILES),
  )
  const submitted = withEnv(
    { PAN_PREFETCH_FULL: null, PAN_GATE_CACHE: '0' },
    () =>
      submitStageOutput(
        root,
        runId,
        stageBySlug(workflow, 'implement'),
        'success',
      ),
  )

  assert.equal(submitted.state.current_stage, 'verify')
  assert.equal(prefetchRecord(root, runId), null)
  assert.equal(fullRuns(root), 0)
})

test('a prefetch answer that never lands leaves the ship entry gate to run the profile', () => {
  // C-03: the prefetch is an optimisation, so a child that was killed, that
  // failed, or whose evidence was archived away must leave the gate reaching
  // its own verdict on its own evidence. This is the mirror of the cached
  // case above: the same setup, minus a usable answer.
  const { root, runId, workflow } = checkpoint(
    'delivery@verify-prepared',
    checksVariant('checks=full-marker-adopted', PREFETCH_PROFILES),
  )
  const fingerprint = gitWorkspaceSnapshot(root).fingerprint
  const cacheKey = gateCacheKey(root, fingerprint, 'pan repository-check full')

  submitStageOutput(root, runId, stageBySlug(workflow, 'verify'), 'success')

  // A child started, so its record sits in the run's evidence directory.
  writeJson(
    resolveRunLayout(root, runId).evidence('prefetch-full.json').absolute,
    {
      schema_version: 1,
      run_id: runId,
      profile: 'full',
      pid: 999_999,
      workspace_fingerprint: fingerprint,
      started_at: new Date().toISOString(),
    },
  )

  // It even recorded its pass, and then the evidence that pass cites was
  // archived out from under it. A cache entry whose log is gone is a miss.
  const recorded = recordProfileGatePass(
    root,
    'full',
    runRepositoryCheck(root, 'full'),
    {
      run_ids: [runId],
      fingerprint_before: fingerprint,
      started_at: new Date().toISOString(),
    },
  )

  assert.ok(recorded)
  rmSync(path.join(root, recorded.evidence_path), { force: true })
  assert.equal(gateCacheLookup(root, cacheKey), null)

  const executions = fullRuns(root)
  const prepared = prepareInvocation(root, runId)
  const gate = prepared.state.entry_gates?.ship

  assert.ok(prepared.invocation)
  assert.ok(gate)
  // The gate did its own work rather than trusting the record beside it.
  assert.equal(fullRuns(root), executions + 1)
  assert.equal(gate.last_result.cached, undefined)
  assert.equal(gate.last_result.passed, true)
  assert.equal(gate.last_result.command, 'pan repository-check full')
  assert.ok(existsSync(path.join(root, gate.last_result.evidence_path ?? '')))
})

