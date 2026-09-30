/**
 * Integration tests for `pan release land`: the landing mutex across callers,
 * and `landRelease` against a fixture repository with a pan-dev branch,
 * candidate worktrees, and a stub `full` profile.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { acquireLandingMutex } from '../../src/lib/landing-mutex.js'
import { gitSourceContentFingerprint } from '../../src/lib/git.js'
import {
  landRelease,
  resolveLandingVerification,
  type LandingResult,
} from '../../src/lib/release-landing.js'
import {
  nextSemanticVersion,
  RELEASE_LANDING_METADATA_PATHS,
  validateReleaseMetadata,
} from '../../src/lib/versioning.js'
import { createWorktree } from '../../src/lib/worktrees.js'
import { createFixture } from '../fixture-template.js'
import { createTestTempDirectory } from '../temp.js'

const REPO_ROOT = process.cwd()
const PAN_DEV = 'pan-dev'
const LANDING_STEPS = [
  'tip_read',
  'integrate',
  'allocate',
  'metadata_regenerated',
  'finalize',
  'verify',
  'check',
  'fast_forward',
]

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function gitStatus(cwd: string, args: string[]): number {
  return spawnSync('git', args, { cwd, encoding: 'utf8' }).status ?? 1
}

function readLandingLog(root: string): Array<Record<string, unknown>> {
  const logPath = path.join(root, 'runtime', 'release', 'landing.jsonl')

  if (!existsSync(logPath)) {
    return []
  }

  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

function landingLockExists(root: string): boolean {
  return existsSync(path.join(root, 'runtime', 'release', 'landing.lock'))
}

/**
 * A fixture root with pan-dev at the fixture commit and the landing guard in
 * place. Embedded mode keeps finalize's self-development conform and style
 * scans out of scope, because the fixture copy carries unrelated prose debt.
 */
function landingFixture(): string {
  const root = createFixture()
  const checkLanding = path.join(root, 'bin', 'check-landing')
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  git(root, ['branch', PAN_DEV])
  copyFileSync(path.join(REPO_ROOT, 'bin', 'check-landing'), checkLanding)
  chmodSync(checkLanding, 0o755)
  config.installation_mode = 'embedded'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  return root
}

function setFullProfileCommand(root: string, command: string): void {
  const checksPath = path.join(root, 'runtime', 'repository-checks.json')
  const checks = JSON.parse(readFileSync(checksPath, 'utf8')) as {
    profiles: Record<string, { commands: string[] }>
  }

  ;(checks.profiles.full as { commands: string[] }).commands = [command]
  writeFileSync(checksPath, `${JSON.stringify(checks, null, 2)}\n`)
}

function prependChangelogEntry(
  checkout: string,
  version: string,
  body: string,
): void {
  const changelogPath = path.join(checkout, 'CHANGELOG.md')
  const content = readFileSync(changelogPath, 'utf8')
  const firstEntry = content.indexOf('\n## [')
  const entry = `\n## [${version}] - 2026-09-26\n\n${body}\n`

  writeFileSync(
    changelogPath,
    content.slice(0, firstEntry) + entry + content.slice(firstEntry + 1),
  )
}

