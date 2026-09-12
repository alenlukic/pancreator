import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

import {
  FAKE_TSC_OUT_DIR,
  ROOT,
  createBuildScriptFixture,
  ownerToken,
  reclaimEnv,
  waitForPath,
  waitForProcess,
  writeBuildLock,
} from './cli-build-helpers.js'

test('build lock keeps the CLI available during concurrent commands', async () => {
  const root = createTestTempDirectory('pancreator-build-lock-')
  const binDirectory = path.join(root, 'bin')
  const toolDirectory = path.join(root, 'tools')
  const runBuilt = path.join(binDirectory, 'run-built')
  const command = path.join(root, 'read-cli')
  const started = path.join(root, 'command-started')

  try {
    mkdirSync(binDirectory, { recursive: true })
    mkdirSync(toolDirectory, { recursive: true })
    symlinkSync(process.execPath, path.join(toolDirectory, 'node'))

    for (const script of ['build', 'run-built', 'run-quiet']) {
      const target = path.join(binDirectory, script)

      copyFileSync(path.join(ROOT, 'bin', script), target)
      chmodSync(target, 0o755)
    }

    const compiler = path.join(toolDirectory, 'tsc')

    writeFileSync(
      compiler,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        `${FAKE_TSC_OUT_DIR}`,
        'sleep 0.5',
        'mkdir -p "$out/src"',
        `printf '%s\\n' "process.stdout.write('ready')" > "$out/src/cli.js"`,
        '',
      ].join('\n'),
    )
    chmodSync(compiler, 0o755)

    writeFileSync(
      command,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        `touch "${started}"`,
        'sleep 0.2',
        'node dist/src/cli.js',
        '',
      ].join('\n'),
    )
    chmodSync(command, 0o755)

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${toolDirectory}:/usr/bin:/bin`,
    }

    delete env.PANCREATOR_BUILD_READY

    const first = spawn('/bin/bash', [runBuilt, '--', command], {
      cwd: root,
      env,
    })
    const firstResult = waitForProcess(first)

    await waitForPath(started)

    const second = spawn('/bin/bash', [runBuilt, '--', command], {
      cwd: root,
      env,
    })
    const secondResult = waitForProcess(second)

    const [firstCompleted, secondCompleted] = await Promise.all([
      firstResult,
      secondResult,
    ])

    assert.equal(firstCompleted.status, 0, firstCompleted.stderr)
    assert.equal(secondCompleted.status, 0, secondCompleted.stderr)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// The lock lives under the root, so it outlives the reboot that resets pid
// assignment. A lock abandoned by SIGKILL or by power loss can therefore name
// a pid the kernel has since given to something else, and a liveness test
// that only asks whether the pid exists would wait on that stranger forever.
test('a build lock naming a recycled pid is reclaimed', () => {
  const fixture = createBuildScriptFixture()
  // Stands in for whatever the kernel later assigned the dead holder's pid.
  const squatter = spawn('/bin/sleep', ['30'])

  try {
    assert.ok(squatter.pid)

    const lock = writeBuildLock(
      fixture.root,
      `${squatter.pid}\nMonJan109:00:002001\n`,
    )

    const result = spawnSync(
      '/bin/bash',
      [fixture.runBuilt, '--', '/usr/bin/true'],
      { cwd: fixture.root, encoding: 'utf8', env: reclaimEnv(fixture.env) },
    )

    assert.equal(result.status, 0, result.stderr)
    assert.equal(existsSync(lock), false)
  } finally {
    squatter.kill()
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('a build lock written by an older single-line wrapper is reclaimed', () => {
  const fixture = createBuildScriptFixture()
  const squatter = spawn('/bin/sleep', ['30'])

  try {
    assert.ok(squatter.pid)

    const lock = writeBuildLock(fixture.root, `${squatter.pid}\n`)

    const result = spawnSync(
      '/bin/bash',
      [fixture.runBuilt, '--', '/usr/bin/true'],
      { cwd: fixture.root, encoding: 'utf8', env: reclaimEnv(fixture.env) },
    )

    assert.equal(result.status, 0, result.stderr)
    assert.equal(existsSync(lock), false)
  } finally {
    squatter.kill()
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

// A verified holder still serializes, but every pan command passes through
// this wait, so it ends with a diagnosable failure rather than a hang.
test('a wait on a verified live lock holder ends at a bound', () => {
  const fixture = createBuildScriptFixture()
  const holder = spawn('/bin/sleep', ['30'])

  try {
    assert.ok(holder.pid)

    const lock = writeBuildLock(
      fixture.root,
      `${holder.pid}\n${ownerToken(holder.pid)}\n`,
    )

    const result = spawnSync(
      '/bin/bash',
      [fixture.runBuilt, '--', '/usr/bin/true'],
      {
        cwd: fixture.root,
        encoding: 'utf8',
        env: {
          ...fixture.env,
          PANCREATOR_BUILD_LOCK_NOTICE_SECONDS: '1',
          PANCREATOR_BUILD_LOCK_TIMEOUT_SECONDS: '2',
        },
      },
    )

    assert.equal(result.status, 1)
    assert.match(result.stderr, /gave up after 2s waiting for the build lock/u)
    // Only an unverifiable lock is reclaimed, so a live holder keeps its own.
    assert.equal(existsSync(lock), true)
  } finally {
    holder.kill()
    rmSync(fixture.root, { recursive: true, force: true })
  }
})
