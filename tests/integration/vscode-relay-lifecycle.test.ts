import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { crc32 } from 'node:zlib'

import { reminderRelayLifecycle } from '../../src/lib/governance/prompt-context/relay-lifecycle.js'
import { startReminderRelay } from '../../src/lib/governance/prompt-context/relay.js'
import { isRecord, readJson, writeJsonAtomic } from '../../src/lib/io.js'
import { packageVscodeRelay } from '../../src/vscode-relay-package.js'
import { createFixture } from '../fixture-template.js'
import { createTestTempDirectory } from '../temp.js'

async function cli(root: string, action: 'start' | 'stop'): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [
        path.join(process.cwd(), 'dist/src/cli.js'),
        'governance',
        'reminder-relay',
        action,
        '--owner-pid',
        String(process.pid),
      ],
      {
        cwd: root,
        env: { ...process.env, PANCREATOR_ROOT: root },
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message))
        } else {
          resolve(JSON.parse(stdout) as unknown)
        }
      },
    )
  })
}

test('probable_edge_case: concurrent CLI starts share a relay and repeated stops are no-ops', async () => {
  const root = createFixture()

  try {
    assert.deepEqual(await cli(root, 'stop'), { status: 'stopped' })
    writeFileSync(path.join(root, 'runtime/reminder-relay.json'), '{broken')
    const results = await Promise.all([cli(root, 'start'), cli(root, 'start')])
    assert.deepEqual(results[0], results[1])
    assert.ok(isRecord(results[0]) && results[0].status === 'running')
    const receipt = readJson(path.join(root, 'runtime/reminder-relay.json'))
    assert.deepEqual(await cli(root, 'start'), results[0])
    assert.deepEqual(
      readJson(path.join(root, 'runtime/reminder-relay.json')),
      receipt,
    )
    await cli(root, 'stop')
    assert.equal(
      existsSync(path.join(root, 'runtime/reminder-relay.json')),
      false,
    )
    assert.deepEqual(await cli(root, 'stop'), { status: 'stopped' })
  } finally {
    await reminderRelayLifecycle(root, 'stop')
  }
})

test('hidden_edge_case: shared owners survive one window closing and a crashed last owner is reaped', async () => {
  const root = createFixture()
  const owner = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  })
  await once(owner, 'spawn')
  assert.ok(owner.pid)
  const relay = await startReminderRelay(root, { ownerPid: owner.pid })

  try {
    await reminderRelayLifecycle(root, 'start', { ownerPid: process.pid })
    assert.equal(
      (await reminderRelayLifecycle(root, 'stop', { ownerPid: owner.pid }))
        .status,
      'running',
    )
    assert.equal((await fetch(`${relay.url}/pan/health`)).status, 200)
    await reminderRelayLifecycle(root, 'stop', { ownerPid: process.pid })
    await relay.closed
    assert.equal(
      existsSync(path.join(root, 'runtime/reminder-relay.json')),
      false,
    )

    const orphan = await startReminderRelay(root, { ownerPid: owner.pid })
    const exited = once(owner, 'exit')
    owner.kill('SIGTERM')
    await exited
    const guard = new AbortController()

    try {
      await Promise.race([
        orphan.closed,
        setTimeout(10_000, undefined, { signal: guard.signal }).then(() => {
          throw new Error('Relay outlived its last owner')
        }),
      ])
      assert.equal(
        existsSync(path.join(root, 'runtime/reminder-relay.json')),
        false,
      )
    } finally {
      guard.abort()
      await orphan.close()
    }
  } finally {
    owner.kill('SIGTERM')
    await relay.close()
  }
})

test('critical_unhappy_path: lifecycle refuses browser requests and incorrect relay identity', async () => {
  const root = createFixture()
  const relay = await startReminderRelay(root)

  try {
    const receipt = readJson(path.join(root, 'runtime/reminder-relay.json'))
    assert.ok(isRecord(receipt))

    for (const [relayId, origin] of [
      ['wrong', ''],
      [receipt.relay_id, 'http://example.invalid'],
    ]) {
      const response = await fetch(`${relay.url}/pan/lifecycle`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(origin ? { origin: String(origin) } : {}),
        },
        body: JSON.stringify({ action: 'stop', relay_id: relayId }),
      })
      assert.equal(response.status, 403)
    }
    await assert.rejects(
      reminderRelayLifecycle(root, 'start', { ownerPid: -1 }),
      { code: 'INVALID_REMINDER_RELAY' },
    )
    assert.equal((await fetch(`${relay.url}/pan/health`)).status, 200)
  } finally {
    await relay.close()
  }
})

