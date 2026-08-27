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
  payload_files: Array<{ path: string; sha256: string }>
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
  return run(INSTALLER, [
    '--target',
    project,
    '--skip-dependencies',
    '--skip-shell-alias',
    ...args,
  ])
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
    'config.json',
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

  // The tracked config.json blanks its model values; the effective specs live
  // in the untracked overrides file, which a real operator checkout carries.
  if (existsSync(path.join(REPO_ROOT, 'config_overrides.json'))) {
    cpSync(
      path.join(REPO_ROOT, 'config_overrides.json'),
      path.join(fixture, 'config_overrides.json'),
    )
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
    assert.equal(existsSync(path.join(project, 'config.json')), false)

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

test('detached installer places the harness outside the target tree', () => {
  const project = makeSkeletonProject()
  const harness = mkdtempSync(path.join(tmpdir(), 'pancreator-harness-'))

  try {
    git(project, ['init', '-q'])
    git(project, ['config', 'user.email', 'fixture@example.com'])
    git(project, ['config', 'user.name', 'Fixture'])
    git(project, ['add', '.'])
    git(project, ['commit', '-qm', 'initial'])

    const result = runInstaller(project, ['--harness-dir', harness])

    assert.equal(result.status, 0, result.stderr)

    // The harness is outside the target; the target has no .pancreator at all.
    assert.equal(existsSync(path.join(harness, 'bin', 'pan')), true)
    assert.equal(existsSync(path.join(project, '.pancreator')), false)

    const config = readJson<{
      workspace_root: string
      state_root: string
      installation_mode: string
    }>(path.join(harness, 'config.json'))

    assert.equal(config.installation_mode, 'detached')
    assert.equal(config.workspace_root, project)
    assert.equal(path.isAbsolute(config.workspace_root), true)
    assert.equal(config.state_root, 'runtime')

    // The Cursor surface still lands in the target so opening it just works.
    assert.equal(
      existsSync(path.join(project, '.cursor', 'agents', 'pan-coder.md')),
      true,
    )

    // Projected content must address the harness absolutely: no relative path
    // from the target can reach it.
    const status = readFileSync(
      path.join(project, '.cursor', 'commands', 'pan-status.md'),
      'utf8',
    )

    assert.ok(status.includes(path.join(harness, 'bin', 'pan')))
    assert.doesNotMatch(status, /\.pancreator\/bin\/pan/u)

    // The runtime reaches the Cursor surface through an absolute symlink.
    const link = path.join(harness, '.cursor')

    assert.equal(lstatSync(link).isSymbolicLink(), true)
    assert.equal(existsSync(path.join(link, 'agents', 'pan-coder.md')), true)

    // Runtime state lives with the harness, not the target.
    assert.equal(existsSync(path.join(harness, 'runtime', 'inbox')), true)

    // The target repository is left untouched.
    assert.equal(git(project, ['status', '--porcelain']), '')

    const exclude = readFileSync(
      path.join(project, '.git', 'info', 'exclude'),
      'utf8',
    )

    // Nothing sits at .pancreator/, so that rule must not be emitted.
    assert.doesNotMatch(exclude, /^\/\.pancreator\/$/mu)
    assert.match(exclude, /^\/\.cursor\/agents\/pan-\*\.md$/mu)
  } finally {
    rmSync(project, { recursive: true, force: true })
    rmSync(harness, { recursive: true, force: true })
  }
})

test('detached installer refuses a harness inside the target', () => {
  const project = makeSkeletonProject()

  try {
    const result = runInstaller(project, [
      '--harness-dir',
      path.join(project, 'nested', 'harness'),
    ])

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /MUST be outside the target repository/)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('detached installation refreshes idempotently', () => {
  const project = makeSkeletonProject()
  const harness = mkdtempSync(path.join(tmpdir(), 'pancreator-harness-'))

  try {
    assert.equal(runInstaller(project, ['--harness-dir', harness]).status, 0)

    const refresh = runInstaller(project, ['--harness-dir', harness, '--yes'])

    assert.equal(refresh.status, 0, refresh.stderr)
    assert.match(refresh.stdout, /Installation refresh completed/)

    const config = readJson<{
      workspace_root: string
      installation_mode: string
    }>(path.join(harness, 'config.json'))

    assert.equal(config.installation_mode, 'detached')
    assert.equal(config.workspace_root, project)
  } finally {
    rmSync(project, { recursive: true, force: true })
    rmSync(harness, { recursive: true, force: true })
  }
})

test('detached installation preserves target authority and scoped precedence', () => {
  const project = makeSkeletonProject()
  const harness = mkdtempSync(path.join(tmpdir(), 'pancreator-harness-'))

  try {
    git(project, ['init', '-q'])
    git(project, ['config', 'user.email', 'fixture@example.com'])
    git(project, ['config', 'user.name', 'Fixture'])

    const targetAgents = path.join(project, 'AGENTS.md')
    const targetRule = path.join(
      project,
      '.cursor',
      'rules',
      'typescript-semicolons.mdc',
    )
    const targetAgent = path.join(project, '.cursor', 'agents', 'coder.md')

    writeFileSync(
      targetAgents,
      '# Target agents\n\nAlways terminate TypeScript statements with semicolons.\n',
    )
    mkdirSync(path.dirname(targetRule), { recursive: true })
    writeFileSync(
      targetRule,
      '---\nalwaysApply: true\n---\n\nRequire terminating semicolons in TypeScript files.\n',
    )
    mkdirSync(path.dirname(targetAgent), { recursive: true })
    writeFileSync(
      targetAgent,
      '---\nmodel: target-coder\n---\n\nTarget-owned coder agent.\n',
    )

    git(project, ['add', '.'])
    git(project, ['commit', '-qm', 'initial'])

    const agentsBefore = readFileSync(targetAgents, 'utf8')
    const ruleBefore = readFileSync(targetRule, 'utf8')
    const agentBefore = readFileSync(targetAgent, 'utf8')

    const result = runInstaller(project, ['--harness-dir', harness])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /live target authority/)
    assert.match(result.stdout, /does not modify or remove/)
    assert.doesNotMatch(result.stdout, /does not read/)
    assert.match(result.stdout, /retained {2}AGENTS\.md/)
    assert.match(
      result.stdout,
      /retained {2}\.cursor\/rules\/typescript-semicolons\.mdc/,
    )
    assert.match(result.stdout, /retained {2}\.cursor\/agents\/coder\.md/)

    assert.equal(readFileSync(targetAgents, 'utf8'), agentsBefore)
    assert.equal(readFileSync(targetRule, 'utf8'), ruleBefore)
    assert.equal(readFileSync(targetAgent, 'utf8'), agentBefore)

    assert.equal(
      existsSync(path.join(project, '.cursor', 'agents', 'pan-coder.md')),
      true,
    )
    assert.equal(existsSync(path.join(project, '.pancreator')), false)

    const harnessAgents = readFileSync(path.join(harness, 'AGENTS.md'), 'utf8')
    const projectedRule = readFileSync(
      path.join(project, '.cursor', 'rules', 'pancreator.mdc'),
      'utf8',
    )

    assert.match(harnessAgents, /Detached Pancreator operating card/)
    assert.match(harnessAgents, /absolute `workspace_root`/)
    assert.match(harnessAgents, /fall back to the target/)
    assert.match(projectedRule, /target policy wins/)
    assert.equal(git(project, ['status', '--porcelain']), '')
  } finally {
    rmSync(project, { recursive: true, force: true })
    rmSync(harness, { recursive: true, force: true })
  }
})

test('detached refresh keeps live target instructions without copied policy', () => {
  const project = makeSkeletonProject()
  const harness = mkdtempSync(path.join(tmpdir(), 'pancreator-harness-'))

  try {
    git(project, ['init', '-q'])
    git(project, ['config', 'user.email', 'fixture@example.com'])
    git(project, ['config', 'user.name', 'Fixture'])

    const targetRule = path.join(
      project,
      '.cursor',
      'rules',
      'typescript-semicolons.mdc',
    )

    mkdirSync(path.dirname(targetRule), { recursive: true })
    writeFileSync(
      targetRule,
      '---\nalwaysApply: true\n---\n\nInitial target rule.\n',
    )
    git(project, ['add', '.'])
    git(project, ['commit', '-qm', 'initial'])

    assert.equal(runInstaller(project, ['--harness-dir', harness]).status, 0)

    writeFileSync(
      targetRule,
      '---\nalwaysApply: true\n---\n\nUpdated target rule after install.\n',
    )
    git(project, ['add', targetRule])
    git(project, ['commit', '-qm', 'update target rule'])

    const ruleAfterChange = readFileSync(targetRule, 'utf8')

    const refresh = runInstaller(project, ['--harness-dir', harness, '--yes'])

    assert.equal(refresh.status, 0, refresh.stderr)
    assert.equal(readFileSync(targetRule, 'utf8'), ruleAfterChange)
    assert.equal(
      existsSync(path.join(harness, 'runtime', 'inbox', 'target-policy.json')),
      false,
    )

    const config = readJson<{
      workspace_root: string
      installation_mode: string
    }>(path.join(harness, 'config.json'))

    assert.equal(config.installation_mode, 'detached')
    assert.equal(config.workspace_root, project)
    assert.match(
      readFileSync(path.join(harness, 'AGENTS.md'), 'utf8'),
      /live target authority/,
    )
    assert.equal(git(project, ['status', '--porcelain']), '')
  } finally {
    rmSync(project, { recursive: true, force: true })
    rmSync(harness, { recursive: true, force: true })
  }
})

test('embedded installer never writes the target gitignore', () => {
  const withGitignore = makeSkeletonProject()
  const withoutGitignore = makeSkeletonProject()

  try {
    writeFileSync(path.join(withGitignore, '.gitignore'), 'node_modules/')

    const first = runInstaller(withGitignore)
    const second = runInstaller(withGitignore, ['--yes'])

    assert.equal(first.status, 0, first.stderr)
    assert.equal(second.status, 0, second.stderr)
    assert.equal(
      readFileSync(path.join(withGitignore, '.gitignore'), 'utf8'),
      'node_modules/',
    )

    const absent = runInstaller(withoutGitignore)

    assert.equal(absent.status, 0, absent.stderr)
    assert.equal(existsSync(path.join(withoutGitignore, '.gitignore')), false)
  } finally {
    rmSync(withGitignore, { recursive: true, force: true })
    rmSync(withoutGitignore, { recursive: true, force: true })
  }
})

test('embedded installer preserves legacy gitignore and unrelated exclude content', () => {
  const project = makeSkeletonProject()

  try {
    git(project, ['init', '-q'])
    git(project, ['config', 'user.email', 'fixture@example.com'])
    git(project, ['config', 'user.name', 'Fixture'])
    writeFileSync(
      path.join(project, '.gitignore'),
      'node_modules/\n/.pancreator/\n',
    )
    writeFileSync(
      path.join(project, '.git', 'info', 'exclude'),
      'local-only-pattern\n',
    )
    git(project, ['add', '.'])
    git(project, ['commit', '-qm', 'initial'])

    const gitignoreBefore = readFileSync(
      path.join(project, '.gitignore'),
      'utf8',
    )

    const first = runInstaller(project)
    const second = runInstaller(project, ['--yes'])

    assert.equal(first.status, 0, first.stderr)
    assert.equal(second.status, 0, second.stderr)
    assert.match(first.stdout, /Legacy Pancreator ignore entry detected/)
    assert.equal(
      readFileSync(path.join(project, '.gitignore'), 'utf8'),
      gitignoreBefore,
    )

    const exclude = readFileSync(
      path.join(project, '.git', 'info', 'exclude'),
      'utf8',
    )

    assert.match(exclude, /^local-only-pattern$/mu)
    assert.equal(exclude.match(/# >>> pancreator >>>/gu)?.length, 1)
    assert.match(exclude, /^\/\.pancreator\/$/mu)
    assert.equal(git(project, ['status', '--porcelain']), '')
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer leaves a git target with no tracked changes', () => {
  const project = makeSkeletonProject()

  try {
    git(project, ['init', '-q'])
    git(project, ['config', 'user.email', 'fixture@example.com'])
    git(project, ['config', 'user.name', 'Fixture'])
    git(project, ['add', '.'])
    git(project, ['commit', '-qm', 'initial'])

    const head = git(project, ['rev-parse', 'HEAD'])

    assert.equal(runInstaller(project).status, 0)
    assert.equal(runInstaller(project, ['--yes']).status, 0)

    // The installation is invisible to the repository: no tracked file changed,
    // nothing untracked was introduced, and no commit was created.
    assert.equal(git(project, ['status', '--porcelain']), '')
    assert.equal(git(project, ['rev-parse', 'HEAD']), head)
    assert.equal(existsSync(path.join(project, '.gitignore')), false)

    // The exclusions live only in the clone-local, never-committed file, and a
    // refresh MUST NOT duplicate the managed block.
    const exclude = readFileSync(
      path.join(project, '.git', 'info', 'exclude'),
      'utf8',
    )

    assert.equal(exclude.match(/# >>> pancreator >>>/gu)?.length, 1)
    assert.match(exclude, /^\/\.pancreator\/$/mu)
    assert.match(exclude, /^\/\.cursor\/agents\/pan-\*\.md$/mu)
  } finally {
    rmSync(project, { recursive: true, force: true })
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

test('embedded installer reclaims un-namespaced agents from a pre-namespace install', () => {
  const project = makeSkeletonProject()
  const legacyAgent = path.join(project, '.cursor', 'agents', 'coder.md')
  const markerPath = path.join(project, '.pancreator', 'install.json')

  try {
    assert.equal(runInstaller(project).status, 0)

    // Reproduce an installation made before agents were namespaced: the old
    // path exists and the marker records Pancreator as its owner.
    const contents = 'pancreator-owned coder\n'

    writeFileSync(legacyAgent, contents)

    const marker = readJson<InstallMarker>(markerPath)

    marker.cursor_files.push({
      path: '.cursor/agents/coder.md',
      sha256: createHash('sha256').update(contents).digest('hex'),
    })
    writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`)

    assert.equal(runInstaller(project, ['--yes']).status, 0)

    // Ownership transfers to the namespaced path and the orphan is reclaimed.
    assert.equal(existsSync(legacyAgent), false)
    assert.equal(
      existsSync(path.join(project, '.cursor', 'agents', 'pan-coder.md')),
      true,
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
    const briefSystemDirectory = path.join(
      project,
      '.pancreator',
      'docs',
      'operator-briefs',
    )
    mkdirSync(briefSystemDirectory, { recursive: true })
    writeFileSync(
      path.join(briefSystemDirectory, 'project.json'),
      '{"target":"custom-registry"}\n',
    )
    writeFileSync(
      path.join(briefSystemDirectory, 'project.css'),
      ':root { --target-token: 1; }\n',
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
    const retiredValidationName = `led${'ger'}-validation.json`
    writeFileSync(path.join(legacyRunDirectory, retiredValidationName), '{}\n')
    writeFileSync(path.join(legacyRunDirectory, 'baseline.json'), '{}\n')
    const retiredStateDirectory = path.join(
      project,
      '.pancreator',
      'runtime',
      'workflows',
      'legacy-run',
    )
    mkdirSync(retiredStateDirectory, { recursive: true })
    writeFileSync(
      path.join(retiredStateDirectory, retiredValidationName),
      '{}\n',
    )
    writeFileSync(path.join(retiredStateDirectory, 'baseline.json'), '{}\n')
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
    const oldRunId = '63379_Jun-22_5f354f23'
    // Prefix migration adds the minute component; suffix migration then
    // replaces the hex fragment with keywords from the run title.
    const migratedOldRunId = '63379_Jun-22-0158_old-run'
    const oldRunDirectory = path.join(
      project,
      '.pancreator',
      'runtime',
      'logs',
      'workflows',
      oldRunId,
    )
    const oldStateDirectory = path.join(
      project,
      '.pancreator',
      'runtime',
      'workflows',
      oldRunId,
    )
    mkdirSync(oldRunDirectory, { recursive: true })
    mkdirSync(oldStateDirectory, { recursive: true })
    writeFileSync(
      path.join(oldRunDirectory, 'state.json'),
      `${JSON.stringify({
        schema_version: 1,
        run_id: oldRunId,
        workflow_slug: 'dev',
        title: 'old run',
        status: 'succeeded',
        pending_action: { type: 'none' },
        stage_history: [],
        attempts: {},
        created_at: '2026-06-22T21:22:54.051Z',
      })}\n`,
    )
    writeFileSync(
      path.join(oldRunDirectory, 'workflow.snapshot.json'),
      '{"stages":[{"slug":"intake"}]}\n',
    )
    writeFileSync(path.join(oldRunDirectory, 'events.jsonl'), '')
    writeFileSync(
      path.join(oldStateDirectory, 'modifications.jsonl'),
      `${JSON.stringify({ run_id: oldRunId })}\n`,
    )

    const result = runInstaller(project, ['--yes'])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Installation refresh completed/)
    // Runtime maintenance standardizes loose inbox names onto the temporal
    // prefix scheme; the content survives under the new name.
    const inboxDirectory = path.join(project, '.pancreator', 'runtime', 'inbox')
    const standardizedRequest = readdirSync(inboxDirectory).find((name) =>
      /^\d+_[A-Z][a-z]{2}-\d{2}-\d{4}_request\.md$/u.test(name),
    )

    assert.ok(standardizedRequest, 'inbox request was not standardized')
    assert.equal(
      readFileSync(path.join(inboxDirectory, standardizedRequest), 'utf8'),
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
    assert.equal(
      readFileSync(path.join(briefSystemDirectory, 'project.json'), 'utf8'),
      '{"target":"custom-registry"}\n',
    )
    assert.equal(
      readFileSync(path.join(briefSystemDirectory, 'project.css'), 'utf8'),
      ':root { --target-token: 1; }\n',
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
      existsSync(path.join(legacyRunDirectory, retiredValidationName)),
      false,
    )
    assert.equal(
      existsSync(path.join(legacyRunDirectory, 'baseline.json')),
      false,
    )
    assert.equal(
      existsSync(path.join(retiredStateDirectory, retiredValidationName)),
      false,
    )
    assert.equal(
      existsSync(path.join(retiredStateDirectory, 'baseline.json')),
      false,
    )
    assert.equal(existsSync(legacyWorkspaceDirectory), false)
    assert.equal(existsSync(oldRunDirectory), false)
    assert.equal(existsSync(oldStateDirectory), false)
    assert.equal(
      existsSync(
        path.join(
          project,
          '.pancreator',
          'runtime',
          'logs',
          'workflows',
          'archive',
          migratedOldRunId,
          'state.json',
        ),
      ),
      true,
    )
    assert.equal(
      existsSync(
        path.join(
          project,
          '.pancreator',
          'runtime',
          'workflows',
          'archive',
          migratedOldRunId,
          'modifications.jsonl',
        ),
      ),
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
          'library',
          'schemas',
          'stage-output.schema.json',
        ),
        'utf8',
      ),
      /workspace_changes/u,
    )
    assert.equal(
      existsSync(path.join(project, '.cursor', 'commands', 'pan-repair.md')),
      true,
    )
    assert.equal(
      existsSync(
        path.join(project, '.cursor', 'agents', 'pan-harness-technician.md'),
      ),
      true,
    )
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer refresh preserves target persona model mappings', () => {
  const project = makeSkeletonProject()
  const customCoderModel = 'operator-custom-coder-model[fast=false]'

  try {
    assert.equal(runInstaller(project).status, 0)

    const configJsonPath = path.join(project, '.pancreator', 'config.json')
    const config = readJson<{
      active_config: string
      configs: Record<string, { personas: Record<string, string> }>
    }>(configJsonPath)

    config.active_config = 'simple'
    config.configs.simple.personas.coder = customCoderModel
    writeFileSync(configJsonPath, `${JSON.stringify(config, null, 2)}\n`)

    const result = runInstaller(project, ['--yes'])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Installation refresh completed/)

    const refreshed = readJson<{
      active_config: string
      configs: Record<string, { personas: Record<string, string> }>
    }>(configJsonPath)

    assert.equal(refreshed.active_config, 'simple')
    assert.equal(refreshed.configs.simple.personas.coder, customCoderModel)

    const coderAgent = readFileSync(
      path.join(project, '.cursor', 'agents', 'pan-coder.md'),
      'utf8',
    )

    assert.ok(coderAgent.includes(`model: ${customCoderModel}`))
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer refresh prunes personas the release no longer ships', () => {
  const project = makeSkeletonProject()
  const customCoderModel = 'operator-custom-coder-model[fast=false]'
  const retiredPersona = 'tech-lead'
  const retiredModel = 'retired-persona-model[fast=false]'

  try {
    assert.equal(runInstaller(project).status, 0)

    const configJsonPath = path.join(project, '.pancreator', 'config.json')
    const config = readJson<{
      defaults: Record<string, string>
      configs: Record<string, { personas: Record<string, string> }>
    }>(configJsonPath)

    // Reproduce an installation that still maps a persona the harness retired.
    config.defaults[retiredPersona] = retiredModel
    config.configs.simple.personas[retiredPersona] = retiredModel
    config.configs.simple.personas.coder = customCoderModel
    writeFileSync(configJsonPath, `${JSON.stringify(config, null, 2)}\n`)

    const result = runInstaller(project, ['--yes'])

    assert.equal(result.status, 0, result.stderr)

    const refreshed = readJson<{
      defaults: Record<string, string>
      configs: Record<string, { personas: Record<string, string> }>
    }>(configJsonPath)

    assert.equal(refreshed.defaults[retiredPersona], undefined)
    assert.equal(
      refreshed.configs.simple.personas[retiredPersona],
      undefined,
      'a retired persona MUST NOT survive a refresh',
    )

    // Pruning MUST NOT disturb a mapping the release still ships.
    assert.equal(refreshed.configs.simple.personas.coder, customCoderModel)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer refresh preserves a target disposition layer', () => {
  const project = makeSkeletonProject()

  try {
    assert.equal(runInstaller(project).status, 0)

    const layerPath = path.join(
      project,
      '.pancreator',
      'governance',
      'registries',
      'context_bloat_dispositions.d',
      'target-layer.json',
    )

    mkdirSync(path.dirname(layerPath), { recursive: true })
    writeFileSync(
      layerPath,
      `${JSON.stringify({
        schema_version: 1,
        extension_id: 'target-layer',
        entries: [
          {
            id: 'target-handbook-boilerplate',
            category: 'duplicate',
            sources: ['governance/handbooks/target-owned/'],
            disposition: 'retain',
            rationale: 'Target-owned guidance restates the RFC 2119 preamble.',
            evidence: ['governance/handbooks/target-owned/'],
          },
        ],
      })}\n`,
    )

    const result = runInstaller(project, ['--yes'])

    assert.equal(result.status, 0, result.stderr)
    assert.equal(
      existsSync(layerPath),
      true,
      'a target disposition layer MUST survive a refresh',
    )
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer migrates a legacy project.json to config.json', () => {
  const project = makeSkeletonProject()
  const customCoderModel = 'operator-legacy-coder-model[fast=false]'
  const pancreatorDir = path.join(project, '.pancreator')
  const configPath = path.join(pancreatorDir, 'config.json')
  const legacyPath = path.join(pancreatorDir, 'project.json')

  try {
    assert.equal(runInstaller(project).status, 0)

    // Reproduce a pre-rename installation carrying an operator edit.
    const config = readJson<{
      active_config: string
      configs: Record<string, { personas: Record<string, string> }>
    }>(configPath)

    config.active_config = 'simple'
    config.configs.simple.personas.coder = customCoderModel
    writeFileSync(legacyPath, `${JSON.stringify(config, null, 2)}\n`)
    rmSync(configPath)

    const result = runInstaller(project, ['--yes'])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Migrated harness configuration/)

    assert.equal(existsSync(configPath), true)
    assert.equal(existsSync(legacyPath), false)

    const migrated = readJson<{
      active_config: string
      installation_mode: string
      configs: Record<string, { personas: Record<string, string> }>
    }>(configPath)

    assert.equal(migrated.active_config, 'simple')
    assert.equal(migrated.installation_mode, 'embedded')
    assert.equal(migrated.configs.simple.personas.coder, customCoderModel)

    // The projected agent must pick the migrated mapping up, proving the
    // migration ran before persona projection rather than after.
    const coderAgent = readFileSync(
      path.join(project, '.cursor', 'agents', 'pan-coder.md'),
      'utf8',
    )

    assert.ok(coderAgent.includes(`model: ${customCoderModel}`))
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer retains a superseded legacy project.json as a backup', () => {
  const project = makeSkeletonProject()
  const pancreatorDir = path.join(project, '.pancreator')
  const legacyPath = path.join(pancreatorDir, 'project.json')

  try {
    assert.equal(runInstaller(project).status, 0)

    writeFileSync(legacyPath, '{"schema_version":1,"active_config":"stale"}\n')

    const result = runInstaller(project, ['--yes'])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Superseded legacy project\.json retained/)
    assert.equal(existsSync(legacyPath), false)

    const backupRoot = path.join(pancreatorDir, 'backups', 'config')
    const stamps = readdirSync(backupRoot)

    assert.equal(stamps.length, 1)
    assert.equal(
      existsSync(path.join(backupRoot, stamps[0]!, 'project.json')),
      true,
    )
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer refresh compacts defaults and preserves operator models', () => {
  const project = makeSkeletonProject()

  try {
    assert.equal(runInstaller(project).status, 0)

    const configJsonPath = path.join(project, '.pancreator', 'config.json')
    const config = readJson<{
      active_config: string
      defaults: Record<string, string>
      configs: Record<string, { personas: Record<string, string> }>
    }>(configJsonPath)

    const activeConfigName = 'extreme'
    const activePersonas = config.configs[activeConfigName].personas
    const inheritedEntry = Object.entries(config.defaults).find(
      ([persona]) => activePersonas[persona] === undefined,
    )
    const omittedEntry = Object.entries(activePersonas).find(
      ([persona]) => persona !== 'reviewer',
    )

    assert.ok(inheritedEntry)
    assert.ok(omittedEntry)

    const customReviewerModel = 'operator-custom-reviewer[fast=false]'
    const [inheritedPersona, inheritedModel] = inheritedEntry
    const [omittedPersona, omittedModel] = omittedEntry
    config.active_config = activeConfigName
    config.configs[activeConfigName].personas.reviewer = customReviewerModel
    config.configs[activeConfigName].personas[inheritedPersona] = inheritedModel
    delete config.configs[activeConfigName].personas[omittedPersona]
    writeFileSync(configJsonPath, `${JSON.stringify(config, null, 2)}\n`)

    const result = runInstaller(project, ['--yes'])

    assert.equal(result.status, 0, result.stderr)

    const refreshed = readJson<{
      active_config: string
      configs: Record<string, { personas: Record<string, string> }>
    }>(configJsonPath)
    const active = refreshed.configs[activeConfigName]

    assert.equal(active.personas.reviewer, customReviewerModel)
    assert.equal(active.personas[inheritedPersona], undefined)
    assert.equal(active.personas[omittedPersona], omittedModel)
    assert.ok(
      readFileSync(
        path.join(project, '.cursor', 'agents', `pan-${inheritedPersona}.md`),
        'utf8',
      ).includes(`model: ${inheritedModel}`),
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

test('embedded installer scripted smoke verification passes', () => {
  const result = run(INSTALLER, ['--smoke'])

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /smoke: all steps passed/)
  assert.match(result.stdout, /smoke: fresh install/)
  assert.match(result.stdout, /smoke: partial install repair/)
})

test('embedded installer refresh supersedes local payload fixes and preserves extensions', () => {
  const project = makeSkeletonProject()

  try {
    assert.equal(runInstaller(project).status, 0)

    const owned = path.join(
      project,
      '.pancreator',
      'docs',
      'runtime-protocol.md',
    )
    const pristine = readFileSync(owned, 'utf8')
    const extension = path.join(
      project,
      '.pancreator',
      'docs',
      'target-notes.md',
    )
    const policyExtension = path.join(
      project,
      '.pancreator',
      'governance',
      'registries',
      'policy_lookup.d',
      'target.json',
    )
    const legacyPolicyRows = path.join(
      project,
      '.pancreator',
      'governance',
      'registries',
      'rowspace_policy_rows.json',
    )
    const migratedPolicyExtension = path.join(
      project,
      '.pancreator',
      'governance',
      'registries',
      'policy_lookup.d',
      'rowspace.json',
    )
    const targetPolicy = path.join(
      project,
      '.pancreator',
      'governance',
      'policies',
      'ROWSPACE-001.json',
    )
    const lookupTable = path.join(
      project,
      '.pancreator',
      'governance',
      'registries',
      'policy_lookup_table.json',
    )
    const pristineLookup = readFileSync(lookupTable, 'utf8')

    writeFileSync(owned, 'locally patched\n')
    writeFileSync(extension, 'target extension\n')
    mkdirSync(path.dirname(policyExtension), { recursive: true })
    writeFileSync(
      policyExtension,
      '{"schema_version":1,"rows":[{"persona":"tech-lead","workflow":"dev","stage":"plan","policies":["TARGET-001"]}]}\n',
    )
    writeFileSync(
      targetPolicy,
      '{"id":"ROWSPACE-001","extension_id":"rowspace","title":"Rowspace","severity":"hard","summary":"Agents MUST obey Rowspace.","instructions":["Agents MUST obey Rowspace."]}\n',
    )
    writeFileSync(
      legacyPolicyRows,
      '{"rows":[{"persona":"release-steward","workflow":"dev","stage":"ship","policies":["ROWSPACE-001"]}]}\n',
    )

    const refresh = runInstaller(project, ['--yes'])

    assert.equal(refresh.status, 0, refresh.stderr)
    // The Pancreator source is authoritative for harness-owned files; the
    // local fix is flagged, backed up, and replaced.
    assert.match(refresh.stdout, /superseded {2}docs\/runtime-protocol\.md/u)
    assert.equal(readFileSync(owned, 'utf8'), pristine)
    // A file the release never shipped is a target extension and survives.
    assert.match(refresh.stdout, /preserved {2}docs\/target-notes\.md/u)
    assert.equal(readFileSync(extension, 'utf8'), 'target extension\n')
    assert.match(
      refresh.stdout,
      /preserved {2}governance\/registries\/policy_lookup\.d\/target\.json/u,
    )
    assert.match(readFileSync(policyExtension, 'utf8'), /TARGET-001/u)
    assert.equal(readFileSync(lookupTable, 'utf8'), pristineLookup)
    assert.equal(existsSync(legacyPolicyRows), true)
    assert.deepEqual(
      JSON.parse(readFileSync(migratedPolicyExtension, 'utf8')),
      {
        schema_version: 1,
        extension_id: 'rowspace',
        policies: ['ROWSPACE-001'],
        rows: [
          {
            persona: 'release-steward',
            workflow: 'dev',
            stage: 'ship',
            policies: ['ROWSPACE-001'],
          },
        ],
      },
    )

    const backupRoot = path.join(project, '.pancreator', 'backups', 'payload')
    const stamps = readdirSync(backupRoot)

    assert.equal(stamps.length, 1)
    assert.equal(
      readFileSync(
        path.join(backupRoot, stamps[0], 'docs', 'runtime-protocol.md'),
        'utf8',
      ),
      'locally patched\n',
    )

    // A second refresh has nothing to flag: the extension is preserved again
    // without ever being recorded as release-owned content.
    const second = runInstaller(project, ['--yes'])

    assert.equal(second.status, 0, second.stderr)
    assert.doesNotMatch(second.stdout, /superseded {2}/u)
    assert.equal(readFileSync(extension, 'utf8'), 'target extension\n')
    assert.match(readFileSync(policyExtension, 'utf8'), /TARGET-001/u)
    assert.equal(readFileSync(lookupTable, 'utf8'), pristineLookup)
    assert.equal(existsSync(legacyPolicyRows), true)
    assert.match(readFileSync(migratedPolicyExtension, 'utf8'), /ROWSPACE-001/u)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})
