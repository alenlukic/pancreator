/**
 * Cohort `63300_Sep-09-1149_operator-out`: the operator directed a repair of
 * two files and the supervisor executed it between stages. The remediator,
 * the reviewer, and the verifier each audited the edit and reported it as
 * unattributed, and the remediate output recorded attribution `mixed` with an
 * unknown author.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import type { SpawnSyncReturns } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  getRunState,
  prepareInvocation,
  recordWorkspaceDirective,
} from '../../src/lib/engine.js'
import { readJson, writeJsonAtomic } from '../../src/lib/io.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import { workspaceCleanliness } from '../../src/lib/workspace-attribution.js'
import type { RunState, WorkspaceDirectiveRecord } from '../../src/lib/types.js'
import { createTestTempDirectory } from '../temp.js'
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
  assert.equal(
    record.disposition,
    'operator-owned',
    'a directive that names no disposition keeps every refusal in place',
  )
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
  assert.match(artifact, /\*\*Disposition:\*\* operator-owned/u)
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

  // Age the first record into the shape every directive written before this
  // field carries, so the card resolves an absent disposition rather than
  // printing `undefined` to every run whose directives predate the change.
  const statePath = resolveRunLayout(root, runId).state.absolute
  const persisted = readJson(statePath) as RunState
  const aged = persisted.workspace_directives?.[0]

  assert.ok(aged)
  delete aged.disposition
  writeJsonAtomic(statePath, persisted)

  const legacyRecord: WorkspaceDirectiveRecord = { ...record }

  delete legacyRecord.disposition

  // The next worker reads the attribution instead of auditing the delta.
  const next = prepareInvocation(root, runId)

  assert.ok(next.invocation)
  assert.deepEqual(next.invocation.attributed_changes, [legacyRecord, second])

  const card = readFileSync(
    path.join(root, next.state.current_invocation?.markdown_path ?? ''),
    'utf8',
  )

  assert.match(card, /## 📌 Attributed workspace changes/u)
  assert.match(card, /- `src\/directed-fixture\.ts`/u)
  assert.match(
    card,
    /disposition `operator-owned`\): Repair the stale fixture/u,
    'a record carrying no disposition key renders the default on the card',
  )
  assert.match(
    card,
    /disposition `operator-owned`\): Repair the second stale fixture/u,
    'a record carrying the field renders the value it carries',
  )
})

test('the disposition an operator chooses reaches the record, the artifact, and the card', () => {
  const { root, runId, workflow } = checkpoint('delivery@verify-prepared')

  submitStageOutput(root, runId, stageBySlug(workflow, 'verify'), 'success')

  // The operator placed a design source as an input and directed the
  // supervisor to record it as one.
  writeFileSync(path.join(root, 'design-source.svg'), '<svg/>\n')

  const record = recordWorkspaceDirective(root, runId, {
    directive: 'Keep the design source I exported available to every stage.',
    disposition: 'read-only-input',
    paths: ['design-source.svg'],
  })

  assert.equal(record.disposition, 'read-only-input')
  assert.deepEqual(getRunState(root, runId).workspace_directives, [record])
  assert.match(
    readFileSync(path.join(root, record.artifact_path), 'utf8'),
    /\*\*Disposition:\*\* read-only-input/u,
  )

  // The same command wrote the repository-scoped record every clean-tree
  // gate reads, so the placed input is already clean state.
  const report = workspaceCleanliness(root, root)

  assert.deepEqual(
    report.exempt.map((entry) => entry.path),
    ['design-source.svg'],
  )
  assert.deepEqual(
    report.blocking.filter((entry) => entry.path === 'design-source.svg'),
    [],
  )

  const next = prepareInvocation(root, runId)
  const card = readFileSync(
    path.join(root, next.state.current_invocation?.markdown_path ?? ''),
    'utf8',
  )

  assert.match(card, /disposition `read-only-input`/u)
})

test('a directive is recorded for a workspace that holds no repository', () => {
  const { root, runId } = checkpoint('delivery@verify-prepared')

  // A run may be bound to a plain directory, which is why the workspace
  // snapshot carries a filesystem branch. Such a workspace has no repository
  // to key an attribution on, and the run-scoped record must survive anyway.
  const workspace = createTestTempDirectory('repositoryless-workspace-')
  const statePath = resolveRunLayout(root, runId).state.absolute
  const state = readJson(statePath) as RunState

  writeFileSync(path.join(workspace, 'placed-input.txt'), 'operator input\n')
  state.workspace_root = workspace
  writeJsonAtomic(statePath, state)

  const record = recordWorkspaceDirective(root, runId, {
    directive: 'Keep the input I placed in this workspace.',
    disposition: 'read-only-input',
    paths: ['placed-input.txt'],
  })

  assert.deepEqual(getRunState(root, runId).workspace_directives, [record])
  assert.match(
    readFileSync(path.join(root, record.artifact_path), 'utf8'),
    /\*\*Disposition:\*\* read-only-input/u,
  )
  assert.equal(
    existsSync(
      path.join(root, 'runtime', 'logs', 'workspace-attributions.json'),
    ),
    false,
    'no repository holds the workspace, so no repository-scoped record exists',
  )
})

test('pan attribute rejects a disposition the harness does not define', () => {
  const { root, runId } = checkpoint('delivery@verify-prepared')

  writeFileSync(path.join(root, 'design-source.svg'), '<svg/>\n')

  const attribute = (disposition: string): SpawnSyncReturns<string> =>
    spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), 'dist', 'src', 'cli.js'),
        'attribute',
        runId,
        '--note',
        'Keep the design source I exported available to every stage.',
        '--paths',
        'design-source.svg',
        '--disposition',
        disposition,
        '--json',
      ],
      { cwd: root, encoding: 'utf8', timeout: 120_000 },
    )

  const rejected = attribute('read-only')

  assert.notEqual(rejected.status, 0)
  assert.equal(
    (JSON.parse(rejected.stderr) as { error: string }).error,
    'INVALID_ARGUMENT',
  )
  assert.deepEqual(
    getRunState(root, runId).workspace_directives ?? [],
    [],
    'a rejected disposition records nothing',
  )

  const accepted = attribute('commit-with-unit')

  assert.equal(accepted.status, 0)
  assert.equal(
    (JSON.parse(accepted.stdout) as { disposition: string }).disposition,
    'commit-with-unit',
  )
})
