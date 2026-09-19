import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  allocateReleaseVersion,
  readReleaseAllocations,
  releaseAllocationFor,
} from '../../src/lib/release-allocation.js'
import { validateReleaseOutput } from '../../src/lib/validators/stage-validators.js'
import { nextSemanticVersion } from '../../src/lib/versioning.js'
import { createWorktree } from '../../src/lib/worktrees.js'
import { createFixture } from '../helpers.js'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function committedVersion(root: string): string {
  return git(root, ['show', 'HEAD:VERSION'])
}

/** Commit a bumped VERSION on a new branch and return to the original one. */
function publishVersionOnBranch(
  root: string,
  branch: string,
  version: string,
): void {
  const original = git(root, ['branch', '--show-current'])

  git(root, ['checkout', '-q', '-b', branch])
  writeFileSync(path.join(root, 'VERSION'), `${version}\n`)
  git(root, ['add', 'VERSION'])
  git(root, ['commit', '-q', '-m', `release: ${version}`])
  git(root, ['checkout', '-q', original])
}

test('two worktrees allocating against one base receive distinct versions, and a repeat is reused', () => {
  const root = createFixture()
  const current = committedVersion(root)
  const first = createWorktree(root, 'release-one')
  const second = createWorktree(root, 'release-two')

  const one = allocateReleaseVersion(root, first.name, 'minor', {
    runId: 'run-one',
    recordedAt: '2026-09-19T10:00:00.000Z',
  })
  const two = allocateReleaseVersion(root, second.name, 'minor', {
    runId: 'run-two',
  })

  assert.equal(one.status, 'allocated')
  assert.equal(one.allocation.version, nextSemanticVersion(current, 'minor'))
  assert.equal(one.allocation.committed_version, current)
  assert.equal(one.allocation.run_id, 'run-one')
  assert.equal(two.status, 'allocated')
  // The second worktree reads the same committed VERSION, so only the
  // ledger separates it from the first.
  assert.equal(
    two.allocation.version,
    nextSemanticVersion(one.allocation.version, 'minor'),
  )
  assert.equal(two.allocation.base_version, one.allocation.version)
  assert.ok(
    two.allocation.sources.some(
      (source) =>
        source.source === 'allocations.jsonl' &&
        source.version === one.allocation.version,
    ),
  )

  const repeat = allocateReleaseVersion(root, first.name, 'minor')

  assert.equal(repeat.status, 'reused')
  assert.equal(repeat.allocation.version, one.allocation.version)
  assert.equal(readReleaseAllocations(root).length, 2)

  // A steward that reconsiders the bump is handed a fresh number for it, not
  // the minor one the validator would then refuse under a patch bump.
  const rebumped = allocateReleaseVersion(root, first.name, 'patch')

  assert.equal(rebumped.status, 'allocated')
  assert.equal(
    rebumped.allocation.version,
    nextSemanticVersion(two.allocation.version, 'patch'),
  )
  assert.equal(readReleaseAllocations(root).length, 3)
  assert.ok(
    readFileSync(one.ledger_path, 'utf8').includes(one.allocation.version),
  )
})

test('an allocation clears the version the integration branch already published', () => {
  const root = createFixture()
  const current = committedVersion(root)
  const worktree = createWorktree(root, 'release-behind')
  const published = nextSemanticVersion(current, 'minor') as string

  // pan-dev moved on after this worktree branched, so the exact next version
  // from the worktree's own VERSION is already taken.
  publishVersionOnBranch(root, 'pan-dev', published)

  const result = allocateReleaseVersion(root, worktree.name, 'patch')

  assert.equal(result.allocation.base_version, published)
  assert.equal(
    result.allocation.version,
    nextSemanticVersion(published, 'patch'),
  )
  assert.ok(
    result.allocation.sources.some(
      (source) =>
        source.source === 'pan-dev:VERSION' && source.version === published,
    ),
  )
})

test('an allocated version that has landed frees the worktree to allocate again', () => {
  const root = createFixture()
  const worktree = createWorktree(root, 'release-landed')
  const first = allocateReleaseVersion(root, worktree.name, 'patch')

  publishVersionOnBranch(root, 'pan-dev', first.allocation.version)

  const next = allocateReleaseVersion(root, worktree.name, 'patch')

  assert.equal(next.status, 'allocated')
  assert.equal(
    next.allocation.version,
    nextSemanticVersion(first.allocation.version, 'patch'),
  )
})

test('the allocation rejects an unknown bump before touching the ledger', () => {
  const root = createFixture()
  const worktree = createWorktree(root, 'release-bad-bump')

  assert.throws(
    () => allocateReleaseVersion(root, worktree.name, 'huge'),
    /major, minor, or patch/u,
  )
  assert.equal(readReleaseAllocations(root).length, 0)
})

test('the ship validator accepts an allocated version above the exact next one for the same bump only', () => {
  const root = createFixture()
  const current = committedVersion(root)
  const first = createWorktree(root, 'release-one')
  const second = createWorktree(root, 'release-two')
  const secondPath = path.join(root, second.path)

  allocateReleaseVersion(root, first.name, 'minor')
  const allocated = allocateReleaseVersion(root, second.name, 'minor')
  const baselineCommit = git(secondPath, ['rev-parse', 'HEAD'])

  assert.notEqual(
    allocated.allocation.version,
    nextSemanticVersion(current, 'minor'),
  )
  assert.ok(
    releaseAllocationFor(
      root,
      secondPath,
      allocated.allocation.version,
      'minor',
    ),
  )
  assert.equal(
    releaseAllocationFor(
      root,
      secondPath,
      allocated.allocation.version,
      'patch',
    ),
    null,
  )

  const validate = (proposedVersion: string, recommendation: string) => {
    const target = 'output.json'

    writeFileSync(
      path.join(root, target),
      `${JSON.stringify({
        data: {
          release: {
            summary: 'ready',
            versioning: {
              current_version: current,
              recommendation,
              proposed_version: proposedVersion,
              baseline_commit: baselineCommit,
              rationale: 'fixture',
              compatibility: 'backward compatible',
              updated_files: [
                'CHANGELOG.md',
                'README.md',
                'VERSION',
                'docs/embedded-installation.md',
                'package-lock.json',
                'package.json',
              ],
              release_index_action: 'Index after the release commit exists.',
            },
            change_list: [],
            validation: [],
            rollback: 'revert commit',
            waivers: [],
            follow_up_cases: [],
          },
        },
      })}\n`,
    )

    return validateReleaseOutput({
      root,
      targetPath: target,
      requirement: {
        policy_id: 'VERSION-001',
        requirement_id: 'release-validate',
        registry_id: 'RELEASE-VALIDATE-001',
        arguments: {},
      },
      runState: { stage_history: [], workspace_root: second.path },
    }).issues.filter(
      (issue) => issue.code === 'release.proposed_version_mismatch',
    )
  }

  assert.deepEqual(validate(allocated.allocation.version, 'minor'), [])
  // The same number under a different bump was never allocated.
  assert.equal(validate(allocated.allocation.version, 'patch').length, 1)
  // A version nobody allocated is still a mismatch.
  assert.equal(
    validate(
      nextSemanticVersion(allocated.allocation.version, 'minor') as string,
      'minor',
    ).length,
    1,
  )
})
