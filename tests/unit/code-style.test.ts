import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { createFixture } from '../helpers.js'
import { PanError } from '../../src/lib/errors.js'
import {
  checkpointStyleArtifacts,
  scanStyleArtifacts,
  STYLE_CACHE_RELATIVE_PATH,
} from '../../src/lib/code-style.js'

const CLEAN_SOURCE = 'export const total = 1\n'
const DIRTY_SOURCE = 'export const total: any = 1\n'

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function write(root: string, relativePath: string, content: string): void {
  const absolute = path.join(root, relativePath)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
}

function paths(files: Array<{ relative_path: string }>): string[] {
  return files.map((file) => file.relative_path)
}

/**
 * Place a harness under `<target>/.pancreator` and point it at the target,
 * which is the layout an embedded installation produces. The scan reads the
 * harness for its configuration and its checkpoint alone, so the fixture
 * writes that configuration instead of copying a whole installation.
 */
function embedHarness(target: string): string {
  const harness = path.join(target, '.pancreator')

  write(
    harness,
    'config.json',
    `${JSON.stringify(
      {
        schema_version: 1,
        installation_mode: 'embedded',
        workspace_root: target,
      },
      null,
      2,
    )}\n`,
  )

  return harness
}

test('the first scan selects the committed eligible set, not only the dirty tree', () => {
  const root = createFixture()

  // A repository with no checkpoint has no baseline to diff against. The bare
  // scan must still see this committed file, because `style checkpoint`
  // inspects it and blocks on what a hidden scan never reported.
  write(root, 'src/committed.ts', DIRTY_SOURCE)
  write(root, 'docs/guide.md', 'var total = 0\n')
  git(root, ['add', 'src/committed.ts', 'docs/guide.md'])
  git(root, ['commit', '-qm', 'pin workspace source'])

  const bare = scanStyleArtifacts(root, { workspace_root: root })
  const all = scanStyleArtifacts(root, { workspace_root: root, all: true })

  assert.equal(bare.checkpoint_head, null)
  assert.equal(bare.base, bare.head)
  assert.deepEqual(paths(bare.files).sort(), paths(all.files).sort())

  const committed = bare.files.find(
    (file) => file.relative_path === 'src/committed.ts',
  )

  assert.ok(committed, 'the bare scan selects the committed source file')
  assert.equal(committed.language, 'typescript')
  assert.equal(committed.editable, true)
  assert.deepEqual(
    committed.issues.map((issue) => issue.code),
    ['style.any_type'],
  )
  assert.equal(bare.status, 'failed')
  assert.equal(bare.summary.editable_issue_files, 1)

  // No style handbook owns Markdown, so the scan never selects it.
  assert.equal(paths(bare.files).includes('docs/guide.md'), false)
})

test('the scan selects only extensions a detected language owns', () => {
  const root = createFixture()

  write(root, 'src/module.ts', CLEAN_SOURCE)
  write(root, 'scripts/build.mjs', CLEAN_SOURCE)
  write(root, 'tools/report.py', 'def run():\n    return 1\n')
  write(root, 'tools/report.rb', 'def run\n  1\nend\n')
  git(root, ['add', '.'])
  git(root, ['commit', '-qm', 'add sources'])

  const result = scanStyleArtifacts(root, { workspace_root: root, all: true })
  const selected = paths(result.files)

  assert.ok(result.languages.includes('typescript'))
  assert.ok(result.languages.includes('python'))
  assert.ok(selected.includes('src/module.ts'))
  assert.ok(selected.includes('scripts/build.mjs'))
  assert.ok(selected.includes('tools/report.py'))
  assert.equal(selected.includes('tools/report.rb'), false)
})

test('an embedded install reports its nested harness and never edits it', () => {
  const target = createFixture()
  const harness = embedHarness(target)

  write(target, 'src/target-owned.ts', DIRTY_SOURCE)
  write(target, '.pancreator/src/harness-owned.ts', DIRTY_SOURCE)
  git(target, [
    'add',
    '-f',
    'src/target-owned.ts',
    '.pancreator/src/harness-owned.ts',
  ])
  git(target, ['commit', '-qm', 'target and harness source'])

  const result = scanStyleArtifacts(harness, { workspace_root: target })
  const targetFile = result.files.find(
    (file) => file.relative_path === 'src/target-owned.ts',
  )
  const harnessFile = result.files.find(
    (file) => file.relative_path === '.pancreator/src/harness-owned.ts',
  )

  assert.ok(targetFile)
  assert.equal(targetFile.editable, true)
  assert.ok(harnessFile, 'the nested harness is reported')
  assert.equal(harnessFile.editable, false)
  assert.ok(harnessFile.issues.length > 0)
  assert.ok(result.summary.report_only_issue_files > 0)
})

