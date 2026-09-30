/**
 * The 2026-09-22..29 audit found five ship entry gate failures in lanes the
 * verify stage never ran (configuration, integration, secondary), each one a
 * 23-36 minute remediate-verify-gate loop. The gate now records which failed
 * lanes no earlier gate of the run proved at the same workspace, so an audit
 * can count the checks that belong before the verify verdict.
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { prepareInvocation } from '../../src/lib/engine.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import {
  checkpoint,
  checksVariant,
  PASS,
  submitStageOutput,
} from '../integration/delivery-helpers.js'

const SECONDARY_FAILURE =
  `node -e "console.log('not ok 1 - installs cleanly ` +
  `(tests/secondary/embedded-installation.test.ts:12)');process.exit(1)"`

const BREAKABLE =
  `node -e "process.exit(require('node:fs').existsSync(` +
  `'runtime/break-config')?1:0)"`

function eventsOf(
  root: string,
  runId: string,
): Array<{ type: string; payload?: Record<string, unknown> }> {
  return readFileSync(
    path.join(root, 'runtime/logs/workflows', runId, 'agent/events.jsonl'),
    'utf8',
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string })
}

function failedGateEvent(
  root: string,
  runId: string,
): Record<string, unknown> | undefined {
  const event = eventsOf(root, runId).find(
    (item) => item.type === 'entry_gate_failed',
  ) as Record<string, unknown> | undefined

  return (event?.payload as Record<string, unknown> | undefined) ?? event
}

test('an entry gate failure in a lane no earlier gate ran records the lane gap', () => {
  const { root, runId, workflow } = checkpoint(
    'delivery@verify-prepared',
    checksVariant('checks=full-fails-secondary', {
      static: { probes: [], commands: [PASS] },
      fast: { probes: [], commands: [PASS] },
      configuration: { probes: [], commands: [PASS] },
      full: { probes: [], commands: [SECONDARY_FAILURE] },
    }),
  )

  submitStageOutput(root, runId, stageBySlug(workflow, 'verify'), 'success')

  const routed = prepareInvocation(root, runId)
  const record = routed.state.entry_gates?.ship

  assert.equal(routed.state.current_stage, 'remediate')
  assert.deepEqual(record?.last_result.failed_lanes, ['secondary'])
  assert.deepEqual(record?.lane_gap?.lanes, ['secondary'])
  assert.ok(record?.lane_gap?.verified_profiles.includes('configuration'))
  assert.ok(record?.lane_gap?.verified_profiles.includes('fast'))

  const event = failedGateEvent(root, runId)

  assert.equal(event?.lane_gap, true)
  assert.deepEqual(event?.lanes, ['secondary'])
})

test('an entry gate failure in a command an earlier gate proved records no lane gap', () => {
  const { root, runId, workflow } = checkpoint(
    'delivery@verify-prepared',
    checksVariant('checks=full-fails-configuration-command', {
      static: { probes: [], commands: [PASS] },
      fast: { probes: [], commands: [PASS] },
      configuration: { probes: [], commands: [BREAKABLE] },
      full: { probes: [], commands: [BREAKABLE] },
    }),
  )

  submitStageOutput(root, runId, stageBySlug(workflow, 'verify'), 'success')
  // runtime/ is outside the workspace fingerprint, so the configuration pass
  // the implement gate recorded stays current for the gate's workspace.
  writeFileSync(path.join(root, 'runtime/break-config'), 'x')

  const routed = prepareInvocation(root, runId)
  const record = routed.state.entry_gates?.ship

  assert.equal(routed.state.current_stage, 'remediate')
  assert.equal(record?.failures, 1)
  assert.equal(record?.lane_gap, undefined)
  assert.equal(failedGateEvent(root, runId)?.lane_gap, undefined)
})
