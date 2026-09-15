import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { PanError } from '../../src/lib/errors.js'
import { readJson, writeJsonAtomic } from '../../src/lib/io.js'
import {
  cleanTreeRefusal,
  committablePaths,
  recordWorkspaceAttribution,
  workspaceAttributions,
  workspaceCleanliness,
} from '../../src/lib/workspace-attribution.js'
import type { RecordWorkspaceAttributionInput } from '../../src/lib/workspace-attribution.js'
import type { WorkspaceAttributionStore } from '../../src/lib/types.js'
import { createWorktree } from '../../src/lib/worktrees.js'
import { createFixture } from '../fixture-template.js'
import { createTestTempDirectory } from '../temp.js'

const STORE_PATH = 'runtime/logs/workspace-attributions.json'

function attribute(
  root: string,
  overrides: Partial<RecordWorkspaceAttributionInput> = {},
): ReturnType<typeof recordWorkspaceAttribution> {
  return recordWorkspaceAttribution(root, {
    workspacePath: root,
    runId: 'run-fixture',
    actingRole: 'supervisor',
    directive: 'Place the design source I exported for this run.',
    disposition: 'read-only-input',
    paths: ['design-source.svg'],
    artifactPath: 'runtime/logs/workflows/run-fixture/evidence/directive-1.md',
    ...overrides,
  })
}

function placeUntracked(workspacePath: string, relative: string): void {
  writeFileSync(path.join(workspacePath, relative), 'exported design source\n')
}

test('an untracked path a read-only-input record names is clean state', () => {
  const root = createFixture()

  placeUntracked(root, 'design-source.svg')
  attribute(root, { paths: ['design-source.svg'] })

  const report = workspaceCleanliness(root, root)

  assert.equal(report.clean, true)
  assert.deepEqual(
    report.exempt.map((entry) => entry.path),
    ['design-source.svg'],
  )
  assert.equal(report.exempt[0]?.tracked, false)
  assert.equal(
    report.exempt[0]?.attribution?.directive,
    'Place the design source I exported for this run.',
  )
  assert.deepEqual(report.blocking, [])
})

test('an omitted disposition and a record written without the field both block', () => {
  const root = createFixture()

  placeUntracked(root, 'design-source.svg')

  // What `pan attribute` writes when the operator names no disposition.
  attribute(root, {
    paths: ['design-source.svg'],
    disposition: 'operator-owned',
  })

  assert.equal(workspaceCleanliness(root, root).clean, false)

  // A record written before the field existed carries no `disposition` key.
  const store = readJson(
    path.join(root, STORE_PATH),
  ) as WorkspaceAttributionStore
  const [record] = store.records

  assert.ok(record)
  delete (record as { disposition?: unknown }).disposition
  writeJsonAtomic(path.join(root, STORE_PATH), store)

  const report = workspaceCleanliness(root, root)

  assert.equal(report.clean, false)
  assert.deepEqual(
    report.blocking.map((entry) => entry.path),
    ['design-source.svg'],
  )
})

test('a tracked modification is never exempt, and never committable', () => {
  const root = createFixture()

  placeUntracked(root, 'design-source.svg')
  execFileSync('git', ['add', 'design-source.svg'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'track the design source'], {
    cwd: root,
  })
  writeFileSync(path.join(root, 'design-source.svg'), 'edited by hand\n')
  attribute(root, { paths: ['design-source.svg'] })

  const report = workspaceCleanliness(root, root)

  assert.equal(report.clean, false)
  assert.deepEqual(report.exempt, [])
  assert.equal(report.blocking[0]?.tracked, true)
  assert.equal(
    report.blocking[0]?.attribution?.disposition,
    'read-only-input',
    'the refusal still carries the record that did not exempt the path',
  )

  // Commit scope reads the disposition rather than the tracked bit: a path
  // recorded as never-committable is withheld whichever side Git holds it on.
  assert.deepEqual(
    committablePaths(root, root, ['design-source.svg', 'src/base.ts']),
    { committable: ['src/base.ts'], withheld: ['design-source.svg'] },
  )
})