test('checkpoint blocks on an editable issue and writes once the set is clean', () => {
  const root = createFixture()

  write(root, 'src/module.ts', DIRTY_SOURCE)
  git(root, ['add', 'src/module.ts'])
  git(root, ['commit', '-qm', 'add dirty source'])

  const blocked = checkpointStyleArtifacts(root, { workspace_root: root })

  assert.equal(blocked.status, 'blocked')
  assert.equal(blocked.wrote_checkpoint, false)
  assert.equal(blocked.summary.checkpoint_entries, 0)

  write(root, 'src/module.ts', CLEAN_SOURCE)

  const written = checkpointStyleArtifacts(root, { workspace_root: root })

  assert.equal(written.status, 'passed')
  assert.equal(written.wrote_checkpoint, true)
  assert.ok(written.summary.checkpoint_entries > 0)

  const saved = JSON.parse(
    readFileSync(path.join(root, STYLE_CACHE_RELATIVE_PATH), 'utf8'),
  ) as { schema_version: number; files: Record<string, unknown> }

  assert.equal(saved.schema_version, 1)
  assert.ok('src/module.ts' in saved.files)

  const after = scanStyleArtifacts(root, { workspace_root: root })

  assert.equal(after.status, 'passed')
  assert.deepEqual(after.files, [])
})

test('scan selects dirty, untracked, and deleted files and --all adds unchanged files', () => {
  const root = createFixture()

  write(root, 'src/dirty.ts', CLEAN_SOURCE)
  write(root, 'src/deleted.ts', CLEAN_SOURCE)
  write(root, 'src/kept.ts', CLEAN_SOURCE)
  git(root, ['add', 'src'])
  git(root, ['commit', '-qm', 'initial source'])

  checkpointStyleArtifacts(root, { workspace_root: root })

  write(root, 'src/dirty.ts', 'export const total = 2\n')
  write(root, 'src/untracked.ts', CLEAN_SOURCE)
  git(root, ['rm', '-q', 'src/deleted.ts'])

  const changed = scanStyleArtifacts(root, { workspace_root: root })

  assert.deepEqual(
    changed.files.map((file) => [file.relative_path, file.status]),
    [
      ['src/deleted.ts', 'deleted'],
      ['src/dirty.ts', 'changed'],
      ['src/untracked.ts', 'changed'],
    ],
  )
  assert.equal(changed.summary.deleted_files, 1)

  const all = scanStyleArtifacts(root, { workspace_root: root, all: true })

  assert.ok(paths(all.files).includes('src/kept.ts'))
  assert.equal(
    all.files.find((file) => file.relative_path === 'src/kept.ts')?.status,
    'unchanged',
  )
})

test('--since selects tracked changes and an invalid ref is refused', () => {
  const root = createFixture()

  write(root, 'src/first.ts', CLEAN_SOURCE)
  write(root, 'src/second.ts', CLEAN_SOURCE)
  git(root, ['add', 'src'])
  git(root, ['commit', '-qm', 'initial source'])

  const base = git(root, ['rev-parse', 'HEAD'])

  write(root, 'src/second.ts', 'export const total = 3\n')
  git(root, ['add', 'src/second.ts'])
  git(root, ['commit', '-qm', 'change second'])

  const result = scanStyleArtifacts(root, {
    workspace_root: root,
    since_ref: base,
  })

  assert.equal(result.status, 'passed')
  assert.deepEqual(paths(result.files), ['src/second.ts'])
  assert.equal(result.base, base)

  assert.throws(
    () =>
      scanStyleArtifacts(root, {
        workspace_root: root,
        since_ref: 'not-a-real-ref',
      }),
    (error: unknown) =>
      error instanceof PanError && error.code === 'INVALID_ARGUMENT',
  )
})

test('checkpoint accepts lone --since and both verbs reject combined overrides', () => {
  const root = createFixture()

  write(root, 'src/module.ts', CLEAN_SOURCE)
  git(root, ['add', 'src/module.ts'])
  git(root, ['commit', '-qm', 'initial source'])

  const base = git(root, ['rev-parse', 'HEAD'])

  const checkpoint = checkpointStyleArtifacts(root, {
    workspace_root: root,
    since_ref: base,
  })

  assert.equal(checkpoint.status, 'passed')
  assert.equal(checkpoint.wrote_checkpoint, true)

  for (const operation of [scanStyleArtifacts, checkpointStyleArtifacts]) {
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

test('a checkpoint entry keeps the editability the scan resolved', () => {
  const root = createFixture()

  write(root, 'src/module.ts', CLEAN_SOURCE)
  git(root, ['add', 'src/module.ts'])
  git(root, ['commit', '-qm', 'initial source'])

  const result = checkpointStyleArtifacts(root, { workspace_root: root })
  const saved = JSON.parse(
    readFileSync(path.join(root, STYLE_CACHE_RELATIVE_PATH), 'utf8'),
  ) as { files: Record<string, { editable: boolean; sha256: string }> }
  const entry = saved.files['src/module.ts']

  assert.equal(result.status, 'passed')
  assert.ok(entry)
  assert.equal(entry.editable, true)
  assert.equal(
    entry.sha256,
    result.files.find((file) => file.relative_path === 'src/module.ts')?.sha256,
  )
})
