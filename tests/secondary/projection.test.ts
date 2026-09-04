import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  projectCursorContent,
  renderPolicyCursorRule,
} from '../../src/lib/cursor-content.js'
import { loadPolicyCatalog } from '../../src/lib/policies.js'
import { createFixture } from '../helpers.js'
import { createTestTempDirectory } from '../temp.js'

test('installer and compiled projection renderers stay byte-identical', () => {
  const root = createFixture()
  const targetRoot = createTestTempDirectory('pancreator-installer-projection-')
  const policy = loadPolicyCatalog(root).get('BROWSER-001')

  assert.ok(policy)

  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), 'bin', 'install-support'),
        'project-cursor',
        '--source-root',
        root,
        '--target-root',
        targetRoot,
        '--manifest-out',
        path.join(targetRoot, 'cursor-manifest.json'),
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      },
    )

    assert.equal(result.status, 0, result.stderr)

    const installerRendered = readFileSync(
      path.join(targetRoot, '.cursor', 'rules', 'pan-browser-isolation.mdc'),
      'utf8',
    )

    assert.equal(installerRendered, renderPolicyCursorRule(policy))

    const commandSource = readFileSync(
      path.join(root, 'library', 'cursor', 'commands', 'pan-status.md'),
      'utf8',
    )
    const installerCommand = readFileSync(
      path.join(targetRoot, '.cursor', 'commands', 'pan-status.md'),
      'utf8',
    )

    assert.equal(
      installerCommand,
      projectCursorContent(
        commandSource,
        '.cursor/commands/pan-status.md',
        'embedded',
      ),
    )
  } finally {
    rmSync(targetRoot, { recursive: true, force: true })
  }
})
