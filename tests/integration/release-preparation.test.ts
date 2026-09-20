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
  SECRET_PATH_PATTERN,
  continueLocalRelease,
  finalizeLocalRelease,
  syncLocalRelease,
} from '../../src/lib/release-preparation.js'
import { createRun, setRunStage, waiveGate } from '../../src/lib/engine.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import { loadState, statePath } from '../../src/lib/state.js'
import { fileExists } from '../../src/lib/io.js'
import { evaluateDeterministicCriteria } from '../../src/lib/validation.js'
import { recordWorkspaceAttribution } from '../../src/lib/workspace-attribution.js'
import { validateReleaseOutput } from '../../src/lib/validators/stage-validators.js'
import { createWorktree } from '../../src/lib/worktrees.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { nextSemanticVersion } from '../../src/lib/versioning.js'
import { createFixture, writeJson } from '../helpers.js'
import type { StageOutput } from '../../src/lib/types.js'
import { createTestTempDirectory } from '../temp.js'
import { runCli } from './worktree-helpers.js'

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

const DESIGN_SOURCE = 'design-source.svg'

/** Record `DESIGN_SOURCE` as a read-only input of the release worktree. */
function attributeReadOnlyInput(
  root: string,
  worktreePath: string,
  paths: string[] = [DESIGN_SOURCE],
): void {
  recordWorkspaceAttribution(root, {
    workspacePath: worktreePath,
    runId: 'run-fixture',
    actingRole: 'operator',
    directive: 'Keep the design source I exported out of the release.',
    disposition: 'read-only-input',
    paths,
    artifactPath: 'runtime/logs/workflows/run-fixture/evidence/directive-1.md',
  })
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

    const allocation = allocateReleaseVersion(root, record.name, 'patch')
    const version = writeReleaseMetadata(worktreePath)

    assert.equal(version, allocation.allocation.version)
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

    const commitCountBeforeReplay = git(worktreePath, [
      'rev-list',
      '--count',
      'HEAD',
    ])
    const replayed = finalizeLocalRelease(
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

// The corpus is the rule's contract: a shape the release check must name, and
// a shape it must leave alone. `credentials.txt` below proves the wiring from
// this pattern to RELEASE_PATH_UNSAFE, so the table stays at the rule.
const SECRET_PATHS = [
  '.env',
  '.env.production',
  '.env/production',
  'config/.env/keys.json',
  'certs/server.pem',
  'certs/server.key',
  'keys/client.p12',
  '.ssh/id_rsa',
  'id_ed25519',
  'credentials.txt',
  'deploy/service-account-token.json',
  'config/private_key.json',
]

const NON_SECRET_PATHS = [
  'docs/environment.md',
  'src/lib/env.ts',
  'library/templates/env.example.json',
  '.ssh/id_rsa.pub',
  'src/lib/keyboard.ts',
  'package-lock.json',
  'release/index.json',
  'governance/handbooks/eng/engineering.md',
]

test('the secret-path detector names every secret shape and no ordinary path', () => {
  for (const candidate of SECRET_PATHS) {
    assert.ok(
      SECRET_PATH_PATTERN.test(candidate),
      `${candidate} MUST be named as a secret-like path`,
    )
  }

  for (const candidate of NON_SECRET_PATHS) {
    assert.ok(
      !SECRET_PATH_PATTERN.test(candidate),
      `${candidate} MUST NOT be named as a secret-like path`,
    )
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
      finalizeLocalRelease(
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
        finalizeLocalRelease(
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
      finalizeLocalRelease(
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
    const finalized = finalizeLocalRelease(
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

test('release finalization refuses dirty metadata on a completed same-version pair', () => {
  const candidate = prepareReleaseCandidate('release-finalized-dirty')

  try {
    const finalized = finalizeLocalRelease(
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
      finalizeLocalRelease(
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
        finalizeLocalRelease(
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
    errorCode(() => finalizeLocalRelease(root, record.name, '-bad-ref')),
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
      finalizeLocalRelease(
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
      finalizeLocalRelease(
        candidate.root,
        candidate.record.name,
        candidate.fetchedMain,
      ),
    new RegExp(`pan-dev.*${collisionCommit}`, 'u'),
  )
})
