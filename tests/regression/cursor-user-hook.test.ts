import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

const DISPATCHER = path.join(process.cwd(), 'bin', 'pan-cursor-user-hook')

function dispatch(args: string[], payload: unknown) {
  const result = spawnSync(DISPATCHER, args, {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 20_000,
  })

  return { status: result.status, stdout: result.stdout.trim() }
}

/** A workspace holding an embedded hook stub that echoes its cwd, arguments, and payload. */
function workspaceWithHook(): string {
  const root = realpathSync(createTestTempDirectory('cursor-user-hook-'))
  const bin = path.join(root, '.pancreator', 'bin')

  mkdirSync(bin, { recursive: true })
  writeFileSync(
    path.join(bin, 'pan-hook-stub'),
    '#!/usr/bin/env python3\n' +
      'import json, os, sys\n' +
      'payload = json.load(sys.stdin)\n' +
      'print(json.dumps({"cwd": os.getcwd(), "args": sys.argv[1:], "event": payload["hook_event_name"]}))\n' +
      'sys.exit(3)\n',
    { mode: 0o755 },
  )

  return root
}

test('the user-level dispatcher runs the named hook from the workspace root holding an installation', () => {
  const root = workspaceWithHook()
  const result = dispatch(['pan-hook-stub', 'preToolUse'], {
    hook_event_name: 'preToolUse',
    workspace_roots: ['/nonexistent-workspace', root],
  })

  assert.equal(result.status, 3)
  assert.deepEqual(JSON.parse(result.stdout), {
    cwd: root,
    args: ['preToolUse'],
    event: 'preToolUse',
  })
})

test('the user-level dispatcher answers neutrally without an installation', () => {
  const roots = { workspace_roots: ['/nonexistent-workspace'] }
  const cases: Array<[string, unknown]> = [
    ['beforeShellExecution', { permission: 'allow' }],
    ['preToolUse', { permission: 'allow' }],
    ['beforeSubmitPrompt', { continue: true }],
    ['stop', {}],
  ]

  for (const [event, response] of cases) {
    const result = dispatch(['pan-hook-stub'], {
      hook_event_name: event,
      ...roots,
    })

    assert.equal(result.status, 0, event)
    assert.deepEqual(JSON.parse(result.stdout), response, event)
  }
})

test('the user-level dispatcher defers to a project hooks file that registers Pancreator hooks', () => {
  const root = workspaceWithHook()

  mkdirSync(path.join(root, '.cursor'), { recursive: true })
  writeFileSync(
    path.join(root, '.cursor', 'hooks.json'),
    JSON.stringify({
      version: 1,
      hooks: {
        preToolUse: [{ command: '.pancreator/bin/pan-hook-agent-index' }],
      },
    }),
  )

  const result = dispatch(['pan-hook-stub'], {
    hook_event_name: 'preToolUse',
    workspace_roots: [root],
  })

  assert.equal(result.status, 0)
  assert.deepEqual(JSON.parse(result.stdout), { permission: 'allow' })
})

test('the user-level dispatcher refuses a hook name outside the pan-hook namespace', () => {
  const root = workspaceWithHook()

  for (const name of ['../bin/pan-hook-stub', 'pan-stub', '']) {
    const result = dispatch([name], {
      hook_event_name: 'beforeShellExecution',
      workspace_roots: [root],
    })

    assert.equal(result.status, 0, name)
    assert.deepEqual(JSON.parse(result.stdout), { permission: 'allow' }, name)
  }
})
