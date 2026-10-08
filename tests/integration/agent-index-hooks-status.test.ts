/** Agent-index hook projection checks that need a real Git repository. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { agentIndexHooksStatus } from '../../src/lib/agent-index.js'
import { createTestTempDirectory } from '../temp.js'

function writeHooksJson(
  filePath: string,
  events: Record<string, string[]>,
): void {
  const hooks: Record<string, Array<{ command: string }>> = {}

  for (const [event, commands] of Object.entries(events)) {
    hooks[event] = commands.map((command) => ({ command }))
  }

  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify({ version: 1, hooks }, null, 2))
}

test('agentIndexHooksStatus counts user-level hooks only when the repository tracks its own hooks file', (t) => {
  const root = createTestTempDirectory('agent-index-hooks-')
  const userDirectory = createTestTempDirectory('agent-index-user-')
  const previous = process.env.PANCREATOR_CURSOR_USER_DIR
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' })

  process.env.PANCREATOR_CURSOR_USER_DIR = userDirectory
  t.after(() => {
    if (previous === undefined) {
      delete process.env.PANCREATOR_CURSOR_USER_DIR
    } else {
      process.env.PANCREATOR_CURSOR_USER_DIR = previous
    }
  })

  writeHooksJson(path.join(root, 'library', 'cursor', 'hooks.json'), {
    subagentStart: ['bin/pan-hook-agent-index subagentStart'],
  })
  writeHooksJson(path.join(root, '.cursor', 'hooks.json'), {
    stop: ['./team-stop'],
  })
  writeHooksJson(path.join(userDirectory, 'hooks.json'), {
    subagentStart: [
      './hooks/pan-cursor-user-hook pan-hook-agent-index subagentStart',
    ],
  })

  assert.equal(agentIndexHooksStatus(root)?.projected, false)

  git(['init', '-q'])
  git(['add', '.cursor/hooks.json'])

  assert.equal(agentIndexHooksStatus(root)?.projected, true)
})
