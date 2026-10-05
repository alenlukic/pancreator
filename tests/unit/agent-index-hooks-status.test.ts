/** Tests for the agent-index hook projection check. */
import assert from 'node:assert/strict'
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

test('agentIndexHooksStatus is null with no canonical hooks.json to compare against', () => {
  const root = createTestTempDirectory('agent-index-hooks-')

  assert.equal(agentIndexHooksStatus(root), null)
})

test('agentIndexHooksStatus reports every canonical agent-index event a stale projection lacks', () => {
  const root = createTestTempDirectory('agent-index-hooks-')

  writeHooksJson(path.join(root, 'library', 'cursor', 'hooks.json'), {
    preToolUse: [
      'bin/pan-hook-deny-await-shell',
      'bin/pan-hook-agent-index preToolUse',
    ],
    postToolUse: ['bin/pan-hook-agent-index postToolUse'],
    subagentStart: ['bin/pan-hook-agent-index subagentStart'],
  })
  // The projected file predates the agent-index hooks: it still wires the
  // deny hook, but never the agent-index one, and carries no subagentStart
  // entry at all.
  writeHooksJson(path.join(root, '.cursor', 'hooks.json'), {
    preToolUse: ['bin/pan-hook-deny-await-shell'],
    postToolUse: ['bin/pan-hook-agent-index postToolUse'],
  })

  const status = agentIndexHooksStatus(root)

  assert.equal(status?.projected, false)
  assert.deepEqual([...(status?.missing_events ?? [])].sort(), [
    'preToolUse',
    'subagentStart',
  ])
})

test('agentIndexHooksStatus reports current when the projection carries every agent-index hook', () => {
  const root = createTestTempDirectory('agent-index-hooks-')

  writeHooksJson(path.join(root, 'library', 'cursor', 'hooks.json'), {
    preToolUse: ['bin/pan-hook-agent-index preToolUse'],
    subagentStart: ['bin/pan-hook-agent-index subagentStart'],
  })
  writeHooksJson(path.join(root, '.cursor', 'hooks.json'), {
    preToolUse: ['bin/pan-hook-agent-index preToolUse'],
    subagentStart: ['bin/pan-hook-agent-index subagentStart'],
  })

  const status = agentIndexHooksStatus(root)

  assert.equal(status?.projected, true)
  assert.deepEqual(status?.missing_events, [])
})

test('agentIndexHooksStatus reports every event missing when the projected file is absent', () => {
  const root = createTestTempDirectory('agent-index-hooks-')

  writeHooksJson(path.join(root, 'library', 'cursor', 'hooks.json'), {
    subagentStart: ['bin/pan-hook-agent-index subagentStart'],
  })

  const status = agentIndexHooksStatus(root)

  assert.equal(status?.projected, false)
  assert.deepEqual(status?.missing_events, ['subagentStart'])
})

test('agentIndexHooksStatus names a stale VS Code projection when the vscode host is enabled', () => {
  const root = createTestTempDirectory('agent-index-hooks-')
  const vscodeSource = (events: string[]): unknown => ({
    version: 1,
    hooks: Object.fromEntries(
      events.map((event) => [
        event,
        [{ type: 'command', bash: `bin/pan-hook-agent-index ${event}` }],
      ]),
    ),
  })

  writeFileSync(
    path.join(root, 'config.json'),
    JSON.stringify({
      schema_version: 1,
      workspace_root: '.',
      hosts: ['cursor', 'vscode'],
    }),
  )
  writeHooksJson(path.join(root, 'library', 'cursor', 'hooks.json'), {
    subagentStart: ['bin/pan-hook-agent-index subagentStart'],
  })
  writeHooksJson(path.join(root, '.cursor', 'hooks.json'), {
    subagentStart: ['bin/pan-hook-agent-index subagentStart'],
  })
  mkdirSync(path.join(root, 'library', 'vscode'), { recursive: true })
  writeFileSync(
    path.join(root, 'library', 'vscode', 'hooks.json'),
    JSON.stringify(vscodeSource(['preToolUse', 'subagentStop'])),
  )
  mkdirSync(path.join(root, '.github', 'hooks'), { recursive: true })
  writeFileSync(
    path.join(root, '.github', 'hooks', 'pan-hooks.json'),
    JSON.stringify(vscodeSource(['preToolUse'])),
  )

  const status = agentIndexHooksStatus(root)

  assert.equal(status?.projected, false)
  assert.deepEqual(status?.missing_events, ['subagentStop'])
  assert.deepEqual(
    status?.projections.map((entry) => [entry.path, entry.projected]),
    [
      ['.cursor/hooks.json', true],
      ['.github/hooks/pan-hooks.json', false],
    ],
  )
})