/** Commit a complete release pair for `version` on the checkout's branch. */
function commitReleasePair(
  checkout: string,
  version: string,
  notes = 'This release moves the tip.\n\n### Fixed\n\n- Move the tip past the candidate.',
): void {
  const previous = readFileSync(path.join(checkout, 'VERSION'), 'utf8').trim()
  const packagePath = path.join(checkout, 'package.json')
  const lockPath = path.join(checkout, 'package-lock.json')
  const embeddedPath = path.join(checkout, 'docs', 'embedded-installation.md')
  const indexPath = path.join(checkout, 'release', 'index.json')
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as {
    version: string
  }
  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
    version: string
    packages?: Record<string, { version?: string }>
  }

  writeFileSync(path.join(checkout, 'VERSION'), `${version}\n`)
  pkg.version = version
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)
  lock.version = version

  if (lock.packages?.['']) {
    lock.packages[''].version = version
  }

  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
  writeFileSync(
    embeddedPath,
    readFileSync(embeddedPath, 'utf8').replace(
      `currently agree on \`${previous}\``,
      `currently agree on \`${version}\``,
    ),
  )
  prependChangelogEntry(checkout, version, notes)
  git(checkout, [
    'add',
    'VERSION',
    'package.json',
    'package-lock.json',
    'CHANGELOG.md',
    'docs/embedded-installation.md',
  ])
  git(checkout, ['commit', '-qm', `release: prepare v${version}`])

  const releaseCommit = git(checkout, ['rev-parse', 'HEAD'])
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
    releases: Array<{ version: string; commit: string }>
  }

  index.releases.push({ version, commit: releaseCommit })
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`)
  git(checkout, ['add', 'release/index.json'])
  git(checkout, ['commit', '-qm', `chore: index release v${version}`])
}

/**
 * Move pan-dev one patch release ahead, optionally with a tip-side change to
 * `src/base.ts`, through a checkout that is removed again afterward so no
 * checkout holds pan-dev when the landing runs.
 */
function advanceTip(root: string, options: { sourceChange?: boolean } = {}) {
  const checkout = path.join(root, 'tip-advance')

  git(root, ['worktree', 'add', '-q', checkout, PAN_DEV])

  if (options.sourceChange) {
    writeFileSync(
      path.join(checkout, 'src', 'base.ts'),
      "export const base = true\nexport const tipSide = 'tip'\n",
    )
    git(checkout, ['add', 'src/base.ts'])
    git(checkout, ['commit', '-qm', 'feat: tip-side source change'])
  }

  const tipVersion = nextSemanticVersion(
    readFileSync(path.join(checkout, 'VERSION'), 'utf8').trim(),
    'patch',
  ) as string

  commitReleasePair(checkout, tipVersion)
  git(root, ['worktree', 'remove', checkout])

  return tipVersion
}

function makeCandidate(
  root: string,
  name: string,
  notes: string,
  sourceChange?: string,
): string {
  const worktreePath = path.join(root, createWorktree(root, name).path)
  const sourcePath = sourceChange ? 'src/base.ts' : `src/${name}.ts`

  writeFileSync(
    path.join(worktreePath, sourcePath),
    sourceChange ?? `export const marker = '${name}'\n`,
  )
  git(worktreePath, ['add', sourcePath])
  git(worktreePath, ['commit', '-qm', `feat: ${name} change`])
  prependChangelogEntry(worktreePath, '9.9.9', notes)
  git(worktreePath, ['add', 'CHANGELOG.md'])
  git(worktreePath, ['commit', '-qm', `docs: release notes for ${name}`])

  return worktreePath
}

/**
 * A candidate that was finalized before landing, the flow every landing path
 * prescribes: one source commit, then a complete release pair for `version`.
 */
function finalizedCandidate(
  root: string,
  name: string,
  version: string,
  notes: string,
): string {
  const worktreePath = path.join(root, createWorktree(root, name).path)
  const sourcePath = `src/${name}.ts`

  writeFileSync(
    path.join(worktreePath, sourcePath),
    `export const marker = '${name}'\n`,
  )
  git(worktreePath, ['add', sourcePath])
  git(worktreePath, ['commit', '-qm', `feat: ${name} change`])
  commitReleasePair(worktreePath, version, notes)

  return worktreePath
}

function versionAt(root: string, ref: string): string {
  return git(root, ['show', `${ref}:VERSION`])
}

function inspectPanDev(root: string): {
  errors: string[]
  markers: string
  indexed: string[]
} {
  const inspect = path.join(root, 'inspect-pan-dev')

  git(root, ['worktree', 'add', '-q', '--detach', inspect, PAN_DEV])

  try {
    const index = JSON.parse(
      readFileSync(path.join(inspect, 'release', 'index.json'), 'utf8'),
    ) as { releases: Array<{ version: string }> }

    return {
      errors: validateReleaseMetadata(inspect).errors,
      markers: spawnSync('git', ['grep', '-n', '^<<<<<<< ', '--', '.'], {
        cwd: inspect,
        encoding: 'utf8',
      }).stdout,
      indexed: index.releases.map((entry) => entry.version),
    }
  } finally {
    git(root, ['worktree', 'remove', '--force', inspect])
  }
}

test('two consecutive callers serialize: first blocks second, second succeeds after release', () => {
  const root = createTestTempDirectory('mutex-concurrency-')

  mkdirSync(path.join(root, 'runtime', 'release'), { recursive: true })

  const first = acquireLandingMutex(
    root,
    { worktree: 'first', command: 'pan release land' },
    { waitSeconds: 3 },
  )

  assert.throws(
    () =>
      acquireLandingMutex(
        root,
        { worktree: 'second', command: 'pan release land' },
        { waitSeconds: 0 },
      ),
    (error: unknown) =>
      (error as { code?: string }).code === 'LANDING_MUTEX_TIMEOUT',
  )

  first.release()

  const second = acquireLandingMutex(
    root,
    { worktree: 'second', command: 'pan release land' },
    { waitSeconds: 3 },
  )

  second.release()
})

test('a candidate whose only conflicts with a moved tip are release metadata lands with the tip changelog plus one entry', () => {
  const root = landingFixture()
  const tipVersion = advanceTip(root)
  const tipBefore = git(root, ['rev-parse', PAN_DEV])
  const tipChangelog = git(root, ['show', `${PAN_DEV}:CHANGELOG.md`])

  makeCandidate(
    root,
    'metadata-only',
    'This release lands across a metadata-only conflict.\n\n### Added\n\n- Add the metadata-only marker module.',
  )

  const result = landRelease(root, { worktree: 'metadata-only', bump: 'minor' })
  const expected = nextSemanticVersion(tipVersion, 'minor')

  assert.equal(result.status, 'landed')
  assert.equal(result.version, expected)
  assert.equal(result.tip_before, tipBefore)
  assert.ok(result.merge_commit, 'the tip was merged into the candidate')
  assert.deepEqual(
    result.steps.map((entry) => entry.step),
    LANDING_STEPS,
  )
  assert.deepEqual(
    readLandingLog(root)
      .filter((entry) => entry.event === 'step')
      .map((entry) => entry.step),
    LANDING_STEPS,
  )
  assert.equal(git(root, ['rev-parse', PAN_DEV]), result.index_commit)
  assert.equal(landingLockExists(root), false)

  const landedChangelog = git(root, ['show', `${PAN_DEV}:CHANGELOG.md`])
  const tipFirstEntry = tipChangelog.indexOf('\n## [')
  const landedFirstEntry = landedChangelog.indexOf('\n## [')
  const landedSecondEntry = landedChangelog.indexOf(
    '\n## [',
    landedFirstEntry + 1,
  )

  assert.match(
    landedChangelog.slice(landedFirstEntry, landedSecondEntry),
    new RegExp(
      `^\\n## \\[${(expected as string).replace(/\./gu, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}\\n\\nThis release lands across a metadata-only conflict\\.`,
      'u',
    ),
  )
  assert.equal(
    landedChangelog.slice(landedSecondEntry),
    tipChangelog.slice(tipFirstEntry),
  )

  const panDev = inspectPanDev(root)

  assert.deepEqual(panDev.errors, [])
  assert.equal(panDev.markers, '')
  assert.deepEqual(panDev.indexed.slice(-2), [tipVersion, expected])
})

