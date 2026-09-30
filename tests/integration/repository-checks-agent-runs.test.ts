import assert from 'node:assert/strict'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  AGENT_REPOSITORY_CHECK_RUNS_FILE,
  HARNESS_LAUNCH_TOKEN_ENV,
  harnessLaunchDigest,
  agentRepositoryCheckAdvisories,
  recordAgentRepositoryCheck,
  recordAgentRepositoryCheckForRuns,
  REPOSITORY_CHECK_FAST_REPEATED,
  resolveRepositoryCheckInitiator,
  unrecordedProfileClaimAdvisories,
} from '../../src/lib/repository-checks.js'
import type { RepositoryCheckResult } from '../../src/lib/repository-checks.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import {
  prefetchRecordPath,
  resolveRunLayout,
} from '../../src/lib/run-layout.js'
import { createFixture, writeJson } from '../helpers.js'
import { createRun } from '../run-helpers.js'
import { makeInstallation } from './repository-checks-helpers.js'

test('an agent-run profile is recorded against the live run bound to its worktree', () => {
  const { root, workspace } = makeInstallation()
  const writeRun = (
    runId: string,
    status: string,
    worktree?: string,
    invocationId?: string,
  ) => {
    const directory = path.join(root, 'runtime/logs/workflows', runId, 'agent')

    mkdirSync(directory, { recursive: true })
    writeFileSync(
      path.join(directory, 'state.json'),
      `${JSON.stringify({
        schema_version: 2,
        run_id: runId,
        workflow_slug: 'delivery',
        title: runId,
        status,
        current_stage: 'implement',
        pending_action: { type: 'prepare_invocation' },
        current_invocation: invocationId
          ? {
              id: invocationId,
              json_path: `agent/invocations/${invocationId}.json`,
              markdown_path: `agent/invocations/${invocationId}.md`,
              output_path: `agent/outputs/${invocationId}.json`,
            }
          : null,
        stage_history: [],
        attempts: {},
        revision: 1,
        workspace_root: '../workspace',
        ...(worktree
          ? {
              managed_worktree: {
                name: worktree,
                path: `worktrees/operator/${worktree}`,
                branch: worktree,
              },
            }
          : {}),
      })}\n`,
    )
  }

  writeRun('live-bound', 'running', 'cohort-greeting', 'implement-1')
  writeRun('paused-bound', 'paused', 'cohort-greeting')
  writeRun('finished-bound', 'succeeded', 'cohort-greeting')
  writeRun('live-other', 'running', 'cohort-farewell')
  writeRun('live-unbound', 'running')

  const result: RepositoryCheckResult = {
    profile: 'fast',
    status: 'passed',
    config_path: 'runtime/repository-checks.json',
    workspace_root: workspace,
    timeout_ms: 1000,
    results: [],
    total_duration_ms: 1234,
    advisories: [],
  }
  const recorded = recordAgentRepositoryCheck(
    root,
    'cohort-greeting',
    result,
    '2026-09-05T02:00:00.000Z',
  )

  // Only the live runs bound to the worktree receive the record: a finished
  // run has nothing left to audit, and other runs never saw this execution.
  assert.deepEqual(recorded.sort(), [
    `runtime/logs/workflows/live-bound/agent/evidence/${AGENT_REPOSITORY_CHECK_RUNS_FILE}`,
    `runtime/logs/workflows/paused-bound/agent/evidence/${AGENT_REPOSITORY_CHECK_RUNS_FILE}`,
  ])

  const lines = readFileSync(path.join(root, recorded[0]), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)

  // The record names the run's current invocation, so the per-invocation
  // "fast at most once" rule is countable; a run between invocations records
  // null.
  assert.equal(lines.length, 1)
  assert.deepEqual(lines[0], {
    profile: 'fast',
    invocation_id: 'implement-1',
    workspace_fingerprint: lines[0].workspace_fingerprint,
    status: 'passed',
    duration_ms: 1234,
    started_at: '2026-09-05T02:00:00.000Z',
    invoked_by: 'agent',
  })
  assert.match(String(lines[0].workspace_fingerprint), /^[0-9a-f]{64}$/u)
  assert.equal(
    (
      JSON.parse(
        readFileSync(path.join(root, recorded[1]), 'utf8').trim(),
      ) as Record<string, unknown>
    ).invocation_id,
    null,
  )

  // One fast run for the invocation is within policy: no advisory.
  assert.deepEqual(
    agentRepositoryCheckAdvisories(root, 'live-bound', 'implement-1'),
    [],
  )

  // A second execution appends, so the "fast at most once" rule is countable.
  recordAgentRepositoryCheck(
    root,
    'cohort-greeting',
    { ...result, status: 'failed' },
    '2026-09-05T02:10:00.000Z',
  )

  assert.equal(
    readFileSync(path.join(root, recorded[0]), 'utf8').trim().split('\n')
      .length,
    2,
  )

  // Two fast runs for one invocation of a single-worker stage are reported by
  // name, as an advisory rather than a gate failure; another invocation's
  // count is its own. This run carries no workflow snapshot, so the stage
  // keeps the one-agent allowance.
  const advisories = agentRepositoryCheckAdvisories(
    root,
    'live-bound',
    'implement-1',
  )

  assert.equal(advisories.length, 1)
  assert.equal(advisories[0].id, REPOSITORY_CHECK_FAST_REPEATED)
  assert.equal(advisories[0].id, 'repository_check_fast_repeated')
  assert.match(advisories[0].message, /fast profile 2 times/u)
  assert.match(advisories[0].message, /implement-1/u)
  assert.match(
    advisories[0].message,
    /allows one run per agent, 1 for this stage \(one stage worker\)/u,
  )
  assert.deepEqual(
    agentRepositoryCheckAdvisories(root, 'live-bound', 'implement-2'),
    [],
  )
  // A run with no record file has nothing to report.
  assert.deepEqual(
    agentRepositoryCheckAdvisories(root, 'live-other', 'implement-1'),
    [],
  )

  // No bound live run means nothing is written anywhere.
  assert.deepEqual(
    recordAgentRepositoryCheck(root, 'unknown-worktree', result, 'now'),
    [],
  )
  assert.equal(
    existsSync(
      path.join(
        root,
        'runtime/logs/workflows/live-other/agent/evidence',
        AGENT_REPOSITORY_CHECK_RUNS_FILE,
      ),
    ),
    false,
  )

  // `--run` names the run directly, so a run without a worktree binding (a
  // release run in the base checkout) still receives its evidence.
  assert.deepEqual(
    recordAgentRepositoryCheckForRuns(root, ['live-unbound'], result, 'now'),
    [
      `runtime/logs/workflows/live-unbound/agent/evidence/${AGENT_REPOSITORY_CHECK_RUNS_FILE}`,
    ],
  )
})

