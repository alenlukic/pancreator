import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

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

test('prepare selects an evidence-role agent before launch and recording', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  setRunStage(root, run.run_id, 'verify', 'Verify the current workspace.')

  const prepared = prepareInvocation(root, run.run_id, {
    agent: 'pan-reviewer',
  })

  assert.ok(prepared.invocation)
  assert.deepEqual(prepared.prepared_evidence, {
    role: 'review',
    agent: 'pan-reviewer',
    prompt_path: prepared.invocation.evidence_workers?.[0].brief_path,
    evidence_path: prepared.invocation.evidence_workers?.[0].evidence_path,
    attempt: 1,
  })

  const report = prepared.prepared_evidence?.evidence_path

  assert.ok(report)
  writeFileSync(path.join(root, report), '# completed review\n')

  const recorded = recordDelegatedWorker(root, run.run_id, {
    handle: 'bc-review-returned',
    invocationId: prepared.invocation.invocation_id,
    role: 'review',
    agent: 'pan-reviewer',
  })

  assert.equal(recorded.record.attempt, 1)
  assert.equal(recorded.evidence_attempt?.evidence_path, report)
})

// `--agent` asks two questions at once when one persona serves the stage
// worker and an evidence role: which evidence launch is this, and does the
// stage still owe its delegation artifact. Answering only the first dropped
// the artifact `pan submit` later requires.
test('a shared agent name prepares the evidence launch and the stage delegation', () => {
  const root = createFixture()
  const stagePath = path.join(
    root,
    'library',
    'workflows',
    'delivery',
    'stages',
    'verify.json',
  )
  const stage = JSON.parse(readFileSync(stagePath, 'utf8')) as {
    persona: string
    evidence_workers: Array<{ persona: string; role: string }>
  }
  const shared = stage.evidence_workers[0]

  assert.ok(shared)

  // The stage worker and the review evidence worker now project to one
  // agent name, which is the ambiguity the repair has to resolve.
  stage.persona = shared.persona
  writeFileSync(stagePath, `${JSON.stringify(stage, null, 2)}\n`)

  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  setRunStage(root, run.run_id, 'verify', 'Verify the current workspace.')

  const prepared = prepareInvocation(root, run.run_id)
  const agent = (prepared.invocation?.evidence_workers ?? [])[0]?.agent

  assert.ok(agent)

  const shipped = prepareInvocation(root, run.run_id, { agent })

  assert.equal(shipped.prepared_evidence?.role, shared.role)
  assert.ok(
    shipped.prepared_delegation,
    'the stage delegation is still prepared for its own agent',
  )
  assert.ok(shipped.prepared_delegation.artifact_path)
  assert.ok(
    existsSync(path.join(root, shipped.prepared_delegation.artifact_path)),
  )
})

// A foreground evidence worker can finish before Cursor returns the platform
// handle. Recording that handle attaches to the report's prepared attempt.
test('a completed evidence report receives its late platform handle', () => {
  const { root, runId, invocation } = verifyInvocation()
  const invocationId = invocation.invocation_id
  const first = (invocation.evidence_workers ?? [])[0]
  const firstBody = '# Review evidence, first attempt\n'

  writeFileSync(path.join(root, first.evidence_path), firstBody)

  const recorded = recordDelegatedWorker(root, runId, {
    handle: 'bc-returned',
    invocationId,
    role: first.role,
  })

  assert.ok(recorded.evidence_attempt)
  assert.equal(recorded.record.attempt, 1)
  assert.equal(recorded.evidence_attempt.evidence_path, first.evidence_path)
  assert.equal(recorded.evidence_attempt.brief_path, first.brief_path)
  assert.equal(recorded.warnings, undefined)
  assert.equal(
    readFileSync(path.join(root, first.evidence_path), 'utf8'),
    firstBody,
  )
  assert.deepEqual(
    (readInvocation(root, runId, invocationId).evidence_workers ?? [])
      .find((worker) => worker.role === first.role)
      ?.attempts?.map((attempt) => attempt.attempt),
    [1],
  )
})

