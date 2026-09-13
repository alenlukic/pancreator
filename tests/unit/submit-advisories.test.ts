import assert from 'node:assert/strict'
import { utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  getRunState,
  getRunStatus,
  prepareInvocation,
  recordSupervisorModelEvidence,
  submitOutput,
} from '../../src/lib/engine.js'
import { statePath } from '../../src/lib/state.js'
import { delegationPath } from '../../src/lib/validation.js'
import {
  markDelegationBackground,
  watchInvocation,
} from '../../src/lib/watch.js'
import { createFixture, read, writeJson } from '../helpers.js'
import { createRun } from '../run-helpers.js'
import { CADENCE_SECONDS, fillPreparedOutput } from './watch-helpers.js'

// Run 63296 int-con HR-004: a submission recorded a platform-guidance conflict
// to run state and returned an advisory list without it, so `pan status`
// listed a conflict the supervisor's own submit result had not mentioned. One
// submission now yields one collection, whatever the advisory kind.
test('a submission returns every advisory it records', async () => {
  const root = createFixture()
  const created = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  // Recorded supervisor evidence makes the invocation carry the model-evidence
  // obligation, which is the third kind.
  recordSupervisorModelEvidence(
    root,
    created.run_id,
    'GPT 5.6 Sol',
    'Cursor session metadata',
  )

  const prepared = prepareInvocation(root, created.run_id)

  assert.ok(prepared.invocation)

  const { state } = prepared
  const invocationId = prepared.invocation.invocation_id
  const outputPath = prepared.invocation.output.path

  // Prepare records a labeled default for the declared worker, so the only
  // remaining model-evidence gap is a worker with no record at all.
  writeJson(statePath(root, state.run_id), {
    ...getRunState(root, state.run_id),
    model_evidence: (
      getRunState(root, state.run_id).model_evidence ?? []
    ).filter((item) => item.role !== 'worker'),
  })

  fillPreparedOutput(root, state)

  const output = read(path.join(root, outputPath)) as Record<string, unknown>

  output.platform_guidance_conflicts = [
    {
      guidance: 'Plan mode forbids file edits',
      covered_step: 'write the stage output',
      authority_followed: 'the invocation contract',
    },
  ]
  writeFileSync(
    path.join(root, outputPath),
    `${JSON.stringify(output, null, 2)}\n`,
  )

  // Backdate the launch so the same marker reads as a late arming, which is
  // the delegation-supervision advisory this submission also carries.
  const marker = read(
    path.join(root, markDelegationBackground(root, state.run_id, invocationId)),
  ) as { launched_at: string | null }
  const backdated = new Date(Date.parse(marker.launched_at!) - 10 * 60 * 1000)

  utimesSync(
    path.join(root, delegationPath(state.run_id, invocationId, root)),
    backdated,
    backdated,
  )
  markDelegationBackground(root, state.run_id, invocationId)

  await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    agentState: 'completed',
  })

  const before = getRunState(root, state.run_id).advisories ?? []
  const submitted = submitOutput(root, state.run_id, outputPath)
  const recorded = (getRunState(root, state.run_id).advisories ?? []).slice(
    before.length,
  )

  assert.deepEqual(
    new Set(submitted.advisories.map((advisory) => advisory.kind)),
    new Set(['model_evidence', 'delegation_supervision', 'platform_guidance']),
  )
  assert.deepEqual(submitted.advisories, recorded)
  assert.match(
    getRunStatus(root, state.run_id) as string,
    /Platform guidance conflict: "Plan mode forbids file edits"/u,
  )
})
