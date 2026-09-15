import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  INTEGRATION_BRANCH,
  integrationBranchReadiness,
} from '../../src/lib/git.js'
import { fixtureGit } from '../fixture-template.js'
import { createTestTempDirectory } from '../temp.js'

/** A repository with one commit on its default branch and no `pan-dev`. */
function committedRepository(): string {
  const tree = createTestTempDirectory('pan-integration-branch-')
  const git = (args: string[]): void => {
    fixtureGit(args, { cwd: tree, encoding: 'utf8' })
  }

  writeFileSync(path.join(tree, 'README.md'), 'target\n')
  git(['init', '-q'])
  git(['config', 'user.email', 'fixture@example.com'])
  git(['config', 'user.name', 'Fixture'])
  git(['add', '-A'])
  git(['commit', '-qm', 'initial'])

  return tree
}

test('doctor names the pan-dev repair when a git workspace lacks the integration branch', () => {
  const tree = committedRepository()
  const readiness = integrationBranchReadiness(tree)

  assert.equal(INTEGRATION_BRANCH, 'pan-dev')
  assert.equal(readiness.name, 'pan-dev')
  assert.equal(readiness.present, false)
  assert.match(readiness.advisory ?? '', /integration branch pan-dev missing/u)
  assert.match(readiness.advisory ?? '', /\.\/bin\/install refresh/u)
  assert.match(readiness.advisory ?? '', /git branch pan-dev/u)
})

test('doctor reports a present integration branch without an advisory', () => {
  const tree = committedRepository()

  fixtureGit(['branch', 'pan-dev'], { cwd: tree, encoding: 'utf8' })

  assert.deepEqual(integrationBranchReadiness(tree), {
    name: 'pan-dev',
    present: true,
  })
})

test('doctor reports no integration branch verdict outside a git repository', () => {
  const tree = createTestTempDirectory('pan-integration-branch-plain-')

  assert.deepEqual(integrationBranchReadiness(tree), {
    name: 'pan-dev',
    present: null,
  })
})
