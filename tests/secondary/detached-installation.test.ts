import assert from 'node:assert/strict'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  INSTALLER,
  git,
  makeSkeletonProject,
  readJson,
  run,
  runInstaller,
} from './install-helpers.js'

test('detached installer places the harness outside the target tree and refreshes idempotently', () => {
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

    // A refresh of the same detached installation is idempotent.
    const refresh = runInstaller(project, ['--harness-dir', harness, '--yes'])

    assert.equal(refresh.status, 0, refresh.stderr)
    assert.match(refresh.stdout, /Installation refresh completed/)

    const refreshedConfig = readJson<{
      workspace_root: string
      installation_mode: string
    }>(path.join(harness, 'config.json'))

    assert.equal(refreshedConfig.installation_mode, 'detached')
    assert.equal(refreshedConfig.workspace_root, project)
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

test('embedded installer scripted smoke verification passes', () => {
  const result = run(INSTALLER, ['--smoke'])

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /smoke: all steps passed/)
  assert.match(result.stdout, /smoke: fresh install/)
  assert.match(result.stdout, /smoke: partial install repair/)
})
