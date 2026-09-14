import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { abortRun, getRunState } from '../../src/lib/engine.js'
import { loadState, loadStateRevision } from '../../src/lib/state.js'
import type { ResolvedRunCitation } from '../../src/lib/workflow-artifacts.js'
import { checkpoint } from './delivery-helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

test('aborting a run finalizes artifact numbering and layout', () => {
  const { root, runId, state, invocation } = checkpoint(
    'planning@plan-prepared',
  )

  assert.ok(invocation)
  assert.match(invocation.invocation_id, /^99_plan-1_/u)

  // Finalization renames the 99_-prefixed invocation id. Do not rewrite the
  // revision artifact content, because a new digest breaks loadState for the
  // closed run.
  const preparedRevision = state.revision

  const canceled = abortRun(root, runId, 'operator canceled')
  const persisted = getRunState(root, runId)
  const runDirectory = path.join(root, 'runtime/logs/workflows', runId)

  assert.equal(canceled.status, 'canceled')
  assert.equal(persisted.status, 'canceled')
  assert.equal(persisted.current_invocation, null)
  const agentDirectory = path.join(runDirectory, 'agent')
  const operatorDirectory = path.join(runDirectory, 'operator')
  const invocationFiles = readdirSync(path.join(agentDirectory, 'invocations'))

  assert.ok(invocationFiles.some((name) => /^00_plan-1_.*\.json$/u.test(name)))
  assert.ok(invocationFiles.some((name) => /^00_plan-1_.*\.md$/u.test(name)))
  assert.equal(existsSync(path.join(runDirectory, 'records')), false)
  assert.equal(existsSync(path.join(agentDirectory, 'artifacts/json')), true)
  assert.equal(existsSync(operatorDirectory), true)
  assert.equal(existsSync(path.join(runDirectory, 'artifacts')), false)
  assert.match(
    readFileSync(path.join(agentDirectory, 'events.jsonl'), 'utf8'),
    /"type":"workflow_artifacts_finalized"/u,
  )

  const reloaded = loadState(root, runId)

  assert.equal(reloaded.status, 'canceled')

  const historical = loadStateRevision(root, runId, preparedRevision)

  assert.match(
    historical.current_invocation?.id ?? '',
    /^99_plan-1_/u,
    'historical revisions keep their pre-finalization invocation ids',
  )
})

// The rewrite repairs every reference inside the run, and a citation that
// left the run — in an operator's notes, a chat, a report of another run —
// is the one it cannot reach. Those citations are how a reader returns to
// the record, so the run has to answer for the ids it retired.
test('a citation written before the close resolves through pan status', () => {
  const { root, runId, invocation } = checkpoint('planning@plan-prepared')

  assert.ok(invocation)
  const citation = `runtime/logs/workflows/${runId}/agent/invocations/${invocation.invocation_id}.md`

  abortRun(root, runId, 'operator canceled')

  assert.equal(
    existsSync(path.join(root, citation)),
    false,
    'the close retired the cited path',
  )

  const resolution = JSON.parse(
    execFileSync(
      process.execPath,
      [CLI, 'status', runId, '--resolve', citation, '--json'],
      { cwd: root, encoding: 'utf8' },
    ),
  ) as ResolvedRunCitation

  assert.equal(resolution.aliased, true)
  assert.match(resolution.resolved, /\/00_plan-1_[^/]+\.md$/u)
  assert.equal(resolution.path, resolution.resolved)
  assert.equal(existsSync(path.join(root, resolution.path ?? '')), true)
  assert.ok(resolution.alias_path)

  // The operator reading the terminal gets the same answer as the tooling.
  assert.match(
    execFileSync(
      process.execPath,
      [CLI, 'status', runId, '--resolve', invocation.invocation_id],
      { cwd: root, encoding: 'utf8' },
    ),
    new RegExp(`resolves to .*00_plan-1_[^/]+\\.md`, 'u'),
  )
})
