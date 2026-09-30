/**
 * Integration tests for `pan release land`: the landing mutex across callers,
 * and `landRelease` against a fixture repository with a pan-dev branch,
 * candidate worktrees, and a stub `full` profile.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { acquireLandingMutex } from '../../src/lib/landing-mutex.js'
import {
  landRelease,
  type LandingResult,
} from '../../src/lib/release-landing.js'
import {
  nextSemanticVersion,
  validateReleaseMetadata,
} from '../../src/lib/versioning.js'
import { createWorktree } from '../../src/lib/worktrees.js'
import { createTestTempDirectory } from '../temp.js'
import {
  PAN_DEV,
  advanceTip,
  finalizedCandidate,
  git,
  landingFixture,
  landingLockExists,
  makeCandidate,
  readLandingLog,
  setFullProfileCommand,
  versionAt,
} from './release-landing-helpers.js'

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

function gitStatus(cwd: string, args: string[]): number {
  return spawnSync('git', args, { cwd, encoding: 'utf8' }).status ?? 1
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
