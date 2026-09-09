import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { createFixture } from '../helpers.js'
import { PanError } from '../../src/lib/errors.js'
import {
  checkpointConformArtifacts,
  CONFORM_CACHE_RELATIVE_PATH,
  scanConformArtifacts,
} from '../../src/lib/conform.js'

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function write(root: string, relativePath: string, content: string): void {
  const absolute = path.join(root, relativePath)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
}

test('scan includes runtime artifacts on first run', () => {
  const root = createFixture()

  write(root, 'CHANGELOG.md', '# Changelog\n\nRun this command.\n')
  git(root, ['add', 'CHANGELOG.md'])
  git(root, ['commit', '-qm', 'pin changelog'])

  write(
    root,
    'runtime/pr-descriptions/example.md',
    '# PR\n\nRun this command.\n',
  )
  write(
    root,
    'runtime/logs/workflows/scan-fixture/operator/brief.html',
    '<html><body><p>Run this command.</p></body></html>\n',
  )

  const result = scanConformArtifacts(root, { workspace_root: root })

  assert.equal(result.status, 'passed')
  assert.deepEqual(
    result.files.map((file) => file.relative_path),
    [
      'runtime/logs/workflows/scan-fixture/operator/brief.html',
      'runtime/pr-descriptions/example.md',
      'CHANGELOG.md',
    ],
  )
  assert.equal(result.summary.editable_files, 1)
  assert.equal(result.summary.report_only_files, 2)
})

test('the first scan selects the committed eligible set, not only the dirty tree', () => {
  const root = createFixture()

  // A repository with no checkpoint has no baseline to diff against. The bare
  // scan must still see this committed file, because `conform checkpoint`
  // inspects it and blocks on what a hidden scan never reported.
  write(root, 'CHANGELOG.md', "# Changelog\n\nDon't do this.\n")
  write(root, 'docs/issues/committed.md', "# Issue\n\nDon't do this.\n")
  git(root, ['add', 'CHANGELOG.md', 'docs/issues/committed.md'])
  git(root, ['commit', '-qm', 'pin operator prose'])

  const bare = scanConformArtifacts(root, { workspace_root: root })
  const all = scanConformArtifacts(root, { workspace_root: root, all: true })

  assert.equal(bare.checkpoint_head, null)
  assert.equal(bare.base, bare.head)
  assert.deepEqual(
    bare.files.map((file) => file.relative_path).sort(),
    all.files.map((file) => file.relative_path).sort(),
    'the first scan and --all agree on their input set',
  )

  const changelog = bare.files.find(
    (file) => file.relative_path === 'CHANGELOG.md',
  )
  const issue = bare.files.find(
    (file) => file.relative_path === 'docs/issues/committed.md',
  )

  assert.ok(changelog, 'the bare scan selects the committed CHANGELOG.md')
  assert.ok(changelog.issues.length > 0)
  assert.ok(issue)
  assert.ok(issue.issues.length > 0)

  // Release history is reported, never repaired, so its issues do not fail the
  // scan and do not block the checkpoint.
  assert.equal(changelog.editable, false)
  assert.equal(issue.editable, true)
  assert.equal(bare.status, 'failed')
  assert.equal(bare.summary.editable_issue_files, 1)
})

