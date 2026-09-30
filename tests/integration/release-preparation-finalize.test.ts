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

import { scanStyleArtifacts } from '../../src/lib/code-style.js'
import { scanConformArtifacts } from '../../src/lib/conform.js'
import { allocateReleaseVersion } from '../../src/lib/release-allocation.js'
import {
  finalizeLocalRelease,
  syncLocalRelease,
} from '../../src/lib/release-preparation.js'
import { createRun, setRunStage, waiveGate } from '../../src/lib/engine.js'
import { loadState, statePath } from '../../src/lib/state.js'
import { fileExists } from '../../src/lib/io.js'
import { createWorktree } from '../../src/lib/worktrees.js'
import { createFixture, writeJson } from '../helpers.js'
import { createTestTempDirectory } from '../temp.js'
import {
  DESIGN_SOURCE,
  attributeReadOnlyInput,
  errorCode,
  finalizeWithQualityOverrides,
  git,
  writeReleaseMetadata,
} from './release-preparation-helpers.js'

function prepareReleaseCandidate(
  name: string,
  options: { allocate?: boolean } = {},
): {
  root: string
  remote: string
  record: ReturnType<typeof createWorktree>
  worktreePath: string
  fetchedMain: string
  version: string
} {
  const root = createFixture()
  const remote = createTestTempDirectory('pan-release-recovery-')

  execFileSync('git', ['init', '--bare', '-q'], { cwd: remote })
  git(root, ['branch', '-M', 'main'])
  git(root, ['remote', 'add', 'origin', remote])
  git(root, ['push', '-u', 'origin', 'main'])

  const record = createWorktree(root, name)
  const worktreePath = path.join(root, record.path)

  writeFileSync(
    path.join(worktreePath, 'src', 'base.ts'),
    "export const base = 'release candidate'\n",
  )

  const synchronized = syncLocalRelease(
    root,
    record.name,
    'feat: checkpoint release candidate',
  )
  const allocation =
    options.allocate === false
      ? null
      : allocateReleaseVersion(root, record.name, 'patch')
  const version = writeReleaseMetadata(worktreePath)

  if (allocation) {
    assert.equal(version, allocation.allocation.version)
  }

  return {
    root,
    remote,
    record,
    worktreePath,
    fetchedMain: synchronized.fetched_main,
    version,
  }
}

function commitReleaseMetadata(worktreePath: string, version: string): string {
  git(worktreePath, [
    'add',
    'CHANGELOG.md',
    'VERSION',
    'docs/embedded-installation.md',
    'package-lock.json',
    'package.json',
  ])
  git(worktreePath, ['commit', '-m', `release: prepare v${version}`])

  return git(worktreePath, ['rev-parse', 'HEAD'])
}

test('release finalize succeeds without quality preconditions', () => {
  const candidate = prepareReleaseCandidate('release-no-quality-gate')

  try {
    writeFileSync(
      path.join(candidate.worktreePath, 'AGENTS.md'),
      `${readFileSync(path.join(candidate.worktreePath, 'AGENTS.md'), 'utf8')}\nDon't ship this sentence.\n`,
    )
    git(candidate.worktreePath, ['add', 'AGENTS.md'])
    git(candidate.worktreePath, ['commit', '-qm', 'test: add conform issue'])
    writeFileSync(
      path.join(candidate.worktreePath, 'src', 'quality-issue.ts'),
      'export function qualityIssue(ready: boolean): void {\n  if (ready) return\n}\n',
    )
    git(candidate.worktreePath, ['add', 'src/quality-issue.ts'])
    git(candidate.worktreePath, ['commit', '-qm', 'test: add style issue'])

    assert.equal(
      scanConformArtifacts(candidate.root, {
        workspace_root: candidate.worktreePath,
        all: true,
      }).status,
      'failed',
    )
    assert.equal(
      scanStyleArtifacts(candidate.root, {
        workspace_root: candidate.worktreePath,
        all: true,
      }).status,
      'failed',
    )

    const finalized = finalizeLocalRelease(
      candidate.root,
      candidate.record.name,
      candidate.fetchedMain,
    )

    assert.equal(finalized.status, 'finalized')
    assert.equal(finalized.release_commit.length, 40)
    assert.equal('overridden_quality_passes' in finalized, false)
  } finally {
    rmSync(candidate.remote, { recursive: true, force: true })
  }
})