test('a source conflict with the tip stops before any release commit, and the documented repair lands on rerun', () => {
  const root = landingFixture()

  advanceTip(root, { sourceChange: true })

  const tipBefore = git(root, ['rev-parse', PAN_DEV])
  const candidate = makeCandidate(
    root,
    'source-conflict',
    'This release resolves a source conflict.\n\n### Changed\n\n- Change base on the candidate side.',
    "export const base = true\nexport const candidateSide = 'candidate'\n",
  )
  const headBefore = git(candidate, ['rev-parse', 'HEAD'])

  const first = landRelease(root, {
    worktree: 'source-conflict',
    bump: 'minor',
  })

  assert.equal(first.status, 'conflict')
  assert.deepEqual(first.source_conflicts, ['src/base.ts'])
  assert.equal(git(candidate, ['rev-parse', 'HEAD']), headBefore)
  assert.equal(git(root, ['rev-parse', PAN_DEV]), tipBefore)
  assert.equal(
    gitStatus(candidate, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']),
    1,
  )
  assert.equal(git(candidate, ['status', '--porcelain=v1']), '')
  assert.equal(landingLockExists(root), false)

  // The documented repair: merge pan-dev, resolve the source path, take the
  // tip's release metadata, commit, and land again.
  spawnSync('git', ['merge', '--no-ff', '--no-edit', PAN_DEV], {
    cwd: candidate,
    encoding: 'utf8',
  })

  for (const conflicted of git(candidate, [
    'diff',
    '--name-only',
    '--diff-filter=U',
  ]).split('\n')) {
    if (conflicted === 'src/base.ts') {
      writeFileSync(
        path.join(candidate, conflicted),
        "export const base = true\nexport const tipSide = 'tip'\nexport const candidateSide = 'candidate'\n",
      )
    } else if (conflicted) {
      git(candidate, ['checkout', PAN_DEV, '--', conflicted])
    }
  }

  git(candidate, ['add', '-A'])
  git(candidate, [
    'commit',
    '-qm',
    'merge: resolve source conflict with pan-dev',
  ])

  const rerun = landRelease(root, {
    worktree: 'source-conflict',
    bump: 'minor',
  })

  assert.equal(rerun.status, 'landed')
  assert.deepEqual(rerun.verified_profiles, ['full'])
  assert.equal(git(root, ['rev-parse', PAN_DEV]), rerun.index_commit)
  assert.match(
    git(root, ['show', `${PAN_DEV}:CHANGELOG.md`]),
    /This release resolves a source conflict\./u,
  )
  assert.match(
    git(root, ['show', `${PAN_DEV}:src/base.ts`]),
    /tipSide[\s\S]*candidateSide/u,
  )
})

test('two landings started together from one tip both land, each one bump above the tip it landed on', async () => {
  const root = landingFixture()
  const baseVersion = versionAt(root, PAN_DEV)
  // The module path goes in argv[1], where an entry-point check in the import
  // chain expects a real file path.
  const modulePath = fileURLToPath(
    new URL('../../src/lib/release-landing.js', import.meta.url),
  )

  makeCandidate(
    root,
    'first-lander',
    'This release is the first concurrent landing.\n\n### Added\n\n- Add the first-lander marker module.',
  )
  makeCandidate(
    root,
    'second-lander',
    'This release is the second concurrent landing.\n\n### Added\n\n- Add the second-lander marker module.',
  )

  const land = (worktree: string): Promise<LandingResult> =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `const { pathToFileURL } = await import('node:url');
           const { landRelease } = await import(pathToFileURL(process.argv[1]).href);
           const result = landRelease(process.argv[2], { worktree: process.argv[3], bump: 'minor', waitSeconds: 120 });
           process.stdout.write(JSON.stringify(result));`,
          modulePath,
          root,
          worktree,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (chunk: Buffer) => (stdout += String(chunk)))
      child.stderr.on('data', (chunk: Buffer) => (stderr += String(chunk)))
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) {
          resolve(JSON.parse(stdout) as LandingResult)
        } else {
          reject(new Error(`landing ${worktree} exited ${code}: ${stderr}`))
        }
      })
    })

  const results = await Promise.all([
    land('first-lander'),
    land('second-lander'),
  ])

  for (const result of results) {
    assert.equal(result.status, 'landed')
    assert.equal(
      result.version,
      nextSemanticVersion(
        versionAt(root, result.tip_before as string),
        'minor',
      ),
    )
  }

  const versions = results.map((result) => result.version as string)

  assert.notEqual(versions[0], versions[1])
  assert.ok(
    versions.includes(nextSemanticVersion(baseVersion, 'minor') as string),
  )

  const panDev = inspectPanDev(root)

  assert.deepEqual(panDev.errors, [])
  assert.equal(panDev.markers, '')

  for (const version of versions) {
    assert.ok(panDev.indexed.includes(version), `pan-dev indexes ${version}`)
  }

  const holds = readLandingLog(root).filter(
    (entry) => entry.event === 'acquired' || entry.event === 'released',
  )

  assert.deepEqual(
    holds.map((entry) => entry.event),
    ['acquired', 'released', 'acquired', 'released'],
  )
})