test('an embedded install scans harness intake and never target-tracked prose', () => {
  const harness = createFixture()
  const target = createFixture()
  const configPath = path.join(harness, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  config.installation_mode = 'embedded'
  config.workspace_root = target
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  write(harness, 'docs/issues/harness-owned.md', "# Issue\n\nDon't do this.\n")
  write(target, 'docs/issues/target-owned.md', "# Issue\n\nDon't do this.\n")
  write(target, 'CHANGELOG.md', "# Changelog\n\nDon't do this.\n")
  git(target, ['add', '.'])
  git(target, ['commit', '-qm', 'target prose'])

  const result = scanConformArtifacts(harness, { workspace_root: target })

  assert.deepEqual(
    result.files.map((file) => file.relative_path),
    ['docs/issues/harness-owned.md'],
  )
  assert.equal(result.files[0]?.root, 'runtime')
  assert.equal(
    result.files[0]?.absolute_path,
    path.join(harness, 'docs/issues/harness-owned.md'),
  )
  assert.equal(result.summary.editable_files, 1)
  assert.equal(result.summary.report_only_files, 0)
})

test('checkpoint writes a clean baseline and scan reports no changes', () => {
  const root = createFixture()

  write(root, 'CHANGELOG.md', '# Changelog\n\nRun this command.\n')
  write(root, 'docs/issues/one.md', '# Issue\n\nRun this command.\n')
  git(root, ['add', 'CHANGELOG.md', 'docs/issues/one.md'])
  git(root, ['commit', '-qm', 'pin editable prose'])

  write(
    root,
    'runtime/pr-descriptions/example.md',
    '# PR\n\nRun this command.\n',
  )

  const checkpoint = checkpointConformArtifacts(root, { workspace_root: root })

  assert.equal(checkpoint.status, 'passed')
  assert.equal(checkpoint.wrote_checkpoint, true)
  assert.ok(
    readFileSync(path.join(root, CONFORM_CACHE_RELATIVE_PATH), 'utf8').includes(
      '"schema_version": 1',
    ),
  )

  const scan = scanConformArtifacts(root, { workspace_root: root })

  assert.equal(scan.status, 'passed')
  assert.deepEqual(scan.files, [])
})

test('checkpoint blocks editable issues but permits report-only HTML issues', () => {
  const root = createFixture()

  write(root, 'CHANGELOG.md', '# Changelog\n\nRun this command.\n')
  git(root, ['add', 'CHANGELOG.md'])
  git(root, ['commit', '-qm', 'pin changelog'])

  write(
    root,
    'runtime/pr-descriptions/example.md',
    '# PR\n\nRun this command.\n',
  )
  write(
    root,
    'runtime/logs/workflows/scan-fixture/operator/brief.html',
    "<html><body><p>Don't do this.</p></body></html>\n",
  )

  const reportOnlyScan = scanConformArtifacts(root, { workspace_root: root })

  assert.equal(reportOnlyScan.status, 'passed')
  assert.equal(reportOnlyScan.summary.editable_issue_files, 0)
  assert.ok(reportOnlyScan.summary.report_only_issue_files > 0)

  const reportOnly = checkpointConformArtifacts(root, { workspace_root: root })

  assert.equal(reportOnly.status, 'passed')
  assert.equal(reportOnly.wrote_checkpoint, true)
  assert.ok(reportOnly.summary.report_only_issue_files > 0)

  write(root, 'runtime/pr-descriptions/example.md', "# PR\n\nDon't do this.\n")

  const blocked = checkpointConformArtifacts(root, { workspace_root: root })

  assert.equal(blocked.status, 'blocked')
  assert.equal(blocked.wrote_checkpoint, false)
})

test('--since selects tracked changes and invalid refs are refused', () => {
  const root = createFixture()

  write(root, 'CHANGELOG.md', '# Changelog\n\nRun this command.\n')
  write(root, 'docs/issues/one.md', '# Issue\n\nRun this command.\n')
  git(root, ['add', 'CHANGELOG.md', 'docs/issues/one.md'])
  git(root, ['commit', '-qm', 'initial prose'])

  const base = git(root, ['rev-parse', 'HEAD'])

  write(root, 'docs/issues/one.md', '# Issue\n\nRun this command again.\n')
  git(root, ['add', 'docs/issues/one.md'])
  git(root, ['commit', '-qm', 'change issue'])

  const result = scanConformArtifacts(root, {
    workspace_root: root,
    since_ref: base,
  })

  assert.equal(result.status, 'passed')
  assert.deepEqual(
    result.files.map((file) => file.relative_path),
    ['docs/issues/one.md'],
  )

  assert.throws(
    () =>
      scanConformArtifacts(root, {
        workspace_root: root,
        since_ref: 'not-a-real-ref',
      }),
    (error: unknown) =>
      error instanceof PanError && error.code === 'INVALID_ARGUMENT',
  )
})

test('checkpoint accepts lone --since and both verbs reject combined overrides', () => {
  const root = createFixture()

  write(root, 'CHANGELOG.md', '# Changelog\n\nRun this command.\n')
  git(root, ['add', 'CHANGELOG.md'])
  git(root, ['commit', '-qm', 'initial prose'])

  const base = git(root, ['rev-parse', 'HEAD'])

  write(root, 'CHANGELOG.md', '# Changelog\n\nRun this command again.\n')
  git(root, ['add', 'CHANGELOG.md'])
  git(root, ['commit', '-qm', 'change prose'])

  const checkpoint = checkpointConformArtifacts(root, {
    workspace_root: root,
    since_ref: base,
  })

  assert.equal(checkpoint.status, 'passed')
  assert.equal(checkpoint.wrote_checkpoint, true)

  for (const operation of [scanConformArtifacts, checkpointConformArtifacts]) {
    assert.throws(
      () =>
        operation(root, {
          workspace_root: root,
          since_ref: base,
          all: true,
        }),
      (error: unknown) =>
        error instanceof PanError &&
        error.code === 'INVALID_ARGUMENT' &&
        error.message === '--since and --all cannot be used together.',
    )
  }
})

test('scan selects dirty, untracked, and deleted files and --all adds unchanged files', () => {
  const root = createFixture()

  write(root, 'CHANGELOG.md', '# Changelog\n\nRun this command.\n')
  write(root, 'docs/issues/dirty.md', '# Dirty\n\nRun this command.\n')
  write(root, 'docs/issues/deleted.md', '# Deleted\n\nRun this command.\n')
  git(root, ['add', 'CHANGELOG.md', 'docs/issues'])
  git(root, ['commit', '-qm', 'initial prose'])

  checkpointConformArtifacts(root, { workspace_root: root })

  write(root, 'docs/issues/dirty.md', '# Dirty\n\nRun this command again.\n')
  write(root, 'docs/issues/untracked.md', '# Untracked\n\nRun this command.\n')
  git(root, ['rm', '-q', 'docs/issues/deleted.md'])

  const changed = scanConformArtifacts(root, { workspace_root: root })

  assert.deepEqual(
    changed.files.map((file) => [file.relative_path, file.status]),
    [
      ['docs/issues/deleted.md', 'deleted'],
      ['docs/issues/dirty.md', 'changed'],
      ['docs/issues/untracked.md', 'changed'],
    ],
  )

  const all = scanConformArtifacts(root, {
    workspace_root: root,
    all: true,
  })

  // Harness-owned intake sorts ahead of the governed workspace, because the
  // checkpoint key carries the root.
  assert.deepEqual(
    all.files.map((file) => [file.relative_path, file.status]),
    [
      ['docs/issues/dirty.md', 'changed'],
      ['docs/issues/untracked.md', 'changed'],
      ['CHANGELOG.md', 'unchanged'],
    ],
  )
})

test('--all omits an absent CHANGELOG.md', () => {
  const root = createFixture()

  git(root, ['rm', '-q', 'CHANGELOG.md'])
  write(root, 'docs/issues/one.md', '# Issue\n\nRun this command.\n')
  git(root, ['add', 'docs/issues/one.md'])
  git(root, ['commit', '-qm', 'remove changelog'])

  const result = scanConformArtifacts(root, {
    workspace_root: root,
    all: true,
  })

  assert.deepEqual(
    result.files.map((file) => file.relative_path),
    ['docs/issues/one.md'],
  )
  assert.equal(result.summary.deleted_files, 0)
})

test('checkpoint replacement drops entries for deleted files', () => {
  const root = createFixture()

  write(root, 'CHANGELOG.md', '# Changelog\n\nRun this command.\n')
  write(root, 'docs/issues/one.md', '# Issue\n\nRun this command.\n')
  git(root, ['add', 'CHANGELOG.md', 'docs/issues/one.md'])
  git(root, ['commit', '-qm', 'initial prose'])

  checkpointConformArtifacts(root, { workspace_root: root })
  git(root, ['rm', '-q', 'docs/issues/one.md'])

  const replacement = checkpointConformArtifacts(root, {
    workspace_root: root,
  })

  assert.equal(replacement.status, 'passed')
  assert.equal(replacement.summary.checkpoint_entries, 1)

  const saved = JSON.parse(
    readFileSync(path.join(root, CONFORM_CACHE_RELATIVE_PATH), 'utf8'),
  ) as { files: Record<string, unknown> }

  assert.deepEqual(Object.keys(saved.files), ['workspace:CHANGELOG.md'])
})
