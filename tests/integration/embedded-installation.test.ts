import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const REPO_ROOT = process.cwd()
const INSTALLER = path.join(REPO_ROOT, 'bin', 'install')
const CURRENT_VERSION = readFileSync(
  path.join(REPO_ROOT, 'VERSION'),
  'utf8',
).trim()

interface CommandResult {
  stdout: string
  stderr: string
  status: number | null
}

interface InstallMarker {
  schema_version: number
  version: string
  source_commit: string
  source_dirty: boolean
  source_indexed: boolean
  payload_entries: string[]
  cursor_files: Array<{ path: string; sha256: string }>
}

function makeSkeletonProject(): string {
  const project = mkdtempSync(path.join(tmpdir(), 'pancreator-embed-'))

  writeFileSync(path.join(project, 'README.md'), '# skeleton\n')

  return project
}

function run(
  executable: string,
  args: string[],
  cwd = REPO_ROOT,
): CommandResult {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
  }
}

function runInstaller(project: string, args: string[] = []): CommandResult {
  return run(INSTALLER, ['--target', project, '--skip-dependencies', ...args])
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function createReleaseFixture(): string {
  const fixture = mkdtempSync(path.join(tmpdir(), 'pancreator-release-source-'))
  const entries = [
    '.gitignore',
    '.npmrc',
    '.prettierignore',
    'README.md',
    'CHANGELOG.md',
    'VERSION',
    'bin',
    'docs',
    'governance',
    'library',
    'package-lock.json',
    'package.json',
    'prettier.config.js',
    'project.json',
    'release',
    'src',
    'tests',
    'tsconfig.json',
  ]

  for (const entry of entries) {
    cpSync(path.join(REPO_ROOT, entry), path.join(fixture, entry), {
      recursive: true,
    })
  }

  writeFileSync(path.join(fixture, 'VERSION'), '0.1.0\n')

  writeFileSync(
    path.join(fixture, 'release', 'index.json'),
    '{\n  "schema_version": 1,\n  "releases": []\n}\n',
  )
  chmodSync(path.join(fixture, 'bin', 'install'), 0o755)
  chmodSync(path.join(fixture, 'bin', 'install-support'), 0o755)
  chmodSync(path.join(fixture, 'bin', 'update'), 0o755)

  git(fixture, ['init', '-q'])
  git(fixture, ['config', 'user.email', 'fixture@example.com'])
  git(fixture, ['config', 'user.name', 'Fixture'])
  git(fixture, ['add', '.'])
  git(fixture, ['commit', '-qm', 'release 0.1.0'])

  const release01 = git(fixture, ['rev-parse', 'HEAD'])

  writeFileSync(
    path.join(fixture, 'release', 'index.json'),
    `${JSON.stringify(
      {
        schema_version: 1,
        releases: [{ version: '0.1.0', commit: release01 }],
      },
      null,
      2,
    )}\n`,
  )
  git(fixture, ['add', 'release/index.json'])
  git(fixture, ['commit', '-qm', 'index 0.1.0'])

  return fixture
}

test('embedded installer creates a runnable-layout harness under .pancreator', () => {
  const project = makeSkeletonProject()

  try {
    const result = runInstaller(project)

    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.stdout.includes(`Pancreator ${CURRENT_VERSION} installed`))
    assert.equal(existsSync(path.join(project, 'project.json')), false)

    const config = readJson<{
      schema_version: number
      workspace_id: string
      workspace_root: string
      state_root: string
      installation_mode: string
    }>(path.join(project, '.pancreator', 'project.json'))

    assert.equal(config.schema_version, 1)
    assert.equal(config.workspace_root, '..')
    assert.equal(config.state_root, 'runtime')
    assert.equal(config.installation_mode, 'embedded')
    assert.ok(config.workspace_id.length > 0)

    assert.equal(
      lstatSync(path.join(project, '.pancreator', '.cursor')).isSymbolicLink(),
      true,
    )
    assert.equal(
      existsSync(path.join(project, '.pancreator', 'governance')),
      true,
    )
    assert.equal(
      existsSync(
        path.join(
          project,
          '.pancreator',
          'governance',
          'policies',
          'OPERATOR-001.json',
        ),
      ),
      true,
    )
    assert.match(
      readFileSync(
        path.join(
          project,
          '.pancreator',
          'governance',
          'policies',
          'WAIVER-001.json',
        ),
        'utf8',
      ),
      /operator MAY waive any workflow stage/u,
    )
    assert.equal(existsSync(path.join(project, '.pancreator', 'library')), true)
    assert.equal(
      existsSync(path.join(project, '.pancreator', 'release', 'index.json')),
      true,
    )
    assert.equal(existsSync(path.join(project, '.pancreator', 'src')), true)
    const primer = readFileSync(
      path.join(project, '.pancreator', 'docs', 'target-repo-primer.md'),
      'utf8',
    )
    assert.match(primer, /pancreator-primer-status: unbuilt/u)
    assert.equal(
      existsSync(
        path.join(project, '.pancreator', 'runtime', 'target-repo-primer.md'),
      ),
      false,
    )

    const repositoryChecks = readJson<{
      schema_version: number
      profiles: Record<string, { commands: string[] }>
    }>(path.join(project, '.pancreator', 'runtime', 'repository-checks.json'))
    assert.equal(repositoryChecks.schema_version, 1)
    assert.deepEqual(repositoryChecks.profiles.static?.commands, [])
    assert.deepEqual(repositoryChecks.profiles.secondary?.commands, [])
    assert.deepEqual(repositoryChecks.profiles.full?.commands, [])
    assert.equal(
      existsSync(path.join(project, '.pancreator', 'runtime', 'locks')),
      false,
    )

    const buildDocsCommand = readFileSync(
      path.join(project, '.cursor', 'commands', 'pan-build-docs.md'),
      'utf8',
    )
    assert.match(buildDocsCommand, /\.\/\.pancreator\/bin\/pan/u)
    assert.match(
      buildDocsCommand,
      /\.pancreator\/docs\/target-repo-primer\.md/u,
    )
    assert.match(buildDocsCommand, /create the primer when absent/u)
    assert.match(buildDocsCommand, /inventory target-owned documentation/u)
    assert.equal(
      existsSync(path.join(project, '.cursor', 'agents', 'librarian.md')),
      true,
    )

    const writePrCommand = readFileSync(
      path.join(project, '.cursor', 'commands', 'pan-write-pr.md'),
      'utf8',
    )
    assert.match(
      writePrCommand,
      /\.pancreator\/library\/skills\/write-pr-description\.md/u,
    )
    assert.match(writePrCommand, /\.pancreator\/docs\/target-repo-primer\.md/u)
    assert.match(writePrCommand, /\.pancreator\/runtime\/pr-descriptions/u)

    assert.equal(
      existsSync(path.join(project, '.pancreator', 'workdesk')),
      false,
    )
    assert.equal(
      existsSync(path.join(project, '.pancreator', 'runtime', 'workflows')),
      false,
    )

    const command = readFileSync(
      path.join(project, '.cursor', 'commands', 'pan-start.md'),
      'utf8',
    )
    assert.match(command, /\.\/\.pancreator\/bin\/pan/)
    assert.match(command, /\.pancreator\/runtime\/inbox/)
    assert.match(command, /runtime\/inbox\/request-<id>\.md/)

    const marker = readJson<InstallMarker>(
      path.join(project, '.pancreator', 'install.json'),
    )
    assert.equal(marker.schema_version, 3)
    assert.equal(marker.version, CURRENT_VERSION)
    assert.equal(typeof marker.source_dirty, 'boolean')
    assert.equal(typeof marker.source_indexed, 'boolean')
    assert.equal(marker.source_dirty && marker.source_indexed, false)
    assert.equal('source_root' in marker, false)
    assert.equal('target_root' in marker, false)
    assert.ok(marker.payload_entries.includes('governance'))
    assert.ok(marker.payload_entries.includes('release'))
    assert.ok(
      marker.cursor_files.some((entry) => entry.path.endsWith('coder.md')),
    )
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

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
      ['--target', project, '--skip-dependencies'],
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
      ['--target', project, '--skip-dependencies'],
      source,
    )
    assert.notEqual(update.status, 0)
    assert.match(update.stderr, /development-snapshot install/)
  } finally {
    rmSync(source, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer manages an existing target gitignore without creating one', () => {
  const withGitignore = makeSkeletonProject()
  const equivalentRule = makeSkeletonProject()
  const withoutGitignore = makeSkeletonProject()

  try {
    writeFileSync(path.join(withGitignore, '.gitignore'), 'node_modules/')

    const first = runInstaller(withGitignore)
    const second = runInstaller(withGitignore, ['--yes'])

    assert.equal(first.status, 0, first.stderr)
    assert.equal(second.status, 0, second.stderr)
    assert.equal(
      readFileSync(path.join(withGitignore, '.gitignore'), 'utf8'),
      'node_modules/\n.pancreator/\n',
    )

    writeFileSync(
      path.join(equivalentRule, '.gitignore'),
      '/.pancreator/\nlocal-only/\n',
    )

    const equivalent = runInstaller(equivalentRule)

    assert.equal(equivalent.status, 0, equivalent.stderr)
    assert.equal(
      readFileSync(path.join(equivalentRule, '.gitignore'), 'utf8'),
      '/.pancreator/\nlocal-only/\n',
    )

    const absent = runInstaller(withoutGitignore)

    assert.equal(absent.status, 0, absent.stderr)
    assert.equal(existsSync(path.join(withoutGitignore, '.gitignore')), false)
  } finally {
    rmSync(withGitignore, { recursive: true, force: true })
    rmSync(equivalentRule, { recursive: true, force: true })
    rmSync(withoutGitignore, { recursive: true, force: true })
  }
})

test('embedded installer ignores source-checkout Cursor files', () => {
  const project = makeSkeletonProject()
  const source = createReleaseFixture()

  try {
    mkdirSync(path.join(source, '.cursor', 'agents'), { recursive: true })
    writeFileSync(
      path.join(source, '.cursor', 'agents', 'coder.md'),
      'poisoned local source config\n',
    )

    const result = runInstaller(project, ['--pancreator-root', source])

    assert.equal(result.status, 0, result.stderr)

    const projected = readFileSync(
      path.join(project, '.cursor', 'agents', 'coder.md'),
      'utf8',
    )

    assert.doesNotMatch(projected, /poisoned local source config/u)
    assert.match(projected, /library\/personas\/coder\.md/u)
  } finally {
    rmSync(project, { recursive: true, force: true })
    rmSync(source, { recursive: true, force: true })
  }
})

test('embedded installer warns on existing Cursor state, preserves custom files, and backs up conflicts', () => {
  const project = makeSkeletonProject()

  try {
    mkdirSync(path.join(project, '.cursor', 'agents'), { recursive: true })
    mkdirSync(path.join(project, '.cursor', 'rules'), { recursive: true })
    writeFileSync(
      path.join(project, '.cursor', 'agents', 'coder.md'),
      'custom coder\n',
    )
    writeFileSync(
      path.join(project, '.cursor', 'rules', 'custom.mdc'),
      'custom\n',
    )
    writeFileSync(
      path.join(project, '.cursor', 'settings.json'),
      '{"custom":true}\n',
    )

    const result = runInstaller(project)

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /EXISTING \.cursor DIRECTORY DETECTED/)
    assert.match(
      result.stdout,
      /assumes a pristine agentic\/harness environment/,
    )
    assert.equal(
      readFileSync(
        path.join(project, '.cursor', 'rules', 'custom.mdc'),
        'utf8',
      ),
      'custom\n',
    )
    assert.equal(
      readFileSync(path.join(project, '.cursor', 'settings.json'), 'utf8'),
      '{"custom":true}\n',
    )
    assert.notEqual(
      readFileSync(path.join(project, '.cursor', 'agents', 'coder.md'), 'utf8'),
      'custom coder\n',
    )

    const backupBase = path.join(project, '.pancreator', 'backups', 'cursor')
    const backupRuns = readdirSync(backupBase)
    assert.equal(backupRuns.length, 1)
    assert.equal(
      readFileSync(
        path.join(backupBase, backupRuns[0], '.cursor', 'agents', 'coder.md'),
        'utf8',
      ),
      'custom coder\n',
    )
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer refresh preserves target primer, runtime state, and unrelated Cursor files', () => {
  const project = makeSkeletonProject()

  try {
    assert.equal(runInstaller(project).status, 0)
    writeFileSync(
      path.join(project, '.pancreator', 'runtime', 'inbox', 'request.md'),
      'keep me\n',
    )
    writeFileSync(path.join(project, '.cursor', 'custom.md'), 'keep me\n')
    writeFileSync(
      path.join(project, '.pancreator', 'docs', 'target-repo-primer.md'),
      'generated primer\n',
    )
    writeFileSync(
      path.join(project, '.pancreator', 'runtime', 'repository-checks.json'),
      '{\n  "schema_version": 1,\n  "profiles": {\n    "full": {\n      "probes": ["python --version"],\n      "commands": ["python -m pytest"]\n    }\n  }\n}\n',
    )
    mkdirSync(path.join(project, '.pancreator', 'runtime', 'locks'), {
      recursive: true,
    })
    writeFileSync(
      path.join(project, '.pancreator', 'runtime', 'locks', 'stale.json'),
      '{}\n',
    )
    const legacyRunDirectory = path.join(
      project,
      '.pancreator',
      'runtime',
      'logs',
      'workflows',
      'legacy-run',
    )
    mkdirSync(legacyRunDirectory, { recursive: true })
    writeFileSync(path.join(legacyRunDirectory, '.lock'), '99999999\n')
    const legacyWorkspaceDirectory = path.join(
      project,
      '.pancreator',
      'runtime',
      'workspace',
    )
    mkdirSync(legacyWorkspaceDirectory, { recursive: true })
    writeFileSync(
      path.join(legacyWorkspaceDirectory, 'active-workflow.json'),
      '{}\n',
    )

    const result = runInstaller(project, ['--yes'])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Installation refresh completed/)
    assert.equal(
      readFileSync(
        path.join(project, '.pancreator', 'runtime', 'inbox', 'request.md'),
        'utf8',
      ),
      'keep me\n',
    )
    assert.equal(
      readFileSync(path.join(project, '.cursor', 'custom.md'), 'utf8'),
      'keep me\n',
    )
    assert.equal(
      readFileSync(
        path.join(project, '.pancreator', 'docs', 'target-repo-primer.md'),
        'utf8',
      ),
      'generated primer\n',
    )
    assert.equal(
      existsSync(
        path.join(project, '.pancreator', 'runtime', 'target-repo-primer.md'),
      ),
      false,
    )
    assert.match(
      readFileSync(
        path.join(project, '.pancreator', 'runtime', 'repository-checks.json'),
        'utf8',
      ),
      /python -m pytest/u,
    )
    assert.equal(
      existsSync(path.join(project, '.pancreator', 'runtime', 'locks')),
      false,
    )
    assert.equal(existsSync(path.join(legacyRunDirectory, '.lock')), false)
    assert.equal(
      existsSync(path.join(legacyWorkspaceDirectory, 'active-workflow.json')),
      false,
    )
    assert.equal(
      existsSync(
        path.join(
          project,
          '.pancreator',
          'governance',
          'policies',
          'OPERATOR-001.json',
        ),
      ),
      true,
    )
    assert.match(
      readFileSync(
        path.join(
          project,
          '.pancreator',
          'library',
          'schemas',
          'stage-output.schema.json',
        ),
        'utf8',
      ),
      /workspace_changes/u,
    )
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer migrates a legacy runtime primer into docs', () => {
  const project = makeSkeletonProject()

  try {
    assert.equal(runInstaller(project).status, 0)
    const currentPrimer = path.join(
      project,
      '.pancreator',
      'docs',
      'target-repo-primer.md',
    )
    const legacyPrimer = path.join(
      project,
      '.pancreator',
      'runtime',
      'target-repo-primer.md',
    )
    rmSync(currentPrimer)
    writeFileSync(legacyPrimer, 'legacy generated primer\n')

    const result = runInstaller(project, ['--yes'])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Migrated target repository primer/u)
    assert.equal(
      readFileSync(currentPrimer, 'utf8'),
      'legacy generated primer\n',
    )
    assert.equal(existsSync(legacyPrimer), false)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer disables a legacy fast profile that duplicates full', () => {
  const project = makeSkeletonProject()

  try {
    assert.equal(runInstaller(project).status, 0)
    const checksPath = path.join(
      project,
      '.pancreator',
      'runtime',
      'repository-checks.json',
    )
    writeFileSync(
      checksPath,
      `${JSON.stringify(
        {
          schema_version: 1,
          profiles: {
            fast: {
              description: 'incorrect generated fast profile',
              probes: ['node --version'],
              commands: ['node -e "process.exit(0)"'],
            },
            full: {
              description: 'complete suite',
              probes: ['node --version'],
              commands: ['node   -e   "process.exit(0)"'],
            },
          },
        },
        null,
        2,
      )}\n`,
    )

    const result = runInstaller(project, ['--yes'])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Disabled fast because it duplicated full/u)

    const migrated = readJson<{
      profiles: Record<string, { commands: string[]; probes: string[] }>
      $operator?: { migration_notes?: string[] }
    }>(checksPath)

    assert.deepEqual(migrated.profiles.fast?.commands, [])
    assert.deepEqual(migrated.profiles.fast?.probes, [])
    assert.deepEqual(migrated.profiles.full?.commands, [
      'node   -e   "process.exit(0)"',
    ])
    assert.deepEqual(migrated.profiles.secondary?.commands, [])
    assert.match(
      migrated.$operator?.migration_notes?.join('\n') ?? '',
      /distinct default\/primary suite/u,
    )

    const backupRoot = path.join(
      project,
      '.pancreator',
      'backups',
      'repository-checks',
    )
    assert.equal(readdirSync(backupRoot).length, 1)
    assert.match(
      readFileSync(path.join(backupRoot, readdirSync(backupRoot)[0]), 'utf8'),
      /incorrect generated fast profile/u,
    )
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer clean reinstall removes stale harness payload', () => {
  const project = makeSkeletonProject()

  try {
    assert.equal(runInstaller(project).status, 0)
    writeFileSync(path.join(project, '.pancreator', 'stale.txt'), 'old\n')

    const retiredPath = path.join(project, '.cursor', 'commands', 'retired.md')
    const retiredContent = 'retired Pancreator command\n'
    writeFileSync(retiredPath, retiredContent)

    const markerPath = path.join(project, '.pancreator', 'install.json')
    const marker = readJson<InstallMarker>(markerPath)
    marker.cursor_files.push({
      path: '.cursor/commands/retired.md',
      sha256: createHash('sha256').update(retiredContent).digest('hex'),
    })
    writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`)

    const result = runInstaller(project, ['--clean'])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Clean reinstall completed/)
    assert.equal(
      existsSync(path.join(project, '.pancreator', 'stale.txt')),
      false,
    )
    assert.equal(existsSync(retiredPath), false)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer requires an explicit partial-install decision', () => {
  const project = makeSkeletonProject()

  try {
    mkdirSync(path.join(project, '.pancreator'), { recursive: true })

    const result = runInstaller(project)

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /partial installation detected/)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer supports deterministic repair, clean, and abort choices', () => {
  for (const choice of ['r', 'c', 'a']) {
    const project = makeSkeletonProject()

    try {
      mkdirSync(path.join(project, '.pancreator'), { recursive: true })
      writeFileSync(path.join(project, '.pancreator', 'stale.txt'), 'old\n')

      const result = runInstaller(project, ['--choice', choice])

      assert.equal(result.status, 0, result.stderr)

      if (choice === 'a') {
        assert.match(result.stdout, /Aborted/)
        assert.equal(
          existsSync(path.join(project, '.pancreator', 'install.json')),
          false,
        )
      } else {
        assert.match(
          result.stdout,
          choice === 'r' ? /Repair completed/ : /Clean reinstall completed/,
        )
        assert.equal(
          existsSync(path.join(project, '.pancreator', 'install.json')),
          true,
        )
      }
    } finally {
      rmSync(project, { recursive: true, force: true })
    }
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
      ['--target', project, '--skip-dependencies'],
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
      ['--target', project, '--skip-dependencies'],
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
      ['--target', project, '--skip-dependencies'],
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
      ['--target', project, '--skip-dependencies'],
      source,
    )
    assert.equal(install.status, 0, install.stderr)

    const installed = readJson<InstallMarker>(
      path.join(project, '.pancreator', 'install.json'),
    )
    assert.equal(installed.schema_version, 3)
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
      ['--target', project, '--skip-dependencies'],
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

test('embedded installer scripted smoke verification passes', () => {
  const result = run(INSTALLER, ['--smoke'])

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /smoke: all steps passed/)
  assert.match(result.stdout, /smoke: fresh install/)
  assert.match(result.stdout, /smoke: partial install repair/)
})
