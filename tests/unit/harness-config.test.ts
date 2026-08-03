import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createFixture } from '../helpers.js'
import {
  harnessConfigName,
  harnessPathPrefix,
  isDetachedInstallation,
  isEmbeddedInstallation,
  isTargetInstallation,
  loadProjectConfig,
  panCommand,
  readProjectConfig,
} from '../../src/lib/project-config.js'
import { loadPipelineConfig } from '../../src/lib/pipeline-config.js'
import { loadOperatorInvolvementFile } from '../../src/lib/operator-involvement.js'
import { findProjectRoot } from '../../src/lib/io.js'

/** Rewrite the fixture's harness configuration with the supplied overrides. */
function configure(root: string, overrides: Record<string, unknown>): void {
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  writeFileSync(
    configPath,
    `${JSON.stringify({ ...config, ...overrides }, null, 2)}\n`,
  )
}

function useLegacyConfigName(root: string): void {
  renameSync(path.join(root, 'config.json'), path.join(root, 'project.json'))
}

test('harnessConfigName reports the current configuration name', () => {
  const root = createFixture()

  assert.equal(harnessConfigName(root), 'config.json')
})

test('harnessConfigName falls back to the pre-rename name', () => {
  const root = createFixture()

  useLegacyConfigName(root)

  assert.equal(harnessConfigName(root), 'project.json')
})

test('harnessConfigName returns null when no configuration exists', () => {
  const root = createFixture()

  rmSync(path.join(root, 'config.json'))

  assert.equal(harnessConfigName(root), null)
  assert.equal(readProjectConfig(root), null)
})

test('config.local.json overrides project preferences without touching config.json', () => {
  const root = createFixture()

  writeFileSync(
    path.join(root, 'config.local.json'),
    JSON.stringify({ review_mode: 'squad' }),
  )

  assert.equal(loadProjectConfig(root).review_mode, 'squad')
  assert.equal(
    loadOperatorInvolvementFile(root).active,
    'standard',
    'an involvement preference the local file does not name is unchanged',
  )

  const checkedIn = JSON.parse(
    readFileSync(path.join(root, 'config.json'), 'utf8'),
  ) as { review_mode: string }

  assert.equal(checkedIn.review_mode, 'default')
})

test('config.local.json can select the active involvement profile', () => {
  const root = createFixture()

  writeFileSync(
    path.join(root, 'config.local.json'),
    JSON.stringify({ operator_involvement: { active: 'hands-off' } }),
  )

  const involvement = loadOperatorInvolvementFile(root)

  assert.equal(involvement.active, 'hands-off')
  assert.equal(involvement.profiles['hands-off']?.gates?.intake, 'supervisor')
})

test('loadProjectConfig reads an unmigrated installation', () => {
  const root = createFixture()
  const expected = loadProjectConfig(root)

  useLegacyConfigName(root)

  assert.deepEqual(loadProjectConfig(root), expected)
})

test('loadPipelineConfig records the configuration name it actually read', () => {
  const root = createFixture()

  assert.equal(loadPipelineConfig(root).path, 'config.json')

  useLegacyConfigName(root)

  assert.equal(loadPipelineConfig(root).path, 'project.json')
})

test('config.json wins when both names are present', () => {
  const root = createFixture()

  // A refresh has landed the new name but a stale legacy file is still on
  // disk; reads MUST NOT regress to the superseded configuration.
  const current = loadProjectConfig(root)

  writeFileSync(
    path.join(root, 'project.json'),
    `${JSON.stringify({ schema_version: 1, state_root: 'stale' }, null, 2)}\n`,
  )

  assert.equal(harnessConfigName(root), 'config.json')
  assert.deepEqual(loadProjectConfig(root), current)
  assert.notEqual(loadProjectConfig(root).state_root, 'stale')
})

test('detached installation is a target installation but not embedded', () => {
  const root = createFixture()
  const workspace = mkdtempSync(path.join(tmpdir(), 'pancreator-target-'))

  try {
    configure(root, {
      installation_mode: 'detached',
      workspace_root: workspace,
    })

    assert.equal(isDetachedInstallation(root), true)
    assert.equal(isTargetInstallation(root), true)
    assert.equal(isEmbeddedInstallation(root), false)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('detached installation addresses the harness by absolute path', () => {
  const root = createFixture()
  const workspace = mkdtempSync(path.join(tmpdir(), 'pancreator-target-'))

  try {
    configure(root, {
      installation_mode: 'detached',
      workspace_root: workspace,
    })

    assert.equal(harnessPathPrefix(root), root)
    assert.equal(panCommand(root), path.join(root, 'bin', 'pan'))
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('embedded installation keeps the relative harness prefix', () => {
  const root = createFixture()

  configure(root, { installation_mode: 'embedded', workspace_root: '..' })

  assert.equal(harnessPathPrefix(root), '.pancreator')
  assert.equal(panCommand(root), './.pancreator/bin/pan')
  assert.equal(isTargetInstallation(root), true)
})

test('detached installation rejects a relative workspace root', () => {
  const root = createFixture()

  configure(root, { installation_mode: 'detached', workspace_root: '..' })

  assert.throws(
    () => loadProjectConfig(root),
    /workspace_root MUST be an absolute path for a detached installation/u,
  )
})

test('an unknown installation mode is rejected', () => {
  const root = createFixture()

  configure(root, { installation_mode: 'nonsense' })

  assert.throws(
    () => loadProjectConfig(root),
    /installation_mode MUST be self_development, embedded, or detached/u,
  )
})

test('PANCREATOR_ROOT locates a harness outside the working directory', () => {
  const root = createFixture()
  const elsewhere = mkdtempSync(path.join(tmpdir(), 'pancreator-cwd-'))
  const previous = process.env.PANCREATOR_ROOT

  try {
    // Walking up from an unrelated directory can never reach a detached
    // harness, so the explicit override is the only way to find it.
    assert.throws(() => findProjectRoot(elsewhere), /ROOT_NOT_FOUND|locate/u)

    process.env.PANCREATOR_ROOT = root

    assert.equal(findProjectRoot(elsewhere), root)
  } finally {
    if (previous === undefined) {
      delete process.env.PANCREATOR_ROOT
    } else {
      process.env.PANCREATOR_ROOT = previous
    }
    rmSync(elsewhere, { recursive: true, force: true })
  }
})

test('PANCREATOR_ROOT rejects a directory that is not a harness', () => {
  const elsewhere = mkdtempSync(path.join(tmpdir(), 'pancreator-cwd-'))
  const previous = process.env.PANCREATOR_ROOT

  try {
    process.env.PANCREATOR_ROOT = elsewhere

    assert.throws(
      () => findProjectRoot(elsewhere),
      /is not a Pancreator installation/u,
    )
  } finally {
    if (previous === undefined) {
      delete process.env.PANCREATOR_ROOT
    } else {
      process.env.PANCREATOR_ROOT = previous
    }
    rmSync(elsewhere, { recursive: true, force: true })
  }
})
