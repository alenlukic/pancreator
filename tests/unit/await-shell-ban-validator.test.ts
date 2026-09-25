import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validateAwaitShellBan } from '../../src/lib/validators/await-shell-ban.js'
import { createTestTempDirectory } from '../temp.js'

function makeInput(root: string) {
  return {
    root,
    targetPath: root,
    requirement: {
      policy_id: 'DELEGATE-001',
      requirement_id: 'await-shell-ban-validate',
      registry_id: 'AWAIT-SHELL-BAN-VALIDATE-001',
      arguments: {},
    },
  }
}

function writeAgentFile(root: string, name: string, frontmatter: string): void {
  const dir = path.join(root, 'library', 'cursor', 'agents')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path.join(dir, name),
    `---\n${frontmatter}\n---\n\nAgent body.\n`,
  )
}

function writeHooksJson(root: string, content: unknown): void {
  const dir = path.join(root, 'library', 'cursor')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'hooks.json'), JSON.stringify(content, null, 2))
}

const VALID_HOOKS = {
  version: 1,
  hooks: {
    preToolUse: [
      {
        command: '{{PANCREATOR_HARNESS_PATH}}bin/pan-hook-deny-await-shell',
        matcher: '.*',
        timeout: 5,
        failClosed: true,
      },
    ],
  },
}

test('AC-001/AC-002: validateAwaitShellBan', async (t) => {
  await t.test(
    'passes when all agents have AwaitShell in disallowedTools and hooks.json has the entry',
    () => {
      const root = createTestTempDirectory('ban-validator-pass-')
      writeAgentFile(
        root,
        'coder.md',
        "description: Coder\nmodel: __MODEL__\ntools: [Bash]\ndisallowedTools: [AwaitShell, 'Bash(git push:*)']",
      )
      writeHooksJson(root, VALID_HOOKS)
      const result = validateAwaitShellBan(makeInput(root))
      assert.equal(result.status, 'passed')
      assert.equal(result.issues.length, 0)
    },
  )

  await t.test(
    'fails with the agent file path when AwaitShell is missing from disallowedTools',
    () => {
      const root = createTestTempDirectory('ban-validator-miss-')
      writeAgentFile(
        root,
        'bad-agent.md',
        "description: Bad\nmodel: __MODEL__\ndisallowedTools: ['Bash(git push:*)']",
      )
      writeHooksJson(root, VALID_HOOKS)
      const result = validateAwaitShellBan(makeInput(root))
      assert.equal(result.status, 'failed')
      const issue = result.issues.find(
        (i) => i.code === 'await_shell_ban.missing_from_disallowed_tools',
      )
      assert.ok(issue, 'issue with missing code present')
      assert.ok(
        issue.message.includes('bad-agent.md'),
        `message names the file: ${issue.message}`,
      )
    },
  )

  await t.test('fails when disallowedTools is empty', () => {
    const root = createTestTempDirectory('ban-validator-empty-')
    writeAgentFile(
      root,
      'empty-agent.md',
      'description: Empty\nmodel: __MODEL__\ndisallowedTools: []',
    )
    writeHooksJson(root, VALID_HOOKS)
    const result = validateAwaitShellBan(makeInput(root))
    assert.equal(result.status, 'failed')
    const issue = result.issues.find(
      (i) => i.code === 'await_shell_ban.missing_from_disallowed_tools',
    )
    assert.ok(issue)
  })

  await t.test(
    'fails when hooks.json has no preToolUse entry for pan-hook-deny-await-shell',
    () => {
      const root = createTestTempDirectory('ban-validator-nohook-')
      writeAgentFile(
        root,
        'good-agent.md',
        'description: Good\nmodel: __MODEL__\ndisallowedTools: [AwaitShell]',
      )
      writeHooksJson(root, { version: 1, hooks: {} })
      const result = validateAwaitShellBan(makeInput(root))
      assert.equal(result.status, 'failed')
      const issue = result.issues.find(
        (i) => i.code === 'await_shell_ban.pre_tool_use_hook_missing',
      )
      assert.ok(issue, 'hook-missing issue present')
      assert.ok(
        issue.message.includes('pan-hook-deny-await-shell'),
        `message names the hook: ${issue.message}`,
      )
    },
  )

  await t.test('fails when hooks.json is absent', () => {
    const root = createTestTempDirectory('ban-validator-nohooksfile-')
    writeAgentFile(
      root,
      'good.md',
      'description: G\nmodel: __MODEL__\ndisallowedTools: [AwaitShell]',
    )
    // no hooks.json
    const result = validateAwaitShellBan(makeInput(root))
    assert.equal(result.status, 'failed')
    const issue = result.issues.find(
      (i) => i.code === 'await_shell_ban.hooks_source_missing',
    )
    assert.ok(issue)
  })

  await t.test('fails when agents directory is missing', () => {
    const root = createTestTempDirectory('ban-validator-noagentsdir-')
    writeHooksJson(root, VALID_HOOKS)
    const result = validateAwaitShellBan(makeInput(root))
    assert.equal(result.status, 'failed')
    const issue = result.issues.find(
      (i) => i.code === 'await_shell_ban.agents_dir_missing',
    )
    assert.ok(issue)
  })
})
