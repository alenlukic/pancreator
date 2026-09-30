import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { syncLocalRelease } from '../../src/lib/release-preparation.js'
import { createWorktree } from '../../src/lib/worktrees.js'
import { createFixture } from '../helpers.js'
import { createTestTempDirectory } from '../temp.js'
import { errorCode, git } from './release-preparation-helpers.js'

/**
 * A release worktree branched from a local default branch that the remote has
 * not seen: the shape every self-development release takes, because this
 * harness releases itself without pushing.
 */
function prepareUnpushedIntegration(name: string): {
  root: string
  remote: string
  record: ReturnType<typeof createWorktree>
  worktreePath: string
  localMain: string
  fetchedMain: string
} {
  const root = createFixture()
  const remote = createTestTempDirectory('pan-release-behind-')

  execFileSync('git', ['init', '--bare', '-q'], { cwd: remote })
  git(root, ['branch', '-M', 'main'])
  git(root, ['remote', 'add', 'origin', remote])
  git(root, ['push', '-u', 'origin', 'main'])

  const fetchedMain = git(root, ['rev-parse', 'HEAD'])

  git(root, ['switch', '-q', '-c', 'chunk-one'])
  writeFileSync(path.join(root, 'src', 'chunk.ts'), 'export const chunk = 1\n')
  git(root, ['add', 'src/chunk.ts'])
  git(root, ['commit', '-qm', 'feat: chunk one'])
  git(root, ['switch', '-q', 'main'])
  git(root, ['merge', '-q', '--no-ff', 'chunk-one', '-m', 'merge: chunk one'])

  const localMain = git(root, ['rev-parse', 'HEAD'])
  const record = createWorktree(root, name)

  return {
    root,
    remote,
    record,
    worktreePath: path.join(root, record.path),
    localMain,
    fetchedMain,
  }
}

test('release sync leaves an already-current cohort integration merge untouched', () => {
  const behind = prepareUnpushedIntegration('release-current')

  try {
    const headBeforeSync = git(behind.worktreePath, ['rev-parse', 'HEAD'])
    const synchronized = syncLocalRelease(
      behind.root,
      behind.record.name,
      'feat: checkpoint',
    )

    assert.equal(synchronized.status, 'already_current')
    assert.equal(synchronized.fetched_main, behind.fetchedMain)
    assert.equal(synchronized.rebase_target, behind.fetchedMain)
    assert.equal(synchronized.checkpoint_commit, null)
    assert.deepEqual(synchronized.advisories, [
      {
        code: 'RELEASE_LOCAL_DEFAULT_AHEAD',
        message:
          `Local default branch 'main' at ${behind.localMain} is ahead of ` +
          `fetched main ${behind.fetchedMain}; release preparation kept the ` +
          `local history and did not publish it.`,
        details: {
          default_branch: 'main',
          fetched_main: behind.fetchedMain,
          local_head: behind.localMain,
        },
      },
    ])
    assert.equal(
      git(behind.worktreePath, ['rev-parse', 'HEAD']),
      headBeforeSync,
      'an already-current sync must not rewrite the integration head',
    )
    assert.equal(
      git(behind.worktreePath, [
        'rev-list',
        '--parents',
        '-n',
        '1',
        'HEAD',
      ]).split(' ').length,
      3,
      'the cohort integration commit remains a two-parent merge',
    )
  } finally {
    rmSync(behind.root, { recursive: true, force: true })
    rmSync(behind.remote, { recursive: true, force: true })
  }
})

