/**
 * Integration tests for `pan release land`: the landing mutex across callers,
 * and `landRelease` against a fixture repository with a pan-dev branch,
 * candidate worktrees, and a stub `full` profile.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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

import { gitSourceContentFingerprint } from '../../src/lib/git.js'
import {
  landRelease,
  resolveLandingVerification,
  type LandingResult,
} from '../../src/lib/release-landing.js'
import {
  nextSemanticVersion,
  RELEASE_LANDING_METADATA_PATHS,
} from '../../src/lib/versioning.js'
import { createWorktree } from '../../src/lib/worktrees.js'
import { createTestTempDirectory } from '../temp.js'
import {
  PAN_DEV,
  REPO_ROOT,
  advanceTip,
  commitReleasePair,
  finalizedCandidate,
  git,
  landingFixture,
  landingLockExists,
  makeCandidate,
  readLandingLog,
  setFullProfileCommand,
  versionAt,
} from './release-landing-helpers.js'

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