test('release finalization refuses success when a post-commit hook dirties the tree', () => {
  const candidate = prepareReleaseCandidate('release-post-commit-dirty')

  try {
    const hooksDirectory = path.resolve(
      candidate.worktreePath,
      git(candidate.worktreePath, ['rev-parse', '--git-path', 'hooks']),
    )
    const hookPath = path.join(hooksDirectory, 'post-commit')

    mkdirSync(hooksDirectory, { recursive: true })
    writeFileSync(
      hookPath,
      `#!/bin/sh
subject="$(git log -1 --format=%s)"
if [ "$subject" = 'chore: index release v${candidate.version}' ]; then
  printf '%s\n' '// dirtied after the index commit' >> src/base.ts
fi
`,
    )
    chmodSync(hookPath, 0o755)

    let refusal: unknown = null

    try {
      finalizeWithQualityOverrides(
        candidate.root,
        candidate.record.name,
        candidate.fetchedMain,
      )
    } catch (error) {
      refusal = error
    }

    assert.ok(refusal instanceof Error)
    assert.equal(
      'code' in refusal ? refusal.code : null,
      'RELEASE_WORKTREE_DIRTY',
    )
    assert.match(refusal.message, /src\/base\.ts/u)
    assert.equal(
      git(candidate.worktreePath, ['log', '-1', '--format=%s']),
      `chore: index release v${candidate.version}`,
      'the refusal happens after both release commits exist',
    )
    assert.equal(
      git(candidate.worktreePath, ['status', '--porcelain=v1']),
      'M src/base.ts',
    )

    // The pair the block left behind is complete, so a retry meets it as a
    // finalized release with a dirty non-metadata path and refuses before any
    // commit rather than writing a second pair for the same version.
    const commitCountAfterBlock = git(candidate.worktreePath, [
      'rev-list',
      '--count',
      'HEAD',
    ])

    assert.equal(
      errorCode(() =>
        finalizeWithQualityOverrides(
          candidate.root,
          candidate.record.name,
          candidate.fetchedMain,
        ),
      ),
      'RELEASE_SCOPE_INVALID',
    )
    assert.equal(
      git(candidate.worktreePath, ['rev-list', '--count', 'HEAD']),
      commitCountAfterBlock,
      'the retry writes no second release pair',
    )
  } finally {
    rmSync(candidate.root, { recursive: true, force: true })
    rmSync(candidate.remote, { recursive: true, force: true })
  }
})

test('release finalization refuses an unclassifiable tracked edit before any commit', () => {
  const candidate = prepareReleaseCandidate('release-dirty-before-commit')

  try {
    // The HR-009 shape: a tracked file the operator recorded as a read-only
    // input and then modified. The record withholds it from every harness
    // commit and the modification blocks a clean tree, so finalization can
    // neither commit it nor ignore it.
    const sourcePath = path.join('src', 'base.ts')

    writeFileSync(
      path.join(candidate.worktreePath, sourcePath),
      "export const base = 'misattributed edit'\n",
    )
    attributeReadOnlyInput(candidate.root, candidate.worktreePath, [sourcePath])

    const headBeforeFinalize = git(candidate.worktreePath, [
      'rev-parse',
      'HEAD',
    ])
    const commitCountBeforeFinalize = git(candidate.worktreePath, [
      'rev-list',
      '--count',
      'HEAD',
    ])

    let refusal: unknown = null

    try {
      finalizeWithQualityOverrides(
        candidate.root,
        candidate.record.name,
        candidate.fetchedMain,
      )
    } catch (error) {
      refusal = error
    }

    assert.ok(refusal instanceof Error)
    assert.equal(
      'code' in refusal ? refusal.code : null,
      'RELEASE_WORKTREE_DIRTY',
    )
    assert.match(refusal.message, /src\/base\.ts/u)
    assert.match(refusal.message, /found work it cannot classify/u)
    assert.equal(
      git(candidate.worktreePath, ['rev-parse', 'HEAD']),
      headBeforeFinalize,
      'the refusal leaves the branch at the head the attempt found',
    )
    assert.equal(
      git(candidate.worktreePath, ['rev-list', '--count', 'HEAD']),
      commitCountBeforeFinalize,
      'neither release commit was written',
    )
    assert.equal(
      git(candidate.worktreePath, ['diff', '--cached', '--name-only']),
      '',
      'nothing was staged on the way to the refusal',
    )
  } finally {
    rmSync(candidate.root, { recursive: true, force: true })
    rmSync(candidate.remote, { recursive: true, force: true })
  }
})