test('release sync fast-forwards without flattening a cohort integration merge', () => {
  const root = createFixture()
  const remote = createTestTempDirectory('pan-release-merge-rebase-')

  try {
    execFileSync('git', ['init', '--bare', '-q'], { cwd: remote })
    git(root, ['branch', '-M', 'main'])
    git(root, ['remote', 'add', 'origin', remote])
    git(root, ['push', '-u', 'origin', 'main'])

    git(root, ['switch', '-q', '-c', 'chunk-one'])
    writeFileSync(
      path.join(root, 'src', 'chunk.ts'),
      'export const chunk = 1\n',
    )
    git(root, ['add', 'src/chunk.ts'])
    git(root, ['commit', '-qm', 'feat: chunk one'])
    git(root, ['switch', '-q', 'main'])
    git(root, ['merge', '-q', '--no-ff', 'chunk-one', '-m', 'merge: chunk one'])

    const integrationMerge = git(root, ['rev-parse', 'HEAD'])
    const record = createWorktree(root, 'release-merge-rebase')
    const worktreePath = path.join(root, record.path)

    writeFileSync(path.join(root, 'remote-main.txt'), 'remote main change\n')
    git(root, ['add', 'remote-main.txt'])
    git(root, ['commit', '-qm', 'feat: advance remote main'])
    git(root, ['push', '-q', 'origin', 'main'])

    const remoteHead = git(root, ['rev-parse', 'HEAD'])
    const synchronized = syncLocalRelease(root, record.name, 'feat: checkpoint')

    assert.equal(synchronized.status, 'synchronized')
    assert.equal(synchronized.fetched_main, remoteHead)
    assert.equal(git(worktreePath, ['rev-parse', 'HEAD']), remoteHead)
    assert.equal(
      git(worktreePath, [
        'merge-base',
        '--is-ancestor',
        integrationMerge,
        'HEAD',
      ]),
      '',
    )
    assert.ok(
      git(worktreePath, ['rev-list', '--merges', 'HEAD'])
        .split('\n')
        .includes(integrationMerge),
      'the original cohort merge remains in the synchronized topology',
    )
    assert.equal(
      git(worktreePath, [
        'rev-list',
        '--parents',
        '-n',
        '1',
        integrationMerge,
      ]).split(' ').length,
      3,
      'the synchronized cohort commit still has both parents',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  }
})

/**
 * A release worktree carrying a cohort integration merge the remote has never
 * seen, while the remote default branch advanced on its own: the one shape in
 * which release sync must replay commits rather than fast-forward, and the
 * shape HR-003 reported losing three `--no-ff` merges in.
 */
function prepareDivergentIntegration(name: string): {
  root: string
  remote: string
  record: ReturnType<typeof createWorktree>
  worktreePath: string
  integrationMerge: string
  remoteHead: string
} {
  const behind = prepareUnpushedIntegration(name)
  const baseCommit = behind.fetchedMain

  git(behind.root, ['switch', '-q', '-c', 'remote-advance', baseCommit])
  writeFileSync(
    path.join(behind.root, 'remote-main.txt'),
    'remote main change\n',
  )
  git(behind.root, ['add', 'remote-main.txt'])
  git(behind.root, ['commit', '-qm', 'feat: advance remote main'])
  git(behind.root, ['push', '-q', 'origin', 'remote-advance:main'])

  const remoteHead = git(behind.root, ['rev-parse', 'HEAD'])

  git(behind.root, ['switch', '-q', 'main'])

  return {
    root: behind.root,
    remote: behind.remote,
    record: behind.record,
    worktreePath: behind.worktreePath,
    integrationMerge: behind.localMain,
    remoteHead,
  }
}

test('release sync replays a divergent cohort integration merge with its topology intact', () => {
  const divergent = prepareDivergentIntegration('release-divergent-merge')

  try {
    const synchronized = syncLocalRelease(
      divergent.root,
      divergent.record.name,
      'feat: checkpoint',
    )

    assert.equal(synchronized.status, 'synchronized')
    assert.equal(synchronized.fetched_main, divergent.remoteHead)
    assert.equal(synchronized.rebase_target, divergent.remoteHead)
    assert.deepEqual(synchronized.conflicted_paths, [])

    const postSyncHead = git(divergent.worktreePath, ['rev-parse', 'HEAD'])

    assert.equal(
      git(divergent.worktreePath, [
        'merge-base',
        '--is-ancestor',
        divergent.remoteHead,
        postSyncHead,
      ]),
      '',
      'the synchronized branch descends from the fetched remote head',
    )
    // The replayed commits are new objects, so the integration merge's hash
    // is gone from the branch. The contract is its topology, not its identity.
    assert.throws(() =>
      git(divergent.worktreePath, [
        'merge-base',
        '--is-ancestor',
        divergent.integrationMerge,
        postSyncHead,
      ]),
    )

    const replayedMerges = git(divergent.worktreePath, [
      'rev-list',
      '--merges',
      `${divergent.remoteHead}..HEAD`,
    ])
      .split('\n')
      .filter(Boolean)

    assert.equal(replayedMerges.length, 1, 'exactly one merge was replayed')
    assert.equal(
      git(divergent.worktreePath, [
        'rev-list',
        '--parents',
        '-n',
        '1',
        replayedMerges[0] ?? '',
      ]).split(' ').length,
      3,
      'the replayed cohort merge keeps both parents',
    )
    assert.equal(
      git(divergent.worktreePath, [
        'show',
        '-s',
        '--format=%s',
        replayedMerges[0] ?? '',
      ]),
      'merge: chunk one',
    )
    assert.equal(
      readFileSync(
        path.join(divergent.worktreePath, 'src', 'chunk.ts'),
        'utf8',
      ),
      'export const chunk = 1\n',
    )
    assert.equal(
      readFileSync(
        path.join(divergent.worktreePath, 'remote-main.txt'),
        'utf8',
      ),
      'remote main change\n',
    )
  } finally {
    rmSync(divergent.root, { recursive: true, force: true })
    rmSync(divergent.remote, { recursive: true, force: true })
  }
})

test('release sync refuses a completed rebase that flattened the branch merges', () => {
  const divergent = prepareDivergentIntegration('release-flattened-merge')

  try {
    // Prepare the linear history a plain `git rebase` produces from this
    // branch, then restore the merge so sync meets the divergent shape. A
    // post-rewrite hook moves the branch to that linear history once sync's
    // own rebase completes, which is the flattening the lineage check exists
    // to catch, arriving through the only path a completed rebase offers.
    git(divergent.worktreePath, ['rebase', '-q', divergent.remoteHead])

    const flattenedHead = git(divergent.worktreePath, ['rev-parse', 'HEAD'])

    assert.equal(
      git(divergent.worktreePath, [
        'rev-list',
        '--merges',
        '--count',
        `${divergent.remoteHead}..${flattenedHead}`,
      ]),
      '0',
    )
    git(divergent.worktreePath, [
      'reset',
      '-q',
      '--hard',
      divergent.integrationMerge,
    ])

    const hooksDirectory = path.resolve(
      divergent.worktreePath,
      git(divergent.worktreePath, ['rev-parse', '--git-path', 'hooks']),
    )
    const hookPath = path.join(hooksDirectory, 'post-rewrite')

    mkdirSync(hooksDirectory, { recursive: true })
    writeFileSync(
      hookPath,
      `#!/bin/sh
if [ "$1" = rebase ]; then
  git reset -q --hard ${flattenedHead}
fi
`,
    )
    chmodSync(hookPath, 0o755)

    let refusal: unknown = null

    try {
      syncLocalRelease(
        divergent.root,
        divergent.record.name,
        'feat: checkpoint',
      )
    } catch (error) {
      refusal = error
    }

    assert.ok(refusal instanceof Error)
    assert.equal(
      'code' in refusal ? refusal.code : null,
      'RELEASE_REBASE_TOPOLOGY_LOST',
    )
    assert.match(refusal.message, /1 merge commit\(s\) were replayed/u)
    assert.match(refusal.message, /0 remain/u)
    assert.match(
      refusal.message,
      /recover the preserved head before finalizing/u,
    )
    assert.deepEqual('details' in refusal ? refusal.details : null, {
      pre_sync_head: divergent.integrationMerge,
      post_sync_head: flattenedHead,
      rebase_target: divergent.remoteHead,
      descends_from_target: true,
      expected_merges: ['2 merge: chunk one'],
      actual_merges: [],
    })
    assert.equal(
      git(divergent.worktreePath, ['rev-parse', 'HEAD']),
      flattenedHead,
      'the refusal names the branch head Git left behind',
    )
  } finally {
    rmSync(divergent.root, { recursive: true, force: true })
    rmSync(divergent.remote, { recursive: true, force: true })
  }
})

test('release sync accepts --no-rebase and refuses both overrides together', () => {
  const behind = prepareUnpushedIntegration('release-declined')

  try {
    writeFileSync(
      path.join(behind.worktreePath, 'src', 'base.ts'),
      "export const base = 'release candidate'\n",
    )

    const declined = syncLocalRelease(
      behind.root,
      behind.record.name,
      'feat: checkpoint release candidate',
      undefined,
      { noRebase: true },
    )

    assert.equal(declined.status, 'synchronized')
    assert.equal(declined.fetched_main, behind.fetchedMain)
    assert.equal(declined.rebase_target, null)
    assert.deepEqual(declined.rebase_override, {
      kind: 'no_rebase',
      requested_ref: null,
      resolved_commit: null,
    })
    assert.ok(declined.checkpoint_commit)
    assert.equal(
      git(behind.worktreePath, ['rev-parse', 'HEAD^']),
      behind.localMain,
    )
    assert.equal(
      errorCode(() =>
        syncLocalRelease(
          behind.root,
          behind.record.name,
          'feat: checkpoint',
          undefined,
          { onto: 'main', noRebase: true },
        ),
      ),
      'RELEASE_REBASE_OVERRIDE_CONFLICT',
    )

    // `--onto` alone is the operator's route past a fetched head that is not
    // the base they want. Naming the local default branch, which the branch
    // already descends from, records the override and rewrites nothing.
    const headBeforeOnto = git(behind.worktreePath, ['rev-parse', 'HEAD'])
    const onto = syncLocalRelease(
      behind.root,
      behind.record.name,
      'feat: checkpoint',
      undefined,
      { onto: 'main' },
    )

    assert.equal(onto.status, 'already_current')
    assert.equal(onto.rebase_target, behind.localMain)
    assert.deepEqual(onto.rebase_override, {
      kind: 'onto',
      requested_ref: 'main',
      resolved_commit: behind.localMain,
    })
    assert.equal(onto.checkpoint_commit, null)
    assert.equal(
      git(behind.worktreePath, ['rev-parse', 'HEAD']),
      headBeforeOnto,
    )

    // Naming a ref the branch does not descend from rebases onto it and
    // records the same override shape on the synchronized result.
    git(behind.root, [
      'switch',
      '-q',
      '-c',
      'operator-base',
      behind.fetchedMain,
    ])
    writeFileSync(
      path.join(behind.root, 'operator-base.txt'),
      'operator-selected base\n',
    )
    git(behind.root, ['add', 'operator-base.txt'])
    git(behind.root, ['commit', '-qm', 'feat: operator-selected base'])

    const operatorBase = git(behind.root, ['rev-parse', 'HEAD'])

    git(behind.root, ['switch', '-q', 'main'])

    const rebased = syncLocalRelease(
      behind.root,
      behind.record.name,
      'feat: checkpoint',
      undefined,
      { onto: 'operator-base' },
    )

    assert.equal(rebased.status, 'synchronized')
    assert.equal(rebased.rebase_target, operatorBase)
    assert.deepEqual(rebased.rebase_override, {
      kind: 'onto',
      requested_ref: 'operator-base',
      resolved_commit: operatorBase,
    })
    assert.deepEqual(rebased.conflicted_paths, [])
    assert.equal(
      git(behind.worktreePath, [
        'merge-base',
        '--is-ancestor',
        operatorBase,
        'HEAD',
      ]),
      '',
      'the branch now descends from the operator-selected base',
    )
    assert.equal(
      git(behind.worktreePath, [
        'rev-list',
        '--merges',
        '--count',
        `${operatorBase}..HEAD`,
      ]),
      '1',
      'the cohort integration merge survived the --onto rebase',
    )
  } finally {
    rmSync(behind.root, { recursive: true, force: true })
    rmSync(behind.remote, { recursive: true, force: true })
  }
})

test('release sync skips an ancestor target and rebases when the fetched head is ahead', () => {
  const root = createFixture()
  const remote = createTestTempDirectory('pan-release-ahead-')

  try {
    execFileSync('git', ['init', '--bare', '-q'], { cwd: remote })
    git(root, ['branch', '-M', 'main'])
    git(root, ['remote', 'add', 'origin', remote])
    git(root, ['push', '-u', 'origin', 'main'])

    const equalRecord = createWorktree(root, 'release-equal')
    const equalWorktree = path.join(root, equalRecord.path)

    writeFileSync(
      path.join(equalWorktree, 'src', 'base.ts'),
      "export const base = 'equal heads'\n",
    )

    const equal = syncLocalRelease(
      root,
      equalRecord.name,
      'feat: checkpoint against an equal head',
    )

    assert.equal(equal.status, 'already_current')
    assert.equal(equal.rebase_target, equal.fetched_main)
    assert.equal(equal.rebase_override, null)
    assert.equal(git(equalWorktree, ['rev-parse', 'HEAD^']), equal.fetched_main)

    const aheadRecord = createWorktree(root, 'release-ahead')
    const aheadWorktree = path.join(root, aheadRecord.path)

    writeFileSync(path.join(root, 'remote-main.txt'), 'remote main change\n')
    git(root, ['add', 'remote-main.txt'])
    git(root, ['commit', '-qm', 'feat: advance remote main'])
    git(root, ['push', '-q', 'origin', 'main'])

    const aheadHead = git(root, ['rev-parse', 'HEAD'])

    // Leave local main behind the remote, which is the direction the guard
    // must ignore.
    git(root, ['reset', '-q', '--hard', 'HEAD~1'])

    writeFileSync(
      path.join(aheadWorktree, 'src', 'base.ts'),
      "export const base = 'ahead head'\n",
    )

    const ahead = syncLocalRelease(
      root,
      aheadRecord.name,
      'feat: checkpoint against an advanced head',
    )

    assert.equal(ahead.status, 'synchronized')
    assert.equal(ahead.fetched_main, aheadHead)
    assert.equal(ahead.rebase_target, aheadHead)
    assert.equal(ahead.rebase_override, null)
    assert.equal(git(aheadWorktree, ['rev-parse', 'HEAD^']), aheadHead)
  } finally {
    rmSync(remote, { recursive: true, force: true })
  }
})
