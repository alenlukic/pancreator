import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createFixture } from '../helpers.js'
import {
  gitWorkspaceSnapshot,
  snapshotChanged,
  workspaceChangedPathsFromSnapshots,
} from '../../src/lib/git.js'

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
