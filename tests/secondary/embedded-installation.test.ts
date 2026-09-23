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
  parsePipelineConfig,
  resolveConfigPersonas,
} from '../../src/lib/pipeline-config.js'
import {
  RELEASE_FIXTURE_VERSION,
  type InstallMarker,
  git,
  gitInit,
  installedProjectTemplate,
  makeSkeletonProject,
  readJson,
  run,
  runInstaller,
} from './install-helpers.js'

test('embedded installer creates a runnable-layout harness under .pancreator', () => {
  const project = installedProjectTemplate()

  assert.equal(existsSync(path.join(project, 'config.json')), false)
  // The installer strips the self-development-only harness lineup from staging
  // but still ships the core squad skill.
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
    configs: Record<string, Record<string, unknown>>
  }>(path.join(project, '.pancreator', 'config.json'))

  assert.equal(config.schema_version, 1)
  assert.equal(config.workspace_root, '..')
  assert.equal(config.state_root, 'runtime')
  assert.equal(config.installation_mode, 'embedded')
  assert.ok(config.workspace_id.length > 0)

  // Named configurations never duplicate a default mapping.
  for (const namedConfig of Object.values(config.configs)) {
    assert.equal(
      typeof (namedConfig as Record<string, unknown>).personas,
      'undefined',
      'embedded config.json MUST use the flat mapping shape',
    )

    for (const [persona, defaultModel] of Object.entries(config.defaults)) {
      const value = (namedConfig as Record<string, unknown>)[persona]

      if (value !== undefined) {
        assert.notEqual(value, defaultModel)
      }
    }
  }

  const parsedConfig = parsePipelineConfig(config, 'installed config.json')
  const projectedHarnessTechnicianModel = resolveConfigPersonas(
    parsedConfig,
    parsedConfig.active_config,
  )['harness-technician']

  assert.ok(
    readFileSync(
      path.join(project, '.cursor', 'agents', 'pan-harness-technician.md'),
      'utf8',
    ).includes(`model: ${projectedHarnessTechnicianModel}`),
  )

  // A relative symlink keeps the installed tree portable.
  const link = path.join(project, '.pancreator', '.cursor')

  assert.equal(lstatSync(link).isSymbolicLink(), true)
  assert.equal(existsSync(path.join(project, '.pancreator', 'src')), true)

  // The harness suite covers Pancreator internals a target never changes, so
  // neither its sources nor its compiled output belong in an installation.
  assert.equal(existsSync(path.join(project, '.pancreator', 'tests')), false)
  assert.equal(
    existsSync(path.join(project, '.pancreator', 'dist', 'tests')),
    false,
  )

  const installedPackage = readJson<{
    scripts: Record<string, string>
  }>(path.join(project, '.pancreator', 'package.json'))
  const installedScripts = Object.keys(installedPackage.scripts)

  assert.equal(
    installedScripts.some(
      (name) => name === 'test' || name.startsWith('test:'),
    ),
    false,
  )
  assert.ok(installedPackage.scripts.build)
  assert.ok(installedPackage.scripts.check)
  assert.ok(installedPackage.scripts.lint)
  assert.ok(installedPackage.scripts.validate)
  assert.equal(
    existsSync(
      path.join(project, '.pancreator', 'target-extensions', '.gitkeep'),
    ),
    true,
  )
  assert.deepEqual(
    readdirSync(path.join(project, '.pancreator', 'target-extensions')),
    ['.gitkeep'],
  )

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

  const chatRule = readFileSync(
    path.join(project, '.cursor', 'rules', 'pan-chat-output.mdc'),
    'utf8',
  )

  assert.match(chatRule, /COMMS-001/u)
  assert.match(chatRule, /alwaysApply:\s*true/u)

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

  const doctor = run(
    process.execPath,
    [path.join(project, '.pancreator', 'dist', 'src', 'cli.js'), 'doctor'],
    path.join(project, '.pancreator'),
  )

  assert.equal(doctor.status, 0, `${doctor.stdout}\n${doctor.stderr}`)

  const doctorReport = JSON.parse(doctor.stdout) as {
    validation: {
      ok: boolean
      errors: string[]
      warnings: string[]
    }
  }

  assert.equal(doctorReport.validation.ok, true)
  assert.deepEqual(doctorReport.validation.errors, [])
  assert.deepEqual(doctorReport.validation.warnings, [])

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
    [
      'pan-horizon.md',
      [
        /horizon init --queue <path>/u,
        /horizon start <session-id> --attest-supervisor-card/u,
        /\.\/\.pancreator\/bin\/pan/u,
      ],
    ],
    [
      'pan-author.md',
      [
        /governance card --mode author/u,
        /author apply --input runtime\/inbox\/target-authoring/u,
      ],
    ],
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
  // The agent resolves run-relative records from the active card, so the
  // projection has no run subdirectory to rewrite.
  assert.doesNotMatch(orchestratorAgent, /runtime\/logs\/workflows/u)

  // A bare skeleton displaces nothing, so the installer takes no backup.
  assert.equal(
    existsSync(path.join(project, '.pancreator', 'backups', 'cursor')),
    false,
  )

  const marker = readJson<InstallMarker>(
    path.join(project, '.pancreator', 'install.json'),
  )

  assert.equal(marker.schema_version, 4)
  assert.equal(marker.version, RELEASE_FIXTURE_VERSION)
  assert.equal(typeof marker.source_dirty, 'boolean')
  assert.equal(typeof marker.source_indexed, 'boolean')
  assert.equal(marker.source_dirty && marker.source_indexed, false)
  assert.equal('source_root' in marker, false)
  assert.equal('target_root' in marker, false)
  assert.ok(marker.payload_entries.includes('governance'))
  assert.ok(marker.payload_entries.includes('release'))
  assert.equal(marker.payload_entries.includes('tests'), false)
  // The manifest lists release-owned files so an update can separate local
  // fixes and target extensions from shipped content.
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

test('installed review scope reports its untracked closure', () => {
  const project = makeSkeletonProject()

  try {
    gitInit(project)
    git(project, ['add', 'README.md'])
    git(project, ['commit', '-qm', 'initial'])

    const base = git(project, ['rev-parse', 'HEAD'])
    const install = runInstaller(project)

    assert.equal(install.status, 0, install.stderr)
    assert.equal(git(project, ['ls-files', '--', '.pancreator']), '')

    writeFileSync(
      path.join(project, 'README.md'),
      '# skeleton\n\nTarget revision.\n',
    )
    git(project, ['add', 'README.md'])
    git(project, ['commit', '-qm', 'change target'])

    const head = git(project, ['rev-parse', 'HEAD'])
    // Run the installed compiled CLI directly, as the doctor case above does.
    // A `--skip-dependencies` install carries no toolchain of its own, so the
    // installed `bin/pan` wrapper can rebuild only through whatever `tsc` the
    // parent process happens to have on PATH; the contract here is the
    // installed command's answer, not the wrapper's build step.
    const scopeCommand = run(
      process.execPath,
      [
        path.join(project, '.pancreator', 'dist', 'src', 'cli.js'),
        'governance',
        'review-scope',
        '--target',
        head,
        '--base',
        base,
        '--json',
      ],
      path.join(project, '.pancreator'),
    )

    assert.equal(
      scopeCommand.status,
      0,
      `${scopeCommand.stdout}\n${scopeCommand.stderr}`,
    )
    assert.doesNotMatch(
      `${scopeCommand.stdout}\n${scopeCommand.stderr}`,
      /REVIEW_CLOSURE_REVISION_MISMATCH/u,
    )

    const scope = JSON.parse(scopeCommand.stdout) as {
      base: string
      head: string
      closure_tracking: string
      closure_revision: string | null
      changed_path_count: number
    }

    assert.equal(scope.base, base)
    assert.equal(scope.head, head)
    assert.equal(scope.closure_tracking, 'untracked')
    assert.equal(scope.closure_revision, null)
    assert.equal(scope.changed_path_count, 1)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

// The state before the first install is the condition under test, so this test
// cannot start from the shared template.
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

    // The first install creates the integration branch from HEAD without
    // leaving the checked-out branch; the refresh keeps it where it is.
    assert.match(first.stdout, /Created integration branch pan-dev from/u)
    assert.match(second.stdout, /Retained integration branch pan-dev/u)
    assert.equal(git(project, ['rev-parse', 'refs/heads/pan-dev']), head)
    assert.notEqual(
      git(project, ['symbolic-ref', '--short', 'HEAD']),
      'pan-dev',
    )
    assert.equal(
      git(project, ['branch', '--list', 'pan-dev']).trim(),
      'pan-dev',
    )

    // A refresh MUST NOT duplicate the managed block.
    const exclude = readFileSync(
      path.join(project, '.git', 'info', 'exclude'),
      'utf8',
    )

    assert.match(exclude, /^local-only-pattern$/mu)
    assert.equal(exclude.match(/# >>> pancreator >>>/gu)?.length, 1)
    assert.match(exclude, /^\/\.pancreator\/$/mu)
    assert.match(exclude, /^\/\.cursor\/agents\/pan-\*\.md$/mu)

    // Git excludes only the pan- projection and the payload, so the target's
    // own agent stays visible.
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

test('embedded installer merges project hooks and keeps the result byte stable', () => {
  const project = makeSkeletonProject()
  const hooksPath = path.join(project, '.cursor', 'hooks.json')

  try {
    gitInit(project)
    mkdirSync(path.dirname(hooksPath), { recursive: true })
    writeFileSync(
      hooksPath,
      `${JSON.stringify(
        {
          version: 4,
          hooks: {
            beforeSubmitPrompt: [{ command: './target-before-submit' }],
            afterFileEdit: [{ command: './target-after-edit' }],
          },
        },
        null,
        2,
      )}\n`,
    )
    git(project, ['add', 'README.md'])
    git(project, ['commit', '-qm', 'initial'])

    const first = runInstaller(project)

    assert.equal(first.status, 0, first.stderr)

    const firstContent = readFileSync(hooksPath, 'utf8')
    const hooks = JSON.parse(firstContent) as {
      version: number
      hooks: Record<string, Array<{ command: string }>>
    }

    assert.equal(hooks.version, 4)
    assert.deepEqual(hooks.hooks.afterFileEdit, [
      { command: './target-after-edit' },
    ])
    assert.deepEqual(
      hooks.hooks.beforeSubmitPrompt?.map((entry) => entry.command),
      [
        './target-before-submit',
        '.pancreator/bin/pan-hook-governance-reminder',
      ],
    )

    const second = runInstaller(project, ['--yes'])

    assert.equal(second.status, 0, second.stderr)
    assert.equal(readFileSync(hooksPath, 'utf8'), firstContent)

    const exclude = readFileSync(
      path.join(project, '.git', 'info', 'exclude'),
      'utf8',
    )

    assert.match(exclude, /^\/\.cursor\/hooks\.json$/mu)
    assert.match(exclude, /^\/\.cursor\/hooks\/state\/$/mu)
    assert.equal(git(project, ['status', '--porcelain']), '')
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer reports and preserves a tracked project hooks file', () => {
  const project = makeSkeletonProject()
  const hooksPath = path.join(project, '.cursor', 'hooks.json')

  try {
    gitInit(project)
    mkdirSync(path.dirname(hooksPath), { recursive: true })
    writeFileSync(
      hooksPath,
      '{"version":1,"hooks":{"beforeSubmitPrompt":[{"command":"./target"}]}}\n',
    )
    git(project, ['add', 'README.md', '.cursor/hooks.json'])
    git(project, ['commit', '-qm', 'tracked hooks'])
    const before = readFileSync(hooksPath, 'utf8')

    const result = runInstaller(project)

    assert.equal(result.status, 0, result.stderr)
    assert.match(
      result.stdout,
      /Readiness gap: target tracks \.cursor\/hooks\.json/u,
    )
    assert.equal(readFileSync(hooksPath, 'utf8'), before)
    assert.equal(git(project, ['status', '--porcelain']), '')
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

// Pre-seeded Cursor state is the condition under test, so this test needs its
// own install.
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
    assert.equal(
      existsSync(path.join(project, '.cursor', 'rules', 'pan-chat-output.mdc')),
      true,
    )

    // pan-coder.md squats on the pan namespace, so the installer replaces it
    // and backs up the displaced content.
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
      assert.ok(
        /^pan(-|creator\.)/u.test(path.basename(entry.path)) ||
          entry.path === '.cursor/hooks.json',
        entry.path,
      )
    }
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})
