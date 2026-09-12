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
  discardedRuns,
  ownerToken,
  removalMarkers,
  runTests,
  scratchRuns,
  waitForAbsence,
  waitForPath,
} from './cli-build-helpers.js'

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

// Fixtures never touch the shared OS temp directory. The wrapper hands the
// suite a directory under the root, fences git discovery at it so a fixture
// without its own repository reads as none, and discards it when the suite
// ends, whatever the suite's exit status. How the discard is carried out is
// the next case's contract; this one pins that the directory is gone.
test('run-tests scopes the suite to a scratch directory it discards afterwards', () => {
  const fixture = createBuildScriptFixture()
  const observed = path.join(fixture.root, 'observed')

  try {
    const result = runTests(fixture, [
      '/bin/bash',
      '-c',
      `printf '%s\\n%s\\n' "$PANCREATOR_TEST_TMP" "$GIT_CEILING_DIRECTORIES" > "${observed}"; test -d "$PANCREATOR_TEST_TMP"; exit 7`,
    ])

    assert.equal(result.status, 7, result.stderr)

    const [scratch, ceiling] = readFileSync(observed, 'utf8').split('\n')

    assert.ok(scratch)
    assert.equal(
      path.dirname(scratch),
      path.join(fixture.root, 'runtime', 'tmp', 'tests'),
    )
    assert.match(path.basename(scratch), /^run-/u)
    assert.equal(ceiling?.split(':')[0], scratch)
    assert.equal(existsSync(scratch), false)
    assert.deepEqual(scratchRuns(fixture.root), [])
    // A fixture's .js files must not inherit this checkout's module type.
    assert.equal(
      readFileSync(path.join(path.dirname(scratch), 'package.json'), 'utf8'),
      '{}\n',
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

// A run killed outright skips its own cleanup, so the next run sweeps what it
// left. The sweep uses the same pid-plus-start-time identity as the build
// lock: a directory naming a recycled pid is garbage, a live run's is not.
test('run-tests sweeps scratch left by a dead run and keeps a live one', () => {
  const fixture = createBuildScriptFixture()
  const squatter = spawn('/bin/sleep', ['30'])
  const holder = spawn('/bin/sleep', ['30'])
  const scratch = path.join(fixture.root, 'runtime', 'tmp', 'tests')

  try {
    assert.ok(squatter.pid)
    assert.ok(holder.pid)

    mkdirSync(path.join(scratch, 'run-dead'), { recursive: true })
    writeFileSync(
      path.join(scratch, 'run-dead', '.owner'),
      `${squatter.pid}\nMonJan109:00:002001\n`,
    )
    writeFileSync(path.join(scratch, 'run-dead', 'fixture'), '')

    mkdirSync(path.join(scratch, 'run-live'), { recursive: true })
    writeFileSync(
      path.join(scratch, 'run-live', '.owner'),
      `${holder.pid}\n${ownerToken(holder.pid)}\n`,
    )

    const result = runTests(fixture, ['/usr/bin/true'])

    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(scratchRuns(fixture.root), ['run-live'])
  } finally {
    squatter.kill()
    holder.kill()
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

// Removing the scratch tree in the foreground charged the suite 115 seconds
// after its last assertion. The wrapper now renames the tree and hands it to
// a detached remover, so the command's exit no longer waits on the unlinks.
test('run-tests exits while the removal of its scratch is still running', async () => {
  const fixture = createBuildScriptFixture()
  const slowRemove = path.join(fixture.root, 'tools', 'rm')

  try {
    // A remover that takes its time makes the handoff observable: a wrapper
    // that still deleted in the foreground could not return before it ended.
    writeFileSync(
      slowRemove,
      ['#!/usr/bin/env bash', '/bin/sleep 3', 'exec /bin/rm "$@"', ''].join(
        '\n',
      ),
    )
    chmodSync(slowRemove, 0o755)

    const result = runTests(fixture, ['/usr/bin/true'])

    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(scratchRuns(fixture.root), [])

    const discarded = discardedRuns(fixture.root)
    const markers = removalMarkers(fixture.root)

    assert.equal(discarded.length, 1)
    assert.deepEqual(markers, [
      `.removing-${discarded[0]?.replace('discarded-', '')}`,
    ])

    const scratch = path.join(fixture.root, 'runtime', 'tmp', 'tests')
    const [remover] = readFileSync(
      path.join(scratch, markers[0] as string),
      'utf8',
    ).split('\n')

    assert.match(remover ?? '', /^[0-9]+$/u)
    // The named remover is the process still holding the tree open, which is
    // what lets the next run's sweep tell "working" from "died".
    assert.doesNotThrow(() => process.kill(Number(remover), 0))

    await waitForAbsence(path.join(scratch, discarded[0] as string))
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

// A detached removal dies with a SIGKILLed run just as the run's own cleanup
// does, so the discarded tree needs the same sweep the run directory gets.
test('run-tests sweeps a discarded tree whose remover is gone', () => {
  const fixture = createBuildScriptFixture()
  const squatter = spawn('/bin/sleep', ['30'])
  const holder = spawn('/bin/sleep', ['30'])
  const scratch = path.join(fixture.root, 'runtime', 'tmp', 'tests')

  try {
    assert.ok(squatter.pid)
    assert.ok(holder.pid)

    mkdirSync(path.join(scratch, 'discarded-dead'), { recursive: true })
    writeFileSync(path.join(scratch, 'discarded-dead', 'fixture'), '')
    writeFileSync(
      path.join(scratch, '.removing-dead'),
      `${squatter.pid}\nMonJan109:00:002001\n`,
    )

    mkdirSync(path.join(scratch, 'discarded-live'), { recursive: true })
    writeFileSync(
      path.join(scratch, '.removing-live'),
      `${holder.pid}\n${ownerToken(holder.pid)}\n`,
    )

    // A removal that finished before anyone swept leaves only its marker.
    writeFileSync(
      path.join(scratch, '.removing-finished'),
      `${holder.pid}\n${ownerToken(holder.pid)}\n`,
    )

    const result = runTests(fixture, ['/usr/bin/true'])

    assert.equal(result.status, 0, result.stderr)

    const discarded = discardedRuns(fixture.root).filter(
      (entry) => entry === 'discarded-dead' || entry === 'discarded-live',
    )

    assert.deepEqual(discarded, ['discarded-live'])
    assert.equal(existsSync(path.join(scratch, '.removing-dead')), false)
    assert.equal(existsSync(path.join(scratch, '.removing-finished')), false)
    assert.equal(existsSync(path.join(scratch, '.removing-live')), true)
  } finally {
    squatter.kill()
    holder.kill()
    rmSync(fixture.root, { recursive: true, force: true })
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
