/**
 * Tests for `bin/check-landing branch <ref> <base>` and the
 * `pre-commit` merge-resolution cases.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

const REPO_ROOT = process.cwd()
const CHECK_LANDING = path.join(REPO_ROOT, 'bin', 'check-landing')

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function createRepo(): { root: string } {
  const root = createTestTempDirectory('check-landing-')

  git(root, ['init', '-q', '--initial-branch=main'])
  git(root, ['config', 'user.email', 'test@example.com'])
  git(root, ['config', 'user.name', 'Test'])

  // Seed a minimal installable layout.
  mkdirSync(path.join(root, 'bin'))
  mkdirSync(path.join(root, 'src'))
  mkdirSync(path.join(root, 'docs'))
  mkdirSync(path.join(root, 'release'))

  writeFileSync(path.join(root, 'VERSION'), '1.0.0\n')
  writeFileSync(
    path.join(root, 'CHANGELOG.md'),
    '# Changelog\n\n## [1.0.0] - 2026-01-01\n\n### Changed\n\n- Initial.\n',
  )
  writeFileSync(
    path.join(root, 'package.json'),
    '{"name":"pancreator-v2-prototype","version":"1.0.0"}\n',
  )
  writeFileSync(
    path.join(root, 'package-lock.json'),
    '{"name":"pancreator-v2-prototype","version":"1.0.0","packages":{"":{"version":"1.0.0"}}}\n',
  )
  writeFileSync(path.join(root, '.gitignore'), 'node_modules\n')
  writeFileSync(
    path.join(root, 'config.json'),
    '{"installation_mode":"self_development"}\n',
  )
  writeFileSync(path.join(root, 'README.md'), '# Pancreator\n')
  writeFileSync(path.join(root, 'prettier.config.js'), 'module.exports = {}\n')
  writeFileSync(path.join(root, '.npmrc'), '# npmrc\n')
  writeFileSync(path.join(root, '.prettierignore'), '# ignore\n')
  writeFileSync(path.join(root, 'tsconfig.json'), '{"compilerOptions":{}}\n')
  writeFileSync(path.join(root, 'target-extensions'), '')
  writeFileSync(path.join(root, 'release', 'index.json'), '{"releases":[]}\n')

  git(root, ['add', '.'])
  git(root, ['commit', '-q', '-m', 'initial'])

  // Create pan-dev at this commit.
  git(root, ['branch', 'pan-dev'])

  return { root }
}

function writeReleaseIndex(
  root: string,
  version: string,
  releaseCommit: string,
): void {
  const index = { releases: [{ version, commit: releaseCommit }] }

  writeFileSync(
    path.join(root, 'release', 'index.json'),
    `${JSON.stringify(index, null, 2)}\n`,
  )
}

function createReleaseBranch(
  root: string,
  branch: string,
  version: string,
): string {
  git(root, ['checkout', '-q', '-b', branch])

  // Add a source change.
  writeFileSync(path.join(root, 'src', 'change.ts'), `// ${version}\n`)
  git(root, ['add', 'src/change.ts'])
  git(root, ['commit', '-q', '-m', `feat: ${version}`])

  // Write release metadata.
  writeFileSync(path.join(root, 'VERSION'), `${version}\n`)
  writeFileSync(
    path.join(root, 'package.json'),
    `{"name":"pancreator-v2-prototype","version":"${version}"}\n`,
  )
  writeFileSync(
    path.join(root, 'CHANGELOG.md'),
    `# Changelog\n\n## [${version}] - 2026-09-01\n\n### Changed\n\n- New feature.\n`,
  )

  git(root, ['add', 'VERSION', 'package.json', 'CHANGELOG.md'])
  git(root, ['commit', '-q', '-m', `release: prepare v${version}`])
  const releaseHash = git(root, ['rev-parse', 'HEAD'])

  // Write and commit release/index.json.
  writeReleaseIndex(root, version, releaseHash)
  git(root, ['add', 'release/index.json'])
  git(root, ['commit', '-q', '-m', `release: index v${version}`])

  const head = git(root, ['rev-parse', 'HEAD'])

  git(root, ['checkout', '-q', '-'])

  return head
}

function runCheckLanding(
  args: string[],
  cwd: string,
): { status: number; stderr: string; stdout: string } {
  const result = spawnSync(CHECK_LANDING, args, { cwd, encoding: 'utf8' })

  return {
    status: result.status ?? 1,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  }
}

test('branch check: permits a branch with a proper release above the base', () => {
  const { root } = createRepo()

  createReleaseBranch(root, 'feature', '1.1.0')

  const result = runCheckLanding(['branch', 'feature', 'pan-dev'], root)

  assert.equal(result.status, 0, `Expected exit 0; stderr: ${result.stderr}`)
})

test('branch check: refuses a branch that carries no VERSION above the base', () => {
  const { root } = createRepo()

  // Create a branch with installable changes but no version bump.
  git(root, ['checkout', '-q', '-b', 'no-version'])
  writeFileSync(path.join(root, 'src', 'new.ts'), '// new\n')
  git(root, ['add', 'src/new.ts'])
  git(root, ['commit', '-q', '-m', 'feat: no version bump'])

  const result = runCheckLanding(['branch', 'no-version', 'pan-dev'], root)

  assert.equal(result.status, 1)
  assert.ok(result.stderr.includes('already holds'))

  git(root, ['checkout', '-q', '-'])
})

test('branch check: permits a branch that only changes runtime files (no release owed)', () => {
  const { root } = createRepo()

  git(root, ['checkout', '-q', '-b', 'runtime-only'])
  mkdirSync(path.join(root, 'runtime'), { recursive: true })
  writeFileSync(path.join(root, 'runtime', 'note.txt'), 'note\n')
  git(root, ['add', 'runtime/note.txt'])
  git(root, ['commit', '-q', '-m', 'runtime: note'])

  const result = runCheckLanding(['branch', 'runtime-only', 'pan-dev'], root)

  assert.equal(result.status, 0, `Expected exit 0; stderr: ${result.stderr}`)

  git(root, ['checkout', '-q', '-'])
})

test('branch check: uses optional <base-ref> instead of HEAD', () => {
  const { root } = createRepo()

  // Create an intermediate commit on main and a branch on top of it.
  writeFileSync(path.join(root, 'src', 'mid.ts'), '// mid\n')
  git(root, ['add', 'src/mid.ts'])
  git(root, ['commit', '-q', '-m', 'mid commit'])
  const midCommit = git(root, ['rev-parse', 'HEAD'])

  git(root, ['checkout', '-q', '-b', 'topbranch'])
  writeFileSync(path.join(root, 'src', 'top.ts'), '// top\n')
  git(root, ['add', 'src/top.ts'])
  git(root, ['commit', '-q', '-m', 'feat: top'])
  writeFileSync(path.join(root, 'VERSION'), '2.0.0\n')
  git(root, ['add', 'VERSION'])
  git(root, ['commit', '-q', '-m', 'release: prepare v2.0.0'])
  const relHash = git(root, ['rev-parse', 'HEAD'])

  writeReleaseIndex(root, '2.0.0', relHash)
  git(root, ['add', 'release/index.json'])
  git(root, ['commit', '-q', '-m', 'release: index v2.0.0'])

  // Check against the intermediate commit as base: should pass.
  const result = runCheckLanding(['branch', 'topbranch', midCommit], root)

  assert.equal(result.status, 0, `Expected exit 0; stderr: ${result.stderr}`)

  git(root, ['checkout', '-q', '-'])
})

test('branch check: refuses a branch that changes installables after the release commit', () => {
  const { root } = createRepo()

  git(root, ['checkout', '-q', '-b', 'post-release-change'])
  writeFileSync(path.join(root, 'src', 'pre.ts'), '// pre\n')
  git(root, ['add', 'src/pre.ts'])
  git(root, ['commit', '-q', '-m', 'feat: pre'])

  writeFileSync(path.join(root, 'VERSION'), '1.1.0\n')
  git(root, ['add', 'VERSION'])
  git(root, ['commit', '-q', '-m', 'release: prepare v1.1.0'])
  const relHash = git(root, ['rev-parse', 'HEAD'])

  writeReleaseIndex(root, '1.1.0', relHash)
  git(root, ['add', 'release/index.json'])
  git(root, ['commit', '-q', '-m', 'release: index v1.1.0'])

  // A post-release installable change.
  writeFileSync(path.join(root, 'src', 'post.ts'), '// post\n')
  git(root, ['add', 'src/post.ts'])
  git(root, ['commit', '-q', '-m', 'feat: post-release change'])

  const result = runCheckLanding(
    ['branch', 'post-release-change', 'pan-dev'],
    root,
  )

  assert.equal(result.status, 1)
  assert.ok(result.stderr.includes('changes installable inputs after'))

  git(root, ['checkout', '-q', '-'])
})

/** Start a real merge of `branch` into pan-dev and leave it uncommitted. */
function startMergeOnPanDev(root: string, branch: string): void {
  git(root, ['checkout', '-q', 'pan-dev'])

  const merge = spawnSync('git', ['merge', '--no-ff', '--no-commit', branch], {
    cwd: root,
    encoding: 'utf8',
  })

  assert.equal(merge.status, 0, `merge failed: ${merge.stderr}`)
  assert.equal(
    spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).status,
    0,
    'the merge is in progress',
  )
}

