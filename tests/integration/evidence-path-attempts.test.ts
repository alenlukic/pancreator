import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  prepareInvocation,
  recordDelegatedWorker,
  setRunStage,
} from '../../src/lib/engine.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import {
  nextAgentGatePassAttempt,
  recordAgentRepositoryCheckForRuns,
  recordProfileGatePass,
  reusableProfileExecution,
  type RepositoryCheckResult,
} from '../../src/lib/repository-checks.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import type { Invocation } from '../../src/lib/types.js'
import { invocationEvidencePaths } from '../../src/lib/watch.js'
import { createFixture, read } from '../helpers.js'
import { createRun } from '../run-helpers.js'

/** A run standing at the verify stage, which declares two evidence workers. */
function verifyInvocation(): {
  root: string
  runId: string
  invocation: Invocation
} {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  setRunStage(root, run.run_id, 'verify', 'Verify the current workspace.')

  const invocation = prepareInvocation(root, run.run_id).invocation

  assert.ok(invocation)
  assert.equal(invocation.stage.slug, 'verify')
  assert.ok((invocation.evidence_workers ?? []).length > 0)

  return { root, runId: run.run_id, invocation }
}

function readInvocation(
  root: string,
  runId: string,
  invocationId: string,
): Invocation {
  return read(
    path.join(
      root,
      resolveRunLayout(root, runId).invocation(invocationId, '.json').relative,
    ),
  ) as Invocation
}

// A stalled review worker was relaunched, and the second launch was handed
// the first one's declared report path. The first worker's evidence was
// overwritten in place, and the verification read one report where two
// executions had happened.
test('a relaunched evidence worker writes its own report and leaves the first intact', () => {
  const { root, runId, invocation } = verifyInvocation()
  const invocationId = invocation.invocation_id
  const first = (invocation.evidence_workers ?? [])[0]!
  const firstReport = path.join(root, first.evidence_path)
  const firstBody = '# Review evidence, first attempt\n'

  writeFileSync(firstReport, firstBody)

  const relaunch = recordDelegatedWorker(root, runId, {
    handle: 'bc-relaunch',
    invocationId,
    role: first.role,
  })

  assert.ok(relaunch.evidence_attempt)
  assert.equal(relaunch.record.attempt, 2)
  assert.notEqual(relaunch.evidence_attempt.evidence_path, first.evidence_path)
  assert.notEqual(relaunch.evidence_attempt.brief_path, first.brief_path)

  writeFileSync(
    path.join(root, relaunch.evidence_attempt.evidence_path),
    '# Review evidence, second attempt\n',
  )

  assert.equal(readFileSync(firstReport, 'utf8'), firstBody)

  const amended = readInvocation(root, runId, invocationId)
  const attempts = (amended.evidence_workers ?? []).find(
    (worker) => worker.role === first.role,
  )?.attempts

  assert.deepEqual(
    attempts?.map((attempt) => attempt.attempt),
    [1, 2],
  )

  // The consuming card names both attempts, so the verification that reads it
  // cannot silently consume one report of two.
  const card = readFileSync(
    path.join(
      root,
      resolveRunLayout(root, runId).invocation(invocationId, '.md').relative,
    ),
    'utf8',
  )

  assert.ok(card.includes(first.evidence_path))
  assert.ok(card.includes(relaunch.evidence_attempt.evidence_path))
  assert.match(card, /attempt 2/u)
})

// Relaunching a stalled evidence worker re-rendered the card and moved the
// contract digest under the stage worker already holding it, so that worker's
// submission failed attestation for a card it had read correctly.
test('a relaunch leaves the card a running stage worker attested unmoved', () => {
  const { root, runId, invocation } = verifyInvocation()
  const invocationId = invocation.invocation_id
  const first = (invocation.evidence_workers ?? [])[0]!

  recordDelegatedWorker(root, runId, { handle: 'bc-stage', invocationId })

  const cardPath = path.join(
    root,
    resolveRunLayout(root, runId).invocation(invocationId, '.md').relative,
  )
  const attestedCard = readFileSync(cardPath, 'utf8')
  const attestedManifest = readInvocation(
    root,
    runId,
    invocationId,
  ).contract_manifest

  assert.ok(attestedManifest)

  writeFileSync(path.join(root, first.evidence_path), '# first attempt\n')

  const relaunch = recordDelegatedWorker(root, runId, {
    handle: 'bc-relaunch',
    invocationId,
    role: first.role,
  })

  assert.equal(relaunch.record.attempt, 2)

  const amended = readInvocation(root, runId, invocationId)

  assert.deepEqual(amended.contract_manifest, attestedManifest)
  assert.equal(readFileSync(cardPath, 'utf8'), attestedCard)
  // The attempt still reaches the invocation record, so the watch and the
  // worker-state view see the relaunch the card does not name.
  assert.deepEqual(
    (amended.evidence_workers ?? [])
      .find((worker) => worker.role === first.role)
      ?.attempts?.map((attempt) => attempt.attempt),
    [1, 2],
  )
  assert.ok(existsSync(path.join(root, relaunch.evidence_attempt!.brief_path)))
})

