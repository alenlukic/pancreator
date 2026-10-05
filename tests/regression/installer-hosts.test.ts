import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

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
  assert.equal(existsSync(path.join(target, VSCODE_TARGET)), false)
  assert.equal(
    existsSync(path.join(target, '.cursor', 'rules', 'pancreator.mdc')),
    true,
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
