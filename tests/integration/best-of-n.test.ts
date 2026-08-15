import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abandonBestOfNCandidate,
  bestOfNMutexPath,
  bestOfNStatus,
  cleanBestOfN,
  consolidateBestOfN,
  initBestOfN,
  pruneBestOfN,
  refreshBestOfNAgents,
} from '../../src/lib/best-of-n.js'
import {
  assessStage,
  getRunState,
  prepareInvocation,
  submitOutput,
} from '../../src/lib/engine.js'
import { withOperationMutex } from '../../src/lib/io.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')
const CONFIGS = {
  schema_version: 1,
  candidates: [
    { name: 'alpha', personas: { coder: 'gpt-5.4' } },
    { name: 'beta', personas: { coder: 'claude-opus-5' } },
  ],
  consolidation: { personas: { metacritic: 'gpt-5.6-sol' } },
}

/** Above every supported pid range, so this owner is provably not running. */
const DEAD_PID = 2 ** 31 - 1
const EXCLUSION_NOTE = 'Operator stopped this candidate.'

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  })
}

/** The session id a failed initialization names in its recovery guidance. */
function sessionIdFromFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const match = /runtime\/logs\/best-of-n\/([^/]+)\/state\.json/u.exec(message)

  assert.ok(match, `failure names the partial session record: ${message}`)

  return match[1]
}

function initSession(root: string): ReturnType<typeof initBestOfN> {
  writeJson(path.join(root, 'best-of-n.json'), CONFIGS)

  return initBestOfN(root, {
    requestPath: 'request.md',
    configsPath: 'best-of-n.json',
  })
}

function sessionStatePath(root: string, bonId: string): string {
  return path.join(root, 'runtime', 'logs', 'best-of-n', bonId, 'state.json')
}

function readSessionState(
  root: string,
  bonId: string,
): ReturnType<typeof initBestOfN> {
  return JSON.parse(
    readFileSync(sessionStatePath(root, bonId), 'utf8'),
  ) as ReturnType<typeof initBestOfN>
}

/** Mark a child run terminal so lifecycle guards treat it as finished. */
function terminateRun(root: string, runId: string): void {
  const runStatePath = resolveRunLayout(root, runId).state.absolute
  const state = JSON.parse(readFileSync(runStatePath, 'utf8')) as Record<
    string,
    unknown
  >

  writeJson(runStatePath, { ...state, status: 'canceled' })
}

test('best-of-N init fails when a setup command fails', () => {
  const root = createFixture()

  writeJson(path.join(root, 'best-of-n.json'), {
    ...CONFIGS,
    setup: ['node -e "process.exit(7)"'],
  })

  assert.throws(
    () =>
      initBestOfN(root, {
        requestPath: 'request.md',
        configsPath: 'best-of-n.json',
      }),
    /Setup command failed for candidate 'alpha'/u,
  )
})

test('a failed init leaves a session the lifecycle commands can recover', () => {
  const root = createFixture()

  writeJson(path.join(root, 'best-of-n.json'), {
    ...CONFIGS,
    setup: ['node -e "process.exit(7)"'],
  })

  let failure: unknown

  try {
    initBestOfN(root, {
      requestPath: 'request.md',
      configsPath: 'best-of-n.json',
    })
  } catch (error) {
    failure = error
  }

  assert.ok(failure, 'a failed setup command fails init')

  const bonId = sessionIdFromFailure(failure)
  const status = bestOfNStatus(root, bonId)

  // The worktree exists but its run does not, so the session is discoverable
  // rather than an orphan the commands cannot name.
  assert.equal(status.session_status, 'initializing')
  assert.equal(status.candidates.length, 0)
  assert.deepEqual(
    status.incomplete.map((entry) => entry.slot),
    ['alpha'],
  )
  assert.equal(status.consolidation_ready, false)
  assert.equal(status.recovery_command, `./bin/pan best-of-n clean ${bonId}`)

  assert.throws(
    () => consolidateBestOfN(root, bonId),
    /did not finish initialization/u,
  )

  const worktree = path.join(root, status.incomplete[0].worktree_path)

  assert.equal(existsSync(worktree), true)

  const cleaned = cleanBestOfN(root, bonId)

  assert.deepEqual(cleaned.removed_worktrees, [
    status.incomplete[0].worktree_path,
  ])
  assert.equal(existsSync(worktree), false)
})