// The watch read the evidence directory alone, so a report nobody had written
// yet was invisible to it: the stage could reach a verdict while a declared
// report had never been produced at all.
test('a declared evidence report nobody has written appears in the watched set', () => {
  const { root, runId, invocation } = verifyInvocation()
  const watched = invocationEvidencePaths(root, runId, invocation)

  for (const worker of invocation.evidence_workers ?? []) {
    assert.ok(
      watched.includes(worker.evidence_path),
      `the watched set names ${worker.role}'s declared report`,
    )
    assert.equal(
      existsSync(path.join(root, worker.evidence_path)),
      false,
      'the declared report is named while nobody has written it',
    )
  }

  const first = (invocation.evidence_workers ?? [])[0]!
  const relaunch = recordDelegatedWorker(root, runId, {
    handle: 'bc-relaunch',
    invocationId: invocation.invocation_id,
    role: first.role,
  })

  assert.ok(
    invocationEvidencePaths(
      root,
      runId,
      readInvocation(root, runId, invocation.invocation_id),
    ).includes(relaunch.evidence_attempt!.evidence_path),
    'a relaunch adds its own pending report to the watched set',
  )
})

function passingFastResult(workspaceRoot: string): RepositoryCheckResult {
  return {
    profile: 'fast',
    status: 'passed',
    config_path: 'runtime/repository-checks.json',
    workspace_root: workspaceRoot,
    timeout_ms: 60_000,
    results: [
      {
        kind: 'command',
        command: 'npm test',
        exit_code: 0,
        signal: null,
        stdout: 'suite ok\n',
        stderr: '',
        passed: true,
        timed_out: false,
        duration_ms: 1,
      },
    ],
    total_duration_ms: 1,
    advisories: [],
  }
}

// The reuse key was invocation-scoped while the artifact it protects is
// worker-scoped: the two evidence workers of a verify stage share one
// invocation id, so the second worker was handed the first one's recorded
// pass and the stage held one log for two executions.
test('the two evidence workers of one verify stage produce two distinct logs', () => {
  const { root, runId, invocation } = verifyInvocation()
  const invocationId = invocation.invocation_id
  const roles = (invocation.evidence_workers ?? []).map((worker) => worker.role)

  assert.deepEqual(roles, ['review', 'qa'])

  const fingerprint = gitWorkspaceSnapshot(root).fingerprint
  // The sequence each worker's own `pan repository-check fast --run <id>
  // --role <role>` performs: ask the ledger for a pass to reuse, execute,
  // store the log, then file the row that names it.
  const logs = roles.map((role) => {
    assert.equal(
      reusableProfileExecution(
        root,
        runId,
        invocationId,
        'fast',
        fingerprint,
        role,
      ),
      null,
      `${role} holds no recorded pass of its own to reuse`,
    )

    const result = passingFastResult(root)
    const startedAt = new Date().toISOString()
    const pass = recordProfileGatePass(root, 'fast', result, {
      run_ids: [runId],
      fingerprint_before: fingerprint,
      started_at: startedAt,
      attempt: nextAgentGatePassAttempt(root, runId, 'fast', fingerprint),
      initiator: 'agent',
    })

    assert.ok(pass, `${role} stored its pass`)
    recordAgentRepositoryCheckForRuns(
      root,
      [runId],
      result,
      startedAt,
      'agent',
      pass.evidence_path,
      false,
      role,
    )

    return pass.evidence_path
  })

  assert.equal(new Set(logs).size, 2, 'each worker owns a distinct log path')

  for (const [index, role] of roles.entries()) {
    assert.equal(
      reusableProfileExecution(
        root,
        runId,
        invocationId,
        'fast',
        fingerprint,
        role,
      )?.evidence_log,
      logs[index],
      `${role} resolves to its own log and not the other worker's`,
    )
    assert.match(
      readFileSync(path.join(root, logs[index]), 'utf8'),
      /^\$ pan repository-check fast$/mu,
    )
  }
})
