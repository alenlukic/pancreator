import assert from 'node:assert/strict'
import {
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

import {
  CURRENT_VERSION,
  type InstallMarker,
  git,
  makeSkeletonProject,
  readJson,
  runInstaller,
} from './install-helpers.js'

test('embedded installer creates a runnable-layout harness under .pancreator', () => {
  const project = makeSkeletonProject()

  try {
    // A non-git target keeps its own ignore file byte-identical: the
    // installer never writes a target .gitignore in any installation mode.
    writeFileSync(path.join(project, '.gitignore'), 'node_modules/')

    const result = runInstaller(project)

    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.stdout.includes(`Pancreator ${CURRENT_VERSION} installed`))
    assert.equal(existsSync(path.join(project, 'config.json')), false)
    assert.equal(
      readFileSync(path.join(project, '.gitignore'), 'utf8'),
      'node_modules/',
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
    // The browser contract installs as a rule generated from BROWSER-001, so the
    // policy travels in the payload and no hand-written rule template exists.
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

    const browserRule = path.join(
      project,
      '.cursor',
      'rules',
      'pan-browser-isolation.mdc',
    )

    assert.equal(existsSync(browserRule), true)
    assert.match(readFileSync(browserRule, 'utf8'), /BROWSER-001/u)
    assert.match(readFileSync(browserRule, 'utf8'), /alwaysApply:\s*true/u)
    assert.equal(
      existsSync(
        path.join(
          project,
          '.pancreator',
          'library',
          'operator-briefs',
          'primitives.json',
        ),
      ),
      true,
    )
    assert.equal(
      existsSync(
        path.join(
          project,
          '.pancreator',
          'library',
          'schemas',
          'operator-brief.schema.json',
        ),
      ),
      true,
    )
    assert.equal(
      existsSync(path.join(project, '.pancreator', 'docs', 'operator-briefs')),
      false,
    )
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
      existsSync(path.join(project, '.cursor', 'agents', 'pan-librarian.md')),
      true,
    )

    const repairCommand = readFileSync(
      path.join(project, '.cursor', 'commands', 'pan-repair.md'),
      'utf8',
    )
    assert.match(repairCommand, /harness-technician/u)
    assert.match(repairCommand, /\.pancreator\/runtime\/inbox/u)
    assert.match(repairCommand, /--kind repair/u)
    assert.equal(
      existsSync(
        path.join(project, '.cursor', 'agents', 'pan-harness-technician.md'),
      ),
      true,
    )

    const summarizeContextCommand = readFileSync(
      path.join(project, '.cursor', 'commands', 'pan-summarize-context.md'),
      'utf8',
    )
    assert.match(summarizeContextCommand, /exactly one fenced Markdown block/u)
    assert.match(summarizeContextCommand, /fresh conversation/u)

    const buildBriefsCommand = readFileSync(
      path.join(project, '.cursor', 'commands', 'pan-build-briefs.md'),
      'utf8',
    )
    assert.match(buildBriefsCommand, /\.\/\.pancreator\/bin\/pan briefs build/u)
    assert.match(
      buildBriefsCommand,
      /\.pancreator\/docs\/operator-briefs\/project\.json/u,
    )
    assert.match(
      buildBriefsCommand,
      /\.pancreator\/library\/operator-briefs\/primitives\.json/u,
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
    // The command supervises the run itself, so it must forbid the nested
    // relay rather than describe one.
    assert.match(command, /MUST NOT launch the `pan-orchestrator` subagent/u)
    assert.match(command, /\.pancreator\/runtime\/inbox/)
    assert.match(command, /runtime\/inbox\/request-<id>\.md/)

    const orchestratorAgent = readFileSync(
      path.join(project, '.cursor', 'agents', 'pan-orchestrator.md'),
      'utf8',
    )
    assert.match(orchestratorAgent, /\.\/\.pancreator\/bin\/pan/)
    assert.match(orchestratorAgent, /MUST NOT supervise best-of-N candidates/u)
    // Run-relative records are resolved from the active card rather than named
    // as a literal, so the projection has no run subdirectory to rewrite.
    assert.doesNotMatch(orchestratorAgent, /runtime\/logs\/workflows/u)

    // The supervisor brief owns the delivery contract, because `/pan-start` and
    // the best-of-N agent both adopt it rather than restate it.
    const supervisorBrief = readFileSync(
      path.join(
        project,
        '.pancreator',
        'library',
        'personas',
        'orchestrator.md',
      ),
      'utf8',
    )
    assert.match(supervisorBrief, /the paths it prints/u)

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
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded and detached installs prepare the current worktrees root', () => {
  const project = makeSkeletonProject()
  const harness = mkdtempSync(
    path.join(tmpdir(), 'pancreator-detached-harness-'),
  )

  try {
    const embedded = runInstaller(project)
    assert.equal(embedded.status, 0, embedded.stderr)
    assert.equal(
      existsSync(path.join(project, '.pancreator', 'worktrees')),
      true,
    )

    const legacyMarker = path.join(
      project,
      '.pancreator',
      'runtime',
      'worktrees',
      'operator',
      'legacy-note.txt',
    )
    mkdirSync(path.dirname(legacyMarker), { recursive: true })
    writeFileSync(legacyMarker, 'legacy bytes\n')
    const beforeRefresh = readFileSync(legacyMarker, 'utf8')

    const refresh = runInstaller(project, ['--yes'])
    assert.equal(refresh.status, 0, refresh.stderr)
    assert.equal(readFileSync(legacyMarker, 'utf8'), beforeRefresh)

    const detachedProject = makeSkeletonProject()
    const detached = runInstaller(detachedProject, ['--harness-dir', harness])
    assert.equal(detached.status, 0, detached.stderr)
    assert.equal(existsSync(path.join(harness, 'worktrees')), true)
  } finally {
    rmSync(project, { recursive: true, force: true })
    rmSync(harness, { recursive: true, force: true })
  }
})

test('embedded installer stays out of target git state', () => {
  // One committed repository with a legacy .gitignore and local exclude
  // content, one without any .gitignore; install + refresh each once.
  const legacyProject = makeSkeletonProject()
  const bareProject = makeSkeletonProject()

  try {
    for (const project of [legacyProject, bareProject]) {
      git(project, ['init', '-q'])
      git(project, ['config', 'user.email', 'fixture@example.com'])
      git(project, ['config', 'user.name', 'Fixture'])
    }

    writeFileSync(
      path.join(legacyProject, '.gitignore'),
      'node_modules/\n/.pancreator/\n',
    )
    writeFileSync(
      path.join(legacyProject, '.git', 'info', 'exclude'),
      'local-only-pattern\n',
    )

    for (const project of [legacyProject, bareProject]) {
      git(project, ['add', '.'])
      git(project, ['commit', '-qm', 'initial'])
    }

    const gitignoreBefore = readFileSync(
      path.join(legacyProject, '.gitignore'),
      'utf8',
    )
    const bareHead = git(bareProject, ['rev-parse', 'HEAD'])

    const first = runInstaller(legacyProject)
    const second = runInstaller(legacyProject, ['--yes'])

    assert.equal(first.status, 0, first.stderr)
    assert.equal(second.status, 0, second.stderr)
    assert.match(first.stdout, /Legacy Pancreator ignore entry detected/)
    assert.equal(
      readFileSync(path.join(legacyProject, '.gitignore'), 'utf8'),
      gitignoreBefore,
    )

    // Unrelated exclude content survives, and a refresh MUST NOT duplicate
    // the managed block.
    const legacyExclude = readFileSync(
      path.join(legacyProject, '.git', 'info', 'exclude'),
      'utf8',
    )

    assert.match(legacyExclude, /^local-only-pattern$/mu)
    assert.equal(legacyExclude.match(/# >>> pancreator >>>/gu)?.length, 1)
    assert.match(legacyExclude, /^\/\.pancreator\/$/mu)
    assert.equal(git(legacyProject, ['status', '--porcelain']), '')

    assert.equal(runInstaller(bareProject).status, 0)
    assert.equal(runInstaller(bareProject, ['--yes']).status, 0)

    // The installation is invisible to the repository: no tracked file
    // changed, nothing untracked was introduced, no commit was created, and
    // no .gitignore was ever written.
    assert.equal(git(bareProject, ['status', '--porcelain']), '')
    assert.equal(git(bareProject, ['rev-parse', 'HEAD']), bareHead)
    assert.equal(existsSync(path.join(bareProject, '.gitignore')), false)

    // The exclusions live only in the clone-local, never-committed file.
    const bareExclude = readFileSync(
      path.join(bareProject, '.git', 'info', 'exclude'),
      'utf8',
    )

    assert.equal(bareExclude.match(/# >>> pancreator >>>/gu)?.length, 1)
    assert.match(bareExclude, /^\/\.pancreator\/$/mu)
    assert.match(bareExclude, /^\/\.cursor\/agents\/pan-\*\.md$/mu)
  } finally {
    rmSync(legacyProject, { recursive: true, force: true })
    rmSync(bareProject, { recursive: true, force: true })
  }
})

test('embedded installer does not hide target-owned Cursor files from git', () => {
  const project = makeSkeletonProject()

  try {
    git(project, ['init', '-q'])
    git(project, ['config', 'user.email', 'fixture@example.com'])
    git(project, ['config', 'user.name', 'Fixture'])

    mkdirSync(path.join(project, '.cursor', 'agents'), { recursive: true })
    writeFileSync(
      path.join(project, '.cursor', 'agents', 'coder.md'),
      'target-authored coder\n',
    )

    assert.equal(runInstaller(project).status, 0)

    // The target's own agent stays visible to its operators; only Pancreator's
    // namespaced projection is excluded.
    const status = git(project, [
      'status',
      '--porcelain',
      '--untracked-files=all',
    ])

    assert.match(status, /\.cursor\/agents\/coder\.md/u)
    assert.doesNotMatch(status, /pan-coder\.md/u)
    assert.doesNotMatch(status, /\.pancreator/u)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer warns on existing Cursor state, preserves custom files, and backs up conflicts', () => {
  const project = makeSkeletonProject()

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

    const result = runInstaller(project)

    assert.equal(result.status, 0, result.stderr)
    assert.match(
      result.stdout,
      /Existing agentic harness configuration detected/,
    )
    assert.match(result.stdout, /retained {2}\.cursor\/rules\/custom\.mdc/)
    // pan-coder.md squats on Pancreator's namespace, so it is reported as a
    // takeover rather than silently replaced.
    assert.match(result.stdout, /replaced {2}\.cursor\/agents\/pan-coder\.md/)
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
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer leaves target-owned agents and rules untouched', () => {
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
    writeFileSync(targetCoder, 'target-authored coder\n')
    writeFileSync(targetRule, 'target-authored browser rule\n')

    const result = runInstaller(project)

    assert.equal(result.status, 0, result.stderr)

    // The target's own agentic configuration MUST survive byte-identical.
    assert.equal(readFileSync(targetCoder, 'utf8'), 'target-authored coder\n')
    assert.equal(
      readFileSync(targetRule, 'utf8'),
      'target-authored browser rule\n',
    )

    // Pancreator's equivalents install alongside under the pan namespace.
    assert.equal(
      existsSync(path.join(project, '.cursor', 'agents', 'pan-coder.md')),
      true,
    )
    assert.equal(
      existsSync(
        path.join(project, '.cursor', 'rules', 'pan-browser-isolation.mdc'),
      ),
      true,
    )

    // Nothing was displaced, so nothing should have been backed up.
    assert.equal(
      existsSync(path.join(project, '.pancreator', 'backups', 'cursor')),
      false,
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