function extractPackage(
  archive: Buffer,
  destination: string,
): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  const end = archive.length - 22
  assert.equal(archive.readUInt32LE(end), 0x06054b50)
  let offset = archive.readUInt32LE(end + 16)
  const count = archive.readUInt16LE(end + 10)

  for (let index = 0; index < count; index++) {
    assert.equal(archive.readUInt32LE(offset), 0x02014b50)
    const nameLength = archive.readUInt16LE(offset + 28)
    const name = archive
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString()
    const local = archive.readUInt32LE(offset + 42)
    assert.equal(archive.readUInt32LE(local), 0x04034b50)
    assert.equal(archive.readUInt16LE(local + 8), 0)
    const start =
      local +
      30 +
      archive.readUInt16LE(local + 26) +
      archive.readUInt16LE(local + 28)
    const body = archive.subarray(
      start,
      start + archive.readUInt32LE(offset + 24),
    )
    assert.equal(crc32(body), archive.readUInt32LE(offset + 16))
    assert.ok(!name.includes('..') && !path.isAbsolute(name))
    const target = path.join(destination, name)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, body)
    files.set(name, body)
    offset +=
      46 +
      nameLength +
      archive.readUInt16LE(offset + 30) +
      archive.readUInt16LE(offset + 32)
  }
  assert.equal(offset, end)
  return files
}

test('happy_path: a relocated VSIX carries its runtime and serves a separate Pancreator installation', async () => {
  const source = createTestTempDirectory('vscode-relay-package-')
  mkdirSync(path.join(source, 'library/vscode'), { recursive: true })
  mkdirSync(path.join(source, 'dist'), { recursive: true })
  writeJsonAtomic(path.join(source, 'package.json'), { version: '1.2.3' })

  for (const name of ['relay-extension.json', 'relay-extension.cjs']) {
    copyFileSync(
      path.join(process.cwd(), 'library/vscode', name),
      path.join(source, 'library/vscode', name),
    )
  }
  cpSync(path.join(process.cwd(), 'dist/src'), path.join(source, 'dist/src'), {
    recursive: true,
  })
  writeFileSync(path.join(source, '.env'), 'EXCLUDED_FROM_PACKAGE=private')
  const archive = readFileSync(packageVscodeRelay(source))
  const destination = createTestTempDirectory('relocated-vscode-relay-')
  const files = extractPackage(archive, destination)
  const manifest: unknown = JSON.parse(
    files.get('extension/package.json')!.toString(),
  )
  assert.ok(isRecord(manifest))
  assert.deepEqual(manifest.activationEvents, ['onStartupFinished'])
  assert.equal(manifest.version, '1.2.3')
  assert.equal(manifest.main, './extension.cjs')
  assert.ok(
    files.has('extension/runtime/lib/governance/prompt-context/relay.js'),
  )
  assert.ok(
    ![...files.keys()].some(
      (name) =>
        name.includes('.env') ||
        name.includes('node_modules') ||
        name.includes('/tests/'),
    ),
  )
  assert.deepEqual(readFileSync(packageVscodeRelay(source)), archive)

  const loaded: unknown = await import(
    pathToFileURL(
      path.join(
        destination,
        'extension/runtime/lib/governance/prompt-context/relay-lifecycle.js',
      ),
    ).href
  )
  assert.ok(
    isRecord(loaded) && typeof loaded.reminderRelayLifecycle === 'function',
  )
  const lifecycle =
    loaded.reminderRelayLifecycle as typeof reminderRelayLifecycle
  const target = createFixture()

  try {
    const result = await lifecycle(target, 'start', { ownerPid: process.pid })
    assert.equal(result.status, 'running')
    assert.ok(result.url)
    const health = await fetch(`${result.url.slice(0, -3)}/pan/health`)
    assert.equal(health.status, 200)
    await lifecycle(target, 'stop', { ownerPid: process.pid })
    assert.equal(
      existsSync(path.join(target, 'runtime/reminder-relay.json')),
      false,
    )
  } finally {
    await lifecycle(target, 'stop')
  }
})