test('the fast-profile allowance follows the evidence workers of the invocation stage', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  const layout = resolveRunLayout(root, run.run_id)
  const evidence = layout.evidence(AGENT_REPOSITORY_CHECK_RUNS_FILE).absolute
  const record = (invocationId: string): string =>
    `${JSON.stringify({
      profile: 'fast',
      invocation_id: invocationId,
      workspace_fingerprint: 'f'.repeat(64),
      status: 'passed',
      duration_ms: 1,
      started_at: '2026-09-05T02:00:00.000Z',
      invoked_by: 'agent',
    })}\n`

  // The invocation record names the stage; the run's own workflow snapshot
  // says how many agents that stage dispatches.
  writeJson(layout.invocation('verify-1', '.json').absolute, {
    stage: { slug: 'verify' },
  })
  writeJson(layout.invocation('implement-1', '.json').absolute, {
    stage: { slug: 'implement' },
  })
  mkdirSync(path.dirname(evidence), { recursive: true })
  writeFileSync(
    evidence,
    [
      record('verify-1'),
      record('verify-1'),
      record('implement-1'),
      record('implement-1'),
    ].join(''),
  )

  // Verify dispatches two evidence workers, each permitted one fast run, so
  // two records are compliant.
  assert.deepEqual(
    agentRepositoryCheckAdvisories(root, run.run_id, 'verify-1'),
    [],
  )

  // Implement declares no evidence worker, so its second record is one too
  // many.
  const implement = agentRepositoryCheckAdvisories(
    root,
    run.run_id,
    'implement-1',
  )

  assert.equal(implement.length, 1)
  assert.equal(implement[0].id, REPOSITORY_CHECK_FAST_REPEATED)
  assert.match(implement[0].message, /fast profile 2 times/u)
  assert.match(
    implement[0].message,
    /allows one run per agent, 1 for this stage \(one stage worker\)/u,
  )

  // A third verify record exceeds the two-worker allowance, and the message
  // states both the allowance and the count.
  appendFileSync(evidence, record('verify-1'))

  const verify = agentRepositoryCheckAdvisories(root, run.run_id, 'verify-1')

  assert.equal(verify.length, 1)
  assert.match(verify[0].message, /fast profile 3 times/u)
  assert.match(
    verify[0].message,
    /allows one run per agent, 2 for this stage \(2 evidence worker\(s\)\)/u,
  )
})

