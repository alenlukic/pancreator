import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  projectCursorContent,
  renderPolicyCursorRule,
} from '../../src/lib/cursor-content.js'
import {
  hostToolTranslations,
  loadHostToolRegistry,
} from '../../src/lib/host-tools.js'
import { loadPolicyCatalog } from '../../src/lib/policies.js'
import {
  renderCommandSkill,
  renderVscodeAgent,
  renderVscodeInstructions,
  translateHostToolNames,
} from '../../src/lib/projection/host-content.js'
import { createFixture } from '../fixture-template.js'
import { createTestTempDirectory } from '../temp.js'

const INSTALL_SUPPORT = path.join(process.cwd(), 'bin', 'install-support')
const VSCODE_TARGET = '.github/instructions/pan-fixture.instructions.md'

function installSupport(args: string[]): void {
  const result = spawnSync(process.execPath, [INSTALL_SUPPORT, ...args], {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  })

  assert.equal(result.status, 0, result.stderr)
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
}

test('the installer projects a host-bound target only for enabled hosts and removes it on disable', () => {
  const source = createFixture()
  const work = createTestTempDirectory('pancreator-installer-hosts-')
  const target = path.join(work, 'target')
  const config = path.join(work, 'config.json')
  const marker = path.join(work, 'cursor-manifest.json')
  const manifestPath = path.join(
    source,
    'governance',
    'registries',
    'projection_manifest.json',
  )
  const manifest = readJson(manifestPath)

  ;(manifest.projections as unknown[]).push({
    id: 'vscode-fixture-instructions',
    host: 'vscode',
    format_difference: 'fixture',
    source: 'library/cursor/rules/pancreator-embedded.mdc',
    target: VSCODE_TARGET,
    installation_modes: ['embedded'],
    generated_fields: [],
    transforms: [],
  })
  writeFileSync(manifestPath, JSON.stringify(manifest))
  mkdirSync(target, { recursive: true })

  const project = (hosts: string[] | undefined, previous: boolean) => {
    const value = readJson(path.join(source, 'config.json'))

    if (hosts === undefined) {
      delete value.hosts
    } else {
      value.hosts = hosts
    }

    writeFileSync(config, JSON.stringify(value))
    installSupport([
      'project-cursor',
      '--source-root',
      source,
      '--target-root',
      target,
      '--manifest-out',
      marker,
      '--persona-config',
      config,
      ...(previous ? ['--previous-marker', marker] : []),
    ])
  }

  project(undefined, false)
  assert.equal(existsSync(path.join(target, VSCODE_TARGET)), false)
  assert.equal(
    existsSync(path.join(target, '.cursor', 'rules', 'pancreator.mdc')),
    true,
  )

  project(['cursor', 'vscode'], true)
  assert.equal(existsSync(path.join(target, VSCODE_TARGET)), true)

  project(['cursor'], true)
  assert.equal(existsSync(path.join(target, '.github')), false)
  assert.equal(
    existsSync(path.join(target, '.cursor', 'rules', 'pancreator.mdc')),
    true,
  )

  writeFileSync(
    path.join(work, 'config_overrides.json'),
    JSON.stringify({ hosts: ['cursor', 'vscode'] }),
  )
  project(undefined, true)
  assert.equal(existsSync(path.join(target, VSCODE_TARGET)), true)
})

test('installer and compiled VS Code renderers stay byte-identical', () => {
  const source = createFixture()
  const work = createTestTempDirectory('pancreator-installer-vscode-')
  const target = path.join(work, 'target')
  const config = path.join(work, 'config.json')

  mkdirSync(target, { recursive: true })
  writeFileSync(
    config,
    JSON.stringify({
      ...readJson(path.join(source, 'config.json')),
      hosts: ['cursor', 'vscode'],
    }),
  )
  installSupport([
    'project-cursor',
    '--source-root',
    source,
    '--target-root',
    target,
    '--manifest-out',
    path.join(work, 'cursor-manifest.json'),
    '--persona-config',
    config,
  ])

  const read = (root: string, relative: string) =>
    readFileSync(path.join(root, relative), 'utf8')
  const translations = hostToolTranslations(
    loadHostToolRegistry(source),
    'vscode',
  )
  const policy = loadPolicyCatalog(source).get('COMMS-001')

  assert.ok(policy)
  assert.equal(
    read(target, '.agents/skills/pan-status/SKILL.md'),
    translateHostToolNames(
      renderCommandSkill(
        'pan-status',
        projectCursorContent(
          read(source, 'library/cursor/commands/pan-status.md'),
          '.agents/skills/pan-status/SKILL.md',
          'embedded',
        ),
      ),
      translations,
    ),
  )
  assert.equal(
    read(target, '.github/agents/pan-coder.agent.md'),
    translateHostToolNames(
      renderVscodeAgent(
        'coder',
        projectCursorContent(
          read(source, 'library/cursor/agents/coder.md'),
          '.github/agents/pan-coder.agent.md',
          'embedded',
        ),
      ),
      translations,
    ),
  )
  assert.equal(
    read(target, '.github/instructions/pancreator.instructions.md'),
    translateHostToolNames(
      renderVscodeInstructions(
        read(source, 'library/cursor/rules/pancreator-embedded.mdc'),
      ),
      translations,
    ),
  )
  assert.equal(
    read(target, '.github/instructions/pan-chat-output.instructions.md'),
    translateHostToolNames(
      renderVscodeInstructions(renderPolicyCursorRule(policy)),
      translations,
    ),
  )
  assert.match(
    read(target, '.github/hooks/pan-hooks.json'),
    /"bash": "\.pancreator\/bin\/pan-hook-adapter --fail-closed preToolUse/u,
  )
})

test('an update keeps the operator host selection', () => {
  const work = createTestTempDirectory('pancreator-installer-hosts-')
  const source = path.join(work, 'source.json')
  const destination = path.join(work, 'config.json')
  const shipped = {
    schema_version: 1,
    installation_mode: 'self_development',
    hosts: ['cursor'],
    active_config: 'balanced',
    defaults: { coder: 'claude-sonnet-5' },
    configs: { balanced: {} },
  }
  const write = () =>
    installSupport([
      'write-project',
      '--source',
      source,
      '--destination',
      destination,
      '--workspace-id',
      'target-one',
    ])

  writeFileSync(source, JSON.stringify(shipped))
  write()
  assert.deepEqual(readJson(destination).hosts, ['cursor'])

  writeFileSync(
    destination,
    JSON.stringify({ ...readJson(destination), hosts: ['cursor', 'vscode'] }),
  )
  write()
  assert.deepEqual(readJson(destination).hosts, ['cursor', 'vscode'])
})