test('one command at a time may mutate a session record', () => {
  const root = createFixture()
  const session = initSession(root)
  const candidate = session.candidates[0]

  withOperationMutex(bestOfNMutexPath(root, session.bon_id), () => {
    const mutations = [
      () =>
        abandonBestOfNCandidate(
          root,
          session.bon_id,
          candidate.run_id,
          EXCLUSION_NOTE,
        ),
      () => consolidateBestOfN(root, session.bon_id),
      () => cleanBestOfN(root, session.bon_id, { force: true }),
    ]

    for (const mutation of mutations) {
      assert.throws(mutation, /Another Pancreator command is updating/u)
    }
  })

  // Every refusal happened before its mutation, so nothing partial was written.
  assert.equal(
    bestOfNStatus(root, session.bon_id).candidates[0].abandoned,
    undefined,
  )

  abandonBestOfNCandidate(
    root,
    session.bon_id,
    candidate.run_id,
    EXCLUSION_NOTE,
  )

  assert.ok(bestOfNStatus(root, session.bon_id).candidates[0].abandoned)
})

test('a session recovers from a mutex its dead owner left behind', () => {
  const root = createFixture()
  const session = initSession(root)
  const mutex = bestOfNMutexPath(root, session.bon_id)

  writeFileSync(mutex, `${DEAD_PID}\n`)

  const state = abandonBestOfNCandidate(
    root,
    session.bon_id,
    session.candidates[0].run_id,
    EXCLUSION_NOTE,
  )

  assert.ok(state.candidates[0].abandoned)
  assert.equal(existsSync(mutex), false)
})

test('session state rejects an unknown lifecycle status', () => {
  const root = createFixture()
  const session = initSession(root)

  writeJson(
    path.join(
      root,
      'runtime',
      'logs',
      'best-of-n',
      session.bon_id,
      'state.json',
    ),
    { ...session, status: 'done' },
  )

  assert.throws(
    () => bestOfNStatus(root, session.bon_id),
    /MUST record status 'initializing' or 'ready'/u,
  )
})

function submitCandidateStage(
  root: string,
  runId: string,
  stageSlug: string,
  outcome: 'success' | 'failure' = 'success',
) {
  const workflow = loadWorkflow(root, 'dev-candidate')
  const prepared = prepareInvocation(root, runId)
  const invocation = prepared.invocation

  assert.ok(invocation, `${stageSlug}: expected an invocation`)
  assert.equal(invocation.stage.slug, stageSlug)

  const stage = stageBySlug(workflow, stageSlug)

  writeJson(
    path.join(root, invocation.output.path),
    makeOutput(root, invocation, stage, outcome),
  )

  if (stage.persona !== 'orchestrator') {
    writeCanonicalDelegation(root, invocation)
  }

  const submitted = submitOutput(root, runId, invocation.output.path)

  assert.equal(
    submitted.record.outcome,
    outcome,
    `${stageSlug}: ${JSON.stringify(submitted.record.evaluation)}`,
  )

  if (submitted.state.pending_action.type !== 'supervisor_assessment') {
    return submitted.state
  }

  const assessmentPath = submitted.state.pending_action.output_path

  writeJson(path.join(root, assessmentPath), {
    schema_version: 1,
    assessment_id: randomUUID(),
    invocation_id: invocation.invocation_id,
    verdict: 'pass',
    summary: 'Fixture assessment.',
    criteria: stage.criteria.map((criterion) => ({
      id: criterion.id,
      result: 'pass',
      evidence: [invocation.output.path],
      explanation: 'Fixture evidence',
    })),
  })

  return assessStage(root, runId, assessmentPath).state
}

