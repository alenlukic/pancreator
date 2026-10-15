import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import {
  claimCohortBaselineCapture,
  recordCohortBaselines,
  releaseCohortBaselineClaim,
} from '../../src/lib/cohorts/baselines.js'
import {
  cohortMutexPath,
  loadCohortState,
  persistCohortState,
  withCohortSession,
} from '../../src/lib/cohorts/state.js'
import { initCohortSession, startCohort } from '../../src/lib/cohorts.js'
import { ensureWorkflowRepositoryCheckBaselines } from '../../src/lib/engine/baselines.js'
import { PanError } from '../../src/lib/errors.js'
import { repositoryChecksConfigDigest } from '../../src/lib/gate-cache.js'
import { loadState, operationMutexPath } from '../../src/lib/state.js'
import { isRecord, withOperationMutex } from '../../src/lib/io.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import type { RepositoryCheckBaselinePointer } from '../../src/lib/types.js'
import { attestRunCard, createFixture, writeJson } from '../helpers.js'
import { ratifiedPlanRun } from './cohort-helpers.js'
import { checkpoint } from './delivery-helpers.js'
import { COHORT_ID } from './cohorts-helpers.js'

const BASELINES_URL = new URL(
  '../../src/lib/cohorts/baselines.js',
  import.meta.url,
).href
const STATE_URL = new URL('../../src/lib/cohorts/state.js', import.meta.url)
  .href
const PREPARE_URL = new URL('../../src/lib/engine/prepare.js', import.meta.url)
  .href
const IO_URL = new URL('../../src/lib/io.js', import.meta.url).href

interface WorkerResult {
  code: number | string | null
  output: string
}

function launch(t: TestContext, root: string, body: string) {
  const source = `
    import { existsSync, writeFileSync } from 'node:fs'
    import { claimCohortBaselineCapture, recordCohortBaselines, releaseCohortBaselineClaim } from ${JSON.stringify(BASELINES_URL)}
    import { withCohortSession, cohortMutexPath } from ${JSON.stringify(STATE_URL)}
    import { prepareInvocation } from ${JSON.stringify(PREPARE_URL)}
    import { withOperationMutex } from ${JSON.stringify(IO_URL)}
    const root = ${JSON.stringify(root)}
    const wait = (file) => {
      const deadline = Date.now() + 30_000
      while (!existsSync(file)) {
        if (Date.now() > deadline) { throw new Error('Barrier expired: ' + file) }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
      }
    }
    ${body}
  `
  let child: ReturnType<typeof execFile>
  let result: WorkerResult | undefined
  const done = new Promise<WorkerResult>((resolve) => {
    child = execFile(
      process.execPath,
      ['--input-type=module', '--eval', source],
      {
        cwd: root,
        timeout: 45_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, PAN_PREFETCH_FULL: '0' },
      },
      (error, stdout, stderr) => {
        result = {
          code: error ? (error.code ?? error.message) : 0,
          output: stdout + stderr,
        }
        resolve(result)
      },
    )
  })

  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
    }

    await done
  })

  return {
    done,
    get result() {
      return result
    },
  }
}