test('release finalization neither commits nor refuses over a recorded read-only input', () => {
  const candidate = prepareReleaseCandidate('release-withheld')

  try {
    // The operator input arrives in the release worktree after the sync, so
    // finalization is the step that meets it.
    writeFileSync(path.join(candidate.worktreePath, DESIGN_SOURCE), '<svg/>\n')
    attributeReadOnlyInput(candidate.root, candidate.worktreePath)

    writeFileSync(
      path.join(candidate.root, 'local-main-only.txt'),
      'local integration advance\n',
    )
    git(candidate.root, ['add', 'local-main-only.txt'])
    git(candidate.root, ['commit', '-qm', 'feat: advance local main only'])

    const localMain = git(candidate.root, ['rev-parse', 'HEAD'])
    const finalized = finalizeWithQualityOverrides(
      candidate.root,
      candidate.record.name,
      candidate.fetchedMain,
    )

    assert.equal(finalized.version, candidate.version)
    assert.equal(finalized.clean, true)
    assert.deepEqual(finalized.advisories, [
      {
        code: 'RELEASE_LOCAL_DEFAULT_AHEAD',
        message:
          `Local default branch 'main' at ${localMain} is ahead of fetched ` +
          `main ${candidate.fetchedMain}; release preparation kept the local ` +
          `history and did not publish it.`,
        details: {
          default_branch: 'main',
          fetched_main: candidate.fetchedMain,
          local_head: localMain,
        },
      },
    ])
    assert.doesNotMatch(
      git(candidate.worktreePath, [
        'diff-tree',
        '--no-commit-id',
        '--name-only',
        '-r',
        finalized.release_commit,
      ]),
      /design-source\.svg/u,
    )
    assert.equal(
      git(candidate.worktreePath, ['status', '--porcelain=v1']),
      `?? ${DESIGN_SOURCE}`,
      'the input is still the untracked file the operator placed',
    )
  } finally {
    rmSync(candidate.root, { recursive: true, force: true })
    rmSync(candidate.remote, { recursive: true, force: true })
  }
})

test('release finalization recovers release-only and index-only partial states', () => {
  const releaseOnly = prepareReleaseCandidate('release-only')

  try {
    const releaseCommit = commitReleaseMetadata(
      releaseOnly.worktreePath,
      releaseOnly.version,
    )
    const finalized = finalizeWithQualityOverrides(
      releaseOnly.root,
      releaseOnly.record.name,
      releaseOnly.fetchedMain,
    )

    assert.equal(finalized.release_commit, releaseCommit)
    assert.equal(
      git(releaseOnly.worktreePath, ['rev-parse', 'HEAD^']),
      releaseCommit,
    )
  } finally {
    rmSync(releaseOnly.root, { recursive: true, force: true })
    rmSync(releaseOnly.remote, { recursive: true, force: true })
  }

  const indexOnly = prepareReleaseCandidate('index-only')

  try {
    const releaseCommit = commitReleaseMetadata(
      indexOnly.worktreePath,
      indexOnly.version,
    )
    const indexPath = path.join(indexOnly.worktreePath, 'release', 'index.json')
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
      releases: Array<{ version: string; commit: string }>
    }

    index.releases.push({
      version: indexOnly.version,
      commit: releaseCommit,
    })
    writeJson(indexPath, index)

    const finalized = finalizeWithQualityOverrides(
      indexOnly.root,
      indexOnly.record.name,
      indexOnly.fetchedMain,
    )

    assert.equal(finalized.release_commit, releaseCommit)
    assert.equal(
      git(indexOnly.worktreePath, ['rev-parse', 'HEAD^']),
      releaseCommit,
    )
  } finally {
    rmSync(indexOnly.root, { recursive: true, force: true })
    rmSync(indexOnly.remote, { recursive: true, force: true })
  }
})

