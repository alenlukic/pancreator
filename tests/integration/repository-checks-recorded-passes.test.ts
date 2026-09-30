import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  AGENT_REPOSITORY_CHECK_RUNS_FILE,
  recordAgentRepositoryCheckForRuns,
  recordProfileGatePass,
  reusableProfileExecution,
} from '../../src/lib/repository-checks.js'
import type {
  RepositoryCheckResult,
  ReusableProfileExecution,
} from '../../src/lib/repository-checks.js'
import {
  gateCacheKey,
  gateCacheLookup,
  repositoryCheckGateCommand,
} from '../../src/lib/gate-cache.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { createFixture, createTestTempDirectory } from '../helpers.js'
import { createRun } from '../run-helpers.js'

/** A passing profile result an agent's command-line run would produce. */
function commandLineResult(
  workspaceRoot: string,
  overrides: Partial<RepositoryCheckResult> = {},
): RepositoryCheckResult {
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
        duration_ms: 90_000,
      },
    ],
    total_duration_ms: 90_000,
    advisories: [],
    ...overrides,
  }
}

test('an agent clean profile pass is recorded where the gate looks for it', () => {
  // The agent already paid for this suite at this fingerprint. Recording the
  // pass as a gate result is what stops the submission gate from paying for
  // the identical run minutes later.
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  const fingerprint = gitWorkspaceSnapshot(root).fingerprint
  const result = commandLineResult(root)
  const recorded = recordProfileGatePass(root, 'fast', result, {
    run_ids: [run.run_id],
    fingerprint_before: fingerprint,
    started_at: '2026-09-12T09:00:00.000Z',
  })

  assert.ok(recorded)

  // The gate resolves the same command text for the same profile, so a
  // lookup at this fingerprint finds the entry.
  const entry = gateCacheLookup(
    root,
    gateCacheKey(root, fingerprint, repositoryCheckGateCommand('fast')),
  )

  assert.ok(entry)
  assert.equal(entry.evidence_path, recorded.evidence_path)
  // The gate compares this against the run's baseline, so the whole result
  // has to survive, not a summary of it.
  assert.deepEqual(entry.repository_result, result)

  // The gate copies the evidence bytes forward, so the log must exist.
  const evidence = readFileSync(path.join(root, entry.evidence_path), 'utf8')

  assert.match(evidence, /^\$ pan repository-check fast$/mu)
  assert.match(evidence, /exit_code=0/u)
  assert.match(evidence, /^invoked_by=agent$/mu)
})

// The verify stage permits each of its evidence workers one profile run, and
// two of them land at one workspace fingerprint often. Both passes used to
// derive the same log name, so the second execution overwrote the first one's
// bytes and the ledger carried two entries pointing at one body.
test('two permitted executions at one fingerprint keep their own evidence logs', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const fingerprint = gitWorkspaceSnapshot(root).fingerprint
  const options = {
    run_ids: [run.run_id],
    fingerprint_before: fingerprint,
    started_at: '2026-09-12T09:00:00.000Z',
  }

  const passes = ['review', 'qa'].map((role) => {
    const result = commandLineResult(root)
    const recorded = recordProfileGatePass(root, 'fast', result, options)

    assert.ok(recorded, `${role} stored its pass`)
    recordAgentRepositoryCheckForRuns(
      root,
      [run.run_id],
      result,
      options.started_at,
      'agent',
      recorded.evidence_path,
    )

    return recorded
  })

  assert.equal(
    new Set(passes.map((pass) => pass.evidence_path)).size,
    2,
    'each execution owns a distinct log path',
  )

  // Both bodies survive, and each ledger entry resolves to its own.
  const ledger = readFileSync(
    resolveRunLayout(root, run.run_id).evidence(
      AGENT_REPOSITORY_CHECK_RUNS_FILE,
    ).absolute,
    'utf8',
  )
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { evidence_log: string | null })

  assert.deepEqual(
    ledger.map((entry) => entry.evidence_log),
    passes.map((pass) => pass.evidence_path),
  )

  for (const entry of ledger) {
    assert.match(
      readFileSync(path.join(root, entry.evidence_log ?? ''), 'utf8'),
      /^\$ pan repository-check fast$/mu,
    )
  }
})

