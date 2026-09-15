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

const DESIGN_SOURCE = 'design-source.svg'

/** Record `DESIGN_SOURCE` as a read-only input of the release worktree. */
function attributeReadOnlyInput(root: string, worktreePath: string): void {
  recordWorkspaceAttribution(root, {
    workspacePath: worktreePath,
    runId: 'run-fixture',
    actingRole: 'operator',
    directive: 'Keep the design source I exported out of the release.',
    disposition: 'read-only-input',
    paths: [DESIGN_SOURCE],
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

test('release finalization neither commits nor refuses over a recorded read-only input', () => {
  const candidate = prepareReleaseCandidate('release-withheld')

  try {
    // The operator input arrives in the release worktree after the sync, so
    // finalization is the step that meets it.
    writeFileSync(path.join(candidate.worktreePath, DESIGN_SOURCE), '<svg/>\n')
    attributeReadOnlyInput(candidate.root, candidate.worktreePath)

    const finalized = finalizeLocalRelease(
      candidate.root,
      candidate.record.name,
      candidate.fetchedMain,
    )

    assert.equal(finalized.version, candidate.version)
    assert.equal(finalized.clean, true)
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

test('release sync refuses a rebase that would rewrite local main, and records the override that proceeds', () => {
  const behind = prepareUnpushedIntegration('release-behind')

  try {
    const headBeforeSync = git(behind.worktreePath, ['rev-parse', 'HEAD'])

    assert.notEqual(behind.localMain, behind.fetchedMain)

    let refusal: unknown = null

    try {
      syncLocalRelease(behind.root, behind.record.name, 'feat: checkpoint')
    } catch (error) {
      refusal = error
    }

    assert.ok(refusal instanceof Error)
    assert.equal(
      'code' in refusal ? refusal.code : null,
      'RELEASE_REMOTE_BEHIND_LOCAL',
    )
    assert.ok(refusal.message.includes(behind.localMain))
    assert.ok(refusal.message.includes(behind.fetchedMain))
    // The refusal must leave the steward a recorded way through, so the
    // message names both overrides alongside the push that removes the need
    // for either.
    assert.match(refusal.message, /--onto main/u)
    assert.match(refusal.message, /--no-rebase/u)
    assert.equal(
      git(behind.worktreePath, ['rev-parse', 'HEAD']),
      headBeforeSync,
    )

    writeFileSync(
      path.join(behind.worktreePath, 'src', 'base.ts'),
      "export const base = 'release candidate'\n",
    )

    const overridden = syncLocalRelease(
      behind.root,
      behind.record.name,
      'feat: checkpoint release candidate',
      undefined,
      { onto: 'main' },
    )

    assert.equal(overridden.status, 'synchronized')
    assert.equal(overridden.fetched_main, behind.fetchedMain)
    assert.equal(overridden.rebase_target, behind.localMain)
    assert.deepEqual(overridden.rebase_override, {
      kind: 'onto',
      requested_ref: 'main',
      resolved_commit: behind.localMain,
    })
    // The merge commit local main already carries survives the override.
    assert.equal(
      git(behind.worktreePath, [
        'merge-base',
        '--is-ancestor',
        behind.localMain,
        'HEAD',
      ]),
      '',
    )
  } finally {
    rmSync(behind.root, { recursive: true, force: true })
    rmSync(behind.remote, { recursive: true, force: true })
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
  } finally {
    rmSync(behind.root, { recursive: true, force: true })
    rmSync(behind.remote, { recursive: true, force: true })
  }
})

test('release sync rebases unchanged when the fetched head is equal to or ahead of local main', () => {
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

    assert.equal(equal.status, 'synchronized')
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

    assert.equal(synchronized.status, 'synchronized')
  } finally {
    rmSync(remote, { recursive: true, force: true })
  }
})
