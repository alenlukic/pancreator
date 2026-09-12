import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abandonBestOfNCandidate,
  bestOfNStatus,
  consolidateBestOfN,
  refreshBestOfNAgents,
} from '../../src/lib/best-of-n.js'
import { getRunState, prepareInvocation } from '../../src/lib/engine.js'
import {
  attestRunCard,
  createFixture,
  pinFixturePersonaModel,
  writeJson,
} from '../helpers.js'

import {
  bestOfNCheckpoint,
  driveCandidate,
  git,
  initSession,
} from './best-of-n-helpers.js'

test('best-of-N init isolates every candidate in its own worktree and model set', () => {
  const root = createFixture()

  // The base coder mapping must differ from both candidate models whatever
  // this checkout's config_overrides.json maps for it.
  pinFixturePersonaModel(root, 'coder', 'gpt-5.6-sol')

  const session = initSession(root, true)

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
    assert.equal(run.workflow_slug, 'delivery-candidate')
    assert.equal(run.best_of_n?.bon_id, session.bon_id)
    assert.equal(run.best_of_n?.role, 'candidate')
    assert.equal(run.cursor_agent_suffix, candidate.agent_suffix)
    assert.equal(run.operator_artifacts?.mode, 'requested')

    const snapshot = JSON.parse(
      readFileSync(path.join(root, run.pipeline_config?.path ?? ''), 'utf8'),
    ) as { personas: Record<string, string> }
    const expected =
      candidate.slot === 'alpha' ? 'gpt-5.6-terra' : 'claude-opus-5'

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
  const baseAgent = readFileSync(
    path.join(root, '.cursor/agents/pan-coder.md'),
    'utf8',
  )

  assert.match(baseAgent, /^model: gpt-5\.6-sol$/mu)
  assert.doesNotMatch(baseAgent, /gpt-5\.4|claude-opus-5/u)

  const candidate = session.candidates[0]

  attestRunCard(root, candidate.run_id)

  const prepared = prepareInvocation(root, candidate.run_id)
  const status = bestOfNStatus(root, session.bon_id)

  assert.ok(prepared.invocation)
  assert.equal(
    prepared.invocation.delegation?.cursor_agent_path,
    `.cursor/agents/pan-planner--${candidate.agent_suffix}.md`,
  )
  assert.equal(
    status.candidates[0].resume_command,
    `/pan-resume ${candidate.run_id}`,
  )

  for (const record of [...session.candidates, ...status.candidates]) {
    assert.equal('agent_path' in record, false)
  }
})

test('agent refresh preserves pinned models while updating instructions', () => {
  const { root, session } = bestOfNCheckpoint('ready')
  const candidate = session.candidates[0]
  const variant = path.join(
    root,
    `.cursor/agents/pan-planner--${candidate.agent_suffix}.md`,
  )
  const original = readFileSync(variant, 'utf8')
  const pinnedModel = /^model: .+$/mu.exec(original)?.[0]

  assert.ok(pinnedModel)

  writeFileSync(variant, original.replace('maxTurns: 28', 'maxTurns: 1'))

  const refreshed = refreshBestOfNAgents(root, session.bon_id)
  const updated = readFileSync(variant, 'utf8')

  assert.ok(
    refreshed.refreshed_agents.includes(
      `.cursor/agents/pan-planner--${candidate.agent_suffix}.md`,
    ),
  )
  assert.ok(updated.includes(pinnedModel))
  assert.match(updated, /maxTurns: 28/u)
  assert.equal(
    existsSync(
      path.join(
        root,
        `.cursor/agents/pan-orchestrator--${candidate.agent_suffix}.md`,
      ),
    ),
    false,
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

  attestRunCard(root, consolidationRunId)

  const prepared = prepareInvocation(root, consolidationRunId)

  assert.equal(prepared.invocation?.stage.slug, 'consolidate')
  assert.equal(
    prepared.invocation?.delegation?.cursor_agent_path,
    `.cursor/agents/pan-metacritic--${consolidated.consolidation?.agent_suffix}.md`,
  )

  // Nothing in a session may write history.
  assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), headBefore)
})