test('an agent profile run that proves nothing is not recorded as a pass', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const fingerprint = gitWorkspaceSnapshot(root).fingerprint
  const options = {
    run_ids: [run.run_id],
    fingerprint_before: fingerprint,
    started_at: '2026-09-12T09:00:00.000Z',
  }

  const timedOut = commandLineResult(root)

  timedOut.results = [{ ...timedOut.results[0], timed_out: true }]

  // A failure must re-run to show its repair; a timeout proves nothing at
  // all; a run naming no run has nowhere inside a run to put its evidence.
  assert.equal(
    recordProfileGatePass(
      root,
      'fast',
      commandLineResult(root, { status: 'failed' }),
      options,
    ),
    null,
  )
  assert.equal(recordProfileGatePass(root, 'fast', timedOut, options), null)
  assert.equal(
    recordProfileGatePass(root, 'fast', commandLineResult(root), {
      ...options,
      run_ids: [],
    }),
    null,
  )

  // The workspace moved under the run, so the result describes a tree that
  // no longer exists.
  writeFileSync(path.join(root, 'recorder-buster.txt'), 'changed\n')

  assert.equal(
    recordProfileGatePass(root, 'fast', commandLineResult(root), options),
    null,
  )

  // A workspace outside Git has no fingerprint to key a pass on. Every such
  // workspace fingerprints as the same constant, so one shared cache key
  // would serve results across unrelated trees. The caller in src/cli.ts
  // passes a non-nullable fingerprint, so the guard that has to hold is the
  // snapshot check rather than the null bracket: this case brackets the run
  // exactly as production does and still stores nothing.
  const bare = createTestTempDirectory('unversioned-')
  const bareSnapshot = gitWorkspaceSnapshot(bare)

  assert.notEqual(bareSnapshot.kind, 'git')
  assert.equal(
    recordProfileGatePass(
      root,
      'fast',
      commandLineResult(bare, { workspace_root: bare }),
      { ...options, fingerprint_before: bareSnapshot.fingerprint },
    ),
    null,
  )
  // A caller that brackets nothing at all is refused before that check.
  assert.equal(
    recordProfileGatePass(
      root,
      'fast',
      commandLineResult(bare, { workspace_root: bare }),
      { ...options, fingerprint_before: null },
    ),
    null,
  )
})

/** The ledger a run holds of the profile executions recorded against it. */
function ledgerEntries(root: string, runId: string): Record<string, unknown>[] {
  const ledger = resolveRunLayout(root, runId).evidence(
    AGENT_REPOSITORY_CHECK_RUNS_FILE,
  ).absolute

  return existsSync(ledger)
    ? readFileSync(ledger, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : []
}

// HR3-006: the ledger already held the pass, and the next request for the
// same profile executed the suite again anyway. Nothing about the workspace
// had moved, so the second execution bought the run nothing.
test('a recorded pass answers a repeated request for the same profile', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  const layout = resolveRunLayout(root, run.run_id)
  const ledger = layout.evidence(AGENT_REPOSITORY_CHECK_RUNS_FILE)
  const fingerprint = gitWorkspaceSnapshot(root).fingerprint
  // The pass an agent's own command-line run stores, and the ledger entry
  // that points a later reader at its bytes.
  const pass = recordProfileGatePass(root, 'fast', commandLineResult(root), {
    run_ids: [run.run_id],
    fingerprint_before: fingerprint,
    started_at: '2026-09-13T09:00:00.000Z',
  })

  assert.ok(pass)
  mkdirSync(path.dirname(ledger.absolute), { recursive: true })
  writeFileSync(
    ledger.absolute,
    `${JSON.stringify({
      profile: 'fast',
      invocation_id: 'implement-1',
      workspace_fingerprint: fingerprint,
      status: 'passed',
      duration_ms: 90_000,
      started_at: '2026-09-13T09:00:00.000Z',
      invoked_by: 'agent',
      evidence_log: pass.evidence_path,
    })}\n`,
  )

  // The reuse names the execution it stands in for, so the worker cites that
  // run rather than describing an execution it did not perform.
  assert.deepEqual(
    reusableProfileExecution(
      root,
      run.run_id,
      'implement-1',
      'fast',
      fingerprint,
    ),
    {
      profile: 'fast',
      invocation_id: 'implement-1',
      worker_role: null,
      workspace_fingerprint: fingerprint,
      started_at: '2026-09-13T09:00:00.000Z',
      invoked_by: 'agent',
      evidence_log: pass.evidence_path,
      ledger_path: ledger.relative,
    },
  )

  // Reuse reads the ledger and writes nothing, so no second entry claims a
  // fresh execution.
  assert.equal(ledgerEntries(root, run.run_id).length, 1)
})