test('candidates finalized from one tip land in reverse allocation order, and pan-dev indexes only the landed versions', () => {
  const root = landingFixture()
  const baseVersion = versionAt(root, PAN_DEV)
  const lowerAllocation = nextSemanticVersion(baseVersion, 'minor') as string
  const higherAllocation = nextSemanticVersion(
    lowerAllocation,
    'minor',
  ) as string

  finalizedCandidate(
    root,
    'finalized-lower',
    lowerAllocation,
    'This release was finalized at the lower allocation.\n\n### Added\n\n- Add the finalized-lower marker module.',
  )
  finalizedCandidate(
    root,
    'finalized-higher',
    higherAllocation,
    'This release was finalized at the higher allocation.\n\n### Added\n\n- Add the finalized-higher marker module.',
  )

  const first = landRelease(root, {
    worktree: 'finalized-higher',
    bump: 'minor',
  })
  const second = landRelease(root, {
    worktree: 'finalized-lower',
    bump: 'minor',
  })

  for (const result of [first, second]) {
    assert.equal(result.status, 'landed')
    assert.equal(
      result.version,
      nextSemanticVersion(
        versionAt(root, result.tip_before as string),
        'minor',
      ),
    )
  }

  const panDev = inspectPanDev(root)
  const landedChangelog = git(root, ['show', `${PAN_DEV}:CHANGELOG.md`])

  assert.deepEqual(panDev.errors, [])
  assert.equal(panDev.markers, '')
  assert.deepEqual(panDev.indexed.slice(panDev.indexed.indexOf(baseVersion)), [
    baseVersion,
    first.version,
    second.version,
  ])
  assert.match(landedChangelog, /finalized at the higher allocation\./u)
  assert.match(landedChangelog, /finalized at the lower allocation\./u)
})

test('a candidate without its own release notes fails before it merges the tip or allocates a version', () => {
  const root = landingFixture()

  advanceTip(root)

  const candidate = path.join(root, createWorktree(root, 'no-notes').path)

  writeFileSync(
    path.join(candidate, 'src', 'no-notes.ts'),
    "export const marker = 'no-notes'\n",
  )
  git(candidate, ['add', 'src/no-notes.ts'])
  git(candidate, ['commit', '-qm', 'feat: no-notes change'])

  const headBefore = git(candidate, ['rev-parse', 'HEAD'])
  const ledgerPath = path.join(root, 'runtime', 'release', 'allocations.jsonl')

  assert.throws(
    () => landRelease(root, { worktree: 'no-notes', bump: 'minor' }),
    (error: unknown) =>
      (error as { code?: string }).code === 'LANDING_RELEASE_NOTES_MISSING',
  )
  assert.equal(git(candidate, ['rev-parse', 'HEAD']), headBefore)
  assert.equal(
    existsSync(ledgerPath) &&
      readFileSync(ledgerPath, 'utf8').includes('"worktree":"no-notes"'),
    false,
  )
  assert.equal(landingLockExists(root), false)
})

test('a clean checkout holding pan-dev is fast-forwarded in place', () => {
  const root = landingFixture()
  const checkout = path.join(root, 'pan-dev-checkout')

  git(root, ['worktree', 'add', '-q', checkout, PAN_DEV])
  makeCandidate(
    root,
    'clean-target',
    'This release lands into a clean checkout.\n\n### Added\n\n- Add the clean-target marker module.',
  )

  const result = landRelease(root, { worktree: 'clean-target', bump: 'minor' })

  assert.equal(result.status, 'landed')
  assert.equal(git(checkout, ['rev-parse', 'HEAD']), result.index_commit)
  assert.equal(git(root, ['rev-parse', PAN_DEV]), result.index_commit)
  assert.equal(git(checkout, ['status', '--porcelain=v1']), '')
})