test('release finalization refuses dirty metadata on a completed same-version pair', () => {
  const candidate = prepareReleaseCandidate('release-finalized-dirty')

  try {
    const finalized = finalizeWithQualityOverrides(
      candidate.root,
      candidate.record.name,
      candidate.fetchedMain,
    )
    const headBeforeRetry = git(candidate.worktreePath, ['rev-parse', 'HEAD'])
    const commitCountBeforeRetry = git(candidate.worktreePath, [
      'rev-list',
      '--count',
      'HEAD',
    ])
    const changelogPath = path.join(candidate.worktreePath, 'CHANGELOG.md')

    writeFileSync(
      changelogPath,
      `${readFileSync(changelogPath, 'utf8')}\nDirty retry metadata.\n`,
    )
    assert.equal(
      readFileSync(path.join(candidate.worktreePath, 'VERSION'), 'utf8').trim(),
      candidate.version,
    )

    let refusal: unknown = null

    try {
      finalizeWithQualityOverrides(
        candidate.root,
        candidate.record.name,
        candidate.fetchedMain,
      )
    } catch (error) {
      refusal = error
    }

    assert.ok(refusal instanceof Error)
    assert.equal(
      'code' in refusal ? refusal.code : null,
      'RELEASE_VERSION_ALREADY_FINALIZED_DIRTY',
    )
    assert.match(
      refusal.message,
      new RegExp(`Release v${candidate.version}`, 'u'),
    )
    assert.match(refusal.message, /CHANGELOG\.md/u)
    assert.deepEqual('details' in refusal ? refusal.details : null, {
      version: candidate.version,
      release_commit: finalized.release_commit,
      index_commit: finalized.index_commit,
      dirty_paths: ['CHANGELOG.md'],
    })
    assert.equal(
      git(candidate.worktreePath, ['rev-parse', 'HEAD']),
      headBeforeRetry,
      'the dirty retry must leave the completed pair at HEAD',
    )
    assert.equal(
      git(candidate.worktreePath, ['rev-list', '--count', 'HEAD']),
      commitCountBeforeRetry,
      'the dirty retry must not write a second release pair',
    )
  } finally {
    rmSync(candidate.root, { recursive: true, force: true })
    rmSync(candidate.remote, { recursive: true, force: true })
  }
})

test('release finalization blocks before committing an invalid worktree', () => {
  const candidate = prepareReleaseCandidate('release-blocked-cleanly')

  try {
    writeFileSync(
      path.join(candidate.worktreePath, 'src', 'base.ts'),
      "export const base = 'unexpected finalization edit'\n",
    )

    const headBeforeFinalize = git(candidate.worktreePath, [
      'rev-parse',
      'HEAD',
    ])
    const commitCountBeforeFinalize = git(candidate.worktreePath, [
      'rev-list',
      '--count',
      'HEAD',
    ])

    assert.equal(
      errorCode(() =>
        finalizeWithQualityOverrides(
          candidate.root,
          candidate.record.name,
          candidate.fetchedMain,
        ),
      ),
      'RELEASE_SCOPE_INVALID',
    )
    assert.equal(
      git(candidate.worktreePath, ['rev-parse', 'HEAD']),
      headBeforeFinalize,
      'a deterministic finalization block must not move the branch',
    )
    assert.equal(
      git(candidate.worktreePath, ['rev-list', '--count', 'HEAD']),
      commitCountBeforeFinalize,
      'a blocked attempt writes neither release commit',
    )
  } finally {
    rmSync(candidate.root, { recursive: true, force: true })
    rmSync(candidate.remote, { recursive: true, force: true })
  }
})

test('standalone release refuses an active workflow in the same worktree', () => {
  const root = createFixture()
  const record = createWorktree(root, 'release-busy')
  const worktreePath = path.join(root, record.path)
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    workspace: record.path,
    worktree: record,
  })

  assert.equal(state.workspace_root, record.path)
  assert.equal(state.status, 'running')
  assert.equal(fileExists(statePath(root, state.run_id)), true)
  assert.equal(loadState(root, state.run_id).workspace_root, record.path)
  git(worktreePath, ['switch', '-c', 'blocked-branch'])
  // The refusal names the run holding the claim and the command that
  // releases it, so an operator is not left to infer an abort.
  assert.throws(
    () => syncLocalRelease(root, record.name, 'feat: checkpoint'),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'RELEASE_WORKFLOW_ACTIVE' &&
      error.message.includes(
        `Run '${state.run_id}' holds the worktree claim`,
      ) &&
      error.message.includes(`./bin/pan abort ${state.run_id}`),
  )
  assert.equal(
    git(worktreePath, ['branch', '--show-current']),
    'blocked-branch',
  )

  // The commit-hash invariant is the first statement of finalizeLocalRelease,
  // so it refuses before any Git inspection reaches the worktree.
  assert.equal(
    errorCode(() =>
      finalizeWithQualityOverrides(root, record.name, '-bad-ref'),
    ),
    'RELEASE_FETCHED_MAIN_INVALID',
  )

  assert.throws(
    () => syncLocalRelease(root, record.name, 'feat: checkpoint', state.run_id),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'RELEASE_RUN_WORKTREE_MISMATCH',
  )
  assert.equal(
    git(worktreePath, ['branch', '--show-current']),
    'blocked-branch',
  )
})

