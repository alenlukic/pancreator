import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  type InstallMarker,
  createReleaseFixture,
  git,
  makeSkeletonProject,
  readJson,
  run,
  runInstaller,
} from './install-helpers.js'

test('dirty development snapshot installs with automatic updates disabled', () => {
  const source = createReleaseFixture()
  const project = makeSkeletonProject()

  try {
    writeFileSync(
      path.join(source, 'README.md'),
      '# dirty development snapshot\n',
    )

    const install = run(
      path.join(source, 'bin', 'install'),
      ['--target', project, '--skip-dependencies', '--skip-shell-alias'],
      source,
    )

    assert.equal(install.status, 0, install.stderr)
    assert.match(install.stdout, /Development snapshot/)

    const marker = readJson<InstallMarker>(
      path.join(project, '.pancreator', 'install.json'),
    )
    assert.equal(marker.source_dirty, true)
    assert.equal(marker.source_indexed, false)
    assert.equal(marker.source_commit, git(source, ['rev-parse', 'HEAD']))

    const update = run(
      path.join(source, 'bin', 'update'),
      ['--target', project, '--skip-dependencies', '--skip-shell-alias'],
      source,
    )
    assert.notEqual(update.status, 0)
    assert.match(update.stderr, /development-snapshot install/)
  } finally {
    rmSync(source, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer ignores source-checkout Cursor files', () => {
  const project = makeSkeletonProject()
  const source = createReleaseFixture()

  try {
    mkdirSync(path.join(source, '.cursor', 'agents'), { recursive: true })
    writeFileSync(
      path.join(source, '.cursor', 'agents', 'pan-coder.md'),
      'poisoned local source config\n',
    )

    const result = runInstaller(project, ['--pancreator-root', source])

    assert.equal(result.status, 0, result.stderr)

    const projected = readFileSync(
      path.join(project, '.cursor', 'agents', 'pan-coder.md'),
      'utf8',
    )

    assert.doesNotMatch(projected, /poisoned local source config/u)
    assert.match(projected, /library\/personas\/coder\.md/u)
  } finally {
    rmSync(project, { recursive: true, force: true })
    rmSync(source, { recursive: true, force: true })
  }
})

test('clean unindexed release candidate installs with automatic updates disabled', () => {
  const source = createReleaseFixture()
  const project = makeSkeletonProject()

  try {
    writeFileSync(
      path.join(source, 'release', 'index.json'),
      '{\n  "schema_version": 1,\n  "releases": []\n}\n',
    )
    git(source, ['add', 'release/index.json'])
    git(source, ['commit', '-qm', 'prepare unindexed release candidate'])
    const candidateCommit = git(source, ['rev-parse', 'HEAD'])

    const install = run(
      path.join(source, 'bin', 'install'),
      ['--target', project, '--skip-dependencies', '--skip-shell-alias'],
      source,
    )

    assert.equal(install.status, 0, install.stderr)
    assert.match(install.stdout, /Unindexed release candidate/)

    const marker = readJson<InstallMarker>(
      path.join(project, '.pancreator', 'install.json'),
    )
    assert.equal(marker.source_dirty, false)
    assert.equal(marker.source_indexed, false)
    assert.equal(marker.source_commit, candidateCommit)

    const update = run(
      path.join(source, 'bin', 'update'),
      ['--target', project, '--skip-dependencies', '--skip-shell-alias'],
      source,
    )
    assert.notEqual(update.status, 0)
    assert.match(update.stderr, /unindexed release-candidate install/)
  } finally {
    rmSync(source, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})

test('clean checkout rejects harness drift under an indexed version', () => {
  const source = createReleaseFixture()
  const project = makeSkeletonProject()

  try {
    writeFileSync(path.join(source, 'README.md'), '# unversioned drift\n')
    git(source, ['add', 'README.md'])
    git(source, ['commit', '-qm', 'unversioned install input drift'])

    const install = run(
      path.join(source, 'bin', 'install'),
      ['--target', project, '--skip-dependencies', '--skip-shell-alias'],
      source,
    )

    assert.notEqual(install.status, 0)
    assert.match(
      install.stderr,
      /installed harness inputs differ from indexed release 0\.1/,
    )
  } finally {
    rmSync(source, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})

test('indexed update fast-forwards the embedded harness and preserves target state', () => {
  const source = createReleaseFixture()
  const project = makeSkeletonProject()

  try {
    const install = run(
      path.join(source, 'bin', 'install'),
      ['--target', project, '--skip-dependencies', '--skip-shell-alias'],
      source,
    )
    assert.equal(install.status, 0, install.stderr)

    const installed = readJson<InstallMarker>(
      path.join(project, '.pancreator', 'install.json'),
    )
    assert.equal(installed.schema_version, 4)
    assert.equal(installed.version, '0.1.0')
    assert.equal(installed.source_dirty, false)
    assert.equal(installed.source_indexed, true)

    writeFileSync(
      path.join(project, '.pancreator', 'runtime', 'inbox', 'preserved.md'),
      'preserve\n',
    )
    writeFileSync(
      path.join(project, '.pancreator', 'docs', 'target-repo-primer.md'),
      'generated target primer\n',
    )
    writeFileSync(path.join(project, '.cursor', 'custom.md'), 'preserve\n')

    writeFileSync(path.join(source, 'VERSION'), '0.2.0\n')
    writeFileSync(
      path.join(source, 'README.md'),
      '# Pancreator release 0.2.0\n',
    )
    git(source, ['add', 'VERSION', 'README.md'])
    git(source, ['commit', '-qm', 'release 0.2.0'])
    const release02 = git(source, ['rev-parse', 'HEAD'])
    const index = readJson<{
      schema_version: number
      releases: Array<{ version: string; commit: string }>
    }>(path.join(source, 'release', 'index.json'))
    index.releases.push({ version: '0.2.0', commit: release02 })
    writeFileSync(
      path.join(source, 'release', 'index.json'),
      `${JSON.stringify(index, null, 2)}\n`,
    )
    git(source, ['add', 'release/index.json'])
    git(source, ['commit', '-qm', 'index 0.2.0'])

    const update = run(
      path.join(source, 'bin', 'update'),
      ['--target', project, '--skip-dependencies', '--skip-shell-alias'],
      source,
    )

    assert.equal(update.status, 0, update.stderr)
    assert.match(
      update.stdout,
      /Pancreator fast-forwarded: 0\.1\.0 .* -> 0\.2\.0/,
    )

    const updated = readJson<InstallMarker>(
      path.join(project, '.pancreator', 'install.json'),
    )
    assert.equal(updated.version, '0.2.0')
    assert.equal(updated.source_commit, release02)
    assert.equal(updated.source_dirty, false)
    assert.equal(updated.source_indexed, true)
    assert.equal(
      readFileSync(path.join(project, '.pancreator', 'README.md'), 'utf8'),
      '# Pancreator release 0.2.0\n',
    )
    assert.equal(
      readFileSync(
        path.join(project, '.pancreator', 'runtime', 'inbox', 'preserved.md'),
        'utf8',
      ),
      'preserve\n',
    )
    assert.equal(
      readFileSync(
        path.join(project, '.pancreator', 'docs', 'target-repo-primer.md'),
        'utf8',
      ),
      'generated target primer\n',
    )
    assert.equal(
      existsSync(
        path.join(project, '.pancreator', 'runtime', 'target-repo-primer.md'),
      ),
      false,
    )
    assert.equal(
      readFileSync(path.join(project, '.cursor', 'custom.md'), 'utf8'),
      'preserve\n',
    )
  } finally {
    rmSync(source, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})
