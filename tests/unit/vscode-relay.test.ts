import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  activateRelayExtension,
  findVscodeRelayRoot,
} from '../../src/vscode-relay.js'
import { createTestTempDirectory } from '../temp.js'

function harness(root: string): void {
  mkdirSync(path.join(root, 'bin'), { recursive: true })
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'pancreator-v2-prototype' }),
  )
  writeFileSync(path.join(root, 'config.json'), '{}')
  writeFileSync(path.join(root, 'bin/pan'), '')
}

function hostFixture(workspace: string) {
  const commands = new Map<string, () => Promise<void>>()
  const listeners = new Map<string, () => void>()
  const log: string[] = []
  const configuration = new Map<string, unknown>()
  const disposable = { dispose() {} }
  const host = {
    workspace: {
      isTrusted: true,
      workspaceFolders: [{ uri: { scheme: 'file', fsPath: workspace } }],
      getConfiguration: () => ({
        get: (key: string) => configuration.get(key),
      }),
      onDidChangeWorkspaceFolders: (listener: () => void) => {
        listeners.set('folders', listener)
        return disposable
      },
      onDidGrantWorkspaceTrust: (listener: () => void) => {
        listeners.set('trust', listener)
        return disposable
      },
      onDidChangeConfiguration: (listener: () => void) => {
        listeners.set('configuration', listener)
        return disposable
      },
    },
    commands: {
      registerCommand: (id: string, callback: () => Promise<void>) => {
        commands.set(id, callback)
        return disposable
      },
    },
    window: {
      createOutputChannel: () => ({
        ...disposable,
        appendLine: (text: string) => {
          log.push(text)
        },
      }),
    },
  }
  return { host, commands, listeners, log, configuration }
}

test('happy_path: VS Code activation, repeatable commands, and deactivation own relay lifecycle', async () => {
  const root = createTestTempDirectory('vscode-relay-host-')
  harness(root)
  const { host, commands } = hostFixture(root)
  const calls: string[] = []
  const active = new Set<string>()
  const extension = await activateRelayExtension(
    host,
    { subscriptions: [] },
    async (workspace, action, options) => {
      assert.equal(options?.ownerPid, process.pid)
      calls.push(action)

      if (action === 'start') {
        active.add(workspace)
      } else {
        active.delete(workspace)
      }
      return { status: action === 'start' ? 'running' : 'stopped' }
    },
  )
  assert.equal(active.size, 1)
  await commands.get('pancreator.reminderRelay.start')?.()
  await commands.get('pancreator.reminderRelay.stop')?.()
  await commands.get('pancreator.reminderRelay.stop')?.()
  assert.equal(active.size, 0)
  await commands.get('pancreator.reminderRelay.start')?.()
  await extension.deactivate()
  await extension.deactivate()
  assert.equal(active.size, 0)
  assert.deepEqual(calls, ['start', 'start', 'stop', 'start', 'stop'])
})

test('probable_edge_case: discovery handles source, embedded, detached, ordinary, and virtual workspaces', async () => {
  const root = createTestTempDirectory('vscode-relay-discovery-')
  const embedded = path.join(root, 'target/.pancreator')
  const detached = path.join(root, 'separate harness')
  harness(embedded)
  harness(detached)
  assert.equal(findVscodeRelayRoot(path.dirname(embedded)), embedded)
  assert.equal(findVscodeRelayRoot(root, 'separate harness'), detached)
  assert.equal(findVscodeRelayRoot(root, detached), detached)
  assert.equal(findVscodeRelayRoot(root), undefined)
  assert.equal(findVscodeRelayRoot(root, 'missing'), undefined)

  const { host, configuration } = hostFixture(detached)
  const calls: string[] = []
  host.workspace.isTrusted = false
  const lifecycle = async (_root: string, action: 'start' | 'stop') => {
    calls.push(action)
    return { status: 'running' as const }
  }
  const extension = await activateRelayExtension(
    host,
    { subscriptions: [] },
    lifecycle,
  )
  await extension.deactivate()
  assert.deepEqual(calls, [])
  host.workspace.isTrusted = true
  configuration.set('enabled', false)
  await (
    await activateRelayExtension(host, { subscriptions: [] }, lifecycle)
  ).deactivate()
  configuration.set('enabled', true)
  host.workspace.workspaceFolders[0]!.uri.scheme = 'vscode-remote'
  await (
    await activateRelayExtension(host, { subscriptions: [] }, lifecycle)
  ).deactivate()
  assert.deepEqual(calls, [])
})

test('hidden_edge_case: deactivation waits for an in-flight start before releasing ownership', async () => {
  const root = createTestTempDirectory('vscode-relay-order-')
  harness(root)
  const { host, commands } = hostFixture(root)
  let release: (() => void) | undefined
  let entered: (() => void) | undefined
  const starting = new Promise<void>((resolve) => {
    entered = resolve
  })
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const calls: string[] = []
  const extension = await activateRelayExtension(
    host,
    { subscriptions: [] },
    async (_root, action) => {
      calls.push(action)

      if (calls.length === 2) {
        entered?.()
        await blocked
      }
      return { status: action === 'start' ? 'running' : 'stopped' }
    },
  )
  const start = commands.get('pancreator.reminderRelay.start')?.()
  await starting
  const stop = extension.deactivate()
  assert.deepEqual(calls, ['start', 'start'])
  release?.()
  await Promise.all([start, stop])
  assert.deepEqual(calls, ['start', 'start', 'stop'])
})
