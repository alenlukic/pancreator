import assert from 'node:assert/strict'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  CURRENT_VERSION,
  type InstallMarker,
  git,
  gitInit,
  installedProjectTemplate,
  makeSkeletonProject,
  readJson,
  runInstaller,
} from './install-helpers.js'

// The shared installed template IS the fresh install every other test clones,
// so its layout is asserted here without another installer run. Layout facts
// that `bin/install --smoke` (in the `full` repository-check profile; this
// lane itself runs under `secondary` and `full`) already verifies are not
// repeated.
test('embedded installer creates a runnable-layout harness under .pancreator', () => {
  const project = installedProjectTemplate()

  assert.equal(existsSync(path.join(project, 'config.json')), false)
  // The harness review lineup is self-development-only: the installer strips
  // it from staging while the core squad skill still ships.
  assert.equal(
    existsSync(
      path.join(
        project,
        '.pancreator/library/skills/review-squad-pancreator.md',
      ),
    ),
    false,
  )
  assert.equal(
    existsSync(
      path.join(project, '.pancreator/library/skills/review-squad.md'),
    ),
    true,
  )

  const config = readJson<{
    schema_version: number
    workspace_id: string
    workspace_root: string
    state_root: string
    installation_mode: string
    active_config: string
    defaults: Record<string, string>
    configs: Record<string, { personas: Record<string, string> }>
  }>(path.join(project, '.pancreator', 'config.json'))

  assert.equal(config.schema_version, 1)
  assert.equal(config.workspace_root, '..')
  assert.equal(config.state_root, 'runtime')
  assert.equal(config.installation_mode, 'embedded')
  assert.ok(config.workspace_id.length > 0)

  // Named configurations never duplicate a default mapping.
  for (const namedConfig of Object.values(config.configs)) {
    for (const [persona, defaultModel] of Object.entries(config.defaults)) {
      assert.notEqual(namedConfig.personas[persona], defaultModel)
    }
  }

  const harnessTechnicianModel = config.defaults['harness-technician']

  assert.equal(typeof harnessTechnicianModel, 'string')
  assert.ok(
    readFileSync(
      path.join(project, '.cursor', 'agents', 'pan-harness-technician.md'),
      'utf8',
    ).includes(`model: ${harnessTechnicianModel}`),
  )

  // The symlink is relative, which is what makes the installed tree portable.
  const link = path.join(project, '.pancreator', '.cursor')

  assert.equal(lstatSync(link).isSymbolicLink(), true)
  assert.equal(existsSync(path.join(project, '.pancreator', 'src')), true)

  // The browser contract installs as a rule generated from BROWSER-001, so the
  // policy travels in the payload and the always-apply rule names it.
  assert.equal(
    existsSync(
      path.join(
        project,
        '.pancreator',
        'governance',
        'policies',
        'BROWSER-001.json',
      ),
    ),
    true,
  )

  const browserRule = readFileSync(
    path.join(project, '.cursor', 'rules', 'pan-browser-isolation.mdc'),
    'utf8',
  )

  assert.match(browserRule, /BROWSER-001/u)
  assert.match(browserRule, /alwaysApply:\s*true/u)

  const primer = readFileSync(
    path.join(project, '.pancreator', 'docs', 'target-repo-primer.md'),
    'utf8',
  )

  assert.match(primer, /pancreator-primer-status: unbuilt/u)

  const repositoryChecks = readJson<{
    schema_version: number
    profiles: Record<string, { commands: string[] }>
  }>(path.join(project, '.pancreator', 'runtime', 'repository-checks.json'))

  assert.equal(repositoryChecks.schema_version, 1)
  assert.deepEqual(repositoryChecks.profiles.static?.commands, [])
  assert.deepEqual(repositoryChecks.profiles.secondary?.commands, [])
  assert.deepEqual(repositoryChecks.profiles.full?.commands, [])

  // Embedded projection rewrites harness paths to the `.pancreator` prefix.
  for (const [command, patterns] of [
    [
      'pan-build-docs.md',
      [
        /\.\/\.pancreator\/bin\/pan/u,
        /\.pancreator\/docs\/target-repo-primer\.md/u,
      ],
    ],
    [
      'pan-repair.md',
      [
        /harness-technician/u,
        /\.pancreator\/runtime\/inbox/u,
        /--kind repair/u,
      ],
    ],
    [
      'pan-write-pr.md',
      [
        /\.pancreator\/library\/skills\/write-pr-description\.md/u,
        /\.pancreator\/docs\/target-repo-primer\.md/u,
        /\.pancreator\/runtime\/pr-descriptions/u,
      ],
    ],
    ['pan-start.md', [/\.pancreator\/runtime\/inbox/u]],
  ] as const) {
    const body = readFileSync(
      path.join(project, '.cursor', 'commands', command),
      'utf8',
    )

    for (const pattern of patterns) {
      assert.match(body, pattern, `${command} MUST match ${String(pattern)}`)
    }
  }

  assert.equal(
    existsSync(path.join(project, '.cursor', 'agents', 'pan-librarian.md')),
    true,
  )

  const orchestratorAgent = readFileSync(
    path.join(project, '.cursor', 'agents', 'pan-orchestrator.md'),
    'utf8',
  )

  assert.match(orchestratorAgent, /\.\/\.pancreator\/bin\/pan/)
  // Run-relative records are resolved from the active card rather than named
  // as a literal, so the projection has no run subdirectory to rewrite.
  assert.doesNotMatch(orchestratorAgent, /runtime\/logs\/workflows/u)

  // Nothing was displaced on a bare skeleton, so nothing was backed up.
  assert.equal(
    existsSync(path.join(project, '.pancreator', 'backups', 'cursor')),
    false,
  )

  const marker = readJson<InstallMarker>(
    path.join(project, '.pancreator', 'install.json'),
  )

  assert.equal(marker.schema_version, 4)
  assert.equal(marker.version, CURRENT_VERSION)
  assert.equal(typeof marker.source_dirty, 'boolean')
  assert.equal(typeof marker.source_indexed, 'boolean')
  assert.equal(marker.source_dirty && marker.source_indexed, false)
  assert.equal('source_root' in marker, false)
  assert.equal('target_root' in marker, false)
  assert.ok(marker.payload_entries.includes('governance'))
  assert.ok(marker.payload_entries.includes('release'))
  // The payload manifest describes release-owned files so later updates can
  // separate local fixes and target extensions from shipped content.
  assert.ok(
    marker.payload_files.some(
      (entry) =>
        entry.path === 'docs/runtime-protocol.md' &&
        /^[0-9a-f]{64}$/u.test(entry.sha256),
    ),
  )
  assert.equal(
    marker.payload_files.some((entry) => entry.path.startsWith('dist/')),
    false,
  )
  assert.ok(
    marker.cursor_files.some((entry) => entry.path.endsWith('coder.md')),
  )
})