/** Advance one autonomous candidate run from intake to a terminal outcome. */
function driveCandidate(root: string, runId: string): void {
  for (const stageSlug of ['intake', 'plan', 'implement', 'review', 'test']) {
    submitCandidateStage(root, runId, stageSlug)
  }
}

test('best-of-N init isolates every candidate in its own worktree and model set', () => {
  const root = createFixture()
  const session = initSession(root)

  assert.equal(session.candidates.length, 2)
  assert.equal(session.status, 'ready')
  assert.deepEqual(session.pending, [])

  const worktrees = git(root, ['worktree', 'list', '--porcelain'])

  for (const candidate of session.candidates) {
    const worktree = path.join(root, candidate.worktree_path)

    assert.ok(existsSync(worktree), `${candidate.slot} worktree exists`)
    assert.ok(worktrees.includes(worktree))

    const run = getRunState(root, candidate.run_id)

    assert.equal(run.workspace_root, candidate.worktree_path)
    assert.equal(run.workflow_slug, 'dev-candidate')
    assert.equal(run.best_of_n?.bon_id, session.bon_id)
    assert.equal(run.best_of_n?.role, 'candidate')
    assert.equal(run.cursor_agent_suffix, candidate.agent_suffix)

    const snapshot = JSON.parse(
      readFileSync(path.join(root, run.pipeline_config?.path ?? ''), 'utf8'),
    ) as { personas: Record<string, string> }
    const expected = candidate.slot === 'alpha' ? 'gpt-5.4' : 'claude-opus-5'

    // The candidate map overrides config.json defaults; everything else falls
    // through to them.
    assert.equal(snapshot.personas.coder, expected)
    assert.ok(snapshot.personas.reviewer)

    const variant = path.join(
      root,
      `.cursor/agents/pan-coder--${candidate.agent_suffix}.md`,
    )

    assert.ok(existsSync(variant))
    assert.match(
      readFileSync(variant, 'utf8'),
      new RegExp(`^model: ${expected}$`, 'mu'),
    )
  }

  // Base agents keep the active mapping, so an ordinary run is unaffected.
  assert.doesNotMatch(
    readFileSync(path.join(root, '.cursor/agents/pan-coder.md'), 'utf8'),
    /gpt-5\.4|claude-opus-5/u,
  )
})

test('a candidate run delegates to its own agent variant', () => {
  const root = createFixture()
  const session = initSession(root)
  const candidate = session.candidates[0]
  const prepared = prepareInvocation(root, candidate.run_id)
  const status = bestOfNStatus(root, session.bon_id)

  assert.ok(prepared.invocation)
  assert.equal(
    prepared.invocation.delegation?.cursor_agent_path,
    `.cursor/agents/pan-intake-writer--${candidate.agent_suffix}.md`,
  )
  assert.equal(
    status.candidates[0].resume_command,
    `/pan-resume ${candidate.run_id}`,
  )
})

test('agent refresh preserves pinned models while updating instructions', () => {
  const root = createFixture()
  const session = initSession(root)
  const candidate = session.candidates[0]
  const variant = path.join(
    root,
    `.cursor/agents/pan-orchestrator--${candidate.agent_suffix}.md`,
  )
  const original = readFileSync(variant, 'utf8')
  const pinnedModel = /^model: .+$/mu.exec(original)?.[0]

  assert.ok(pinnedModel)

  writeFileSync(variant, original.replace('maxTurns: 120', 'maxTurns: 1'))

  const refreshed = refreshBestOfNAgents(root, session.bon_id)
  const updated = readFileSync(variant, 'utf8')

  assert.ok(
    refreshed.refreshed_agents.includes(
      `.cursor/agents/pan-orchestrator--${candidate.agent_suffix}.md`,
    ),
  )
  assert.ok(updated.includes(pinnedModel))
  assert.match(updated, /maxTurns: 120/u)
})

