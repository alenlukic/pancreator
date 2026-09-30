import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import {
  getRunState,
  pauseRun,
  probeRunInvocationModel,
  recordInvocationModelEvidence,
  recordSupervisorModelEvidence,
} from '../../src/lib/engine.js'
import {
  expectedCursorModelForSpec,
  resetCursorAgentCapabilities,
} from '../../src/lib/executors/cursor-probe.js'
import { operationMutexPath, statePath } from '../../src/lib/state.js'
import {
  MODEL_EVIDENCE_VARIANT,
  preparedRunCheckpoint,
  verifyRun,
} from './model-evidence-helpers.js'

test('the run mutex spans the evidence write, not the live probe', () => {
  const { root, run, invocation } = preparedRunCheckpoint(
    MODEL_EVIDENCE_VARIANT,
  )

  const expected = expectedCursorModelForSpec(root, invocation.stage.model)

  assert.ok(expected)

  const mutexPath = operationMutexPath(root, run.run_id)
  const observationPath = path.join(root, 'probe-observation.json')
  const concurrentTitle = 'Retitled while the probe ran'

  const bin = path.join(root, 'probe-bin')
  const helperPath = path.join(bin, 'observe.mjs')
  const executable = path.join(bin, 'cursor-agent')

  const priorPath = process.env.PATH

  mkdirSync(bin, { recursive: true })
  // The probe used to run inside the run mutex, which held the lock for the
  // whole two-minute call. The observer proves the lock is free and makes a
  // concurrent state write the probe's own write must not lose.
  writeFileSync(
    helperPath,
    [
      "import { existsSync, readFileSync, writeFileSync } from 'node:fs'",
      `const mutexPath = ${JSON.stringify(mutexPath)}`,
      `const statePath = ${JSON.stringify(statePath(root, run.run_id))}`,
      `const observationPath = ${JSON.stringify(observationPath)}`,
      'const held = existsSync(mutexPath)',
      "const state = JSON.parse(readFileSync(statePath, 'utf8'))",
      `state.title = ${JSON.stringify(concurrentTitle)}`,
      'writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\\n`)',
      'writeFileSync(observationPath, JSON.stringify({ held }))',
      '',
    ].join('\n'),
  )
  writeFileSync(
    executable,
    [
      '#!/bin/sh',
      `node ${JSON.stringify(helperPath)} || exit 1`,
      `printf '%s\\n' '${JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: expected,
      })}'`,
      '',
    ].join('\n'),
  )
  chmodSync(executable, 0o755)
  process.env.PATH = `${bin}${path.delimiter}${priorPath ?? ''}`
  resetCursorAgentCapabilities()

  try {
    const evidence = probeRunInvocationModel(
      root,
      run.run_id,
      invocation.invocation_id,
    )

    assert.equal(evidence.result, 'match')

    const observed = JSON.parse(readFileSync(observationPath, 'utf8')) as {
      held: boolean
    }

    assert.equal(observed.held, false)

    // The second hold re-reads the state, so the concurrent write survives
    // beside the evidence the probe records.
    const state = getRunState(root, run.run_id)

    assert.equal(state.title, concurrentTitle)
    assert.equal(
      state.model_evidence?.some(
        (entry) => entry.invocation_id === invocation.invocation_id,
      ),
      true,
    )
  } finally {
    process.env.PATH = priorPath
    resetCursorAgentCapabilities()
  }
})

