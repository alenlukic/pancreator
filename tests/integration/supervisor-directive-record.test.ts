/**
 * Cohort `63300_Sep-09-1149_operator-out`: the operator directed a repair of
 * two files and the supervisor executed it between stages. The remediator,
 * the reviewer, and the verifier each audited the edit and reported it as
 * unattributed, and the remediate output recorded attribution `mixed` with an
 * unknown author.
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  getRunState,
  prepareInvocation,
  recordWorkspaceDirective,
} from '../../src/lib/engine.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import { checkpoint, submitStageOutput } from './delivery-helpers.js'

test('a supervisor-executed operator directive is recorded and named on the next card', () => {
  const { root, runId, workflow } = checkpoint('delivery@verify-prepared')

  submitStageOutput(root, runId, stageBySlug(workflow, 'verify'), 'success')

  // The operator directs a repair; the supervisor executes it between stages.
  writeFileSync(
    path.join(root, 'src', 'directed-fixture.ts'),
    'export const fixture = true\n',
  )

  const directive =
    'Repair the stale fixture under src/ before the release stage.'
  const record = recordWorkspaceDirective(root, runId, { directive })

  assert.equal(record.acting_role, 'supervisor')
  assert.equal(record.directive, directive)
  assert.deepEqual(record.changed_paths, ['src/directed-fixture.ts'])
  assert.match(record.timestamp, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/u)
  assert.match(record.artifact_path, /agent\/evidence\/workspace-directive-1/u)

  const artifact = readFileSync(path.join(root, record.artifact_path), 'utf8')

  assert.match(artifact, /\*\*Acting role:\*\* supervisor/u)
  assert.match(artifact, /Repair the stale fixture/u)
  assert.match(artifact, /- `src\/directed-fixture\.ts`/u)
  assert.match(
    artifact,
    new RegExp(record.timestamp.replace(/\./gu, '\\.'), 'u'),
  )
  assert.deepEqual(getRunState(root, runId).workspace_directives, [record])

  // The next worker reads the attribution instead of auditing the delta.
  const next = prepareInvocation(root, runId)

  assert.ok(next.invocation)
  assert.deepEqual(next.invocation.attributed_changes, [record])

  const card = readFileSync(
    path.join(root, next.state.current_invocation?.markdown_path ?? ''),
    'utf8',
  )

  assert.match(card, /## 📌 Attributed workspace changes/u)
  assert.match(card, /- `src\/directed-fixture\.ts`/u)
  assert.match(card, /Repair the stale fixture/u)
})