test('status surfaces invalid candidate state', () => {
  const root = createFixture()
  const session = initSession(root)
  const candidate = session.candidates[0]
  const statePath = resolveRunLayout(root, candidate.run_id).state.absolute

  writeJson(statePath, { schema_version: 1 })

  assert.throws(
    () => bestOfNStatus(root, session.bon_id),
    /state\.json\.run_id MUST be a non-empty string/u,
  )
})

test('a candidate run keeps workflow-declared gates under a high-touch profile', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    operator_involvement: { active: string }
  }

  config.operator_involvement.active = 'high-touch'
  writeJson(configPath, config)

  const session = initSession(root)
  const run = getRunState(root, session.candidates[0].run_id)

  assert.deepEqual(run.operator_involvement?.applied_gates, {})
  assert.deepEqual(run.operator_involvement?.contracts, [])

  const snapshot = JSON.parse(
    readFileSync(path.join(root, run.workflow_snapshot.path), 'utf8'),
  ) as { stages: Array<{ slug: string; gate: string }> }

  assert.ok(snapshot.stages.every((stage) => stage.gate !== 'operator'))
})

test('a candidate circuit breaker ends that candidate without operator input', () => {
  const root = createFixture()
  const session = initSession(root)
  const candidate = session.candidates[0]

  submitCandidateStage(root, candidate.run_id, 'intake')
  submitCandidateStage(root, candidate.run_id, 'plan')
  submitCandidateStage(root, candidate.run_id, 'implement')
  submitCandidateStage(root, candidate.run_id, 'review', 'failure')
  submitCandidateStage(root, candidate.run_id, 'implement')

  const failed = submitCandidateStage(
    root,
    candidate.run_id,
    'review',
    'failure',
  )

  assert.equal(failed.status, 'failed')
  assert.equal(failed.pending_action.type, 'none')
  assert.equal(failed.current_stage, null)

  const status = bestOfNStatus(root, session.bon_id)
  const candidateStatus = status.candidates.find(
    (entry) => entry.run_id === candidate.run_id,
  )

  assert.equal(candidateStatus?.terminal, true)
  assert.ok(!status.unresolved.includes(candidate.run_id))
})

test('consolidation waits for every candidate and then evaluates all of them', () => {
  const root = createFixture()
  const session = initSession(root)
  const [alpha, beta] = session.candidates
  const headBefore = git(root, ['rev-parse', 'HEAD']).trim()

  assert.throws(
    () => consolidateBestOfN(root, session.bon_id),
    /unresolved candidates/u,
  )

  driveCandidate(root, alpha.run_id)

  assert.equal(getRunState(root, alpha.run_id).status, 'succeeded')
  assert.throws(
    () => consolidateBestOfN(root, session.bon_id),
    /unresolved candidates/u,
  )

  abandonBestOfNCandidate(
    root,
    session.bon_id,
    beta.run_id,
    'Operator stopped this candidate.',
  )

  const status = bestOfNStatus(root, session.bon_id)

  assert.equal(status.successes, 1)
  assert.deepEqual(status.unresolved, [])
  assert.equal(status.consolidation_ready, true)

  const consolidated = consolidateBestOfN(root, session.bon_id)
  const consolidationRunId = consolidated.consolidation?.run_id

  assert.ok(consolidationRunId)

  const request = readFileSync(
    path.join(root, consolidated.consolidation?.request_path ?? ''),
    'utf8',
  )

  // An excluded candidate is still evidence the consolidation must weigh.
  assert.match(request, /### alpha/u)
  assert.match(request, /### beta/u)
  assert.match(request, /Operator stopped this candidate\./u)

  const consolidationRun = getRunState(root, consolidationRunId)

  assert.equal(consolidationRun.workflow_slug, 'metacritic')
  assert.equal(consolidationRun.workspace_root, '.')
  assert.equal(consolidationRun.best_of_n?.role, 'consolidation')

  const prepared = prepareInvocation(root, consolidationRunId)

  assert.equal(prepared.invocation?.stage.slug, 'consolidate')
  assert.equal(
    prepared.invocation?.delegation?.cursor_agent_path,
    `.cursor/agents/pan-metacritic--${consolidated.consolidation?.agent_suffix}.md`,
  )

  // Nothing in a session may write history.
  assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), headBefore)
})