test('pre-commit: permits a merge resolution that equals the released source', () => {
  const { root } = createRepo()

  createReleaseBranch(root, 'goodrelease', '1.2.0')
  startMergeOnPanDev(root, 'goodrelease')

  const result = runCheckLanding(['pre-commit'], root)

  assert.equal(result.status, 0, `Expected exit 0; stderr: ${result.stderr}`)
})

test('pre-commit: refuses a merge resolution whose staged installable inputs differ from MERGE_HEAD', () => {
  const { root } = createRepo()

  createReleaseBranch(root, 'goodrelease', '1.2.0')
  startMergeOnPanDev(root, 'goodrelease')
  writeFileSync(path.join(root, 'src', 'change.ts'), '// resolved by hand\n')
  git(root, ['add', 'src/change.ts'])

  const result = runCheckLanding(['pre-commit'], root)

  assert.equal(result.status, 1)
  assert.match(
    result.stderr,
    /staged resolution of installable inputs differs/u,
  )
})

test('pre-commit: refuses a merge whose MERGE_HEAD carries no new indexed release', () => {
  const { root } = createRepo()

  git(root, ['checkout', '-q', '-b', 'unreleased'])
  writeFileSync(path.join(root, 'src', 'unreleased.ts'), '// unreleased\n')
  git(root, ['add', 'src/unreleased.ts'])
  git(root, ['commit', '-q', '-m', 'feat: unreleased change'])
  git(root, ['checkout', '-q', 'main'])
  startMergeOnPanDev(root, 'unreleased')

  const result = runCheckLanding(['pre-commit'], root)

  assert.equal(result.status, 1)
  assert.match(result.stderr, /still carries VERSION 1\.0\.0/u)
})

