import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { loadRegistry } from '../../src/lib/requirements/registry.js'
import { runRequirement } from '../../src/lib/requirements/run.js'
import { validateAwaitShellBan as validateRepositoryAwaitShellBan } from '../../src/lib/validation.js'
import { awaitShellBanValidateHandler as validateAwaitShellBan } from '../../src/lib/validators/await-shell-ban.js'
import { createTestTempDirectory } from '../temp.js'

const REPO_ROOT = process.cwd()

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
        matcher: 'AwaitShell|Await',
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
    'passes a multi-line flow list and a block list that carry AwaitShell',
    () => {
      const root = createTestTempDirectory('ban-validator-multiline-')
      writeAgentFile(
        root,
        'flow.md',
        "description: Flow\ntools:\n  [\n    Bash,\n    'Bash(git status:*)',\n  ]\ndisallowedTools:\n  [\n    AwaitShell,\n    'Bash(git push:*)',\n    'Bash(rm:*)',\n  ]\nmaxTurns: 30",
      )
      writeAgentFile(
        root,
        'block.md',
        "description: Block\ndisallowedTools:\n  - AwaitShell\n  - 'Bash(rm:*)'",
      )
      writeHooksJson(root, VALID_HOOKS)
      const result = validateAwaitShellBan(makeInput(root))
      assert.deepEqual(result.issues, [])
      assert.equal(result.status, 'passed')
    },
  )

  await t.test(
    'fails invalid frontmatter where a second flow list follows the first',
    () => {
      const root = createTestTempDirectory('ban-validator-broken-')
      writeAgentFile(
        root,
        'broken.md',
        "description: Broken\ndisallowedTools: [AwaitShell]\n  [\n    'Bash(git push:*)',\n    'Bash(rm:*)',\n  ]\nmaxTurns: 30",
      )
      writeHooksJson(root, VALID_HOOKS)
      const result = validateAwaitShellBan(makeInput(root))
      assert.equal(result.status, 'failed')
      const issue = result.issues.find(
        (i) => i.code === 'await_shell_ban.frontmatter_invalid',
      )
      assert.ok(issue, JSON.stringify(result.issues))
      assert.equal(issue.pointer, 'library/cursor/agents/broken.md')
    },
  )

  await t.test(
    'fails a plain scalar that holds a colon, which YAML rejects',
    () => {
      const root = createTestTempDirectory('ban-validator-colon-')
      writeAgentFile(
        root,
        'colon.md',
        'description: Runs one session: N runs\ndisallowedTools: [AwaitShell]',
      )
      writeHooksJson(root, VALID_HOOKS)
      const result = validateAwaitShellBan(makeInput(root))
      assert.equal(result.status, 'failed')
      assert.ok(
        result.issues.some(
          (i) =>
            i.code === 'await_shell_ban.frontmatter_invalid' &&
            i.message.includes("'description'"),
        ),
        JSON.stringify(result.issues),
      )
    },
  )

  await t.test('fails when AwaitShell appears in the tools allow-list', () => {
    const root = createTestTempDirectory('ban-validator-allowed-')
    writeAgentFile(
      root,
      'allowed.md',
      'description: Allowed\ntools: [Bash, AwaitShell]\ndisallowedTools: [AwaitShell]',
    )
    writeHooksJson(root, VALID_HOOKS)
    const result = validateAwaitShellBan(makeInput(root))
    assert.ok(
      result.issues.some(
        (i) => i.code === 'await_shell_ban.in_tools_allow_list',
      ),
    )
  })

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

test('AC-001: the repository carries the ban and repository validation reports a stripped fixture', () => {
  assert.deepEqual(validateRepositoryAwaitShellBan(REPO_ROOT), [])

  const root = createTestTempDirectory('ban-validator-repository-')
  writeAgentFile(
    root,
    'coder.md',
    "description: Coder\ndisallowedTools: ['Bash(git push:*)']",
  )
  writeHooksJson(root, VALID_HOOKS)
  const errors = validateRepositoryAwaitShellBan(root)
  assert.equal(errors.length, 1)
  assert.match(
    errors[0] ?? '',
    /library\/cursor\/agents\/coder\.md.*AwaitShell/u,
  )
})

test('AC-009: DELEGATE-001 binds the ban validator as an authoritative harness gate', () => {
  const policy = JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, 'governance/policies/DELEGATE-001.json'),
      'utf8',
    ),
  ) as { requirements?: Record<string, unknown>[] }
  const requirement = policy.requirements?.find(
    (entry) => entry.registry_id === 'AWAIT-SHELL-BAN-VALIDATE-001',
  )
  assert.ok(requirement, 'DELEGATE-001 names AWAIT-SHELL-BAN-VALIDATE-001')
  assert.equal(requirement.phase, 'gate')
  assert.equal(requirement.executor, 'harness')
  assert.equal(requirement.enforcement, 'authoritative')

  const root = createTestTempDirectory('ban-validator-gate-')
  writeAgentFile(root, 'coder.md', 'description: Coder\ndisallowedTools: []')
  writeHooksJson(root, VALID_HOOKS)
  const result = runRequirement({
    root,
    requirement: {
      ...requirement,
      policy_id: 'DELEGATE-001',
      requirement_id: requirement.id,
      arguments: {},
    } as never,
    targetPath: '.',
    executor: 'harness',
    catalog: loadRegistry(REPO_ROOT),
    persist: false,
  })
  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'await_shell_ban.missing_from_disallowed_tools',
    ),
  )
})
