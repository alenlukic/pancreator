import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  prepareInvocation,
  recordDelegatedWorker,
  setRunStage,
} from '../../src/lib/engine.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import type { Invocation } from '../../src/lib/types.js'
import { invocationEvidencePaths } from '../../src/lib/watch.js'
import { createFixture, createRun, read } from '../helpers.js'

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
