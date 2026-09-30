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

import { allocateReleaseVersion } from '../../src/lib/release-allocation.js'
import {
  continueLocalRelease,
  syncLocalRelease,
} from '../../src/lib/release-preparation.js'
import { createRun } from '../../src/lib/engine.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import { fileExists } from '../../src/lib/io.js'
import { evaluateDeterministicCriteria } from '../../src/lib/validation.js'
import { validateReleaseOutput } from '../../src/lib/validators/stage-validators.js'
import { createWorktree } from '../../src/lib/worktrees.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createFixture, writeJson } from '../helpers.js'
import type { StageOutput } from '../../src/lib/types.js'
import { createTestTempDirectory } from '../temp.js'
import { runCli } from './worktree-helpers.js'
import {
  DESIGN_SOURCE,
  attributeReadOnlyInput,
  finalizeWithQualityOverrides,
  git,
  writeReleaseMetadata,
} from './release-preparation-helpers.js'

function startProcessAudit(): {
  logPath: string
  restore: () => void
} {
  const directory = createTestTempDirectory('pan-release-audit-')
  const logPath = path.join(directory, 'calls.log')
  const gitExecutable = execFileSync('which', ['git'], {
    encoding: 'utf8',
  }).trim()

  for (const command of [
    'git',
    'gh',
    'npm',
    'pnpm',
    'yarn',
    'docker',
    'kubectl',
  ]) {
    const executable = path.join(directory, command)
    const target =
      command === 'git'
        ? `exec ${JSON.stringify(gitExecutable)} "$@"`
        : 'exit 97'

    writeFileSync(
      executable,
      `#!/bin/sh\nprintf '%s %s\\n' ${JSON.stringify(command)} "$*" >> ${JSON.stringify(logPath)}\n${target}\n`,
    )
    chmodSync(executable, 0o755)
  }

  const previousPath = process.env.PATH

  process.env.PATH = `${directory}${path.delimiter}${previousPath ?? ''}`

  return {
    logPath,
    restore: () => {
      process.env.PATH = previousPath
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('local release sync checkpoints changes and finalizes two commits', () => {
  const root = createFixture()
  const remote = createTestTempDirectory('pan-release-remote-')
  let processAudit: ReturnType<typeof startProcessAudit> | null = null

  try {
    execFileSync('git', ['init', '--bare', '-q'], { cwd: remote })
    git(root, ['branch', '-M', 'main'])
    git(root, ['remote', 'add', 'origin', remote])
    git(root, ['push', '-u', 'origin', 'main'])

    const record = createWorktree(root, 'release-one')
    const worktreePath = path.join(root, record.path)
    const versionBaseline = git(root, ['rev-parse', 'HEAD'])

    writeFileSync(path.join(root, 'remote-main.txt'), 'remote main change\n')
    git(root, ['add', 'remote-main.txt'])
    git(root, ['commit', '-m', 'feat: advance remote main'])
    git(root, ['push', 'origin', 'main'])

    writeFileSync(
      path.join(worktreePath, 'src', 'base.ts'),
      "export const base = 'release candidate'\n",
    )

    processAudit = startProcessAudit()

    const synchronized = syncLocalRelease(
      root,
      record.name,
      'feat: checkpoint release candidate',
    )

    assert.equal(synchronized.status, 'synchronized')
    assert.ok(synchronized.checkpoint_commit)
    assert.equal(
      git(worktreePath, ['rev-parse', 'HEAD^']),
      synchronized.fetched_main,
    )
    assert.equal(
      git(worktreePath, [
        'merge-base',
        '--is-ancestor',
        synchronized.fetched_main,
        'HEAD',
      ]),
      '',
    )

    const allocation = allocateReleaseVersion(root, record.name, 'patch')
    const version = writeReleaseMetadata(worktreePath)

    assert.equal(version, allocation.allocation.version)
    const finalized = finalizeWithQualityOverrides(
      root,
      record.name,
      synchronized.fetched_main,
    )

    assert.equal(finalized.version, version)
    assert.equal(finalized.clean, true)
    assert.equal(
      git(worktreePath, ['rev-parse', 'HEAD']),
      finalized.index_commit,
    )
    assert.equal(
      git(worktreePath, ['rev-parse', `${finalized.index_commit}^`]),
      finalized.release_commit,
    )
    assert.equal(
      git(worktreePath, [
        'diff-tree',
        '--no-commit-id',
        '--name-only',
        '-r',
        finalized.index_commit,
      ]),
      'release/index.json',
    )

    const releaseIndex = JSON.parse(
      readFileSync(path.join(worktreePath, 'release', 'index.json'), 'utf8'),
    ) as { releases: Array<{ version: string; commit: string }> }

    assert.deepEqual(
      releaseIndex.releases.find((entry) => entry.version === version),
      { version, commit: finalized.release_commit },
    )
    assert.equal(git(worktreePath, ['status', '--porcelain']), '')

    const commitCountBeforeReplay = git(worktreePath, [
      'rev-list',
      '--count',
      'HEAD',
    ])
    const replayed = finalizeWithQualityOverrides(
      root,
      record.name,
      synchronized.fetched_main,
    )

    assert.equal(replayed.release_commit, finalized.release_commit)
    assert.equal(replayed.index_commit, finalized.index_commit)
    assert.equal(
      git(worktreePath, ['rev-list', '--count', 'HEAD']),
      commitCountBeforeReplay,
      'a repeated same-version finalization writes no second commit pair',
    )
    const replayedIndex = JSON.parse(
      readFileSync(path.join(worktreePath, 'release', 'index.json'), 'utf8'),
    ) as { releases: Array<{ version: string; commit: string }> }

    assert.equal(
      replayedIndex.releases.filter((entry) => entry.version === version)
        .length,
      1,
      'the reused release version retains one index entry',
    )

    const prPath = 'runtime/pr-descriptions/final.md'

    mkdirSync(path.dirname(path.join(root, prPath)), { recursive: true })
    writeFileSync(
      path.join(root, prPath),
      `feat: prepare local release\n\n## Summary\nPrepare the release.\n\n## Changelist\n- Local commit range: \`${finalized.release_commit}..${finalized.index_commit}\`.\n`,
    )
    writeJson(path.join(root, 'runtime', 'ship-output.json'), {
      data: {
        release: {
          summary: 'Ready.',
          change_list: [],
          validation: [],
          rollback: 'Revert the two local commits.',
          waivers: [],
          follow_up_cases: [],
          governance_artifact_review: {
            summary: 'No issues.',
            issues_reviewed: [],
            repairs: [],
            escalations: [],
          },
          local_release: {
            fetched_main: synchronized.fetched_main,
            release_commit: finalized.release_commit,
            index_commit: finalized.index_commit,
            branch: finalized.branch,
            pr_description_path: prPath,
          },
          versioning: {
            current_version: git(worktreePath, [
              'show',
              `${finalized.release_commit}^:VERSION`,
            ]),
            recommendation: 'patch',
            proposed_version: version,
            baseline_commit: versionBaseline,
            rationale: 'The release contains compatible maintenance.',
            compatibility: 'Backward compatible.',
            updated_files: [
              'CHANGELOG.md',
              'VERSION',
              'docs/embedded-installation.md',
              'package-lock.json',
              'package.json',
            ],
            release_index_action: 'Created a separate release index commit.',
          },
        },
      },
    })

    const validation = validateReleaseOutput({
      root,
      targetPath: 'runtime/ship-output.json',
      requirement: {
        policy_id: 'SHIP-001',
        requirement_id: 'release-packet-validate',
        registry_id: 'RELEASE-PACKET-VALIDATE-001',
        arguments: {},
      },
      invocation: {
        workspace_root: record.path,
        managed_worktree: {
          name: record.name,
          path: record.path,
          branch: record.branch,
        },
      },
      runState: { workspace_root: record.path },
    })

    assert.equal(validation.status, 'passed', JSON.stringify(validation.issues))

    writeFileSync(
      path.join(root, prPath),
      'feat: prepare local release\n\n## Summary\nPrepare the release.\n\n## Changelist\n- Finalize local commits.\n',
    )

    const missingRange = validateReleaseOutput({
      root,
      targetPath: 'runtime/ship-output.json',
      requirement: {
        policy_id: 'SHIP-001',
        requirement_id: 'release-packet-validate',
        registry_id: 'RELEASE-PACKET-VALIDATE-001',
        arguments: {},
      },
      invocation: {
        workspace_root: record.path,
        managed_worktree: {
          name: record.name,
          path: record.path,
          branch: record.branch,
        },
      },
      runState: { workspace_root: record.path },
    })

    assert.ok(
      missingRange.issues.some(
        (issue) => issue.code === 'release.pr_commit_range_missing',
      ),
    )

    const state = createRun(root, {
      workflowSlug: 'delivery',
      requestPath: 'request.md',
      workspace: record.path,
      worktree: record,
    })
    const workflow = loadWorkflow(root, 'delivery')
    const shipStage = stageBySlug(workflow, 'ship')
    const localReleaseStage = {
      ...shipStage,
      criteria: shipStage.criteria.filter(
        (criterion) => criterion.id === 'ship.local_release_complete',
      ),
    }

    const snapshot = gitWorkspaceSnapshot(worktreePath)
    const gateOutput = {
      data: {
        release: {
          local_release: {
            fetched_main: synchronized.fetched_main,
            release_commit: finalized.release_commit,
            index_commit: finalized.index_commit,
          },
        },
      },
    } as unknown as StageOutput
    const gate = evaluateDeterministicCriteria(
      root,
      path.join(root, 'runtime', 'gate-evidence'),
      state,
      localReleaseStage,
      snapshot,
      worktreePath,
      {},
      'ship',
      gateOutput,
      undefined,
      null,
      snapshot,
    )

    assert.equal(gate.results[0]?.passed, true)
    // The other half of the pair: a worktree-bound run satisfies the
    // criterion, so it records no bypass advisory.
    assert.deepEqual(gate.advisories, [])

    const calls = readFileSync(processAudit.logPath, 'utf8')

    assert.match(calls, /^git fetch /mu)
    assert.doesNotMatch(
      calls,
      /^(?:git (?:push|merge)(?: |$)|gh |npm publish|pnpm publish|yarn publish|docker |kubectl )/mu,
    )
  } finally {
    processAudit?.restore()
    rmSync(root, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  }
})

test('release continuation refuses an unanchored manual rebase without mutation', () => {
  const root = createFixture()

  try {
    git(root, ['branch', '-M', 'main'])

    const record = createWorktree(root, 'release-unanchored-rebase')
    const worktreePath = path.join(root, record.path)
    const sourcePath = path.join('src', 'base.ts')
    const initial = readFileSync(path.join(root, sourcePath), 'utf8')

    writeFileSync(
      path.join(worktreePath, sourcePath),
      `${initial.trimEnd()}\nexport const unanchored = 'local'\n`,
    )
    git(worktreePath, ['add', sourcePath])
    git(worktreePath, ['commit', '-m', 'feat: local manual rebase conflict'])

    writeFileSync(
      path.join(root, sourcePath),
      `${initial.trimEnd()}\nexport const unanchored = 'main'\n`,
    )
    git(root, ['add', sourcePath])
    git(root, ['commit', '-m', 'feat: main manual rebase conflict'])

    assert.throws(() => git(worktreePath, ['rebase', 'main']))

    const rebaseDirectory = path.resolve(
      worktreePath,
      git(worktreePath, ['rev-parse', '--git-path', 'rebase-merge']),
    )
    const snapshot = (): Record<string, string> => ({
      head: git(worktreePath, ['rev-parse', 'HEAD']),
      index: git(worktreePath, ['ls-files', '--stage']),
      status: git(worktreePath, [
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
      ]),
    })
    const beforeContinue = snapshot()

    assert.equal(
      fileExists(path.join(rebaseDirectory, 'pancreator-release-anchor')),
      false,
    )

    let refusal: unknown = null

    try {
      continueLocalRelease(root, record.name)
    } catch (error) {
      refusal = error
    }

    assert.ok(refusal instanceof Error)
    assert.equal(
      'code' in refusal ? refusal.code : null,
      'RELEASE_REBASE_ANCHOR_MISSING',
    )
    assert.match(refusal.message, /Finish or abort that rebase manually/u)
    assert.match(refusal.message, /start release sync again/u)
    assert.deepEqual(
      snapshot(),
      beforeContinue,
      'the refused continuation changes neither status, HEAD, nor the index',
    )
    assert.equal(
      fileExists(rebaseDirectory),
      true,
      'the unrelated manual rebase remains active',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release continuation preserves unresolved conflicts and completes staged resolutions', () => {
  const root = createFixture()
  const remote = createTestTempDirectory('pan-release-conflict-')

  try {
    execFileSync('git', ['init', '--bare', '-q'], { cwd: remote })
    git(root, ['branch', '-M', 'main'])
    git(root, ['remote', 'add', 'origin', remote])
    git(root, ['push', '-u', 'origin', 'main'])

    const record = createWorktree(root, 'release-conflict')
    const worktreePath = path.join(root, record.path)
    const sourcePath = path.join('src', 'base.ts')

    const initial = readFileSync(path.join(root, sourcePath), 'utf8')
    const headBeforeContinue = git(worktreePath, ['rev-parse', 'HEAD'])

    const notNeeded = runCli<{ status: string; conflicted_paths: string[] }>(
      root,
      ['release', 'continue', '--worktree', record.name],
    )

    assert.equal(notNeeded.status, 'not_needed')
    assert.deepEqual(notNeeded.conflicted_paths, [])
    assert.equal(git(worktreePath, ['rev-parse', 'HEAD']), headBeforeContinue)

    writeFileSync(
      path.join(root, sourcePath),
      `${initial.trimEnd()}\nexport const conflict = 'remote'\n`,
    )
    git(root, ['add', sourcePath])
    git(root, ['commit', '-m', 'feat: remote conflict'])
    git(root, ['push', 'origin', 'main'])
    writeFileSync(
      path.join(worktreePath, sourcePath),
      `${initial.trimEnd()}\nexport const conflict = 'local'\n`,
    )

    // The operator placed a read-only input in the release worktree. No
    // release commit may carry it, and no release step may refuse over it.
    writeFileSync(path.join(worktreePath, DESIGN_SOURCE), '<svg/>\n')
    attributeReadOnlyInput(root, worktreePath)

    const synchronized = syncLocalRelease(
      root,
      record.name,
      'feat: checkpoint local conflict',
    )

    assert.equal(synchronized.status, 'conflict')
    assert.deepEqual(synchronized.conflicted_paths, [sourcePath])
    assert.deepEqual(synchronized.withheld_paths, [DESIGN_SOURCE])
    assert.ok(synchronized.checkpoint_commit)
    assert.deepEqual(
      git(worktreePath, [
        'diff-tree',
        '--no-commit-id',
        '--name-only',
        '-r',
        synchronized.checkpoint_commit,
      ])
        .split('\n')
        .filter(Boolean),
      [sourcePath],
      'the checkpoint carries the release work and not the operator input',
    )

    const unresolved = continueLocalRelease(root, record.name)

    assert.equal(unresolved.status, 'conflict')
    assert.deepEqual(unresolved.conflicted_paths, [sourcePath])

    // The reported status is only half the contract. A continuation that
    // aborted the rebase, or that resolved the file on the operator's behalf,
    // would report the same conflict while destroying the work in progress.
    assert.equal(
      fileExists(
        path.resolve(
          worktreePath,
          git(worktreePath, ['rev-parse', '--git-path', 'rebase-merge']),
        ),
      ),
      true,
      'the rebase is still in progress for the operator to finish',
    )
    assert.deepEqual(
      git(worktreePath, ['diff', '--name-only', '--diff-filter=U'])
        .split('\n')
        .filter(Boolean),
      [sourcePath],
    )
    assert.match(
      readFileSync(path.join(worktreePath, sourcePath), 'utf8'),
      /^<{7} /mu,
      'the conflict markers stay in the working tree',
    )

    writeFileSync(
      path.join(worktreePath, sourcePath),
      `${initial.trimEnd()}\nexport const conflict = 'resolved'\n`,
    )
    git(worktreePath, ['add', sourcePath])

    const completed = continueLocalRelease(root, record.name)

    assert.equal(completed.status, 'complete')
    assert.deepEqual(completed.conflicted_paths, [])
    assert.deepEqual(completed.withheld_paths, [DESIGN_SOURCE])
    assert.equal(git(worktreePath, ['branch', '--show-current']), record.branch)
    assert.equal(
      git(worktreePath, ['status', '--porcelain=v1']),
      `?? ${DESIGN_SOURCE}`,
      'the continuation left the operator input untracked and unstaged',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  }
})

test('release continuation completes a conflicted rebase that rewrites the pre-sync head', () => {
  const root = createFixture()
  const remote = createTestTempDirectory('pan-release-conflicted-lineage-')

  try {
    execFileSync('git', ['init', '--bare', '-q'], { cwd: remote })
    git(root, ['branch', '-M', 'main'])
    git(root, ['remote', 'add', 'origin', remote])
    git(root, ['push', '-u', 'origin', 'main'])

    const record = createWorktree(root, 'release-conflicted-lineage')
    const worktreePath = path.join(root, record.path)
    const sourcePath = path.join('src', 'base.ts')
    const initial = readFileSync(path.join(root, sourcePath), 'utf8')

    writeFileSync(
      path.join(worktreePath, sourcePath),
      `${initial.trimEnd()}\nexport const lineage = 'local'\n`,
    )
    git(worktreePath, ['add', sourcePath])
    git(worktreePath, ['commit', '-m', 'feat: committed local lineage'])

    const preSyncHead = git(worktreePath, ['rev-parse', 'HEAD'])

    writeFileSync(
      path.join(root, sourcePath),
      `${initial.trimEnd()}\nexport const lineage = 'remote'\n`,
    )
    git(root, ['add', sourcePath])
    git(root, ['commit', '-m', 'feat: conflicting remote lineage'])
    git(root, ['push', 'origin', 'main'])

    const synchronized = syncLocalRelease(
      root,
      record.name,
      'feat: unused clean checkpoint',
    )

    assert.equal(synchronized.status, 'conflict')
    assert.equal(synchronized.checkpoint_commit, null)
    assert.deepEqual(synchronized.conflicted_paths, [sourcePath])

    const rebaseDirectory = path.resolve(
      worktreePath,
      git(worktreePath, ['rev-parse', '--git-path', 'rebase-merge']),
    )
    const anchorPath = path.join(rebaseDirectory, 'pancreator-release-anchor')

    assert.deepEqual(JSON.parse(readFileSync(anchorPath, 'utf8')), {
      pre_sync_head: preSyncHead,
      rebase_target: synchronized.rebase_target,
      replayed_merges: [],
    })

    writeFileSync(
      path.join(worktreePath, sourcePath),
      `${initial.trimEnd()}\nexport const lineage = 'resolved'\n`,
    )
    git(worktreePath, ['add', sourcePath])

    const completed = continueLocalRelease(root, record.name)

    assert.equal(completed.status, 'complete')
    assert.deepEqual(completed.conflicted_paths, [])

    const postSyncHead = git(worktreePath, ['rev-parse', 'HEAD'])

    // The committed local head was itself replayed, so its hash is gone from
    // the result. That is what a rebase does; the lineage check compares the
    // merges the range carried, and this range carried none.
    assert.notEqual(postSyncHead, preSyncHead)
    assert.throws(() =>
      git(worktreePath, [
        'merge-base',
        '--is-ancestor',
        preSyncHead,
        postSyncHead,
      ]),
    )
    assert.equal(
      git(worktreePath, [
        'merge-base',
        '--is-ancestor',
        synchronized.rebase_target ?? '',
        postSyncHead,
      ]),
      '',
      'the completed rebase descends from the fetched target',
    )
    assert.equal(
      readFileSync(path.join(worktreePath, sourcePath), 'utf8'),
      `${initial.trimEnd()}\nexport const lineage = 'resolved'\n`,
    )
    assert.equal(
      fileExists(anchorPath),
      false,
      'Git removes the ephemeral marker with the completed rebase metadata',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  }
})

test('release sync rejects every unsafe path class without repository mutation', () => {
  const cases = [
    ['credentials.txt', 'secret-like path'],
    ['runtime/generated.json', 'generated state'],
    ['dist/output.js', 'dependency or generated output'],
    ['node_modules/package/index.js', 'dependency or generated output'],
    // release/index.json is already tracked, so it needs no baseline.
    ['release/index.json', 'release index'],
  ] as const

  // assertCommittablePaths fires before any commit or fetch, so one fixture
  // and one worktree prove every class: dirty one path, assert, restore.
  const root = createFixture()

  for (const [relativePath, expectedClass] of cases) {
    if (relativePath === 'release/index.json') {
      continue
    }

    const absolute = path.join(root, relativePath)

    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, 'baseline\n')
    git(root, ['add', '-f', relativePath])
    git(root, ['commit', '-m', `test: track ${expectedClass}`])
  }

  const record = createWorktree(root, 'unsafe-paths')
  const worktreePath = path.join(root, record.path)

  for (const [relativePath, expectedClass] of cases) {
    const worktreeFile = path.join(worktreePath, relativePath)

    writeFileSync(
      worktreeFile,
      `${readFileSync(worktreeFile, 'utf8')}changed\n`,
    )

    const snapshot = (): Record<string, string> => ({
      branch: git(worktreePath, ['branch', '--show-current']),
      head: git(worktreePath, ['rev-parse', 'HEAD']),
      index: git(worktreePath, ['diff', '--cached']),
      status: git(worktreePath, [
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
      ]),
      file: readFileSync(worktreeFile, 'utf8'),
    })
    const before = snapshot()

    assert.throws(
      () => syncLocalRelease(root, record.name, 'feat: unsafe path'),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'RELEASE_PATH_UNSAFE' &&
        'details' in error &&
        typeof error.details === 'object' &&
        error.details !== null &&
        'class' in error.details &&
        error.details.class === expectedClass,
    )
    assert.deepEqual(snapshot(), before)

    git(worktreePath, ['checkout', '--', relativePath])
  }
})
