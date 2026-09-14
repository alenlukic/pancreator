import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  buildCurrency,
  buildCurrencyAdvisory,
  executingSourceRoot,
  sourceTreeIdentity,
} from '../../src/lib/build-identity.js'
import { gitHead } from '../../src/lib/git.js'
import { fixtureGit } from '../fixture-template.js'
import { createTestTempDirectory } from '../temp.js'

/** A checkout-shaped tree on its own branch, standing in for a worktree. */
function sourceTree(branch: string, version: string): string {
  const tree = createTestTempDirectory('pan-source-tree-')

  writeFileSync(path.join(tree, 'VERSION'), `${version}\n`)
  fixtureGit(['init', '-q'], { cwd: tree, encoding: 'utf8' })
  fixtureGit(['checkout', '-q', '-b', branch], { cwd: tree, encoding: 'utf8' })
  fixtureGit(['config', 'user.email', 'fixture@example.com'], {
    cwd: tree,
    encoding: 'utf8',
  })
  fixtureGit(['config', 'user.name', 'Fixture'], {
    cwd: tree,
    encoding: 'utf8',
  })
  fixtureGit(['add', '-A'], { cwd: tree, encoding: 'utf8' })
  fixtureGit(['commit', '-qm', 'tree'], { cwd: tree, encoding: 'utf8' })

  return tree
}

test('the executing source root is the checkout that compiled the running build', () => {
  const root = executingSourceRoot()

  assert.ok(root, 'a compiled build always sits inside its own checkout')
  assert.equal(
    existsSync(path.join(root, 'dist', 'src', 'lib', 'build-identity.js')),
    true,
  )
  assert.equal(path.resolve(root), path.resolve(process.cwd()))
})

test('a source tree identity reports the head, branch, and version of that tree', () => {
  const tree = sourceTree('release-lane', '9.9.9')
  const identity = sourceTreeIdentity(tree)

  assert.equal(identity.root, path.resolve(tree))
  assert.equal(identity.head, gitHead(tree))
  assert.match(identity.head ?? '', /^[0-9a-f]{40}$/u)
  assert.equal(identity.branch, 'release-lane')
  assert.equal(identity.version, '9.9.9')
})

test('a tree outside a repository reports no head, branch, or version', () => {
  const identity = sourceTreeIdentity(
    createTestTempDirectory('pan-source-bare-'),
  )

  assert.equal(identity.head, null)
  assert.equal(identity.branch, null)
  assert.equal(identity.version, null)
})

test('build currency is current when the workspace is the tree the build came from', () => {
  const root = executingSourceRoot()

  assert.ok(root)

  const record = buildCurrency(root)

  assert.equal(record.current, true)
  assert.equal(record.executing_build.root, record.workspace.root)
  assert.equal(record.executing_build.head, record.workspace.head)
})

test('build currency is not current for another tree, and the advisory names both', () => {
  const tree = sourceTree('chunk-lane', '9.9.9')
  const record = buildCurrency(tree)

  assert.equal(record.current, false)
  assert.equal(record.workspace.root, path.resolve(tree))
  assert.notEqual(record.executing_build.root, record.workspace.root)

  const message = buildCurrencyAdvisory(record)

  assert.ok(message.includes(record.executing_build.root))
  assert.ok(message.includes(record.executing_build.head ?? 'missing'))
  assert.ok(message.includes(record.workspace.root))
  assert.ok(message.includes(record.workspace.head ?? 'missing'))
})

// An unreadable head proves nothing, and a release lane that cannot show
// currency must say so rather than record agreement it did not observe.
test('an unreadable workspace head is not currency', () => {
  const record = buildCurrency(createTestTempDirectory('pan-source-bare-'))

  assert.equal(record.current, false)
  assert.match(buildCurrencyAdvisory(record), /unreadable head/u)
})