// A stalled worker relaunched before its first handle was ever recorded is
// indistinguishable on disk from a late handle for the launch that wrote the
// report. The caller knows which one it is, so it says so.
test('an explicit new attempt protects the report of an unrecorded relaunch', () => {
  const { root, runId, invocation } = verifyInvocation()
  const invocationId = invocation.invocation_id
  const first = (invocation.evidence_workers ?? [])[0]
  const firstBody = '# partial evidence from the stalled worker\n'

  writeFileSync(path.join(root, first.evidence_path), firstBody)

  const relaunch = recordDelegatedWorker(root, runId, {
    handle: 'bc-relaunch-unrecorded',
    invocationId,
    role: first.role,
    newAttempt: true,
  })

  assert.ok(relaunch.evidence_attempt)
  assert.equal(relaunch.record.attempt, 2)
  assert.notEqual(relaunch.evidence_attempt.evidence_path, first.evidence_path)
  assert.equal(
    readFileSync(path.join(root, first.evidence_path), 'utf8'),
    firstBody,
  )
  assert.match(relaunch.warnings?.[0] ?? '', /prepared card/u)
})

// Attempt 1 can stay unrecorded while attempt 2 carries a handle. A handle
// that arrives after that must not attach behind the recorded attempt.
test('a late handle does not attach behind a recorded newer attempt', () => {
  const { root, runId, invocation } = verifyInvocation()
  const invocationId = invocation.invocation_id
  const first = (invocation.evidence_workers ?? [])[0]

  writeFileSync(path.join(root, first.evidence_path), '# stalled\n')

  const second = recordDelegatedWorker(root, runId, {
    handle: 'bc-second',
    invocationId,
    role: first.role,
    newAttempt: true,
  })

  assert.equal(second.record.attempt, 2)

  const third = recordDelegatedWorker(root, runId, {
    handle: 'bc-third',
    invocationId,
    role: first.role,
  })

  assert.equal(third.record.attempt, 3)
  assert.notEqual(
    third.evidence_attempt?.evidence_path,
    first.evidence_path,
    'attempt 1 stays unrecorded rather than receiving a later launch',
  )
})

// A role whose prepared attempt already carries a handle is a genuine
// relaunch. It receives fresh paths and reports the prepared-card impact.
test('a genuine evidence relaunch allocates attempt two and warns', () => {
  const { root, runId, invocation } = verifyInvocation()
  const invocationId = invocation.invocation_id
  const first = (invocation.evidence_workers ?? [])[0]

  recordDelegatedWorker(root, runId, {
    handle: 'bc-first',
    invocationId,
    role: first.role,
  })
  writeFileSync(path.join(root, first.evidence_path), '# first attempt\n')

  const {
    PANCREATOR_ROOT: _root,
    PANCREATOR_EXEC_ROOT: _execRoot,
    PANCREATOR_BUILD_READY: _buildReady,
    ...env
  } = process.env
  const command = spawnSync(
    process.execPath,
    [
      CLI,
      'worker',
      'record',
      runId,
      '--handle',
      'bc-relaunch',
      '--invocation',
      invocationId,
      '--role',
      first.role,
      '--json',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...env, PANCREATOR_ROOT: root },
    },
  )
  const relaunch = JSON.parse(command.stdout) as ReturnType<
    typeof recordDelegatedWorker
  >

  assert.equal(command.status, 0, command.stderr)
  assert.equal(relaunch.record.attempt, 2)
  assert.ok(relaunch.evidence_attempt)
  assert.notEqual(relaunch.evidence_attempt.evidence_path, first.evidence_path)
  assert.equal(relaunch.warnings?.length, 1)
  assert.match(relaunch.warnings?.[0] ?? '', /prepared card/u)
  assert.match(relaunch.warnings?.[0] ?? '', /sha256:[0-9a-f]{64}/u)

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
  const first = (invocation.evidence_workers ?? [])[0]

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

  recordDelegatedWorker(root, runId, {
    handle: 'bc-evidence-first',
    invocationId,
    role: first.role,
  })
  writeFileSync(path.join(root, first.evidence_path), '# first attempt\n')

  const relaunch = recordDelegatedWorker(root, runId, {
    handle: 'bc-relaunch',
    invocationId,
    role: first.role,
  })

  assert.ok(relaunch.evidence_attempt)
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
  assert.ok(existsSync(path.join(root, relaunch.evidence_attempt.brief_path)))
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

  const first = (invocation.evidence_workers ?? [])[0]
  const relaunch = recordDelegatedWorker(root, runId, {
    handle: 'bc-relaunch',
    invocationId: invocation.invocation_id,
    role: first.role,
  })

  assert.ok(relaunch.evidence_attempt)
  assert.ok(
    invocationEvidencePaths(
      root,
      runId,
      readInvocation(root, runId, invocation.invocation_id),
    ).includes(relaunch.evidence_attempt.evidence_path),
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