test('a reusable pass needs the same invocation, fingerprint, profile, and clean result', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  const ledger = resolveRunLayout(root, run.run_id).evidence(
    AGENT_REPOSITORY_CHECK_RUNS_FILE,
  ).absolute
  const fingerprint = gitWorkspaceSnapshot(root).fingerprint

  const entry = (overrides: Record<string, unknown> = {}): string =>
    `${JSON.stringify({
      profile: 'fast',
      invocation_id: 'implement-1',
      workspace_fingerprint: fingerprint,
      status: 'passed',
      duration_ms: 1,
      started_at: '2026-09-13T09:00:00.000Z',
      invoked_by: 'agent',
      ...overrides,
    })}\n`
  const reuse = (
    invocationId: string | null,
    profileName: string,
    observed: string,
    workerRole: string | null = null,
  ): ReusableProfileExecution | null =>
    reusableProfileExecution(
      root,
      run.run_id,
      invocationId,
      profileName,
      observed,
      workerRole,
    )

  // A run that has recorded nothing has nothing to reuse.
  assert.equal(reuse('implement-1', 'fast', fingerprint), null)

  mkdirSync(path.dirname(ledger), { recursive: true })
  writeFileSync(ledger, entry())

  assert.ok(reuse('implement-1', 'fast', fingerprint))

  // A different tree, another invocation's allowance, and another profile
  // each describe work this record does not cover.
  assert.equal(reuse('implement-1', 'fast', 'a'.repeat(64)), null)
  assert.equal(reuse('verify-1', 'fast', fingerprint), null)
  assert.equal(reuse('implement-1', 'static', fingerprint), null)

  // The two evidence workers of one verify stage share an invocation id, so
  // the role is the only thing that keeps their entries apart. The stage
  // worker's own entry answers no worker, and neither worker answers the
  // other.
  writeFileSync(ledger, entry({ invocation_id: 'verify-1' }))
  assert.equal(reuse('verify-1', 'fast', fingerprint, 'review'), null)

  writeFileSync(
    ledger,
    entry({ invocation_id: 'verify-1', worker_role: 'review' }),
  )
  assert.equal(reuse('verify-1', 'fast', fingerprint, 'qa'), null)
  assert.equal(reuse('verify-1', 'fast', fingerprint), null)
  assert.equal(
    reuse('verify-1', 'fast', fingerprint, 'review')?.worker_role,
    'review',
  )

  // A failure has to re-run to show its repair.
  writeFileSync(ledger, entry({ status: 'failed' }))
  assert.equal(reuse('implement-1', 'fast', fingerprint), null)

  // The newest matching entry wins, so a reader follows the bytes that
  // execution actually left behind.
  writeFileSync(
    ledger,
    [
      entry({ evidence_log: 'agent/evidence/first.log' }),
      entry({ evidence_log: 'agent/evidence/second.log' }),
    ].join(''),
  )
  assert.equal(
    reuse('implement-1', 'fast', fingerprint)?.evidence_log,
    'agent/evidence/second.log',
  )
})

// Deduplication makes an ordinary repeat invisible, so the forced repeat has
// to leave a mark: otherwise a worker that chose to spend the suite again
// looks identical to one that never asked.
test('a forced repeat is recorded as a deliberate rerun', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  recordAgentRepositoryCheckForRuns(
    root,
    [run.run_id],
    commandLineResult(root),
    '2026-09-13T09:00:00.000Z',
  )
  recordAgentRepositoryCheckForRuns(
    root,
    [run.run_id],
    commandLineResult(root),
    '2026-09-13T09:30:00.000Z',
    'agent',
    null,
    true,
  )

  const entries = ledgerEntries(root, run.run_id)

  assert.equal(entries.length, 2)
  assert.equal(entries[0].forced_repeat, undefined)
  assert.equal(entries[1].forced_repeat, true)
})