// R-02 of run 63290: `--harness-initiated` was the whole permission, and a
// documented flag is something the caller sets for itself. The declaration
// now needs the launch token the harness recorded a digest of, and the token
// leaves the environment so the profile's own children cannot inherit it.
test('harness authority comes from the recorded launch token, not the flag', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const token = 'a'.repeat(64)
  const record = prefetchRecordPath(root, run.run_id, 'full')

  mkdirSync(path.dirname(record.absolute), { recursive: true })
  writeFileSync(
    record.absolute,
    `${JSON.stringify({
      schema_version: 1,
      run_id: run.run_id,
      profile: 'full',
      launch_digest: harnessLaunchDigest(token),
    })}
`,
  )

  const previous = process.env[HARNESS_LAUNCH_TOKEN_ENV]

  try {
    process.env[HARNESS_LAUNCH_TOKEN_ENV] = token

    assert.equal(
      resolveRepositoryCheckInitiator(root, run.run_id, true),
      'harness',
    )
    // Reading it removes it, so a profile command this process starts does
    // not inherit the authority of the launch that started this process.
    assert.equal(process.env[HARNESS_LAUNCH_TOKEN_ENV], undefined)

    // RV-02 of run 63290: a same-user process can read a running child's
    // environment, so the launch is spent on first use. The record keeps its
    // other fields, because the supervisor reconciles the child from them.
    const spent = JSON.parse(readFileSync(record.absolute, 'utf8')) as Record<
      string,
      unknown
    >

    assert.equal(spent.launch_digest, undefined)
    assert.equal(spent.run_id, run.run_id)
    assert.ok(typeof spent.launch_consumed_at === 'string')

    process.env[HARNESS_LAUNCH_TOKEN_ENV] = token
    assert.throws(
      () => resolveRepositoryCheckInitiator(root, run.run_id, true),
      /harness launch token/u,
    )

    assert.equal(
      resolveRepositoryCheckInitiator(root, run.run_id, false),
      'agent',
    )

    process.env[HARNESS_LAUNCH_TOKEN_ENV] = 'b'.repeat(64)
    assert.throws(
      () => resolveRepositoryCheckInitiator(root, run.run_id, true),
      /harness launch token/u,
    )
  } finally {
    if (previous === undefined) {
      delete process.env[HARNESS_LAUNCH_TOKEN_ENV]
    } else {
      process.env[HARNESS_LAUNCH_TOKEN_ENV] = previous
    }
  }
})

// R-03 of run 63290: the lookup was scoped to the submitting invocation, so a
// verifier that obeyed its brief and cited the implement gate's pass was told
// its true claim had no evidence, and was pointed at a command its own
// contract forbade. Any passing execution of this run at this fingerprint is
// the evidence the claim needs.
test('a profile pass claim is answered by any current-run evidence', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const fingerprint = gitWorkspaceSnapshot(root).fingerprint
  const output = {
    summary: 'The fast profile passed at the current workspace.',
  }

  const ledger = resolveRunLayout(root, run.run_id).evidence(
    AGENT_REPOSITORY_CHECK_RUNS_FILE,
  )

  mkdirSync(path.dirname(ledger.absolute), { recursive: true })
  writeFileSync(
    ledger.absolute,
    `${JSON.stringify({
      profile: 'fast',
      invocation_id: 'implement-1',
      workspace_fingerprint: fingerprint,
      status: 'passed',
    })}
`,
  )

  assert.deepEqual(
    unrecordedProfileClaimAdvisories(root, run.run_id, fingerprint, output),
    [],
  )

  // A row at another fingerprint is evidence for another workspace, so the
  // advisory still fires.
  assert.equal(
    unrecordedProfileClaimAdvisories(root, run.run_id, 'other', output).length,
    1,
  )
})

// The same finding's second half: prose matching read every string in the
// document, so a finding that reported an unrecorded pass was itself read as
// a claim. Only what the worker asserts in its own voice is a claim.
test('a profile pass claim is read from the summary and criteria only', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const fingerprint = gitWorkspaceSnapshot(root).fingerprint

  assert.deepEqual(
    unrecordedProfileClaimAdvisories(root, run.run_id, fingerprint, {
      summary: 'Verification is complete.',
      risks: ['The output under review says the fast profile passed.'],
      data: {
        verify: {
          findings: [
            {
              evidence: [
                'The implement output claims the fast profile passed.',
              ],
            },
          ],
        },
      },
    }),
    [],
  )

  assert.equal(
    unrecordedProfileClaimAdvisories(root, run.run_id, fingerprint, {
      summary: 'Verification is complete.',
      criteria: [{ explanation: 'The fast profile passed at this workspace.' }],
    }).length,
    1,
  )
})

test('a profile pass claim without current ledger evidence names the sanctioned command', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const invocationId = 'implement-1'
  const fingerprint = gitWorkspaceSnapshot(root).fingerprint

  const output = {
    summary: 'The fast profile passed at the current workspace.',
  }
  const missing = unrecordedProfileClaimAdvisories(
    root,
    run.run_id,
    fingerprint,
    output,
  )

  assert.equal(missing.length, 1)
  assert.equal(missing[0].id, 'repository_check_claim_unrecorded')
  assert.match(
    missing[0].message,
    new RegExp(`repository-check fast --run ${run.run_id}`, 'u'),
  )

  const ledger = resolveRunLayout(root, run.run_id).evidence(
    AGENT_REPOSITORY_CHECK_RUNS_FILE,
  )

  mkdirSync(path.dirname(ledger.absolute), { recursive: true })
  writeFileSync(
    ledger.absolute,
    `${JSON.stringify({
      profile: 'fast',
      invocation_id: invocationId,
      workspace_fingerprint: fingerprint,
      status: 'passed',
    })}
`,
  )

  assert.deepEqual(
    unrecordedProfileClaimAdvisories(root, run.run_id, fingerprint, output),
    [],
  )
})