async function waitFor(
  file: string,
  workers: ReturnType<typeof launch>[] = [],
): Promise<void> {
  const deadline = Date.now() + 30_000

  while (!existsSync(file)) {
    for (const worker of workers) {
      if (worker.result) {
        assert.equal(worker.result.code, 0, worker.result.output)
      }
    }
    assert.ok(Date.now() < deadline, `Barrier was not reached: ${file}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function session(root: string): void {
  persistCohortState(root, {
    schema_version: 1,
    cohort_id: COHORT_ID,
    plan_run_id: 'plan',
    parent_spec_path: 'runtime/specs/parent-specification.md',
    base_branch: 'main',
    created_at: '2026-10-15T00:00:00.000Z',
    updated_at: '2026-10-15T00:00:00.000Z',
    chunks: [],
    edges: [],
    cohorts: [],
    satisfaction: [],
  })
}

test('three concurrent sibling prepares join one complete baseline collection', async (t) => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'beta', cohort_index: 1 },
    { id: 'gamma', cohort_index: 1 },
  ])
  const cohort = initCohortSession(root, { planRunId })
  const started = startCohort(root, cohort.cohort_id)
  const profiles = ['configuration', 'fast', 'impacted-integration', 'static']
  const script = path.join(root, 'baseline-command.cjs')
  const release = path.join(root, 'capture-release')

  writeFileSync(
    script,
    `
    const fs = require('node:fs')
    const profile = process.argv[2]
    fs.appendFileSync(${JSON.stringify(path.join(root, 'executions'))}, profile + '\\n')
    fs.writeFileSync(${JSON.stringify(path.join(root, 'capturing'))}, '')
    const deadline = Date.now() + 30_000
    while (!fs.existsSync(${JSON.stringify(release)})) {
      if (Date.now() > deadline) { throw new Error('Capture barrier expired') }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
    }
    if (profile === 'fast') { console.error('inherited diagnostic'); process.exit(1) }
  `,
  )
  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: Object.fromEntries(
      profiles.map((profile) => [
        profile,
        { probes: [], commands: [`node ${JSON.stringify(script)} ${profile}`] },
      ]),
    ),
  })

  for (const chunk of started.chunks) {
    attestRunCard(root, chunk.run_id)
  }

  t.after(async () => {
    writeFileSync(release, '')
    await Promise.all(workers.map((worker) => worker.done))
  })

  const workers = started.chunks.map((chunk) =>
    launch(
      t,
      root,
      `
    const runId = ${JSON.stringify(chunk.run_id)}
    const result = prepareInvocation(root, runId, {
      onProgress: (message) => {
        if (message.includes('joining the shared')) {
          writeFileSync(root + '/joined-' + runId, '')
          wait(root + '/capture-release')
        }
      },
    })
    if (!result.invocation || result.invocation.stage.slug !== 'implement') {
      throw new Error('Preparation did not produce an implementation invocation')
    }
    writeFileSync(root + '/prepared-' + runId, result.invocation.invocation_id)
  `,
    ),
  )

  await waitFor(path.join(root, 'capturing'), workers)

  const holder = loadCohortState(
    root,
    cohort.cohort_id,
  ).repository_check_baseline_capture

  assert.ok(holder)

  for (const chunk of started.chunks.filter(
    (chunk) => chunk.run_id !== holder.run_id,
  )) {
    await waitFor(path.join(root, `joined-${chunk.run_id}`), workers)
  }

  withCohortSession(root, cohort.cohort_id, (state) => {
    assert.equal(state.repository_check_baselines, undefined)
  })
  assert.throws(
    () => withOperationMutex(operationMutexPath(root, holder.run_id), () => {}),
    (error: unknown) =>
      error instanceof PanError && error.code === 'RUN_OPERATION_IN_PROGRESS',
  )
  writeFileSync(release, '')

  for (const worker of workers) {
    const result = await worker.done

    assert.equal(result.code, 0, result.output)
  }

  assert.deepEqual(
    readFileSync(path.join(root, 'executions'), 'utf8')
      .trim()
      .split('\n')
      .sort(),
    profiles,
  )

  const recorded = loadCohortState(root, cohort.cohort_id)
  const pointers = recorded.repository_check_baselines

  assert.ok(pointers)
  assert.equal(recorded.repository_check_baseline_capture, undefined)
  assert.deepEqual(Object.keys(pointers).sort(), profiles)

  for (const chunk of started.chunks) {
    const run = loadState(root, chunk.run_id)

    assert.ok(run.current_invocation)
    assert.ok(existsSync(path.join(root, `prepared-${chunk.run_id}`)))

    for (const profile of profiles) {
      const pointer = run.repository_check_baselines?.[profile]
      const shared: RepositoryCheckBaselinePointer | undefined =
        pointers[profile]

      assert.ok(pointer && shared)
      assert.equal(shared.captured_by_run_id, holder.run_id)
      assert.equal(pointer.artifact_path, shared.artifact_path)
      assert.equal(pointer.workspace_fingerprint, shared.workspace_fingerprint)
      assert.equal(pointer.recorded_at, shared.recorded_at)
      if (chunk.run_id !== holder.run_id) {
        assert.equal(pointer.captured_by_run_id, holder.run_id)
        assert.equal(pointer.shared_from_cohort, cohort.cohort_id)
      }
      assert.equal(
        pointer.capture_workspace_path,
        loadState(root, holder.run_id).workspace_root,
      )

      const artifact: unknown = JSON.parse(
        readFileSync(path.join(root, pointer.artifact_path), 'utf8'),
      )

      assert.ok(isRecord(artifact))
      assert.equal(artifact.run_id, holder.run_id)
      assert.equal(
        artifact.workspace_fingerprint,
        pointer.workspace_fingerprint,
      )
      assert.equal(
        artifact.checks_config_sha256,
        repositoryChecksConfigDigest(root),
      )
      assert.equal(
        artifact.capture_workspace_path,
        pointer.capture_workspace_path,
      )
    }

    assert.equal(run.repository_check_baselines?.fast?.status, 'failed')
  }
})

test('another process cannot reclaim, publish, or release a live claim with the same run id', async (t) => {
  const root = createFixture()

  session(root)
  const owner = launch(
    t,
    root,
    `
    claimCohortBaselineCapture(root, ${JSON.stringify(COHORT_ID)}, 'same-run')
    writeFileSync(root + '/owner-ready', '')
    wait(root + '/owner-end')
  `,
  )

  await waitFor(path.join(root, 'owner-ready'), [owner])
  const claim = loadCohortState(
    root,
    COHORT_ID,
  ).repository_check_baseline_capture

  assert.throws(
    () => claimCohortBaselineCapture(root, COHORT_ID, 'same-run'),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'COHORT_BASELINE_CAPTURE_IN_PROGRESS',
  )
  assert.throws(
    () => recordCohortBaselines(root, COHORT_ID, 'same-run', {}),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'COHORT_BASELINE_CAPTURE_NOT_OWNER',
  )
  releaseCohortBaselineClaim(root, COHORT_ID, 'same-run')
  assert.deepEqual(
    loadCohortState(root, COHORT_ID).repository_check_baseline_capture,
    claim,
  )
  writeFileSync(path.join(root, 'owner-end'), '')
  assert.equal((await owner.done).code, 0)
})

for (const ending of ['released', 'dead'] as const) {
  test(`${ending} ownership elects one replacement among competing joiners`, async (t) => {
    const root = createFixture()

    session(root)

    const owner = launch(
      t,
      root,
      `
      claimCohortBaselineCapture(root, ${JSON.stringify(COHORT_ID)}, 'owner')
      writeFileSync(root + '/owner-ready', '')
      wait(root + '/owner-end')
      ${ending === 'released' ? `releaseCohortBaselineClaim(root, ${JSON.stringify(COHORT_ID)}, 'owner')` : ''}
    `,
    )

    await waitFor(path.join(root, 'owner-ready'), [owner])

    const successors = ['next-a', 'next-b'].map((runId) =>
      launch(
        t,
        root,
        `
      const claim = claimCohortBaselineCapture(root, ${JSON.stringify(COHORT_ID)}, ${JSON.stringify(runId)}, {
        waitForCaptureMs: 30_000,
        onProgress: () => writeFileSync(root + '/joined-${runId}', ''),
      })
      if (claim.status === 'capture') {
        writeFileSync(root + '/elected-${runId}', '')
        wait(root + '/publish')
        recordCohortBaselines(root, ${JSON.stringify(COHORT_ID)}, ${JSON.stringify(runId)}, {})
      }
      writeFileSync(root + '/result-${runId}', claim.status)
    `,
      ),
    )

    await Promise.all(
      ['next-a', 'next-b'].map((runId) =>
        waitFor(path.join(root, `joined-${runId}`), successors),
      ),
    )
    writeFileSync(path.join(root, 'owner-end'), '')
    assert.equal((await owner.done).code, 0)

    const deadline = Date.now() + 30_000

    while (
      !['next-a', 'next-b'].some((runId) =>
        existsSync(path.join(root, `elected-${runId}`)),
      )
    ) {
      assert.ok(Date.now() < deadline, 'no replacement was elected')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    const elected = ['next-a', 'next-b'].filter((runId) =>
      existsSync(path.join(root, `elected-${runId}`)),
    )

    assert.equal(elected.length, 1)
    assert.equal(
      loadCohortState(root, COHORT_ID).repository_check_baseline_capture
        ?.run_id,
      elected[0],
    )
    writeFileSync(path.join(root, 'publish'), '')

    for (const successor of successors) {
      const result = await successor.done

      assert.equal(result.code, 0, result.output)
    }

    assert.deepEqual(
      ['next-a', 'next-b']
        .map((runId) =>
          readFileSync(path.join(root, `result-${runId}`), 'utf8'),
        )
        .sort(),
      ['adopted', 'capture'],
    )
  })
}

test('baseline bookkeeping queues a short session lock while default operations refuse', async (t) => {
  const root = createFixture()

  session(root)

  const holder = launch(
    t,
    root,
    `
    withCohortSession(root, ${JSON.stringify(COHORT_ID)}, () => {
      writeFileSync(root + '/locked', '')
      wait(root + '/unlock')
    })
  `,
  )

  await waitFor(path.join(root, 'locked'))
  assert.throws(
    () => withCohortSession(root, COHORT_ID, () => {}),
    (error: unknown) =>
      error instanceof PanError && error.code === 'RUN_OPERATION_IN_PROGRESS',
  )
  assert.throws(
    () =>
      claimCohortBaselineCapture(root, COHORT_ID, 'short', {
        waitForHolderMs: 1,
      }),
    (error: unknown) =>
      error instanceof PanError && error.code === 'RUN_OPERATION_IN_PROGRESS',
  )

  const queued = launch(
    t,
    root,
    `
    import fs from 'node:fs'
    import { syncBuiltinESMExports } from 'node:module'
    import { mock } from 'node:test'
    const link = fs.linkSync
    const mutex = cohortMutexPath(root, ${JSON.stringify(COHORT_ID)})
    const observation = mock.method(fs, 'linkSync', (source, destination) => {
      try {
        return link(source, destination)
      } catch (error) {
        if (destination === mutex && error.code === 'EEXIST') {
          writeFileSync(root + '/queue-contended', '')
        }
        throw error
      }
    })
    syncBuiltinESMExports()
    try {
      const claim = claimCohortBaselineCapture(root, ${JSON.stringify(COHORT_ID)}, 'queued')
      writeFileSync(root + '/queue-result', claim.status)
    } finally {
      observation.mock.restore()
      syncBuiltinESMExports()
    }
  `,
  )

  await waitFor(path.join(root, 'queue-contended'), [queued])
  assert.equal(existsSync(path.join(root, 'queue-result')), false)
  writeFileSync(path.join(root, 'unlock'), '')
  assert.equal((await holder.done).code, 0)
  const result = await queued.done

  assert.equal(result.code, 0, result.output)
  assert.equal(readFileSync(path.join(root, 'queue-result'), 'utf8'), 'capture')
  assert.equal(existsSync(cohortMutexPath(root, COHORT_ID)), false)
})

test('expired joins name the live holder and recovery command without preparing the waiter', () => {
  const { root, runId } = checkpoint('delivery@created')

  session(root)
  claimCohortBaselineCapture(root, COHORT_ID, 'owner')
  assert.throws(
    () =>
      claimCohortBaselineCapture(root, COHORT_ID, runId, {
        waitForCaptureMs: 1,
      }),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'COHORT_BASELINE_CAPTURE_IN_PROGRESS' &&
      error.message.includes(COHORT_ID) &&
      error.message.includes(`owner (pid ${process.pid}`) &&
      error.message.includes('bound 1ms') &&
      error.message.includes(`./bin/pan prepare ${runId}`),
  )
  assert.equal(
    loadCohortState(root, COHORT_ID).repository_check_baseline_capture?.run_id,
    'owner',
  )
  assert.equal(
    loadCohortState(root, COHORT_ID).repository_check_baselines,
    undefined,
  )
  const waiting = loadState(root, runId)

  assert.equal(waiting.current_invocation, null)
  assert.equal(waiting.repository_check_baselines, undefined)
  assert.equal(waiting.pending_action.type, 'prepare_invocation')
})

test('capture and publication exceptions and failed environment probes release claims without publishing partial collections', () => {
  for (const failure of ['exception', 'publication', 'probe']) {
    const { root, runId, workflow } = checkpoint('delivery@created')

    session(root)
    const state = loadState(root, runId)

    state.cohort = { cohort_id: COHORT_ID, cohort_index: 1, chunk: 'c1' }
    writeJson(path.join(root, 'runtime/repository-checks.json'), {
      schema_version: 1,
      profiles: {
        configuration: { probes: [], commands: ['node -e "process.exit(0)"'] },
        static: {
          environment_probes:
            failure === 'probe' ? ['node -e "process.exit(17)"'] : [],
          probes: [],
          commands: ['node -e "process.exit(0)"'],
        },
        fast: { probes: [], commands: ['node -e "process.exit(0)"'] },
        'impacted-integration': {
          probes: [],
          commands: ['node -e "process.exit(0)"'],
        },
      },
    })

    const capture = () =>
      ensureWorkflowRepositoryCheckBaselines(
        root,
        state,
        workflow,
        stageBySlug(workflow, 'implement'),
        (message) => {
          if (
            failure === 'exception' &&
            message.includes("capturing pre-implementation 'static'")
          ) {
            throw new Error('controlled capture exception')
          }
          if (
            failure === 'publication' &&
            message.includes("pre-implementation 'static' baseline passed")
          ) {
            releaseCohortBaselineClaim(root, COHORT_ID, runId)
          }
        },
      )

    if (failure === 'exception') {
      assert.throws(capture, /controlled capture exception/u)
    } else if (failure === 'publication') {
      assert.throws(
        capture,
        (error: unknown) =>
          error instanceof PanError &&
          error.code === 'COHORT_BASELINE_CAPTURE_NOT_OWNER',
      )
    } else {
      assert.equal(capture(), true)
      assert.equal(state.status, 'paused')
    }

    assert.equal(state.repository_check_baselines, undefined)
    assert.ok(
      existsSync(
        path.join(
          root,
          `runtime/logs/cohorts/${COHORT_ID}/baselines/pre-implementation-configuration.json`,
        ),
      ),
    )
    assert.equal(
      loadCohortState(root, COHORT_ID).repository_check_baselines,
      undefined,
    )
    assert.equal(
      loadCohortState(root, COHORT_ID).repository_check_baseline_capture,
      undefined,
    )
    assert.deepEqual(
      claimCohortBaselineCapture(root, COHORT_ID, 'replacement'),
      { status: 'capture' },
    )
  }
})
