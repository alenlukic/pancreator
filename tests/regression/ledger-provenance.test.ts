import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import {
  AGENT_REPOSITORY_CHECK_RUNS_FILE,
  recordAgentRepositoryCheckForRuns,
  recordProfileGatePass,
  type RepositoryCheckInitiator,
  type RepositoryCheckResult,
} from '../../src/lib/repository-checks.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { createFixture } from '../helpers.js'
import { createRun } from '../run-helpers.js'

function passingResult(workspaceRoot: string): RepositoryCheckResult {
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

/** `invoked_by` as the ledger row and the evidence log header each report it. */
function recordedProvenance(
  root: string,
  runId: string,
  initiator: RepositoryCheckInitiator,
): { row: unknown; header: string | undefined } {
  const startedAt = new Date().toISOString()
  const result = passingResult(root)
  const pass = recordProfileGatePass(root, 'fast', result, {
    run_ids: [runId],
    fingerprint_before: gitWorkspaceSnapshot(root).fingerprint,
    started_at: startedAt,
    initiator,
  })

  assert.ok(pass)
  recordAgentRepositoryCheckForRuns(
    root,
    [runId],
    result,
    startedAt,
    initiator,
    pass.evidence_path,
  )

  const rows = readFileSync(
    resolveRunLayout(root, runId).evidence(AGENT_REPOSITORY_CHECK_RUNS_FILE)
      .absolute,
    'utf8',
  )
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { invoked_by: unknown })

  return {
    row: rows[rows.length - 1]?.invoked_by,
    header: readFileSync(path.join(root, pass.evidence_path), 'utf8')
      .split('\n')
      .find((line) => line.startsWith('invoked_by='))
      ?.slice('invoked_by='.length),
  }
}

// The ledger row took the initiator argument while the evidence log header
// wrote a fixed string, so a harness-started execution filed a row saying
// `harness` above a log saying `command-line`. Harness initiation is one of
// the three exemptions from the reuse short-circuit, which makes the
// disagreement decisive rather than cosmetic.
test('a ledger row and its own evidence log report the same provenance', () => {
  const root = createFixture()

  for (const initiator of ['agent', 'harness'] as const) {
    const run = createRun(root, {
      workflowSlug: 'delivery',
      requestPath: 'request.md',
    })
    const recorded = recordedProvenance(root, run.run_id, initiator)

    assert.equal(
      recorded.header,
      recorded.row,
      `the ${initiator} log header and ledger row agree`,
    )
    assert.equal(recorded.row, initiator)
  }
})
