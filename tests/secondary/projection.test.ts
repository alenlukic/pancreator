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
import { createFixture } from '../fixture-template.js'
import { createTestTempDirectory } from '../temp.js'

test('installer and compiled projection renderers stay byte-identical', () => {
  const root = createFixture()
  const targetRoot = createTestTempDirectory('pancreator-installer-projection-')

  const catalog = loadPolicyCatalog(root)
  const policy = catalog.get('BROWSER-001')
  const commsPolicy = catalog.get('COMMS-001')
  const delegatePolicy = catalog.get('DELEGATE-001')

  assert.ok(policy)
  assert.ok(commsPolicy)
  assert.ok(delegatePolicy)

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

    assert.equal(
      installerRendered,
      projectCursorContent(
        renderPolicyCursorRule(policy),
        '.cursor/rules/pan-browser-isolation.mdc',
        'embedded',
      ),
    )

    const installerChatRule = readFileSync(
      path.join(targetRoot, '.cursor', 'rules', 'pan-chat-output.mdc'),
      'utf8',
    )

    assert.equal(
      installerChatRule,
      projectCursorContent(
        renderPolicyCursorRule(commsPolicy),
        '.cursor/rules/pan-chat-output.mdc',
        'embedded',
      ),
    )

    const delegatePath = '.cursor/rules/pan-subagent-supervision.mdc'
    const delegateRule = readFileSync(
      path.join(targetRoot, delegatePath),
      'utf8',
    )
    assert.equal(
      delegateRule,
      projectCursorContent(
        renderPolicyCursorRule(delegatePolicy),
        delegatePath,
        'embedded',
      ),
    )
    assert.match(delegateRule, /--capabilities 'shell'/u)
    assert.ok(
      !delegateRule.includes(
        delegatePolicy.instructions.find((entry) =>
          entry.text.startsWith(
            'Shell-capable workers MUST run shell commands inside',
          ),
        )!.text,
      ),
    )

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