const DAILY_SURFACES = {
  schema_version: 1,
  conform_paths: [
    'AGENTS.md',
    'governance/criteria/*.md',
    'docs/issues/**/*.md',
  ],
  style_extensions: ['.ts', '.tsx'],
}

/**
 * A repository whose pan-dev carries the surfaces registry, so daily-range
 * reads it from the base commit of every range these tests check.
 */
function createDailyRepo(): { root: string; base: string } {
  const { root } = createRepo()
  const registry = path.join(
    root,
    'governance',
    'registries',
    'daily_quality_surfaces.json',
  )

  mkdirSync(path.dirname(registry), { recursive: true })
  writeFileSync(registry, `${JSON.stringify(DAILY_SURFACES, null, 2)}\n`)
  git(root, ['add', '.'])
  git(root, ['commit', '-q', '-m', 'add daily quality surfaces'])
  git(root, ['branch', '-f', 'pan-dev', 'HEAD'])

  return { root, base: git(root, ['rev-parse', 'pan-dev']) }
}

/** Commit `files` on the current branch, with the daily trailer when `id` is set. */
function commitFiles(
  root: string,
  files: Record<string, string>,
  id: string | null,
): string {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), content)
    git(root, ['add', file])
  }

  const message =
    id === null
      ? 'style: unmarked change'
      : `style: daily conform and style pass 2026-09-26\n\nPancreator-Daily-Quality: ${id}`

  git(root, ['commit', '-q', '-m', message])

  return git(root, ['rev-parse', 'HEAD'])
}

function runCheckLandingResult(
  args: string[],
  root: string,
): { status: number; stderr: string; stdout: string } {
  const result = spawnSync(CHECK_LANDING, args, {
    cwd: root,
    encoding: 'utf8',
  })

  return {
    status: result.status ?? 1,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  }
}

test('daily-range: accepts a range of marked daily commits inside surfaces', () => {
  const { root, base } = createDailyRepo()

  git(root, ['checkout', '-q', '-b', 'daily-pass'])
  commitFiles(root, { 'src/fixed.ts': '// fixed\n' }, 'occ-001')
  const head = commitFiles(
    root,
    {
      'governance/criteria/sample.md': '# Sample\n',
      'docs/issues/intake/note.md': '# Note\n',
    },
    'occ-002',
  )

  const result = runCheckLandingResult(['daily-range', base, head], root)

  assert.equal(result.status, 0, `Expected exit 0; stderr: ${result.stderr}`)
})