test('a lifecycle command succeeds while a probe is in its live call', async () => {
  const { root, run, invocation } = preparedRunCheckpoint(
    MODEL_EVIDENCE_VARIANT,
  )

  const expected = expectedCursorModelForSpec(root, invocation.stage.model)

  assert.ok(expected)

  const bin = path.join(root, 'window-bin')
  const barrier = path.join(root, 'probe-window')
  const inCall = path.join(barrier, 'in-call')
  const release = path.join(barrier, 'release')

  mkdirSync(bin, { recursive: true })
  mkdirSync(barrier, { recursive: true })
  // The live call is the whole point: the lock used to span it, so every
  // other command against the run failed for the length of the probe.
  writeFileSync(
    path.join(bin, 'cursor-agent'),
    [
      '#!/bin/sh',
      'if [ "$1" = "--help" ]; then',
      '  printf "%s\\n" "Usage: cursor-agent --output-format --model"',
      '  exit 0',
      'fi',
      `: > ${JSON.stringify(inCall)}`,
      'waited=0',
      `while [ ! -f ${JSON.stringify(release)} ] && [ "$waited" -lt 300 ]; do`,
      '  sleep 0.1',
      '  waited=$((waited + 1))',
      'done',
      `printf '%s\\n' '${JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: expected,
      })}'`,
      '',
    ].join('\n'),
  )
  chmodSync(path.join(bin, 'cursor-agent'), 0o755)

  const childPath = path.join(root, 'window-probe.mjs')

  writeFileSync(
    childPath,
    [
      `import { probeRunInvocationModel } from ${JSON.stringify(
        pathToFileURL(
          path.join(process.cwd(), 'dist', 'src', 'lib', 'engine.js'),
        ).href,
      )}`,
      '',
      'probeRunInvocationModel(',
      `  ${JSON.stringify(root)},`,
      `  ${JSON.stringify(run.run_id)},`,
      `  ${JSON.stringify(invocation.invocation_id)},`,
      ')',
      '',
    ].join('\n'),
  )

  const probed = new Promise<void>((resolve, reject) => {
    execFile(
      process.execPath,
      [childPath],
      {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
        },
        timeout: 120_000,
      },
      (error) => (error ? reject(error) : resolve()),
    )
  })

  for (let waited = 0; waited < 300 && !existsSync(inCall); waited += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  assert.equal(existsSync(inCall), true, 'the probe never reached its call')

  const paused = pauseRun(root, run.run_id, 'Paused inside the probe window')

  assert.equal(paused.status, 'paused')
  assert.equal(paused.pause_reason, 'Paused inside the probe window')

  writeFileSync(release, '')
  await probed

  const evidence = getRunState(root, run.run_id).model_evidence?.find(
    (entry) => entry.invocation_id === invocation.invocation_id,
  )

  // The pause must not cost the probe its answer either.
  assert.equal(evidence?.result, 'match')
  assert.equal(getRunState(root, run.run_id).pause_reason, paused.pause_reason)
})

test('two concurrent probes serialize their evidence writes', async () => {
  const { root, run, invocation } = preparedRunCheckpoint(
    MODEL_EVIDENCE_VARIANT,
  )

  const expected = expectedCursorModelForSpec(root, invocation.stage.model)

  assert.ok(expected)

  const bin = path.join(root, 'concurrent-bin')
  const barrier = path.join(root, 'probe-barrier')
  const executable = path.join(bin, 'cursor-agent')
  const childPath = path.join(root, 'concurrent-probe.mjs')

  mkdirSync(bin, { recursive: true })
  mkdirSync(barrier, { recursive: true })
  // Both probes have to be inside the live call together, or they never
  // contend for the hold that records the answer.
  writeFileSync(
    executable,
    [
      '#!/bin/sh',
      'if [ "$1" = "--help" ]; then',
      '  printf "%s\\n" "Usage: cursor-agent --output-format --model"',
      '  exit 0',
      'fi',
      `: > ${JSON.stringify(barrier)}/$$`,
      'waited=0',
      `while [ "$(ls ${JSON.stringify(barrier)} | wc -l)" -lt 2 ] &&` +
        ' [ "$waited" -lt 100 ]; do',
      '  sleep 0.1',
      '  waited=$((waited + 1))',
      'done',
      `printf '%s\\n' '${JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: expected,
      })}'`,
      '',
    ].join('\n'),
  )
  chmodSync(executable, 0o755)
  writeFileSync(
    childPath,
    [
      `import { probeRunInvocationModel } from ${JSON.stringify(
        pathToFileURL(
          path.join(process.cwd(), 'dist', 'src', 'lib', 'engine.js'),
        ).href,
      )}`,
      '',
      'try {',
      '  const evidence = probeRunInvocationModel(',
      `    ${JSON.stringify(root)},`,
      `    ${JSON.stringify(run.run_id)},`,
      `    ${JSON.stringify(invocation.invocation_id)},`,
      '  )',
      '',
      '  process.stdout.write(',
      '    JSON.stringify({ ok: true, result: evidence.result }),',
      '  )',
      '} catch (error) {',
      '  process.stdout.write(',
      '    JSON.stringify({',
      '      ok: false,',
      '      code: error?.code ?? null,',
      '      message: String(error?.message ?? error),',
      '    }),',
      '  )',
      '}',
      '',
    ].join('\n'),
  )

  const probe = async (): Promise<{
    ok: boolean
    result?: string
    code?: string | null
    message?: string
  }> =>
    new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        [childPath],
        {
          cwd: root,
          env: {
            ...process.env,
            PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
          },
          timeout: 120_000,
        },
        (error, stdout) => {
          if (error) {
            reject(error)

            return
          }

          resolve(
            JSON.parse(stdout) as {
              ok: boolean
              result?: string
              code?: string | null
            },
          )
        },
      )
    })

  const [first, second] = await Promise.all([probe(), probe()])

  assert.deepEqual(
    [first, second].map((outcome) => ({
      ok: outcome.ok,
      result: outcome.result ?? outcome.code,
    })),
    [
      { ok: true, result: 'match' },
      { ok: true, result: 'match' },
    ],
  )

  const events = readFileSync(
    path.join(root, 'runtime/logs/workflows', run.run_id, 'agent/events.jsonl'),
    'utf8',
  )
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter(
      (event) =>
        event.type === 'model_evidence_recorded' &&
        event.invocation_id === invocation.invocation_id &&
        event.result === 'match',
    )

  // A lost write is the failure this criterion names: the queued probe must
  // record its own answer rather than die on the contended hold.
  assert.equal(events.length, 2)

  const state = getRunState(root, run.run_id)

  assert.equal(
    state.model_evidence?.filter(
      (entry) => entry.invocation_id === invocation.invocation_id,
    ).length,
    1,
  )
  assert.equal(state.title, 'Checkpoint fixture run')
})

