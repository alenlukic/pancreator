import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { AGENT_REPOSITORY_CHECK_RUNS_FILE } from '../../src/lib/repository-checks.js'
import { CURSOR_TRANSCRIPTS_ENV } from '../../src/lib/worker-profile.js'
import { createTestTempDirectory } from '../temp.js'
import { checkpoint, submitCurrentStage } from './delivery-helpers.js'

function workerTranscript(runId: string, invocationId: string): string {
  const shell = (command: string): string =>
    JSON.stringify({
      role: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Shell', input: { command } }],
      },
    })

  return [
    JSON.stringify({
      role: 'user',
      message: {
        content: [
          {
            type: 'text',
            text:
              'Persona: `coder`.\n\n- Contract: ' +
              `\`runtime/logs/workflows/${runId}/agent/invocations/${invocationId}.md\``,
          },
        ],
      },
    }),
    shell('cd /work && cat src/base.ts'),
    shell("./bin/pan-run -c 'rg -n base src'"),
    shell('./bin/pan tests impacted'),
  ].join('\n')
}

function suiteCostEvents(
  root: string,
  runId: string,
): Record<string, unknown>[] {
  return readFileSync(resolveRunLayout(root, runId).events.absolute, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter(
      (event) =>
        event.type === 'suite_cost_advisory' &&
        event.scope === 'worker_invocation',
    )
}

function withTranscriptsRoot<T>(transcriptsRoot: string, action: () => T): T {
  const previous = process.env[CURSOR_TRANSCRIPTS_ENV]

  process.env[CURSOR_TRANSCRIPTS_ENV] = transcriptsRoot

  try {
    return action()
  } finally {
    if (previous === undefined) {
      delete process.env[CURSOR_TRANSCRIPTS_ENV]
    } else {
      process.env[CURSOR_TRANSCRIPTS_ENV] = previous
    }
  }
}

test('an implement submission records worker-run gate profiles and shell browsing as a suite-cost advisory', () => {
  const { root, runId, invocation } = checkpoint('delivery@implement-prepared')

  assert.ok(invocation)

  const invocationId = invocation.invocation_id
  const ledger = resolveRunLayout(root, runId).evidence(
    AGENT_REPOSITORY_CHECK_RUNS_FILE,
  ).absolute
  const transcriptsRoot = createTestTempDirectory('worker-transcripts-')
  const transcript = path.join(
    transcriptsRoot,
    'supervisor',
    'subagents',
    'worker.jsonl',
  )

  mkdirSync(path.dirname(ledger), { recursive: true })
  writeFileSync(
    ledger,
    [
      { profile: 'fast', invoked_by: 'agent' },
      { profile: 'fast', invoked_by: 'agent' },
      { profile: 'static', invoked_by: 'agent' },
      { profile: 'impacted', invoked_by: 'agent' },
    ]
      .map((entry) =>
        JSON.stringify({
          ...entry,
          invocation_id: invocationId,
          workspace_fingerprint: 'fixture-fingerprint',
          status: 'passed',
        }),
      )
      .join('\n') + '\n',
  )
  mkdirSync(path.dirname(transcript), { recursive: true })
  writeFileSync(transcript, workerTranscript(runId, invocationId))

  const submitted = withTranscriptsRoot(transcriptsRoot, () =>
    submitCurrentStage(root, runId, 'success'),
  )

  assert.equal(submitted.invocation.invocation_id, invocationId)
  assert.ok(
    submitted.advisories.some(
      (item) =>
        item.kind === 'suite_cost' &&
        item.invocation_id === invocationId &&
        /ran fast 2x itself/u.test(item.message) &&
        !/static \d+x/u.test(item.message),
    ),
    JSON.stringify(submitted.advisories),
  )

  const [event, ...others] = suiteCostEvents(root, runId)

  assert.equal(others.length, 0)
  assert.ok(event)
  assert.equal(event.stage, 'implement')
  assert.equal(event.invocation_id, invocationId)
  assert.deepEqual(event.worker_gate_profiles, { fast: 2 })
  assert.equal(event.shell_browsing_calls, 2)
  assert.equal(event.transcript_found, true)
})

test('an implement submission with no worker-run gate profile and no shell browsing records no worker advisory', () => {
  const { root, runId, invocation } = checkpoint('delivery@implement-prepared')

  assert.ok(invocation)

  const transcriptsRoot = createTestTempDirectory('worker-transcripts-')
  const submitted = withTranscriptsRoot(transcriptsRoot, () =>
    submitCurrentStage(root, runId, 'success'),
  )

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(
    submitted.advisories.some((item) => item.kind === 'suite_cost'),
    false,
  )
  assert.deepEqual(suiteCostEvents(root, runId), [])
})
