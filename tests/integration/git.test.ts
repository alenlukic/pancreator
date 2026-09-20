import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createFixture } from '../fixture-template.js'
import {
  gitCommonDir,
  gitDirtyEntries,
  gitRebaseOnto,
  gitStatusPaths,
  gitWorkspaceSnapshot,
  parsePorcelainStatus,
  snapshotChanged,
  snapshotEntryPath,
  workspaceChangedPathsFromSnapshots,
} from '../../src/lib/git.js'
import { createWorktree } from '../../src/lib/worktrees.js'
import { createTestTempDirectory } from '../temp.js'

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  }).trim()
}

test('workspace fingerprint detects content changes when status labels stay the same', () => {
  const root = createFixture()
  const file = path.join(root, 'src', 'base.js')
  writeFileSync(file, "export const base = 'first';\n")
  const before = gitWorkspaceSnapshot(root)
  writeFileSync(file, "export const base = 'second';\n")
  const after = gitWorkspaceSnapshot(root)
  assert.equal(before.entries[0].slice(0, 2), after.entries[0].slice(0, 2))
  assert.equal(snapshotChanged(before, after), true)
})

test('fingerprint observes work inside a gitignored nested repository', () => {
  const root = createFixture()
  const nestedRoot = path.join(root, 'nested')
  const capsule = path.join(nestedRoot, 'project')

  mkdirSync(capsule, { recursive: true })
  writeFileSync(path.join(root, '.gitignore'), 'node_modules\nnested/\n')
  execFileSync('git', ['init', '-q'], { cwd: nestedRoot })
  execFileSync('git', ['config', 'user.email', 'fixture@example.com'], {
    cwd: nestedRoot,
  })
  execFileSync('git', ['config', 'user.name', 'Fixture'], {
    cwd: nestedRoot,
  })
  writeFileSync(path.join(capsule, 'README.md'), '# capsule\n')
  execFileSync('git', ['add', '.'], { cwd: nestedRoot })
  execFileSync('git', ['commit', '-qm', 'capsule'], {
    cwd: nestedRoot,
  })

  const rootBefore = gitWorkspaceSnapshot(root)
  const capsuleBefore = gitWorkspaceSnapshot(capsule)

  writeFileSync(path.join(capsule, 'feature.md'), '# new feature\n')

  const rootAfter = gitWorkspaceSnapshot(root)
  const capsuleAfter = gitWorkspaceSnapshot(capsule)

  assert.equal(
    snapshotChanged(rootBefore, rootAfter),
    false,
    'the Pancreator root is blind to gitignored nested work',
  )
  assert.equal(
    snapshotChanged(capsuleBefore, capsuleAfter),
    true,
    'targeting the nested repo surfaces the new file',
  )
})

test('workspace snapshots exclude protected environments, dependencies, caches, and compiled artifacts', () => {
  const root = createFixture()
  const protectedFiles = [
    '.venv/lib/python/site-packages/pkg/module.py',
    '.pyenv/versions/3.11/lib/python/site-packages/pkg/module.py',
    'client/node_modules/pkg/index.js',
    'xeremia.egg-info/PKG-INFO',
    'src/__pycache__/module.cpython-311.pyc',
    'build/output.o',
  ]

  for (const relative of protectedFiles) {
    const absolute = path.join(root, relative)
    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, 'generated\n')
    execFileSync('git', ['add', '-f', relative], { cwd: root })
  }

  execFileSync('git', ['commit', '-qm', 'add protected artifacts'], {
    cwd: root,
  })
  const before = gitWorkspaceSnapshot(root)

  for (const relative of protectedFiles) {
    writeFileSync(path.join(root, relative), 'changed generated content\n')
    execFileSync('git', ['add', '-f', relative], { cwd: root })
  }
  execFileSync('git', ['commit', '-qm', 'change protected artifacts'], {
    cwd: root,
  })

  const after = gitWorkspaceSnapshot(root)

  assert.notEqual(before.head, after.head)
  assert.deepEqual(before.entries, [])
  assert.deepEqual(after.entries, [])
  assert.equal(snapshotChanged(before, after), false)
  assert.deepEqual(workspaceChangedPathsFromSnapshots(before, after), [])
})

