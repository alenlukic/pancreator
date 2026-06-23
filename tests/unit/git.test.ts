import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createFixture } from '../helpers.js'
import { gitWorkspaceSnapshot, snapshotChanged } from '../../src/lib/git.js'

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
  const capsule = path.join(root, 'workdesk', 'project')

  mkdirSync(capsule, { recursive: true })
  writeFileSync(path.join(root, '.gitignore'), 'node_modules\nworkdesk/\n')
  execFileSync('git', ['init', '-q'], { cwd: path.join(root, 'workdesk') })
  execFileSync('git', ['config', 'user.email', 'fixture@example.com'], {
    cwd: path.join(root, 'workdesk'),
  })
  execFileSync('git', ['config', 'user.name', 'Fixture'], {
    cwd: path.join(root, 'workdesk'),
  })
  writeFileSync(path.join(capsule, 'README.md'), '# capsule\n')
  execFileSync('git', ['add', '.'], { cwd: path.join(root, 'workdesk') })
  execFileSync('git', ['commit', '-qm', 'capsule'], {
    cwd: path.join(root, 'workdesk'),
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
