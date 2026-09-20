import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import {
  abortRun,
  getRunState,
  prepareInvocation,
  releaseProfilePrefetches,
  setRunStage,
} from '../../src/lib/engine.js'
import { gateCacheKey, gateCacheLookup } from '../../src/lib/gate-cache.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import {
  recordProfileGatePass,
  runRepositoryCheck,
} from '../../src/lib/repository-checks.js'
import {
  prefetchRecordPath,
  resolveRunLayout,
} from '../../src/lib/run-layout.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import {
  attachTargetInstructionEvidence,
  createFixture,
  writeJson,
} from '../helpers.js'
import { createRun } from '../run-helpers.js'
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
  const rebaselined = getRunState(root, thirdRun).repository_check_baselines

  assert.equal(staticRuns(root), 2)
  assert.notEqual(
    rebaselined?.static?.artifact_path,
    firstBaseline.artifact_path,
  )
  // Paying again buys the same set of interior gate profiles. A closing
  // `assert.ok` on the workflow this test loaded and never used could not
  // fail, so nothing held the re-baseline to the shape of the first one.
  assert.deepEqual(
    Object.keys(rebaselined ?? {}).sort(),
    Object.keys(
      getRunState(root, firstRun).repository_check_baselines ?? {},
    ).sort(),
  )
})

test('the ship entry gate rejects an agent-recorded full pass and executes', () => {
  // A worker-run full profile cannot take over the harness-owned ship gate.
  // The cache keeps the record for audit, but the gate must compute its own
  // result and record why the worker pass was ineligible.
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
  assert.equal(gate.last_result.cached, undefined)
  assert.equal(fullRuns(root), 2)
  assert.ok(existsSync(path.join(root, gate.last_result.evidence_path ?? '')))
  assert.match(
    readFileSync(path.join(root, gate.last_result.evidence_path ?? ''), 'utf8'),
    /cache_rejection=.*agent-run full.*ship release gate.*VERIFY-001/u,
  )
})

/** The repository-check profiles every prefetch case runs against. */
const PREFETCH_PROFILES = {
  static: { probes: [], commands: [PASS] },
  fast: { probes: [], commands: [PASS] },
  full: { probes: [], commands: [FULL_MARKER_COMMAND] },
  configuration: { probes: [], commands: [PASS] },
}

/**
 * Profiles whose release run outlives the case that starts it, so a child is
 * observably alive and records no pass while the case runs.
 */