test('waiver-based plan adoption moves the claim and releases the workspace', () => {
  const root = createFixture()
  const remote = createTestTempDirectory('pan-release-adoption-')

  try {
    execFileSync('git', ['init', '--bare', '-q'], { cwd: remote })
    git(root, ['branch', '-M', 'main'])
    git(root, ['remote', 'add', 'origin', remote])
    git(root, ['push', '-u', 'origin', 'main'])

    const record = createWorktree(root, 'release-adopted')
    const subsumed = createRun(root, {
      workflowSlug: 'delivery',
      requestPath: 'request.md',
      workspace: record.path,
      worktree: record,
    })
    const adopting = createRun(root, {
      workflowSlug: 'delivery',
      requestPath: 'request.md',
      workspace: record.path,
      worktree: record,
    })

    setRunStage(root, adopting.run_id, 'ship', 'Release preparation')

    // The subsumed run exchanged its plan rather than its worktree, so it is
    // still live and still occupying the workspace the release needs.
    assert.throws(
      () =>
        syncLocalRelease(
          root,
          record.name,
          'feat: checkpoint',
          adopting.run_id,
        ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'RELEASE_WORKFLOW_ACTIVE' &&
        error.message.includes(`--adopt-plan-from ${subsumed.run_id}`),
    )

    const waived = waiveGate(root, adopting.run_id, {
      note: 'This run adopts the ratified plan of the subsumed run, and ship is waived through to succeeded.',
      adoptPlanFromRunId: subsumed.run_id,
    })

    assert.equal(waived.claimTransfer?.role, 'adopted')
    assert.equal(waived.claimTransfer?.worktree, record.name)
    assert.equal(waived.claimTransfer?.from_run_id, subsumed.run_id)
    assert.equal(waived.claimTransfer?.to_run_id, adopting.run_id)
    assert.equal(waived.claimTransfer?.waiver_id, waived.waiver.waiver_id)
    assert.deepEqual(loadState(root, subsumed.run_id).worktree_claim_transfer, {
      ...waived.claimTransfer,
      role: 'released',
    })

    // Adoption is not abortion: the subsumed run keeps running, it just
    // stops occupying the worktree.
    assert.equal(loadState(root, subsumed.run_id).status, 'running')
    // The waiver advanced the adopting run off ship, so put it back where a
    // release owner sits before the workspace assertion runs again.
    setRunStage(root, adopting.run_id, 'ship', 'Release preparation')

    const synchronized = syncLocalRelease(
      root,
      record.name,
      'feat: checkpoint',
      adopting.run_id,
    )

    assert.equal(synchronized.status, 'already_current')
  } finally {
    rmSync(remote, { recursive: true, force: true })
  }
})

test('release finalization requires an allocation before creating a commit', () => {
  const candidate = prepareReleaseCandidate('release-no-allocation', {
    allocate: false,
  })
  const before = git(candidate.worktreePath, ['rev-parse', 'HEAD'])

  assert.throws(
    () =>
      finalizeWithQualityOverrides(
        candidate.root,
        candidate.record.name,
        candidate.fetchedMain,
      ),
    /pan release allocate --worktree release-no-allocation/u,
  )
  assert.equal(git(candidate.worktreePath, ['rev-parse', 'HEAD']), before)
})

test('release finalization names a version collision on pan-dev', () => {
  const candidate = prepareReleaseCandidate('release-collision')
  const original = git(candidate.root, ['branch', '--show-current'])

  git(candidate.root, ['checkout', '-q', '-b', 'pan-dev'])
  writeFileSync(path.join(candidate.root, 'VERSION'), `${candidate.version}\n`)
  git(candidate.root, ['add', 'VERSION'])
  git(candidate.root, ['commit', '-qm', `publish ${candidate.version}`])
  const collisionCommit = git(candidate.root, ['rev-parse', 'HEAD'])
  git(candidate.root, ['checkout', '-q', original])

  assert.throws(
    () =>
      finalizeWithQualityOverrides(
        candidate.root,
        candidate.record.name,
        candidate.fetchedMain,
      ),
    new RegExp(`pan-dev.*${collisionCommit}`, 'u'),
  )
})
