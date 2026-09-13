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

  // The ship currency chain walks before-fingerprint to fingerprint, so this
  // record must close the window the last accountable record opened. The
  // verify stage submitted immediately above, so its after-fingerprint is it.
  const afterVerify = getRunState(root, runId).stage_history.at(-1)

  assert.equal(
    record.workspace_before_fingerprint,
    afterVerify?.workspace_fingerprint,
    'the record opens its window at the last accountable fingerprint',
  )
  assert.notEqual(
    record.workspace_before_fingerprint,
    record.workspace_fingerprint,
    'the directed edit moved the workspace',
  )

  const artifact = readFileSync(path.join(root, record.artifact_path), 'utf8')

  assert.match(artifact, /\*\*Acting role:\*\* supervisor/u)
  assert.match(artifact, /Repair the stale fixture/u)
  assert.match(artifact, /- `src\/directed-fixture\.ts`/u)
  assert.match(
    artifact,
    new RegExp(record.timestamp.replace(/\./gu, '\\.'), 'u'),
  )
  assert.match(
    artifact,
    new RegExp(
      `\\*\\*Workspace fingerprint:\\*\\* \`${record.workspace_before_fingerprint}\` → \`${record.workspace_fingerprint}\``,
      'u',
    ),
    'the artifact states both ends of the window the record claims',
  )
  assert.deepEqual(getRunState(root, runId).workspace_directives, [record])

  // A second directive takes its before-fingerprint from the first record
  // rather than from the stage, which is the branch that makes a chain of
  // consecutive directives bound the workspace without a gap.
  writeFileSync(
    path.join(root, 'src', 'directed-fixture-two.ts'),
    'export const second = true\n',
  )

  // The first fixture is still uncommitted, so the second record names its
  // own path rather than re-claiming the whole dirty tree.
  const second = recordWorkspaceDirective(root, runId, {
    directive: 'Repair the second stale fixture as well.',
    paths: ['src/directed-fixture-two.ts'],
  })

  assert.equal(
    second.workspace_before_fingerprint,
    record.workspace_fingerprint,
    'consecutive directives chain rather than both reaching back to the stage',
  )
  assert.notEqual(second.artifact_path, record.artifact_path)
  assert.deepEqual(second.changed_paths, ['src/directed-fixture-two.ts'])

  // The next worker reads the attribution instead of auditing the delta.
  const next = prepareInvocation(root, runId)

  assert.ok(next.invocation)
  assert.deepEqual(next.invocation.attributed_changes, [record, second])

  const card = readFileSync(
    path.join(root, next.state.current_invocation?.markdown_path ?? ''),
    'utf8',
  )

  assert.match(card, /## 📌 Attributed workspace changes/u)
  assert.match(card, /- `src\/directed-fixture\.ts`/u)
  assert.match(card, /Repair the stale fixture/u)
})