test('consolidation refuses a session no candidate finished', () => {
  const root = createFixture()
  const session = initSession(root)

  for (const candidate of session.candidates) {
    abandonBestOfNCandidate(
      root,
      session.bon_id,
      candidate.run_id,
      'Operator stopped this candidate.',
    )
  }

  assert.throws(
    () => consolidateBestOfN(root, session.bon_id),
    /no successful candidate/u,
  )
})

test('clean refuses to discard uncommitted candidate work without force', () => {
  const root = createFixture()
  const session = initSession(root)
  const candidate = session.candidates.at(-1)

  assert.ok(candidate)

  // Terminal runs put the dirtiness refusal — not the liveness refusal — under
  // test.
  for (const entry of session.candidates) {
    terminateRun(root, entry.run_id)
  }

  writeJson(path.join(root, candidate.worktree_path, 'src', 'candidate.json'), {
    changed: true,
  })

  assert.throws(
    () => cleanBestOfN(root, session.bon_id),
    /Removing it discards that work/u,
  )

  for (const entry of session.candidates) {
    assert.equal(existsSync(path.join(root, entry.worktree_path)), true)
  }

  const result = cleanBestOfN(root, session.bon_id, { force: true })

  assert.deepEqual(
    result.removed_worktrees,
    session.candidates.map((entry) => entry.worktree_path).sort(),
  )
  assert.ok(
    result.removed_agents.some((name) =>
      name.startsWith(`pan-coder--${candidate.agent_suffix}`),
    ),
  )
  assert.equal(existsSync(path.join(root, candidate.worktree_path)), false)
  assert.equal(
    git(root, ['worktree', 'list', '--porcelain']).includes(
      path.join(root, candidate.worktree_path),
    ),
    false,
  )
})

test('clean refuses to remove a live candidate workspace without force', () => {
  const root = createFixture()
  const session = initSession(root)

  // Fresh candidate runs are still in flight with clean worktrees, which is
  // exactly the state a dirtiness-only preflight would remove.
  assert.throws(
    () => cleanBestOfN(root, session.bon_id),
    /Finish or abort the run first/u,
  )

  for (const candidate of session.candidates) {
    assert.equal(existsSync(path.join(root, candidate.worktree_path)), true)
  }

  for (const candidate of session.candidates) {
    terminateRun(root, candidate.run_id)
  }

  const result = cleanBestOfN(root, session.bon_id)

  assert.deepEqual(
    result.removed_worktrees,
    session.candidates.map((entry) => entry.worktree_path).sort(),
  )
})

test('clean refuses while the consolidation run is in flight', () => {
  const root = createFixture()
  const session = initSession(root)
  const [alpha, beta] = session.candidates

  driveCandidate(root, alpha.run_id)
  abandonBestOfNCandidate(root, session.bon_id, beta.run_id, EXCLUSION_NOTE)

  const consolidated = consolidateBestOfN(root, session.bon_id)
  const consolidationRunId = consolidated.consolidation?.run_id

  assert.ok(consolidationRunId)
  // The candidate worktrees are the consolidation run's declared inputs and
  // its agent variants gate every later engine operation on the run.
  assert.throws(
    () => cleanBestOfN(root, session.bon_id),
    /consolidation run .* is still/u,
  )

  terminateRun(root, consolidationRunId)

  const result = cleanBestOfN(root, session.bon_id)

  assert.ok(
    result.removed_agents.some((name) =>
      name.includes(consolidated.consolidation?.agent_suffix ?? ''),
    ),
  )
})

