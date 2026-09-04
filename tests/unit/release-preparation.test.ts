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

import {
  continueLocalRelease,
  finalizeLocalRelease,
  syncLocalRelease,
} from '../../src/lib/release-preparation.js'
import { createRun } from '../../src/lib/engine.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import { loadState, statePath } from '../../src/lib/state.js'
import { fileExists } from '../../src/lib/io.js'
import { evaluateDeterministicCriteria } from '../../src/lib/validation.js'
import { validateReleaseOutput } from '../../src/lib/validators/stage-validators.js'
import { createWorktree } from '../../src/lib/worktrees.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { nextSemanticVersion } from '../../src/lib/versioning.js'
import { createFixture, writeJson } from '../helpers.js'
import type { StageOutput } from '../../src/lib/types.js'
import { createTestTempDirectory } from '../temp.js'

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  }).trim()
}

function errorCode(action: () => unknown): string | null {
  try {
    action()
    return null
  } catch (error) {
    return error instanceof Error && 'code' in error ? String(error.code) : null
  }
}

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

function writeReleaseMetadata(root: string): string {
  const current = readFileSync(path.join(root, 'VERSION'), 'utf8').trim()
  const version = nextSemanticVersion(current, 'patch')

  assert.ok(version)
  writeFileSync(path.join(root, 'VERSION'), `${version}\n`)
  writeFileSync(
    path.join(root, 'CHANGELOG.md'),
    `# Changelog\n\n## [${version}] - 2026-08-31\n\n### Added\n\n- Validate local release finalization.\n`,
  )

  for (const filename of ['package.json', 'package-lock.json']) {
    const filePath = path.join(root, filename)
    const value = JSON.parse(readFileSync(filePath, 'utf8')) as Record<
      string,
      unknown
    >

    value.version = version

    if (filename === 'package-lock.json') {
      const packages = value.packages as Record<string, Record<string, unknown>>

      packages[''].version = version
    }

    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
  }

  const docsPath = path.join(root, 'docs', 'embedded-installation.md')
  const docs = readFileSync(docsPath, 'utf8').replace(
    /currently agree on `[^`]+`/u,
    `currently agree on \`${version}\``,
  )

  writeFileSync(docsPath, docs)

  return version
}

function prepareReleaseCandidate(name: string): {
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
  const version = writeReleaseMetadata(worktreePath)

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

    const version = writeReleaseMetadata(worktreePath)
    const finalized = finalizeLocalRelease(
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

    const replayed = finalizeLocalRelease(
      root,
      record.name,
      synchronized.fetched_main,
    )

    assert.equal(replayed.release_commit, finalized.release_commit)
    assert.equal(replayed.index_commit, finalized.index_commit)

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

    const synchronized = syncLocalRelease(
      root,
      record.name,
      'feat: checkpoint local conflict',
    )

    assert.equal(synchronized.status, 'conflict')
    assert.deepEqual(synchronized.conflicted_paths, [sourcePath])

    const unresolved = continueLocalRelease(root, record.name)

    assert.equal(unresolved.status, 'conflict')
    assert.deepEqual(unresolved.conflicted_paths, [sourcePath])

    writeFileSync(
      path.join(worktreePath, sourcePath),
      `${initial.trimEnd()}\nexport const conflict = 'resolved'\n`,
    )
    git(worktreePath, ['add', sourcePath])

    const completed = continueLocalRelease(root, record.name)

    assert.equal(completed.status, 'complete')
    assert.deepEqual(completed.conflicted_paths, [])
    assert.equal(git(worktreePath, ['branch', '--show-current']), record.branch)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  }
})

test('release finalization rejects an invalid fetched-main hash before Git inspection', () => {
  const root = createFixture()
  const record = createWorktree(root, 'release-invalid')

  assert.equal(
    errorCode(() => finalizeLocalRelease(root, record.name, '-bad-ref')),
    'RELEASE_FETCHED_MAIN_INVALID',
  )
})

test('release sync rejects every unsafe path class without repository mutation', () => {
  const cases = [
    ['credentials.txt', 'secret-like path'],
    ['runtime/generated.json', 'generated state'],
    ['dist/output.js', 'dependency or generated output'],
    ['node_modules/package/index.js', 'dependency or generated output'],
    ['release/index.json', 'release index'],
  ] as const

  for (const [index, [relativePath, expectedClass]] of cases.entries()) {
    const root = createFixture()
    const absolute = path.join(root, relativePath)

    if (relativePath !== 'release/index.json') {
      mkdirSync(path.dirname(absolute), { recursive: true })
      writeFileSync(absolute, 'baseline\n')
      git(root, ['add', '-f', relativePath])
      git(root, ['commit', '-m', `test: track ${expectedClass}`])
    }

    const record = createWorktree(root, `unsafe-${index}`)
    const worktreePath = path.join(root, record.path)
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
  }
})

test('release finalization recovers release-only and index-only partial states', () => {
  const releaseOnly = prepareReleaseCandidate('release-only')

  try {
    const releaseCommit = commitReleaseMetadata(
      releaseOnly.worktreePath,
      releaseOnly.version,
    )
    const finalized = finalizeLocalRelease(
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

    const finalized = finalizeLocalRelease(
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

test('standalone release refuses an active workflow in the same worktree', () => {
  const root = createFixture()
  const record = createWorktree(root, 'release-busy')
  const worktreePath = path.join(root, record.path)
  const state = createRun(root, {
    requestPath: 'request.md',
    workspace: record.path,
    worktree: record,
  })

  assert.equal(state.workspace_root, record.path)
  assert.equal(state.status, 'running')
  assert.equal(fileExists(statePath(root, state.run_id)), true)
  assert.equal(loadState(root, state.run_id).workspace_root, record.path)
  git(worktreePath, ['switch', '-c', 'blocked-branch'])
  assert.throws(
    () => syncLocalRelease(root, record.name, 'feat: checkpoint'),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'RELEASE_WORKFLOW_ACTIVE',
  )
  assert.equal(
    git(worktreePath, ['branch', '--show-current']),
    'blocked-branch',
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
