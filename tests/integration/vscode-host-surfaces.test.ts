import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { projectionTargetPath } from '../../src/lib/projection.js'
import { vscodeWorktreeProtection } from '../../src/lib/vscode-worktree-protection.js'
import { createFixture } from '../fixture-template.js'
import { createTestTempDirectory } from '../temp.js'

const INSTALL_SUPPORT = path.join(process.cwd(), 'bin', 'install-support')

function write(root: string, relative: string, content = 'x\n'): void {
  const file = path.join(root, relative)

  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content)
}

test('the installer reports target-owned host surfaces and per-host collisions', () => {
  const work = createTestTempDirectory('pancreator-host-surfaces-')
  const target = path.join(work, 'target')
  const config = path.join(work, 'config.json')

  write(target, '.agents/skills/team-skill/SKILL.md')
  write(target, '.agents/skills/pan-status/SKILL.md')
  write(target, '.github/agents/reviewer.agent.md')
  write(target, '.github/hooks/team.json')
  write(target, '.github/instructions/style.instructions.md')
  write(target, '.github/instructions/pan-chat-output.instructions.md')
  write(target, '.github/copilot-instructions.md')
  write(target, '.vscode/settings.json', '{}\n')

  const detect = (hosts: string[], firstInstall: boolean): string => {
    writeFileSync(config, JSON.stringify({ hosts }))
    const result = spawnSync(
      process.execPath,
      [
        INSTALL_SUPPORT,
        'detect-existing-harness',
        '--target-root',
        target,
        '--source-root',
        process.cwd(),
        '--first-install',
        String(firstInstall),
        '--persona-config',
        config,
      ],
      { encoding: 'utf8', timeout: 60_000 },
    )

    assert.equal(result.status, 0, result.stderr)

    return result.stdout
  }

  const first = detect(['cursor'], true)

  for (const retained of [
    '.agents/skills/team-skill  (target-owned skill)',
    '.github/agents/reviewer.agent.md  (target-owned VS Code agent)',
    '.github/hooks/team.json  (target-owned hook file)',
    '.github/instructions/style.instructions.md  (target-owned VS Code instructions)',
    '.github/copilot-instructions.md  (GitHub Copilot)',
    '.vscode  (VS Code workspace settings)',
  ]) {
    assert.ok(first.includes(`retained  ${retained}`), retained)
  }

  assert.ok(!first.includes('.agents/skills/pan-status'))
  assert.ok(!first.includes('replaced'))
  assert.equal(detect(['cursor'], false), '')

  const refresh = detect(['cursor', 'vscode'], false)

  assert.ok(
    refresh.includes(
      'replaced  .github/instructions/pan-chat-output.instructions.md',
    ),
    refresh,
  )
})

test('VS Code worktree protection flags settings that reach worktree checkouts', () => {
  const root = createFixture()
  const settings = projectionTargetPath(root, '.vscode/settings.json')

  assert.equal(vscodeWorktreeProtection(root).status, 'protected')

  mkdirSync(path.dirname(settings), { recursive: true })
  writeFileSync(
    settings,
    [
      '{',
      '  // a comment with "quotes" and a // slash',
      '  "chat.useNestedAgentsMdFiles": true,',
      '  "chat.instructionsFilesLocations": {',
      '    ".github/instructions": true,',
      '    "worktrees/operator/x/.github/instructions": true,',
      '    "**/docs": false,',
      '  },',
      '}',
    ].join('\n'),
  )

  const report = vscodeWorktreeProtection(root)

  assert.equal(report.status, 'at_risk')
  assert.equal(report.risks.length, 2, report.risks.join('\n'))
  assert.match(report.risks[0] ?? '', /chat\.useNestedAgentsMdFiles/u)
  assert.match(report.risks[1] ?? '', /worktrees\/operator\/x/u)

  writeFileSync(settings, '{ not json')
  assert.equal(vscodeWorktreeProtection(root).status, 'unreadable')
})