/**
 * Hold the run mutex from another process for `holdMs`, and report when the
 * hold began and when it ended. A synchronous mutex cannot be held and
 * contended from one process, so the holder is a child.
 */
function holdRunMutex(
  root: string,
  runId: string,
  label: string,
  holdMs: number,
): { held: Promise<void>; released: string; exited: Promise<void> } {
  const holderPath = path.join(root, `${label}-holder.mjs`)
  const heldMarker = path.join(root, `${label}-held`)
  const releasedMarker = path.join(root, `${label}-released`)

  writeFileSync(
    holderPath,
    [
      `import { writeFileSync } from 'node:fs'`,
      `import { withOperationMutex } from ${JSON.stringify(
        pathToFileURL(path.join(process.cwd(), 'dist', 'src', 'lib', 'io.js'))
          .href,
      )}`,
      '',
      `withOperationMutex(${JSON.stringify(
        operationMutexPath(root, runId),
      )}, () => {`,
      `  writeFileSync(${JSON.stringify(heldMarker)}, '')`,
      `  const until = Date.now() + ${holdMs}`,
      '  const cell = new Int32Array(new SharedArrayBuffer(4))',
      '  while (Date.now() < until) {',
      '    Atomics.wait(cell, 0, 0, 25)',
      '  }',
      `  writeFileSync(${JSON.stringify(releasedMarker)}, '')`,
      '})',
      '',
    ].join('\n'),
  )

  const holder = spawn(process.execPath, [holderPath], {
    cwd: root,
    stdio: 'ignore',
  })
  const exited = new Promise<void>((resolve, reject) => {
    holder.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`mutex holder '${label}' exited with ${code}`))
      }
    })
    holder.on('error', reject)
  })
  const held = (async () => {
    const deadline = Date.now() + 30_000

    while (!existsSync(heldMarker)) {
      assert.ok(Date.now() < deadline, `mutex holder '${label}' never held`)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  })()

  return { held, released: releasedMarker, exited }
}

// AC-008. `pan models evidence` refused at once with RUN_OPERATION_IN_PROGRESS
// while `pan status --redline` held the run mutex. It is a read-mostly
// evidence write, so both of its writers now wait a bounded interval for a
// live holder and the contended write queues instead of failing.
test('a contended pan models evidence write waits for the run mutex instead of refusing', async () => {
  const { root, runId, invocation } = verifyRun()

  const workerHold = holdRunMutex(root, runId, 'worker-evidence', 1_500)

  await workerHold.held
  assert.equal(existsSync(workerHold.released), false)

  const worker = recordInvocationModelEvidence(
    root,
    runId,
    invocation.invocation_id,
    'worker',
    'Stage Effective Model',
    'Cursor launch metadata',
    'launch-contended-1',
  )

  // The write returned only once the holder let go: it queued behind the
  // live holder rather than refusing or clearing it.
  assert.equal(existsSync(workerHold.released), true)
  assert.equal(worker.launch_handle, 'launch-contended-1')
  await workerHold.exited

  const supervisorHold = holdRunMutex(root, runId, 'supervisor-evidence', 1_500)

  await supervisorHold.held
  assert.equal(existsSync(supervisorHold.released), false)

  const supervisor = recordSupervisorModelEvidence(
    root,
    runId,
    'GPT 5.6 Sol',
    'metadata',
  )

  assert.equal(existsSync(supervisorHold.released), true)
  assert.equal(supervisor.evidence.role, 'supervisor')
  await supervisorHold.exited

  const recorded = getRunState(root, runId).model_evidence ?? []

  assert.equal(
    recorded.find((item) => item.invocation_id === invocation.invocation_id)
      ?.launch_handle,
    'launch-contended-1',
  )
  assert.equal(
    recorded.find((item) => item.role === 'supervisor')?.effective_model,
    'GPT 5.6 Sol',
  )
})