test('prune removes finished and orphaned resources but preserves active runs', () => {
  const root = createFixture()
  const finished = initSession(root)

  for (const candidate of finished.candidates) {
    terminateRun(root, candidate.run_id)
  }

  const active = initSession(root)
  const orphanBonId = '1_Jan-01-2026_deadbeef'
  const orphanWorktree = path.join(
    root,
    'runtime',
    'worktrees',
    orphanBonId,
    'orphan',
  )

  git(root, ['worktree', 'add', '--detach', orphanWorktree, 'HEAD'])

  const orphanAgent = path.join(
    root,
    '.cursor',
    'agents',
    'pan-coder--bondeadbeef-orphan.md',
  )

  writeFileSync(orphanAgent, 'orphan projection\n')

  const result = pruneBestOfN(root)

  assert.ok(
    result.cleaned_sessions.some(
      (session) => session.bon_id === finished.bon_id,
    ),
  )
  assert.ok(
    result.skipped.some(
      (entry) => entry.resource === `session:${active.bon_id}`,
    ),
  )

  for (const candidate of finished.candidates) {
    assert.equal(existsSync(path.join(root, candidate.worktree_path)), false)
  }

  for (const candidate of active.candidates) {
    assert.equal(existsSync(path.join(root, candidate.worktree_path)), true)
  }

  assert.deepEqual(result.removed_orphan_worktrees, [
    `runtime/worktrees/${orphanBonId}/orphan`,
  ])
  assert.ok(result.removed_orphan_agents.includes(path.basename(orphanAgent)))
  assert.equal(existsSync(orphanAgent), false)

  const forced = pruneBestOfN(root, { force: true })

  assert.ok(
    forced.skipped.some(
      (entry) => entry.resource === `session:${active.bon_id}`,
    ),
  )

  for (const candidate of active.candidates) {
    assert.equal(existsSync(path.join(root, candidate.worktree_path)), true)
  }
})

test('best-of-N prune is available through the CLI', () => {
  const root = createFixture()
  const result = JSON.parse(
    execFileSync(process.execPath, [CLI, 'best-of-n', 'prune', '--json'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    }),
  ) as {
    cleaned_sessions: unknown[]
    removed_orphan_worktrees: unknown[]
    removed_orphan_agents: unknown[]
    skipped: unknown[]
  }

  assert.deepEqual(result, {
    cleaned_sessions: [],
    removed_orphan_worktrees: [],
    removed_orphan_agents: [],
    skipped: [],
  })
})

test('an interrupted candidate handoff is adopted from the run state', () => {
  const root = createFixture()
  const session = initSession(root)
  const [alpha, beta] = session.candidates

  // Reproduce a process killed between createRun and the session-record write:
  // the beta run exists durably while the session still shows a pending slot.
  writeJson(sessionStatePath(root, session.bon_id), {
    ...session,
    status: 'initializing',
    candidates: [alpha],
    pending: [
      {
        slot: beta.slot,
        worktree_path: beta.worktree_path,
        agent_suffix: beta.agent_suffix,
      },
    ],
  })

  const status = bestOfNStatus(root, session.bon_id)

  assert.equal(status.session_status, 'ready')
  assert.deepEqual(status.incomplete, [])
  assert.deepEqual(
    status.candidates.map((entry) => entry.run_id).sort(),
    [alpha.run_id, beta.run_id].sort(),
  )

  // Cleanup must reconcile before it decides which worktrees and live runs the
  // session owns. Terminal runs make the non-forced cleanup safe.
  terminateRun(root, alpha.run_id)
  terminateRun(root, beta.run_id)

  const cleaned = cleanBestOfN(root, session.bon_id)

  const persisted = readSessionState(root, session.bon_id)

  assert.deepEqual(
    cleaned.removed_worktrees,
    [alpha.worktree_path, beta.worktree_path].sort(),
  )
  assert.equal(persisted.status, 'ready')
  assert.deepEqual(persisted.pending, [])
  assert.deepEqual(
    persisted.candidates.map((entry) => entry.run_id).sort(),
    [alpha.run_id, beta.run_id].sort(),
  )
})

