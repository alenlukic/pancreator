import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

import {
  PAN,
  ROOT,
  createBuildScriptFixture,
  waitForPath,
} from './cli-build-helpers.js'

test('importing the compiled CLI emits nothing while executing it reaches the command', () => {
  // The entrypoint guard keeps `main()` from running when another module
  // imports the CLI for its exports. No test held it, so removing the guard
  // would have let every importer run the CLI and print its usage.
  const cli = path.join(ROOT, 'dist', 'src', 'cli.js')
  const imported = spawnSync(
    process.execPath,
    [
      '--no-warnings',
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(cli)})`,
    ],
    { cwd: ROOT, encoding: 'utf8', timeout: 60_000 },
  )

  assert.equal(imported.status, 0, imported.stderr)
  assert.equal(imported.stdout, '')
  assert.equal(imported.stderr, '')

  const executed = spawnSync(process.execPath, ['--no-warnings', cli, 'help'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  })

  assert.equal(executed.status, 0, executed.stderr)
  assert.match(executed.stdout, /^Usage:$/mu)
})

test('pan reuses the prepared build during a repository test run', () => {
  const toolDirectory = createTestTempDirectory('pancreator-tools-')
  // The repository root always carries a fresh stamp, so a spawn there cannot
  // tell a honored bypass from a build that was never due. A fixture root has
  // no dist/.build-stamp at all, which makes a compile due and the bypass the
  // only reason the fake compiler can stay unused.
  const stale = createBuildScriptFixture()
  const buildsLog = path.join(stale.root, 'builds.log')

  try {
    symlinkSync(process.execPath, path.join(toolDirectory, 'node'))

    const result = spawnSync('/bin/bash', [PAN, '--help'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        PANCREATOR_BUILD_READY: '1',
        PATH: `${toolDirectory}:/usr/bin:/bin`,
      },
    })

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Usage:/u)
    assert.match(result.stdout, /pan inbox \[--json\]/u)

    const reused = spawnSync(
      '/bin/bash',
      [stale.runBuilt, '--', '/usr/bin/true'],
      {
        cwd: stale.root,
        encoding: 'utf8',
        env: { ...stale.env, PANCREATOR_BUILD_READY: '1' },
        timeout: 30_000,
      },
    )

    assert.equal(reused.status, 0, reused.stderr)
    assert.equal(
      existsSync(buildsLog),
      false,
      'the ready bypass MUST skip the compile a stale stamp would otherwise force',
    )

    const compiled = spawnSync(
      '/bin/bash',
      [stale.runBuilt, '--', '/usr/bin/true'],
      {
        cwd: stale.root,
        encoding: 'utf8',
        env: stale.env,
        timeout: 30_000,
      },
    )

    assert.equal(compiled.status, 0, compiled.stderr)
    assert.equal(readFileSync(buildsLog, 'utf8'), 'build\n')
  } finally {
    rmSync(toolDirectory, { recursive: true, force: true })
    rmSync(stale.root, { recursive: true, force: true })
  }
})

test('run-built exits after the requested command completes', () => {
  const fixture = createBuildScriptFixture()

  try {
    // Content after the run branch is outside the wrapper contract.
    appendFileSync(fixture.runBuilt, 'ch\n')

    const result = spawnSync(
      '/bin/bash',
      [fixture.runBuilt, '--', '/usr/bin/true'],
      {
        cwd: fixture.root,
        encoding: 'utf8',
        env: fixture.env,
      },
    )

    assert.equal(result.status, 0, result.stderr)

    const failure = spawnSync(
      '/bin/bash',
      [fixture.runBuilt, '--', '/usr/bin/false'],
      {
        cwd: fixture.root,
        encoding: 'utf8',
        env: fixture.env,
      },
    )

    assert.equal(failure.status, 1, failure.stderr)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('run-built bypasses quiet capture when the build stamp is fresh', () => {
  const fixture = createBuildScriptFixture()
  const quietRunner = path.join(fixture.root, 'bin', 'run-quiet')

  try {
    const initial = spawnSync(
      '/bin/bash',
      [fixture.runBuilt, '--', '/usr/bin/true'],
      {
        cwd: fixture.root,
        encoding: 'utf8',
        env: fixture.env,
      },
    )

    assert.equal(initial.status, 0, initial.stderr)

    writeFileSync(quietRunner, '#!/usr/bin/env bash\nexit 91\n')
    chmodSync(quietRunner, 0o755)

    const fresh = spawnSync(
      '/bin/bash',
      [fixture.runBuilt, '--', '/usr/bin/true'],
      {
        cwd: fixture.root,
        encoding: 'utf8',
        env: fixture.env,
      },
    )

    assert.equal(fresh.status, 0, fresh.stderr)

    writeFileSync(path.join(fixture.root, 'package.json'), '{}\n')

    const stale = spawnSync(
      '/bin/bash',
      [fixture.runBuilt, '--', '/usr/bin/true'],
      {
        cwd: fixture.root,
        encoding: 'utf8',
        env: fixture.env,
      },
    )

    assert.equal(stale.status, 91, stale.stderr)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('nested build-only reuses the prepared build in the same root', () => {
  const fixture = createBuildScriptFixture()
  const second = createBuildScriptFixture()

  try {
    // Without root-scoped reuse this nested build-only call spins on the lock
    // its own ancestor holds until the timeout kills it.
    const result = spawnSync(
      '/bin/bash',
      [fixture.runBuilt, '--', fixture.runBuilt, '--build-only'],
      {
        cwd: fixture.root,
        encoding: 'utf8',
        env: fixture.env,
        timeout: 30_000,
      },
    )

    assert.equal(result.status, 0, result.stderr)
    assert.equal(
      readFileSync(path.join(fixture.root, 'builds.log'), 'utf8'),
      'build\n',
    )

    // A prepared build in one root does not skip builds in another root.
    const crossRoot = spawnSync(
      '/bin/bash',
      [fixture.runBuilt, '--', second.runBuilt, '--build-only'],
      {
        cwd: fixture.root,
        encoding: 'utf8',
        env: fixture.env,
        timeout: 30_000,
      },
    )

    assert.equal(crossRoot.status, 0, crossRoot.stderr)
    assert.equal(
      readFileSync(path.join(second.root, 'builds.log'), 'utf8'),
      'build\n',
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
    rmSync(second.root, { recursive: true, force: true })
  }
})

test('build-only recompiles changed sources even when the root is marked ready', () => {
  const fixture = createBuildScriptFixture()
  const buildsLog = path.join(fixture.root, 'builds.log')
  const runBuildOnly = (env: NodeJS.ProcessEnv) =>
    spawnSync('/bin/bash', [fixture.runBuilt, '--build-only'], {
      cwd: fixture.root,
      encoding: 'utf8',
      env,
      timeout: 30_000,
    })

  try {
    const first = runBuildOnly(fixture.env)

    assert.equal(first.status, 0, first.stderr)

    // A command that started after this build changed the sources, the way
    // a land merges a tip that deletes a test, and left a compiled file the
    // new sources no longer produce.
    const staleOutput = path.join(fixture.root, 'dist', 'stale-test.js')

    writeFileSync(staleOutput, '')
    mkdirSync(path.join(fixture.root, 'src'), { recursive: true })
    writeFileSync(path.join(fixture.root, 'src', 'merged.ts'), 'export {}\n')

    const ready = { ...fixture.env, PANCREATOR_BUILD_READY: fixture.root }
    const second = runBuildOnly(ready)

    assert.equal(second.status, 0, second.stderr)
    assert.equal(readFileSync(buildsLog, 'utf8'), 'build\nbuild\n')
    assert.equal(existsSync(staleOutput), false)

    // A tree that has not changed since its build pays no compile.
    const third = runBuildOnly(ready)

    assert.equal(third.status, 0, third.stderr)
    assert.equal(readFileSync(buildsLog, 'utf8'), 'build\nbuild\n')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('a long-lived wrapped command does not delay a rebuild on its root', async () => {
  const fixture = createBuildScriptFixture()
  const started = path.join(fixture.root, 'watcher-started')
  const watcher = path.join(fixture.root, 'watcher')

  try {
    writeFileSync(
      watcher,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        `touch "${started}"`,
        'sleep 30',
        '',
      ].join('\n'),
    )
    chmodSync(watcher, 0o755)

    // A watch-like command holds its run-built wrapper for its whole life.
    const longLived = spawn('/bin/bash', [fixture.runBuilt, '--', watcher], {
      cwd: fixture.root,
      env: fixture.env,
    })

    try {
      await waitForPath(started)

      // Invalidate the stamp so the next call must compile.
      writeFileSync(path.join(fixture.root, 'package.json'), '{"v":2}\n')

      const startedAt = Date.now()
      const rebuild = spawnSync(
        '/bin/bash',
        [fixture.runBuilt, '--build-only'],
        {
          cwd: fixture.root,
          encoding: 'utf8',
          env: fixture.env,
          timeout: 30_000,
        },
      )

      assert.equal(rebuild.status, 0, rebuild.stderr)
      assert.ok(
        Date.now() - startedAt < 10_000,
        'a rebuild must not wait for an unrelated long-lived wrapped command',
      )
      assert.equal(
        readFileSync(path.join(fixture.root, 'builds.log'), 'utf8'),
        'build\nbuild\n',
      )
      assert.equal(
        longLived.exitCode,
        null,
        'the wrapped command keeps running',
      )
      assert.equal(
        existsSync(path.join(fixture.root, 'dist', '.build-stamp')),
        true,
      )
    } finally {
      longLived.kill('SIGKILL')
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})