test('a dirty checkout holding pan-dev refuses with LANDING_TARGET_DIRTY and leaves pan-dev unchanged', () => {
  const root = landingFixture()
  const checkout = path.join(root, 'pan-dev-checkout')

  git(root, ['worktree', 'add', '-q', checkout, PAN_DEV])

  const tipBefore = git(root, ['rev-parse', PAN_DEV])

  makeCandidate(
    root,
    'dirty-target',
    'This release meets a dirty checkout.\n\n### Added\n\n- Add the dirty-target marker module.',
  )
  writeFileSync(path.join(checkout, 'src', 'base.ts'), '// operator edit\n')

  assert.throws(
    () => landRelease(root, { worktree: 'dirty-target', bump: 'minor' }),
    (error: unknown) => {
      const failure = error as {
        code?: string
        details?: { blocking_paths?: string[] }
      }

      assert.equal(failure.code, 'LANDING_TARGET_DIRTY')
      assert.deepEqual(failure.details?.blocking_paths, ['src/base.ts'])
      return true
    },
  )
  assert.equal(git(root, ['rev-parse', PAN_DEV]), tipBefore)
  assert.equal(landingLockExists(root), false)
})

test('a failing verification keeps the release commits on the candidate, and a rerun after the fix reuses them and lands', () => {
  const root = landingFixture()
  const tipBefore = git(root, ['rev-parse', PAN_DEV])
  const candidate = makeCandidate(
    root,
    'verify-fails',
    'This release fails verification once.\n\n### Added\n\n- Add the verify-fails marker module.',
  )

  setFullProfileCommand(root, 'node -e "process.exit(1)"')

  const failed = landRelease(root, { worktree: 'verify-fails', bump: 'minor' })

  assert.equal(failed.status, 'verification_failed')
  assert.deepEqual(failed.verified_profiles, [])
  assert.equal(git(root, ['rev-parse', PAN_DEV]), tipBefore)
  assert.equal(git(candidate, ['rev-parse', 'HEAD']), failed.index_commit)
  assert.equal(landingLockExists(root), false)

  setFullProfileCommand(root, 'node -e "process.exit(0)"')

  const rerun = landRelease(root, { worktree: 'verify-fails', bump: 'minor' })

  assert.equal(rerun.status, 'landed')
  assert.equal(rerun.version, failed.version)
  assert.equal(rerun.release_commit, failed.release_commit)
  assert.equal(rerun.index_commit, failed.index_commit)
  assert.equal(
    rerun.steps.some((entry) => entry.step === 'metadata_regenerated'),
    false,
  )
  assert.equal(git(root, ['rev-parse', PAN_DEV]), failed.index_commit)
})