test('an interrupted consolidation handoff cannot start a second consolidation run', () => {
  const root = createFixture()
  const session = initSession(root)
  const [alpha, beta] = session.candidates

  driveCandidate(root, alpha.run_id)
  abandonBestOfNCandidate(root, session.bon_id, beta.run_id, EXCLUSION_NOTE)

  const consolidated = consolidateBestOfN(root, session.bon_id)
  const consolidationRunId = consolidated.consolidation?.run_id

  assert.ok(consolidationRunId)

  // Reproduce a process killed between createRun and the session-record write:
  // the consolidation run exists durably while the session records none.
  const { consolidation: _consolidation, ...withoutConsolidation } =
    readSessionState(root, session.bon_id)

  writeJson(sessionStatePath(root, session.bon_id), withoutConsolidation)

  // A retry adopts the existing run instead of creating a duplicate against
  // the same workspace.
  assert.throws(
    () => consolidateBestOfN(root, session.bon_id),
    /already started consolidation run/u,
  )

  const persisted = readSessionState(root, session.bon_id)

  assert.equal(persisted.consolidation?.run_id, consolidationRunId)
  assert.equal(
    bestOfNStatus(root, session.bon_id).consolidation?.run_id,
    consolidationRunId,
  )
})

test('init rejects a candidate config that maps an unknown persona', () => {
  const root = createFixture()

  writeJson(path.join(root, 'best-of-n.json'), {
    ...CONFIGS,
    candidates: [
      { name: 'alpha', personas: { codeer: 'gpt-5.4' } },
      CONFIGS.candidates[1],
    ],
  })

  assert.throws(
    () =>
      initBestOfN(root, {
        requestPath: 'request.md',
        configsPath: 'best-of-n.json',
      }),
    /Candidate 'alpha' maps unknown persona 'codeer'/u,
  )
})

test('init validates the consolidation config before any candidate runs', () => {
  const root = createFixture()

  writeJson(path.join(root, 'best-of-n.json'), {
    ...CONFIGS,
    consolidation: { personas: { metacritick: 'gpt-5.4' } },
  })

  assert.throws(
    () =>
      initBestOfN(root, {
        requestPath: 'request.md',
        configsPath: 'best-of-n.json',
      }),
    /Consolidation config 'consolidation' maps unknown persona 'metacritick'/u,
  )

  // A consolidation persona with neither a mapping nor a default fails at
  // init, not after N candidate runs completed.
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    defaults: Record<string, string>
  }

  delete config.defaults.metacritic
  writeJson(configPath, config)
  writeJson(path.join(root, 'best-of-n.json'), {
    ...CONFIGS,
    consolidation: { personas: { reviewer: 'gpt-5.4' } },
  })

  assert.throws(
    () =>
      initBestOfN(root, {
        requestPath: 'request.md',
        configsPath: 'best-of-n.json',
      }),
    /maps no model for persona 'metacritic'/u,
  )

  // Nothing was created for either rejected config.
  assert.equal(existsSync(path.join(root, 'runtime', 'worktrees')), false)
})

test('consolidate refuses a stored configs file that drifted since init', () => {
  const root = createFixture()
  const session = initSession(root)
  const storedConfigs = path.join(
    root,
    'runtime',
    'logs',
    'best-of-n',
    session.bon_id,
    'configs.json',
  )

  writeFileSync(storedConfigs, `${readFileSync(storedConfigs, 'utf8')}\n`)

  assert.throws(
    () => consolidateBestOfN(root, session.bon_id),
    /no longer match the digest recorded at initialization/u,
  )
})
