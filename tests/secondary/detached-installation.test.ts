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
  git,
  gitInit,
  makeSkeletonProject,
  readJson,
  runInstaller,
} from './install-helpers.js'

test('detached installer places the harness outside the target tree and refreshes idempotently', () => {
  const project = makeSkeletonProject()
  const harness = mkdtempSync(path.join(tmpdir(), 'pancreator-harness-'))

  try {
    gitInit(project)

    // The install MUST leave the target-owned instructions and Cursor files
    // byte-identical.
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
      '---\nalwaysApply: true\n---\n\nInitial target rule.\n',
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
    assert.equal(existsSync(path.join(project, '.pancreator')), false)

    const config = readJson<{
      workspace_root: string
      state_root: string
      installation_mode: string
    }>(path.join(harness, 'config.json'))

    assert.equal(config.installation_mode, 'detached')
    assert.equal(path.isAbsolute(config.workspace_root), true)
    assert.equal(config.state_root, 'runtime')

    assert.equal(readFileSync(targetAgents, 'utf8'), agentsBefore)
    assert.equal(readFileSync(targetRule, 'utf8'), ruleBefore)
    assert.equal(readFileSync(targetAgent, 'utf8'), agentBefore)
    assert.equal(
      existsSync(path.join(project, '.cursor', 'agents', 'pan-coder.md')),
      true,
    )

    const link = path.join(harness, '.cursor')

    assert.equal(lstatSync(link).isSymbolicLink(), true)
    assert.equal(existsSync(path.join(link, 'agents', 'pan-coder.md')), true)
    assert.equal(existsSync(path.join(harness, 'runtime', 'inbox')), true)
    assert.equal(existsSync(path.join(harness, 'worktrees')), true)

    // Detached mode puts nothing at .pancreator/, so the installer omits that
    // exclude rule.
    const exclude = readFileSync(
      path.join(project, '.git', 'info', 'exclude'),
      'utf8',
    )

    assert.doesNotMatch(exclude, /^\/\.pancreator\/$/mu)
    assert.match(exclude, /^\/\.cursor\/agents\/pan-\*\.md$/mu)
    assert.equal(git(project, ['status', '--porcelain']), '')

    // A refresh leaves live target instructions alone and takes no policy
    // copy.
    writeFileSync(
      targetRule,
      '---\nalwaysApply: true\n---\n\nUpdated target rule after install.\n',
    )
    git(project, ['add', targetRule])
    git(project, ['commit', '-qm', 'update target rule'])

    const ruleAfterChange = readFileSync(targetRule, 'utf8')
    const refresh = runInstaller(project, ['--harness-dir', harness, '--yes'])

    assert.equal(refresh.status, 0, refresh.stderr)
    assert.match(refresh.stdout, /Installation refresh completed/)
    assert.equal(readFileSync(targetRule, 'utf8'), ruleAfterChange)
    assert.equal(
      existsSync(path.join(harness, 'runtime', 'inbox', 'target-policy.json')),
      false,
    )

    const refreshedConfig = readJson<{
      workspace_root: string
      installation_mode: string
    }>(path.join(harness, 'config.json'))

    assert.equal(refreshedConfig.installation_mode, 'detached')
    assert.equal(refreshedConfig.workspace_root, config.workspace_root)
    assert.equal(git(project, ['status', '--porcelain']), '')
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