test('one attribution reaches every checkout of its repository and no other', () => {
  const root = createFixture()
  const linked = createWorktree(root, 'linked-checkout')
  const linkedPath = path.join(root, linked.path)
  const unrelated = createTestTempDirectory('pan-attribution-other-')

  execFileSync('git', ['init', '-q'], { cwd: unrelated })
  execFileSync('git', ['config', 'user.email', 'fixture@example.com'], {
    cwd: unrelated,
  })
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: unrelated })

  attribute(root, { paths: ['design-source.svg'] })
  placeUntracked(linkedPath, 'design-source.svg')
  placeUntracked(unrelated, 'design-source.svg')

  assert.equal(
    workspaceAttributions(root, linkedPath).length,
    1,
    'the record was recorded in the main checkout and read from the worktree',
  )
  assert.equal(workspaceCleanliness(root, linkedPath).clean, true)

  assert.deepEqual(workspaceAttributions(root, unrelated), [])

  const otherReport = workspaceCleanliness(root, unrelated)

  assert.equal(otherReport.clean, false)
  assert.equal(otherReport.blocking[0]?.attribution, null)
})

test('the newest record decides a path two directives name', () => {
  const root = createFixture()

  placeUntracked(root, 'design-source.svg')
  attribute(root, {
    paths: ['design-source.svg'],
    disposition: 'read-only-input',
  })
  attribute(root, {
    paths: ['design-source.svg'],
    disposition: 'commit-with-unit',
    directive: 'That export is now part of the unit; commit it.',
  })

  const report = workspaceCleanliness(root, root)

  assert.equal(report.clean, false)
  assert.equal(report.blocking[0]?.attribution?.disposition, 'commit-with-unit')
})

test('a clean-tree refusal names every blocking path with its attribution status', () => {
  const root = createFixture()

  for (const relative of [
    'unattributed.txt',
    'with-unit.txt',
    'operator-owned.txt',
    'exempt.txt',
  ]) {
    placeUntracked(root, relative)
  }

  attribute(root, {
    paths: ['with-unit.txt'],
    disposition: 'commit-with-unit',
  })
  attribute(root, {
    paths: ['operator-owned.txt'],
    disposition: 'operator-owned',
    directive: 'Keep my scratch notes in place while I finish the review.',
    artifactPath: 'runtime/logs/workflows/run-fixture/evidence/directive-2.md',
  })
  attribute(root, { paths: ['exempt.txt'] })

  const report = workspaceCleanliness(root, root)
  const message = cleanTreeRefusal(report, {
    action: "Chunk 'alpha' cannot be integrated",
    remedy: 'Resolve each path, then integrate again.',
  })

  assert.match(message, /^Chunk 'alpha' cannot be integrated: /u)
  assert.match(message, /- `unattributed\.txt` — no attribution record/u)
  assert.match(
    message,
    /- `with-unit\.txt` — attributed, commit it with the unit/u,
  )
  assert.match(
    message,
    /- `operator-owned\.txt` — operator-owned: "Keep my scratch notes in place while I finish the review\." \(evidence: `runtime\/logs\/workflows\/run-fixture\/evidence\/directive-2\.md`\)/u,
  )
  assert.doesNotMatch(
    message,
    /exempt\.txt/u,
    'an exempt path never appears in a refusal',
  )
  assert.match(message, /Resolve each path, then integrate again\.$/u)

  // A report with nothing blocking produces no message at all.
  assert.throws(
    () =>
      cleanTreeRefusal(
        { workspace: '.', clean: true, blocking: [], exempt: report.exempt },
        { action: 'Nothing is wrong', remedy: 'Nothing to do.' },
      ),
    (error: unknown) =>
      error instanceof PanError && error.code === 'INVALID_CLEANLINESS_REPORT',
  )
})