// What exists before the first install is the condition under test here (a
// committed repository with a legacy ignore entry, local exclude content, and a
// target-owned agent), so this cannot start from the template. `--smoke`
// covers the bare git target: exclude rule, no .gitignore created, clean status.
test('embedded installer stays out of target git state', () => {
  const project = makeSkeletonProject()

  try {
    gitInit(project)
    writeFileSync(
      path.join(project, '.gitignore'),
      'node_modules/\n/.pancreator/\n',
    )
    writeFileSync(
      path.join(project, '.git', 'info', 'exclude'),
      'local-only-pattern\n',
    )
    mkdirSync(path.join(project, '.cursor', 'agents'), { recursive: true })
    writeFileSync(
      path.join(project, '.cursor', 'agents', 'coder.md'),
      'target-authored coder\n',
    )
    git(project, ['add', 'README.md', '.gitignore'])
    git(project, ['commit', '-qm', 'initial'])

    const gitignoreBefore = readFileSync(
      path.join(project, '.gitignore'),
      'utf8',
    )
    const head = git(project, ['rev-parse', 'HEAD'])

    const first = runInstaller(project)
    const second = runInstaller(project, ['--yes'])

    assert.equal(first.status, 0, first.stderr)
    assert.equal(second.status, 0, second.stderr)
    assert.match(first.stdout, /Legacy Pancreator ignore entry detected/)
    assert.equal(
      readFileSync(path.join(project, '.gitignore'), 'utf8'),
      gitignoreBefore,
    )
    assert.equal(git(project, ['rev-parse', 'HEAD']), head)

    // Unrelated exclude content survives, and a refresh MUST NOT duplicate
    // the managed block.
    const exclude = readFileSync(
      path.join(project, '.git', 'info', 'exclude'),
      'utf8',
    )

    assert.match(exclude, /^local-only-pattern$/mu)
    assert.equal(exclude.match(/# >>> pancreator >>>/gu)?.length, 1)
    assert.match(exclude, /^\/\.pancreator\/$/mu)
    assert.match(exclude, /^\/\.cursor\/agents\/pan-\*\.md$/mu)

    // The target's own untracked agent stays visible to its operators; only
    // Pancreator's namespaced projection and payload are excluded.
    const status = git(project, [
      'status',
      '--porcelain',
      '--untracked-files=all',
    ])

    assert.match(status, /\.cursor\/agents\/coder\.md/u)
    assert.doesNotMatch(status, /pan-coder\.md/u)
    assert.doesNotMatch(status, /\.pancreator/u)
    assert.doesNotMatch(status, /^ ?M /mu)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

// Pre-seeded Cursor state is the condition under test, so this needs its own
// install. `--smoke` covers "a custom rule survives"; the unique cases here are
// the namespace squat that is replaced and backed up, and target-owned files
// whose pan- counterparts install alongside.
test('embedded installer warns on existing Cursor state, preserves custom files, and backs up conflicts', () => {
  const project = makeSkeletonProject()
  const targetCoder = path.join(project, '.cursor', 'agents', 'coder.md')
  const targetRule = path.join(
    project,
    '.cursor',
    'rules',
    'browser-isolation.mdc',
  )

  try {
    mkdirSync(path.join(project, '.cursor', 'agents'), { recursive: true })
    mkdirSync(path.join(project, '.cursor', 'rules'), { recursive: true })
    writeFileSync(
      path.join(project, '.cursor', 'agents', 'pan-coder.md'),
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
    writeFileSync(targetCoder, 'target-authored coder\n')
    writeFileSync(targetRule, 'target-authored browser rule\n')

    const result = runInstaller(project)

    assert.equal(result.status, 0, result.stderr)
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

    // The target's own agentic configuration survives byte-identical while
    // Pancreator's equivalents install under the pan namespace.
    assert.equal(readFileSync(targetCoder, 'utf8'), 'target-authored coder\n')
    assert.equal(
      readFileSync(targetRule, 'utf8'),
      'target-authored browser rule\n',
    )
    assert.equal(
      existsSync(
        path.join(project, '.cursor', 'rules', 'pan-browser-isolation.mdc'),
      ),
      true,
    )

    // pan-coder.md squats on Pancreator's namespace: it is replaced and the
    // displaced content is backed up.
    assert.notEqual(
      readFileSync(
        path.join(project, '.cursor', 'agents', 'pan-coder.md'),
        'utf8',
      ),
      'custom coder\n',
    )

    const backupBase = path.join(project, '.pancreator', 'backups', 'cursor')
    const backupRuns = readdirSync(backupBase)

    assert.equal(backupRuns.length, 1)
    assert.equal(
      readFileSync(
        path.join(
          backupBase,
          backupRuns[0],
          '.cursor',
          'agents',
          'pan-coder.md',
        ),
        'utf8',
      ),
      'custom coder\n',
    )

    const marker = readJson<InstallMarker>(
      path.join(project, '.pancreator', 'install.json'),
    )

    for (const entry of marker.cursor_files) {
      assert.match(path.basename(entry.path), /^pan(-|creator\.)/u)
    }
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})