test('a lock left by a killed holder is reclaimed and the landing proceeds', () => {
  const root = landingFixture()
  const exited = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' })

  mkdirSync(path.join(root, 'runtime', 'release'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime', 'release', 'landing.lock'),
    `${JSON.stringify({
      schema_version: 1,
      token: 'killed-holder-token',
      pid: exited.pid,
      process_identity: null,
      worktree: 'killed-holder',
      command: 'pan release land --worktree killed-holder',
      run_id: null,
      started_at: new Date().toISOString(),
      host: 'host',
    })}\n`,
  )
  makeCandidate(
    root,
    'after-crash',
    'This release lands after a crashed holder.\n\n### Added\n\n- Add the after-crash marker module.',
  )

  const result = landRelease(root, {
    worktree: 'after-crash',
    bump: 'minor',
    waitSeconds: 5,
  })
  const reclaimed = readLandingLog(root).find(
    (entry) => entry.event === 'reclaimed',
  )

  assert.equal(result.status, 'landed')
  assert.deepEqual(
    (reclaimed?.dead_holder as Record<string, unknown> | undefined)?.worktree,
    'killed-holder',
  )
  assert.equal(landingLockExists(root), false)
})

test('a landing that waits past a short bound fails with LANDING_MUTEX_TIMEOUT naming the holder', () => {
  const root = landingFixture()
  const tipBefore = git(root, ['rev-parse', PAN_DEV])

  makeCandidate(
    root,
    'late-lander',
    'This release waits for the mutex.\n\n### Added\n\n- Add the late-lander marker module.',
  )

  const holder = acquireLandingMutex(
    root,
    { worktree: 'long-holder', command: 'pan release land' },
    { waitSeconds: 5 },
  )

  try {
    assert.throws(
      () =>
        landRelease(root, {
          worktree: 'late-lander',
          bump: 'minor',
          waitSeconds: 0,
        }),
      (error: unknown) => {
        const failure = error as {
          code?: string
          details?: { holder?: { worktree?: string } }
        }

        assert.equal(failure.code, 'LANDING_MUTEX_TIMEOUT')
        assert.equal(failure.details?.holder?.worktree, 'long-holder')
        return true
      },
    )
  } finally {
    holder.release()
  }

  assert.equal(git(root, ['rev-parse', PAN_DEV]), tipBefore)
})

// HR-002 of the 2026-09-29 efficiency audit: 7 of 8 lands in one week reran
// `full` after an integrate that merged nothing, on a tree the ship entry
// gate had just verified. The land now reuses that proof when the source
// content still matches, and keeps `full` for anything else.
test('a no-op integrate on the tree the entry gate verified runs static and configuration, and every other land keeps full', () => {
  const root = landingFixture()
  const worktreePath = path.join(
    root,
    createWorktree(root, 'verified-tree').path,
  )

  writeFileSync(
    path.join(worktreePath, 'src', 'verified.ts'),
    "export const verified = 'tree'\n",
  )

  // The entry gate runs on the implementation before the steward commits it.
  const verified = gitSourceContentFingerprint(
    worktreePath,
    RELEASE_LANDING_METADATA_PATHS,
  )

  assert.ok(verified)

  git(worktreePath, ['add', 'src/verified.ts'])
  git(worktreePath, ['commit', '-qm', 'feat: verified change'])
  commitReleasePair(worktreePath, '9.9.9')

  const gate = () => ({ fingerprint: verified, profile: 'full' })
  const matched = resolveLandingVerification(
    root,
    worktreePath,
    'already_current',
    'run-verified',
    undefined,
    gate,
  )

  assert.deepEqual(matched.profiles, ['static', 'configuration'])
  assert.equal(matched.basis, 'entry_gate_fingerprint')
  assert.equal(matched.source_fingerprint, verified)

  const cases: Array<[string, ReturnType<typeof resolveLandingVerification>]> =
    [
      [
        'merged',
        resolveLandingVerification(
          root,
          worktreePath,
          'merged',
          'run-verified',
          undefined,
          gate,
        ),
      ],
      [
        'no run',
        resolveLandingVerification(
          root,
          worktreePath,
          'already_current',
          null,
          undefined,
          gate,
        ),
      ],
      [
        'gate ran another profile',
        resolveLandingVerification(
          root,
          worktreePath,
          'already_current',
          'run-verified',
          undefined,
          () => ({ fingerprint: verified, profile: 'fast' }),
        ),
      ],
      [
        'no gate record',
        resolveLandingVerification(
          root,
          worktreePath,
          'already_current',
          'run-verified',
          undefined,
          () => undefined,
        ),
      ],
    ]

  for (const [name, verification] of cases) {
    assert.deepEqual(verification.profiles, ['full'], name)
    assert.equal(verification.basis, 'default', name)
    assert.ok(verification.reason.length > 0, name)
  }

  const operator = resolveLandingVerification(
    root,
    worktreePath,
    'merged',
    'run-verified',
    ['static'],
    gate,
  )

  assert.deepEqual(operator.profiles, ['static'])
  assert.equal(operator.basis, 'operator')

  // A source change after the gate is a tree nobody verified.
  writeFileSync(
    path.join(worktreePath, 'src', 'verified.ts'),
    "export const verified = 'changed'\n",
  )

  const moved = resolveLandingVerification(
    root,
    worktreePath,
    'already_current',
    'run-verified',
    undefined,
    gate,
  )

  assert.deepEqual(moved.profiles, ['full'])
  assert.match(moved.reason, /differs from the tree the entry gate verified/u)
})

test('a land records the basis of every verify step it ran', () => {
  const root = landingFixture()

  finalizedCandidate(
    root,
    'basis-recorded',
    nextSemanticVersion(versionAt(root, PAN_DEV), 'minor') as string,
    'This release records its verify basis.\n\n### Added\n\n- Add the basis-recorded marker module.',
  )
  setFullProfileCommand(root, 'node -e "process.exit(0)"')

  const landed = landRelease(root, {
    worktree: 'basis-recorded',
    bump: 'minor',
  })
  const verifySteps = readLandingLog(root).filter(
    (entry) => entry.event === 'step' && entry.step === 'verify',
  )

  assert.equal(landed.status, 'landed')
  assert.deepEqual(landed.verified_profiles, ['full'])
  assert.equal(landed.verification_basis, 'default')
  assert.equal(verifySteps.length, 1)
  assert.equal(verifySteps[0]?.basis, 'default')
  assert.match(String(verifySteps[0]?.reason), /no --run/u)
})

/**
 * A landing fixture whose candidates carry the build wrappers, with a fake
 * compiler that mirrors `src/*.ts` into `dist/src/*.js`, so the compiled tree
 * shows which sources it was built from. `src/broken.ts` makes it fail.
 */
function buildLandingFixture(): { root: string; tools: string } {
  const root = landingFixture()
  const tools = createTestTempDirectory('pancreator-land-tools-')

  for (const script of ['build', 'pan-run', 'run-built', 'run-quiet']) {
    const target = path.join(root, 'bin', script)

    copyFileSync(path.join(REPO_ROOT, 'bin', script), target)
    chmodSync(target, 0o755)
  }

  writeFileSync(path.join(root, 'src', 'gone.ts'), 'export const gone = true\n')
  git(root, ['add', 'bin', 'src/gone.ts'])
  git(root, [
    'commit',
    '-qm',
    'test: build wrappers and a source the tip removes',
  ])
  git(root, ['branch', '-f', PAN_DEV, 'HEAD'])

  writeFileSync(
    path.join(tools, 'tsc'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'out=dist; while [[ $# -gt 0 ]]; do if [[ "$1" == "--outDir" ]]; then out="$2"; shift; fi; shift; done',
      'if [[ -e src/broken.ts ]]; then echo "error TS9999: broken source" >&2; exit 1; fi',
      'mkdir -p "$out/src"',
      'for f in src/*.ts; do : > "$out/${f%.ts}.js"; done',
      '',
    ].join('\n'),
  )
  chmodSync(path.join(tools, 'tsc'), 0o755)

  return { root, tools }
}

/** Run `body` with the fake compiler first on PATH and a stale ready value. */
function withBuildEnvironment(
  tools: string,
  readyRoot: string | null,
  body: () => void,
): void {
  const saved = {
    PATH: process.env.PATH,
    ready: process.env.PANCREATOR_BUILD_READY,
  }

  process.env.PATH = `${tools}:${saved.PATH ?? ''}`

  if (readyRoot === null) {
    delete process.env.PANCREATOR_BUILD_READY
  } else {
    process.env.PANCREATOR_BUILD_READY = readyRoot
  }

  try {
    body()
  } finally {
    process.env.PATH = saved.PATH

    if (saved.ready === undefined) {
      delete process.env.PANCREATOR_BUILD_READY
    } else {
      process.env.PANCREATOR_BUILD_READY = saved.ready
    }
  }
}

function compileCandidate(candidate: string): string {
  const built = spawnSync(
    path.join(candidate, 'bin', 'run-built'),
    ['--build-only'],
    {
      cwd: candidate,
      encoding: 'utf8',
    },
  )

  assert.equal(built.status, 0, built.stderr)

  return readFileSync(
    path.join(candidate, 'dist', '.build-stamp'),
    'utf8',
  ).trim()
}

test('a landing that merges a tip removing a source verifies the rebuilt tree, not the pre-merge build', () => {
  const { root, tools } = buildLandingFixture()
  const checkout = path.join(root, 'tip-advance')

  git(root, ['worktree', 'add', '-q', checkout, PAN_DEV])
  git(checkout, ['rm', '-q', 'src/gone.ts'])
  git(checkout, ['commit', '-qm', 'refactor: remove the gone source'])
  commitReleasePair(
    checkout,
    nextSemanticVersion(
      readFileSync(path.join(checkout, 'VERSION'), 'utf8').trim(),
      'patch',
    ) as string,
  )
  git(root, ['worktree', 'remove', checkout])

  // The candidate branched before the tip removed `src/gone.ts`, so its
  // compiled tree still holds `dist/src/gone.js`.
  const candidate = makeCandidate(
    root,
    'stale-dist',
    'This release lands on a tip that removed a source.\n\n### Fixed\n\n- Verify the integrated tree.',
  )
  const verifyCheck =
    "const fs = require('node:fs'); process.exit(process.env.PANCREATOR_BUILD_READY || fs.existsSync('dist/src/gone.js') || !fs.existsSync('dist/src/base.js') ? 1 : 0)"

  setFullProfileCommand(root, `node -e "${verifyCheck}"`)

  withBuildEnvironment(tools, null, () => {
    compileCandidate(candidate)
    assert.equal(
      existsSync(path.join(candidate, 'dist', 'src', 'gone.js')),
      true,
    )
  })

  // `bin/pan` exports the ready value for the tree it built before the merge.
  withBuildEnvironment(tools, candidate, () => {
    const result = landRelease(root, { worktree: 'stale-dist', bump: 'minor' })

    assert.equal(result.status, 'landed', result.verification_output ?? '')
    assert.deepEqual(result.verified_profiles, ['full'])

    const stamp = readFileSync(
      path.join(candidate, 'dist', '.build-stamp'),
      'utf8',
    ).trim()

    assert.equal(result.build_stamp, stamp)
    assert.equal(
      existsSync(path.join(candidate, 'dist', 'src', 'gone.js')),
      false,
    )

    const events = readLandingLog(root).filter(
      (event) => event.event === 'step',
    )
    const build = events.find((event) => event.step === 'build')
    const verify = events.find((event) => event.step === 'verify')

    assert.equal(build?.outcome, 'built')
    assert.equal(build?.build_stamp, stamp)
    assert.equal(verify?.build_stamp, stamp)
  })
})

test('a landing whose integrated tree does not compile fails before any profile runs and leaves pan-dev unchanged', () => {
  const { root, tools } = buildLandingFixture()
  const tipBefore = git(root, ['rev-parse', PAN_DEV])

  makeCandidate(
    root,
    'broken',
    'This release does not compile.\n\n### Added\n\n- Add the broken module.',
  )
  setFullProfileCommand(root, 'node -e "process.exit(0)"')

  withBuildEnvironment(tools, null, () => {
    const result = landRelease(root, { worktree: 'broken', bump: 'minor' })

    assert.equal(result.status, 'verification_failed')
    assert.match(result.verification_output ?? '', /broken source/u)
    assert.equal(
      result.steps.some((entry) => entry.step === 'verify'),
      false,
    )
    assert.equal(git(root, ['rev-parse', PAN_DEV]), tipBefore)
    assert.equal(landingLockExists(root), false)
  })
})

const REPAIR_RUN = 'run-ship-repair'

/** A candidate whose first land failed `full` after finalize, plus that result. */
function failedCandidate(
  root: string,
  name: string,
): { candidate: string; failed: LandingResult } {
  const candidate = makeCandidate(
    root,
    name,
    `This release is repaired in place.\n\n### Added\n\n- Add the ${name} marker module.`,
  )

  setFullProfileCommand(root, 'node -e "process.exit(1)"')

  const failed = landRelease(root, {
    worktree: name,
    bump: 'minor',
    runId: REPAIR_RUN,
  })

  assert.equal(failed.status, 'verification_failed')

  return { candidate, failed }
}

function commitTestFile(candidate: string, relativePath: string): void {
  mkdirSync(path.dirname(path.join(candidate, relativePath)), {
    recursive: true,
  })
  writeFileSync(path.join(candidate, relativePath), 'export {}\n')
  git(candidate, ['add', relativePath])
  git(candidate, ['commit', '-qm', `test: repair ${relativePath}`])
}

test('a bounded repair of one lane test relands on the failed release pair and verifies only the lanes it changed', () => {
  const root = landingFixture()
  const { candidate, failed } = failedCandidate(root, 'repair-ok')

  commitTestFile(candidate, 'tests/unit/stale.test.ts')

  const repaired = landRelease(root, {
    worktree: 'repair-ok',
    runId: REPAIR_RUN,
    repairNote: 'A stale compiled test failed the full profile.',
  })

  assert.equal(repaired.status, 'landed')
  assert.equal(repaired.verification_basis, 'bounded_repair')
  assert.deepEqual(repaired.verified_profiles, [
    'static',
    'configuration',
    'fast',
  ])
  assert.equal(repaired.release_commit, failed.release_commit)
  assert.equal(repaired.index_commit, failed.index_commit)
  assert.deepEqual(repaired.repair?.paths, ['tests/unit/stale.test.ts'])
  assert.equal(
    repaired.steps.some(
      (entry) => entry.step === 'finalize' || entry.step === 'allocate',
    ),
    false,
    'a repair reuses the finalized pair and allocates nothing',
  )
  assert.equal(
    git(root, ['rev-parse', PAN_DEV]),
    git(candidate, ['rev-parse', 'HEAD']),
  )
  assert.notEqual(git(root, ['rev-parse', PAN_DEV]), failed.index_commit)
  assert.equal(versionAt(root, PAN_DEV), failed.version)
  assert.equal(landingLockExists(root), false)

  const verifyStep = readLandingLog(root)
    .filter((entry) => entry.event === 'step' && entry.step === 'verify')
    .at(-1)

  assert.equal(verifyStep?.basis, 'bounded_repair')
  assert.equal(
    verifyStep?.repair_note,
    'A stale compiled test failed the full profile.',
  )
  assert.equal(verifyStep?.run_id, REPAIR_RUN)
  assert.equal(typeof verifyStep?.token, 'string')
})

test('a repair that changes source or more than three test files is refused and changes nothing', () => {
  const root = landingFixture()
  const { candidate } = failedCandidate(root, 'repair-wide')
  const tipBefore = git(root, ['rev-parse', PAN_DEV])

  writeFileSync(
    path.join(candidate, 'src', 'repair-wide.ts'),
    'export const x = 1\n',
  )
  git(candidate, ['add', 'src/repair-wide.ts'])
  git(candidate, ['commit', '-qm', 'fix: change source'])

  const headBefore = git(candidate, ['rev-parse', 'HEAD'])
  const source = landRelease(root, {
    worktree: 'repair-wide',
    runId: REPAIR_RUN,
    repairNote: 'Source change.',
  })

  assert.equal(source.status, 'landing_refused')
  assert.match(source.refused_reason ?? '', /LANDING_REPAIR_OUT_OF_BOUND/u)

  git(candidate, ['reset', '-q', '--hard', 'HEAD~1'])

  for (const name of ['a', 'b', 'c', 'd']) {
    commitTestFile(candidate, `tests/unit/${name}.test.ts`)
  }

  const headWide = git(candidate, ['rev-parse', 'HEAD'])
  const wide = landRelease(root, {
    worktree: 'repair-wide',
    runId: REPAIR_RUN,
    repairNote: 'Four tests.',
  })

  assert.equal(wide.status, 'landing_refused')
  assert.match(wide.refused_reason ?? '', /LANDING_REPAIR_OUT_OF_BOUND/u)
  assert.match(wide.refused_reason ?? '', /4 paths/u)
  assert.equal(git(candidate, ['rev-parse', 'HEAD']), headWide)
  assert.notEqual(headWide, headBefore)
  assert.equal(git(root, ['rev-parse', PAN_DEV]), tipBefore)
  assert.equal(landingLockExists(root), false)
})

test('a repair without a run, a prior failure, or a current tip is refused', () => {
  const root = landingFixture()

  makeCandidate(
    root,
    'repair-none',
    'This release has no failed land.\n\n### Added\n\n- Add the repair-none marker module.',
  )

  const noRun = landRelease(root, {
    worktree: 'repair-none',
    repairNote: 'No run.',
  })
  const noFailure = landRelease(root, {
    worktree: 'repair-none',
    runId: REPAIR_RUN,
    repairNote: 'No failure.',
  })

  assert.match(noRun.refused_reason ?? '', /LANDING_REPAIR_REQUIRES_RUN/u)
  assert.match(noFailure.refused_reason ?? '', /LANDING_REPAIR_NO_FAILURE/u)

  const stale = failedCandidate(root, 'repair-stale')

  commitTestFile(stale.candidate, 'tests/unit/stale.test.ts')
  advanceTip(root)

  const moved = landRelease(root, {
    worktree: 'repair-stale',
    runId: REPAIR_RUN,
    repairNote: 'The tip moved.',
  })

  assert.equal(moved.status, 'landing_refused')
  assert.match(moved.refused_reason ?? '', /LANDING_REPAIR_TIP_MOVED/u)
})