test('daily-range: refuses when range has no daily commits', () => {
  const { root, base } = createDailyRepo()
  const result = runCheckLandingResult(['daily-range', base, base], root)

  assert.equal(result.status, 1)
  assert.match(result.stderr, /at least one/u)
})

test('daily-range: refuses an unmarked installable commit', () => {
  const { root, base } = createDailyRepo()

  git(root, ['checkout', '-q', '-b', 'no-trailer'])
  const head = commitFiles(root, { 'src/fixed.ts': '// fixed\n' }, null)

  const result = runCheckLandingResult(['daily-range', base, head], root)

  assert.equal(result.status, 1)
  assert.match(result.stderr, /missing the Pancreator-Daily-Quality: trailer/u)
})

test('daily-range: refuses a marked commit that changes a path outside surfaces', () => {
  const { root, base } = createDailyRepo()

  git(root, ['checkout', '-q', '-b', 'out-of-surface'])
  const head = commitFiles(
    root,
    {
      'src/fixed.ts': '// fixed\n',
      'package.json': '{"name":"test","version":"1.0.0"}\n',
    },
    'occ-003',
  )

  const result = runCheckLandingResult(['daily-range', base, head], root)

  assert.equal(result.status, 1)
  assert.match(
    result.stderr,
    /changes path 'package\.json' which is not in the daily quality surfaces/u,
  )
})

test('daily-range: reads the surfaces from the base commit, not the working tree', () => {
  const { root, base } = createDailyRepo()

  git(root, ['checkout', '-q', '-b', 'widened'])
  const head = commitFiles(
    root,
    { 'package.json': '{"name":"test","version":"1.0.0"}\n' },
    'occ-004',
  )

  writeFileSync(
    path.join(root, 'governance', 'registries', 'daily_quality_surfaces.json'),
    `${JSON.stringify({ ...DAILY_SURFACES, conform_paths: ['package.json'] })}\n`,
  )

  const result = runCheckLandingResult(['daily-range', base, head], root)

  assert.equal(result.status, 1)
  assert.match(result.stderr, /'package\.json' which is not in the daily/u)
})

test('daily-range: refuses a merge commit', () => {
  const { root, base } = createDailyRepo()

  git(root, ['checkout', '-q', '-b', 'branch-a'])
  commitFiles(root, { 'src/a.ts': '// a\n' }, 'occ-side')
  git(root, ['checkout', '-q', '-b', 'integration', base])
  git(root, [
    'merge',
    '--no-ff',
    '-q',
    '-m',
    'style: daily merge\n\nPancreator-Daily-Quality: occ-merge',
    'branch-a',
  ])
  const mergeHead = git(root, ['rev-parse', 'HEAD'])

  const result = runCheckLandingResult(['daily-range', base, mergeHead], root)

  assert.equal(result.status, 1)
  assert.match(
    result.stderr,
    new RegExp(`commit ${mergeHead} is a merge commit`, 'u'),
  )
})

test('branch check: accepts a source whose only drift is marked daily commits', () => {
  const { root } = createDailyRepo()

  git(root, ['checkout', '-q', '-b', 'pan-quality', 'pan-dev'])
  const head = commitFiles(root, { 'src/fixed.ts': '// fixed\n' }, 'occ-branch')

  const result = runCheckLandingResult(['branch', head, 'pan-dev'], root)

  assert.equal(result.status, 0, `Expected exit 0; stderr: ${result.stderr}`)
})

test('branch check: refuses an unmarked installable change at the same version', () => {
  const { root } = createDailyRepo()

  git(root, ['checkout', '-q', '-b', 'pan-quality', 'pan-dev'])
  const head = commitFiles(root, { 'src/fixed.ts': '// fixed\n' }, null)

  const result = runCheckLandingResult(['branch', head, 'pan-dev'], root)

  assert.equal(result.status, 1)
  assert.match(result.stderr, /still carries VERSION 1\.0\.0/u)
  assert.match(
    result.stderr,
    new RegExp(`commit ${head} changes installable inputs and is missing`, 'u'),
  )
})

test('branch check: accepts a marked daily commit that changes only AGENTS.md', () => {
  const { root } = createDailyRepo()

  git(root, ['checkout', '-q', '-b', 'pan-quality', 'pan-dev'])
  const head = commitFiles(root, { 'AGENTS.md': '# Agents\n' }, 'occ-agents')

  const result = runCheckLandingResult(['branch', head, 'pan-dev'], root)

  assert.equal(result.status, 0, `Expected exit 0; stderr: ${result.stderr}`)
})
