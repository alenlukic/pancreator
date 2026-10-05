import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  enabledHosts,
  readProjectConfig,
} from '../../src/lib/project-config.js'
import {
  projectionTargetPath,
  syncCursorProjection,
  validateProjectionDrift,
} from '../../src/lib/projection.js'
import { createFixture } from '../fixture-template.js'

const VSCODE_TARGET = '.github/instructions/pan-fixture.instructions.md'

function editJson(
  file: string,
  edit: (value: Record<string, unknown>) => void,
) {
  const value = JSON.parse(readFileSync(file, 'utf8')) as Record<
    string,
    unknown
  >

  edit(value)
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function manifestPath(root: string): string {
  return path.join(root, 'governance', 'registries', 'projection_manifest.json')
}

function addProjection(root: string, projection: Record<string, unknown>) {
  editJson(manifestPath(root), (manifest) => {
    ;(manifest.projections as unknown[]).push(projection)
  })
}

function setHosts(root: string, hosts: string[] | undefined) {
  editJson(path.join(root, 'config.json'), (config) => {
    if (hosts === undefined) {
      delete config.hosts
    } else {
      config.hosts = hosts
    }
  })
}

function vscodeFixture(): string {
  const root = createFixture()

  addProjection(root, {
    id: 'vscode-fixture-instructions',
    host: 'vscode',
    format_difference: 'fixture',
    source: 'library/cursor/rules/pancreator-self-development.mdc',
    target: VSCODE_TARGET,
    installation_modes: ['self_development'],
    generated_fields: [],
    transforms: [],
  })

  return root
}

test('an installation without hosts behaves as Cursor only', () => {
  const root = createFixture()

  setHosts(root, undefined)

  assert.deepEqual(enabledHosts(root), ['cursor'])
})

test('config hosts accepts only distinct supported hosts', () => {
  const root = createFixture()

  for (const hosts of [[], ['emacs'], ['cursor', 'cursor']]) {
    setHosts(root, hosts)
    assert.throws(() => readProjectConfig(root), /hosts MUST be a non-empty/u)
  }

  setHosts(root, ['vscode', 'cursor'])
  assert.deepEqual(enabledHosts(root), ['vscode', 'cursor'])
})

test('a host-bound projection renders only while its host is enabled', () => {
  const root = vscodeFixture()
  const target = path.join(root, VSCODE_TARGET)

  setHosts(root, ['cursor'])
  syncCursorProjection(root, { write: true })
  assert.equal(existsSync(target), false)
  assert.deepEqual(validateProjectionDrift(root).errors, [])

  setHosts(root, ['cursor', 'vscode'])
  assert.ok(
    validateProjectionDrift(root).errors.some((error) =>
      error.startsWith(`${VSCODE_TARGET} projection drift`),
    ),
  )

  syncCursorProjection(root, { write: true })
  assert.equal(existsSync(target), true)
  assert.deepEqual(validateProjectionDrift(root).errors, [])

  setHosts(root, ['cursor'])

  const removal = syncCursorProjection(root, { write: true }).find(
    (change) => change.path === VSCODE_TARGET,
  )

  assert.equal(removal?.removed, true)
  assert.equal(existsSync(target), false)
  assert.equal(
    existsSync(path.join(root, '.cursor', 'rules', 'pancreator.mdc')),
    true,
  )
  assert.deepEqual(validateProjectionDrift(root).errors, [])
})

test('the manifest rejects a host target outside its projection roots', () => {
  const root = createFixture()

  addProjection(root, {
    id: 'misplaced',
    host: 'vscode',
    format_difference: 'fixture',
    source: 'library/cursor/rules/pancreator-self-development.mdc',
    target: '.cursor/rules/pan-misplaced.mdc',
    installation_modes: ['self_development'],
    generated_fields: [],
    transforms: [],
  })

  assert.match(
    validateProjectionDrift(root).errors.join('\n'),
    /misplaced\.target MUST be under \.github\//u,
  )
})

test('a host-bound projection names its format difference', () => {
  const root = createFixture()

  addProjection(root, {
    id: 'unexplained',
    host: 'vscode',
    source: 'library/cursor/rules/pancreator-self-development.mdc',
    target: '.github/instructions/pan-unexplained.instructions.md',
    installation_modes: ['self_development'],
    generated_fields: [],
    transforms: [],
  })

  assert.match(
    validateProjectionDrift(root).errors.join('\n'),
    /unexplained\.format_difference MUST name/u,
  )
})

test('an embedded host target resolves at the target repository root', () => {
  const root = createFixture()

  editJson(path.join(root, 'config.json'), (config) => {
    config.installation_mode = 'embedded'
    config.workspace_root = '..'
  })

  assert.equal(
    projectionTargetPath(root, VSCODE_TARGET),
    path.join(path.dirname(root), VSCODE_TARGET),
  )
  assert.equal(
    projectionTargetPath(root, '.cursor/rules/pancreator.mdc'),
    path.join(root, '.cursor', 'rules', 'pancreator.mdc'),
  )
})
