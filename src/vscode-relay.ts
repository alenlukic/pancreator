import path from 'node:path'

import { canonicalize, fileExists, isRecord, readJson } from './lib/io.js'
import { reminderRelayLifecycle } from './lib/governance/prompt-context/relay-lifecycle.js'

interface Disposable {
  dispose(): unknown
}

interface WorkspaceFolder {
  uri: { scheme: string; fsPath: string }
}

interface VscodeRelayHost {
  workspace: {
    isTrusted: boolean
    workspaceFolders?: readonly WorkspaceFolder[]
    getConfiguration(
      section: string,
      resource: WorkspaceFolder['uri'],
    ): {
      get(key: string): unknown
    }
    onDidChangeWorkspaceFolders(listener: () => void): Disposable
    onDidGrantWorkspaceTrust(listener: () => void): Disposable
    onDidChangeConfiguration(listener: () => void): Disposable
  }
  commands: {
    registerCommand(id: string, callback: () => Promise<void>): Disposable
  }
  window: {
    createOutputChannel(
      name: string,
    ): Disposable & { appendLine(text: string): void }
  }
}

/** Locate a source, embedded, or explicitly configured detached Pancreator install. */
export function findVscodeRelayRoot(
  workspace: string,
  configured?: string,
): string | undefined {
  const candidates = configured
    ? [path.resolve(workspace, configured)]
    : [workspace, path.join(workspace, '.pancreator')]

  for (const candidate of candidates) {
    try {
      const manifest = readJson(path.join(candidate, 'package.json'))

      if (
        isRecord(manifest) &&
        manifest.name === 'pancreator-v2-prototype' &&
        fileExists(path.join(candidate, 'config.json')) &&
        fileExists(path.join(candidate, 'bin/pan'))
      ) {
        return canonicalize(candidate)
      }
    } catch {
      // Ordinary workspace folders need not contain a harness.
    }
  }
  return undefined
}

/** Bind idempotent relay commands to VS Code activation, workspace changes, and shutdown. */
export async function activateRelayExtension(
  host: VscodeRelayHost,
  context: { subscriptions: Disposable[] },
  lifecycle = reminderRelayLifecycle,
): Promise<{ deactivate(): Promise<void> }> {
  const roots = new Set<string>()
  const output = host.window.createOutputChannel('Pancreator Reminder Relay')
  let queue = Promise.resolve()
  let closing = false

  const stop = async (): Promise<void> => {
    for (const root of roots) {
      await lifecycle(root, 'stop', { ownerPid: process.pid })
      roots.delete(root)
    }
  }
  const start = async (): Promise<void> => {
    if (closing || !host.workspace.isTrusted) {
      return
    }

    const wanted = new Map<string, number>()

    for (const folder of host.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme !== 'file') {
        continue
      }

      const configuration = host.workspace.getConfiguration(
        'pancreator.reminderRelay',
        folder.uri,
      )

      if (configuration.get('enabled') === false) {
        continue
      }

      const configured = configuration.get('harnessPath')
      const root = findVscodeRelayRoot(
        folder.uri.fsPath,
        typeof configured === 'string' && configured ? configured : undefined,
      )

      if (root) {
        const port = configuration.get('port')
        wanted.set(root, typeof port === 'number' ? port : 4040)
      }
    }

    for (const root of roots) {
      if (!wanted.has(root)) {
        await lifecycle(root, 'stop', { ownerPid: process.pid })
        roots.delete(root)
      }
    }

    for (const [root, port] of wanted) {
      const result = await lifecycle(root, 'start', {
        ownerPid: process.pid,
        port,
      })
      roots.add(root)
      output.appendLine(`${root}: ${result.status} ${result.url ?? ''}`)
    }
  }
  const enqueue = (action: () => Promise<void>): Promise<void> => {
    queue = queue.then(action).catch((error: unknown) => {
      output.appendLine(
        `Relay lifecycle failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    return queue
  }
  const refresh = (): void => {
    void enqueue(start)
  }

  context.subscriptions.push(
    output,
    host.commands.registerCommand('pancreator.reminderRelay.start', () =>
      enqueue(start),
    ),
    host.commands.registerCommand('pancreator.reminderRelay.stop', () =>
      enqueue(stop),
    ),
    host.workspace.onDidChangeWorkspaceFolders(refresh),
    host.workspace.onDidGrantWorkspaceTrust(refresh),
    host.workspace.onDidChangeConfiguration(refresh),
  )
  await enqueue(start)

  return {
    deactivate: async () => {
      closing = true
      await enqueue(stop)
    },
  }
}