test('a staged rename reaches the snapshot with both paths unmangled', () => {
  const root = createFixture()

  execFileSync('git', ['mv', 'src/base.ts', 'src/renamed.ts'], { cwd: root })

  const snapshot = gitWorkspaceSnapshot(root)
  const paths = snapshot.entries.map((entry) => snapshotEntryPath(entry))

  // The source used to arrive with its first three characters removed, which
  // named no file. Both paths must survive whole.
  assert.ok(paths.includes('src/renamed.ts'))
  assert.ok(paths.includes('src/base.ts'))
  assert.ok(existsSync(path.join(root, 'src/renamed.ts')))

  // One reader serves both call sites, so the two agree on the rename shape.
  assert.deepEqual(
    paths.filter((entry) => entry.startsWith('src/')).sort(),
    gitStatusPaths(root).filter((entry) => entry.startsWith('src/')),
  )
})

test('the common directory identifies a repository across its worktrees', () => {
  const root = createFixture()
  const linked = createWorktree(root, 'linked-checkout')
  const other = createTestTempDirectory('pan-git-common-dir-')

  execFileSync('git', ['init', '-q'], { cwd: other })

  // The key is what makes one attribution record reach every checkout of a
  // repository and no other repository, so the two halves are one assertion.
  assert.equal(gitCommonDir(path.join(root, linked.path)), gitCommonDir(root))
  assert.notEqual(gitCommonDir(other), gitCommonDir(root))
  assert.equal(path.isAbsolute(gitCommonDir(root)), true)
})

test('dirty entries name every changed path and whether Git tracks it', () => {
  const root = createFixture()

  execFileSync('git', ['mv', 'src/base.ts', 'src/renamed.ts'], { cwd: root })
  writeFileSync(path.join(root, 'untracked.txt'), 'placed by the operator\n')

  assert.deepEqual(gitDirtyEntries(root), [
    { path: 'src/base.ts', tracked: true },
    { path: 'src/renamed.ts', tracked: true },
    { path: 'untracked.txt', tracked: false },
  ])

  // A directory no repository holds yields no entries rather than throwing,
  // because callers reach the dirty signal separately.
  assert.deepEqual(
    gitDirtyEntries(createTestTempDirectory('pan-git-dirty-none-')),
    [],
  )
})

test('the porcelain reader keeps a rename source whole', () => {
  const entries = parsePorcelainStatus(
    'R  dest/file.ts\0src/file.ts\0?? new.ts\0',
  )

  assert.deepEqual(entries, [
    { status: 'R ', path: 'dest/file.ts', source: 'src/file.ts' },
    { status: '??', path: 'new.ts', source: null },
  ])
})

test('gitRebaseOnto preserves a no-ff merge on divergent history', () => {
  const root = createFixture()
  const baseBranch = git(root, ['branch', '--show-current'])

  git(root, ['switch', '-q', '-c', 'cohort-integration'])
  writeFileSync(
    path.join(root, 'src', 'integration.ts'),
    'export const integration = true\n',
  )
  git(root, ['add', 'src/integration.ts'])
  git(root, ['commit', '-qm', 'feat: integration base'])

  git(root, ['switch', '-q', '-c', 'cohort-chunk'])
  writeFileSync(
    path.join(root, 'src', 'cohort-chunk.ts'),
    'export const cohortChunk = true\n',
  )
  git(root, ['add', 'src/cohort-chunk.ts'])
  git(root, ['commit', '-qm', 'feat: cohort chunk'])
  git(root, ['switch', '-q', 'cohort-integration'])
  git(root, [
    'merge',
    '-q',
    '--no-ff',
    'cohort-chunk',
    '-m',
    'merge: cohort chunk',
  ])

  const originalMerge = git(root, ['rev-parse', 'HEAD'])

  git(root, ['switch', '-q', baseBranch])
  writeFileSync(path.join(root, 'upstream.txt'), 'upstream advance\n')
  git(root, ['add', 'upstream.txt'])
  git(root, ['commit', '-qm', 'feat: upstream advance'])

  const upstream = git(root, ['rev-parse', 'HEAD'])

  git(root, ['switch', '-q', 'cohort-integration'])

  const rebased = gitRebaseOnto(root, upstream)

  assert.equal(rebased.succeeded, true, rebased.stderr)
  assert.notEqual(git(root, ['rev-parse', 'HEAD']), originalMerge)

  const mergeCommits = git(root, ['rev-list', '--merges', `${upstream}..HEAD`])
    .split('\n')
    .filter(Boolean)

  assert.equal(mergeCommits.length, 1)
  assert.equal(
    git(root, ['rev-list', '--parents', '-n', '1', mergeCommits[0]]).split(' ')
      .length,
    3,
    'the rebased integration commit retains both parents',
  )
  assert.equal(
    readFileSync(path.join(root, 'src', 'integration.ts'), 'utf8'),
    'export const integration = true\n',
  )
  assert.equal(
    readFileSync(path.join(root, 'src', 'cohort-chunk.ts'), 'utf8'),
    'export const cohortChunk = true\n',
  )
})