const SLOW_PREFETCH_PROFILES = {
  ...PREFETCH_PROFILES,
  full: { probes: [], commands: ['node -e "setTimeout(() => {}, 60000)"'] },
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
function endPrefetchChild(record: { pid?: unknown } | null): void {
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

/** Prefetch pids still alive, once every signalled child has exited. */
async function settledPrefetchPids(
  root: string,
  runId: string,
): Promise<number[]> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const alive = releaseProfilePrefetches(root, runId)
      .filter((record) => record.running)
      .map((record) => record.pid)

    if (alive.length === 0) {
      return alive
    }

    await delay(20)
  }

  return releaseProfilePrefetches(root, runId)
    .filter((record) => record.running)
    .map((record) => record.pid)
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

// The marker was keyed to the run and the profile alone, so a second
// qualifying submission overwrote the first record. The pid of a child that
// was still running was then lost, and nothing could stop or account for it.
test('two qualifying submissions for one run and profile write two records', () => {
  // The profile runs long enough that neither child records its pass while
  // the case runs. A recorded pass would legitimately suppress the second
  // launch, which is a different behavior from the one under test.
  const { root, runId, workflow } = checkpoint(
    'delivery@implement-prepared',
    checksVariant('checks=prefetch-slow', SLOW_PREFETCH_PROFILES),
  )
  const submit = () =>
    withEnv({ PAN_PREFETCH_FULL: null }, () =>
      submitStageOutput(
        root,
        runId,
        stageBySlug(workflow, 'implement'),
        'success',
        [],
        (output) => {
          attachTargetInstructionEvidence(root, output, ['AGENTS.md'])
        },
      ),
    )

  assert.equal(submit().state.current_stage, 'verify')
  setRunStage(root, runId, 'implement', 'Return for a second attempt.', {
    abandonWorkers: true,
  })
  // The repaired tree is a different workspace, so the second submission
  // asks a question the first answer does not cover.
  writeFileSync(
    path.join(root, 'src', 'second-attempt.ts'),
    'export const x = 1\n',
  )
  assert.equal(submit().state.current_stage, 'verify')

  const records = releaseProfilePrefetches(root, runId)

  try {
    assert.equal(records.length, 2, 'each launch owns a record')
    assert.equal(
      new Set(records.map((record) => record.evidence_path)).size,
      2,
      'the two records have distinct names',
    )
    assert.equal(
      new Set(records.map((record) => record.pid)).size,
      2,
      'each record names its own child',
    )

    // A pid that no longer names a process is a child that finished, failed,
    // or was killed. All three are finished as far as the run is concerned.
    writeJson(prefetchRecordPath(root, runId, 'full', 3).absolute, {
      schema_version: 1,
      run_id: runId,
      profile: 'full',
      pid: 999_999,
      workspace_fingerprint: gitWorkspaceSnapshot(root).fingerprint,
      started_at: new Date().toISOString(),
    })

    const dead = releaseProfilePrefetches(root, runId).find(
      (record) => record.pid === 999_999,
    )

    assert.ok(dead)
    assert.equal(dead.running, false)
  } finally {
    for (const record of records) {
      endPrefetchChild({ pid: record.pid })
    }
  }
})

// Nothing joins a prefetch, so a run that ended while one was alive left a
// profile executing against a tree nobody was watching, for a gate that would
// never run.
test('a run reaching its terminal state leaves no prefetch child running', async () => {
  // A child that already exited proves nothing about the stop, so the
  // profile this case prefetches outlives the case itself.
  const { root, runId, workflow } = checkpoint(
    'delivery@implement-prepared',
    checksVariant('checks=prefetch-slow', SLOW_PREFETCH_PROFILES),
  )

  withEnv({ PAN_PREFETCH_FULL: null }, () =>
    submitStageOutput(
      root,
      runId,
      stageBySlug(workflow, 'implement'),
      'success',
    ),
  )

  const started = releaseProfilePrefetches(root, runId)

  try {
    assert.deepEqual(
      started.map((record) => record.running),
      [true],
      'the child is alive before the run ends',
    )

    abortRun(root, runId, 'Abandoned mid-verify.')

    // The signal is delivered synchronously; the exit that follows it is not,
    // so the assertion waits for the process table rather than for a tick.
    assert.deepEqual(
      await settledPrefetchPids(root, runId),
      [],
      'no prefetch child of the run survives the terminal transition',
    )
  } finally {
    for (const record of started) {
      endPrefetchChild(record)
    }
  }
})

test('a routed remediation prefetches for the verify it returns through', () => {
  // A direct return to ship left no window to compute the profile in: the
  // entry gate runs it the moment the run arrives. The repair now returns
  // through verify, and that window answers the gate for the repaired tree.
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

  const remediated = withEnv({ PAN_PREFETCH_FULL: null }, () =>
    submitStageOutput(
      root,
      runId,
      stageBySlug(workflow, 'remediate'),
      'success',
    ),
  )
  const record = prefetchRecord(root, runId)

  try {
    assert.equal(remediated.state.current_stage, 'verify')
    assert.ok(record)
    assert.equal(record.profile, 'full')
    // The answer has to be for the repaired tree; the pre-repair one is the
    // tree the gate already rejected.
    assert.equal(
      record.workspace_fingerprint,
      remediated.record.workspace_fingerprint,
    )
  } finally {
    endPrefetchChild(record)
  }
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
