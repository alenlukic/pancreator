import { spawn } from 'node:child_process'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { PanError } from '../../errors.js'
import { canonicalize, isRecord, readJson } from '../../io.js'

interface RelayReceipt {
  url: string
  relay_id: string
}

async function runningRelay(root: string): Promise<RelayReceipt | undefined> {
  try {
    const receipt = readJson(path.join(root, 'runtime/reminder-relay.json'))

    if (
      !isRecord(receipt) ||
      receipt.workspace !== canonicalize(root) ||
      typeof receipt.url !== 'string' ||
      !/^http:\/\/127\.0\.0\.1:\d+$/u.test(receipt.url) ||
      typeof receipt.relay_id !== 'string'
    ) {
      return undefined
    }

    const response = await fetch(`${receipt.url}/pan/health`, {
      signal: AbortSignal.timeout(500),
    })
    const health: unknown = await response.json()

    if (
      response.ok &&
      isRecord(health) &&
      health.workspace === canonicalize(root) &&
      health.relay_id === receipt.relay_id
    ) {
      return { url: receipt.url, relay_id: receipt.relay_id }
    }
  } catch {
    // Missing, stale, and corrupt discovery all mean no usable relay.
  }
  return undefined
}

/** Start or stop the workspace relay idempotently; VS Code owners share one process. */
export async function reminderRelayLifecycle(
  root: string,
  action: 'start' | 'stop',
  options: {
    ownerPid?: number
    port?: number
    full?: boolean
    cache?: boolean
  } = {},
): Promise<{ status: 'running' | 'stopped'; url?: string }> {
  if (
    options.ownerPid !== undefined &&
    (!Number.isSafeInteger(options.ownerPid) || options.ownerPid <= 0)
  ) {
    throw new PanError('Relay owner must be a positive process id.', {
      code: 'INVALID_REMINDER_RELAY',
    })
  }

  if (
    options.port !== undefined &&
    (!Number.isInteger(options.port) ||
      options.port < 0 ||
      options.port > 65535)
  ) {
    throw new PanError('Relay port must be between 0 and 65535.', {
      code: 'INVALID_REMINDER_RELAY',
    })
  }

  let relay = await runningRelay(root)

  if (!relay && action === 'stop') {
    return { status: 'stopped' }
  }

  if (!relay) {
    const args = [
      fileURLToPath(new URL('../../../cli.js', import.meta.url)),
      'governance',
      'reminder-relay',
      '--port',
      String(options.port ?? 0),
    ]

    if (options.ownerPid !== undefined) {
      args.push('--owner-pid', String(options.ownerPid))
    }

    if (options.full) {
      args.push('--full')
    }

    if (options.cache === false) {
      args.push('--no-prompt-cache')
    }

    const child = spawn(process.execPath, args, {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PANCREATOR_ROOT: root },
    })
    let launchError: Error | undefined
    child.once('error', (error) => {
      launchError = error
    })
    child.unref()

    const deadline = Date.now() + 10_000

    while (!relay && Date.now() < deadline && !launchError) {
      await setTimeout(50)
      relay = await runningRelay(root)
    }

    if (!relay) {
      throw new PanError(
        `Reminder relay failed to start${launchError ? `: ${launchError.message}` : '.'}`,
        {
          code: 'REMINDER_RELAY_START_FAILED',
        },
      )
    }
  }

  const response = await fetch(`${relay.url}/pan/lifecycle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action,
      relay_id: relay.relay_id,
      owner_pid: options.ownerPid,
    }),
    signal: AbortSignal.timeout(2000),
  })
  const result: unknown = await response.json()

  if (
    !response.ok ||
    !isRecord(result) ||
    (result.status !== 'running' && result.status !== 'stopped')
  ) {
    throw new PanError('The relay refused the lifecycle command.', {
      code: 'REMINDER_RELAY_LIFECYCLE_FAILED',
    })
  }

  if (result.status === 'stopped') {
    const deadline = Date.now() + 2000

    while (
      Date.now() < deadline &&
      (await runningRelay(root))?.relay_id === relay.relay_id
    ) {
      await setTimeout(25)
    }

    if ((await runningRelay(root))?.relay_id === relay.relay_id) {
      throw new PanError('The relay did not finish shutting down.', {
        code: 'REMINDER_RELAY_STOP_FAILED',
      })
    }
  }

  return { status: result.status, url: `${relay.url}/v1` }
}
