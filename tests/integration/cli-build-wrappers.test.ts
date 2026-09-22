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
  waitForProcess,
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

// Two files share the unit lane so the negative case can withhold one file
// while every lane is still represented. A matcher that only checked the lane
// names would record that subset, and a one-file-per-lane fixture could not
// tell the two implementations apart.
test('run-tests records only the complete configured fast lane', () => {
  const fixture = createBuildScriptFixture()
  const durationRecord = path.join(
    fixture.root,
    'runtime',
    'tmp',
    'tests.noindex',
    'file-durations.json',
  )
  const observed = path.join(fixture.root, 'fast-wall-call')

  const testFiles = [
    'dist/tests/unit/unit.test.js',
    'dist/tests/unit/second-unit.test.js',
    'dist/tests/integration/integration.test.js',
    'dist/tests/regression/regression.test.js',
  ]
  const allLanesOneFileShort = testFiles.filter(
    (file) => file !== 'dist/tests/unit/second-unit.test.js',
  )

  try {
    for (const file of testFiles) {
      mkdirSync(path.dirname(path.join(fixture.root, file)), {
        recursive: true,
      })
      writeFileSync(path.join(fixture.root, file), '')
    }

    writeFileSync(
      path.join(fixture.root, 'dist', 'src', 'cli.js'),
      `require('node:fs').appendFileSync(${JSON.stringify(observed)}, process.argv.slice(2).join(' ') + '\\n')\n`,
    )
    mkdirSync(path.dirname(durationRecord), { recursive: true })
    writeFileSync(
      durationRecord,
      JSON.stringify({
        schema_version: 1,
        recorded_at: '2026-09-15T00:00:00.000Z',
        lane: 'integration+regression+unit',
        wall_clock_ms: 100,
        test_count: 4,
        files: testFiles.map((file) => ({ file, duration_ms: 1 })),
      }),
    )

    const env = { ...fixture.env, npm_lifecycle_event: 'test' }
    const partial = spawnSync(
      '/bin/bash',
      [
        path.join(fixture.root, 'bin', 'run-tests'),
        '--',
        '/usr/bin/true',
        ...allLanesOneFileShort,
      ],
      { cwd: fixture.root, encoding: 'utf8', env },
    )

    assert.equal(partial.status, 0, partial.stderr)
    assert.equal(existsSync(observed), false)

    const complete = spawnSync(
      '/bin/bash',
      [
        path.join(fixture.root, 'bin', 'run-tests'),
        '--',
        '/usr/bin/true',
        ...testFiles,
      ],
      { cwd: fixture.root, encoding: 'utf8', env },
    )

    assert.equal(complete.status, 0, complete.stderr)
    const recordCommand = readFileSync(observed, 'utf8')

    assert.match(recordCommand, /^tests record-fast-wall .*--worker-count /u)
    assert.match(recordCommand, /--load-average [0-9.]+/u)
    assert.match(recordCommand, /--cpu-count [1-9][0-9]*/u)
    assert.match(recordCommand, /--caller-class standalone/u)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

// Bash 3.2 treats an empty array as unset under `set -u`, so the matcher keeps
// a sentinel element and compares counts. Without the explicit `expected_count
// -gt 0` guard a tree with no compiled lane files matches an empty argument
// list and records a run that never happened.
test('run-tests records nothing when the compiled fast lane is empty', () => {
  const fixture = createBuildScriptFixture()
  const observed = path.join(fixture.root, 'fast-wall-call')

  try {
    writeFileSync(
      path.join(fixture.root, 'dist', 'src', 'cli.js'),
      `require('node:fs').appendFileSync(${JSON.stringify(observed)}, process.argv.slice(2).join(' ') + '\\n')\n`,
    )

    const result = spawnSync(
      '/bin/bash',
      [path.join(fixture.root, 'bin', 'run-tests'), '--', '/usr/bin/true'],
      {
        cwd: fixture.root,
        encoding: 'utf8',
        env: { ...fixture.env, npm_lifecycle_event: 'test' },
      },
    )

    assert.equal(result.status, 0, result.stderr)
    assert.equal(existsSync(observed), false)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
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
      path.join(fixture.root, 'runtime', 'tmp', 'tests.noindex'),
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
    assert.equal(
      existsSync(path.join(path.dirname(scratch), '.metadata_never_index')),
      true,
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

// A release lane runs the suite through `PANCREATOR_EXEC_ROOT=<worktree>
// ./bin/pan tests impacted`, and bin/pan pins PANCREATOR_ROOT on the
// installation for that dispatch. A fixture child CLI that inherited the pin
// would resolve the installation's worktree index instead of its fixture.
test('run-tests does not hand the installation root pin to the suite', () => {
  const fixture = createBuildScriptFixture()
  const observed = path.join(fixture.root, 'observed')

  try {
    const result = spawnSync(
      '/bin/bash',
      [
        path.join(fixture.root, 'bin', 'run-tests'),
        '--',
        '/bin/bash',
        '-c',
        `printf '%s' "\${PANCREATOR_ROOT:-unset}" > "${observed}"`,
      ],
      {
        cwd: fixture.root,
        encoding: 'utf8',
        env: { ...fixture.env, PANCREATOR_ROOT: '/srv/installation' },
      },
    )

    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(observed, 'utf8'), 'unset')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('run-tests orders recorded files slowest first and preserves a fresh order', () => {
  const fixture = createBuildScriptFixture()
  const testDirectory = path.join(fixture.root, 'dist', 'tests', 'unit')
  const observed = path.join(fixture.root, 'observed')

  const fast = path.join(testDirectory, 'fast.test.js')
  const slow = path.join(testDirectory, 'slow.test.js')
  const command = [
    '/bin/bash',
    '-c',
    `printf '%s\\n' "$@" > "${observed}"`,
    'runner',
    fast,
    slow,
  ]

  try {
    mkdirSync(testDirectory, { recursive: true })
    writeFileSync(fast, '')
    writeFileSync(slow, '')

    const fresh = runTests(fixture, command)

    assert.equal(fresh.status, 0, fresh.stderr)
    assert.deepEqual(readFileSync(observed, 'utf8').trim().split('\n'), [
      fast,
      slow,
    ])

    const durations = path.join(
      fixture.root,
      'runtime',
      'tmp',
      'tests.noindex',
      'file-durations.json',
    )

    writeFileSync(
      durations,
      JSON.stringify({
        schema_version: 1,
        recorded_at: '2026-09-15T00:00:00.000Z',
        lane: 'unit',
        wall_clock_ms: 110,
        test_count: 2,
        files: [
          { file: 'dist/tests/unit/fast.test.js', duration_ms: 10 },
          { file: 'dist/tests/unit/slow.test.js', duration_ms: 100 },
        ],
      }),
    )

    const recorded = runTests(fixture, command)

    assert.equal(recorded.status, 0, recorded.stderr)
    assert.deepEqual(readFileSync(observed, 'utf8').trim().split('\n'), [
      slow,
      fast,
    ])

    // dist/ and runtime/ have independent lifetimes, so a record can outlive
    // the helper that reads it. Ordering decides how the suite is dispatched,
    // never whether it runs.
    rmSync(path.join(fixture.root, 'dist', 'src', 'lib', 'test-file-order.js'))

    const unordered = runTests(fixture, command)

    assert.equal(unordered.status, 0, unordered.stderr)
    assert.match(unordered.stderr, /running them in the order received/u)
    assert.deepEqual(readFileSync(observed, 'utf8').trim().split('\n'), [
      fast,
      slow,
    ])
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
  const scratch = path.join(fixture.root, 'runtime', 'tmp', 'tests.noindex')

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

    const scratch = path.join(fixture.root, 'runtime', 'tmp', 'tests.noindex')
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

// A sleeping remover would let this pass by finishing before the group kill
// lands, which proves nothing. The stub instead reports its own session and
// then blocks until this test releases it, so the group kill is answered by
// a remover that is provably still alive in a session of its own.
test('run-tests removal survives the process group that launched it', async () => {
  const fixture = createBuildScriptFixture()
  const blockingRemove = path.join(fixture.root, 'tools', 'rm')
  const started = path.join(fixture.root, 'remover-session')
  const release = path.join(fixture.root, 'release-remover')

  try {
    writeFileSync(
      blockingRemove,
      [
        '#!/usr/bin/env bash',
        'session="$(ps -o sess= -p $$ | tr -d " ")"',
        // The reader below waits on the record's existence, so the record has
        // to appear whole. A redirection creates the file before it writes,
        // and a read once landed in that window under the full profile.
        `printf '%s %s\\n' "$$" "$session" > "${started}.tmp"`,
        `/bin/mv "${started}.tmp" "${started}"`,
        // The count is a hang guard, not the proof: a test that fails before
        // it releases the stub must not leave it blocked forever.
        'waited=0',
        `while [[ ! -e "${release}" && "$waited" -lt 600 ]]; do`,
        '  /bin/sleep 0.05',
        '  waited=$((waited + 1))',
        'done',
        'exec /bin/rm "$@"',
        '',
      ].join('\n'),
    )
    chmodSync(blockingRemove, 0o755)

    const child = spawn(
      '/bin/bash',
      [path.join(fixture.root, 'bin', 'run-tests'), '--', '/usr/bin/true'],
      {
        cwd: fixture.root,
        env: fixture.env,
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    )
    // `detached` made the runner a session leader, so its session is its pid.
    const runner = child.pid as number
    const result = await waitForProcess(child)

    assert.equal(result.status, 0, result.stderr)

    const discarded = discardedRuns(fixture.root)

    assert.equal(discarded.length, 1)

    await waitForPath(started)

    const [removerPid, removerSession] = readFileSync(started, 'utf8')
      .trim()
      .split(' ')

    // A new session is what outlives the launching one; sharing the runner's
    // would make the kill below reach the remover too.
    assert.match(removerSession ?? '', /^[0-9]+$/u)
    assert.notEqual(removerSession, String(runner))

    try {
      process.kill(-runner, 'SIGTERM')
    } catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH')
    }

    // Still blocked on the release below, so its survival is observed rather
    // than inferred from a removal that may already have finished.
    assert.doesNotThrow(() => process.kill(Number(removerPid), 0))

    writeFileSync(release, '')

    await waitForAbsence(
      path.join(
        fixture.root,
        'runtime',
        'tmp',
        'tests.noindex',
        discarded[0] as string,
      ),
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('run-tests ignores a failed dead-run removal', () => {
  const fixture = createBuildScriptFixture()
  const failingRemove = path.join(fixture.root, 'tools', 'rm')
  const scratch = path.join(fixture.root, 'runtime', 'tmp', 'tests.noindex')

  try {
    writeFileSync(failingRemove, '#!/bin/sh\nexit 1\n')
    chmodSync(failingRemove, 0o755)
    mkdirSync(path.join(scratch, 'run-dead'), { recursive: true })
    writeFileSync(
      path.join(scratch, 'run-dead', '.owner'),
      '999999\nunidentified-999999\n',
    )
    writeFileSync(path.join(scratch, 'run-dead', 'fixture'), '')

    const result = runTests(fixture, ['/usr/bin/true'])

    assert.equal(result.status, 0, result.stderr)
    assert.equal(scratchRuns(fixture.root).includes('run-dead'), false)
    assert.equal(
      existsSync(path.join(scratch, 'discarded-dead', 'fixture')),
      true,
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

// A remover can fail independently of its runner, so a discarded tree needs
// the same retry sweep as a run directory left by a killed wrapper.
test('run-tests sweeps a discarded tree whose remover is gone', () => {
  const fixture = createBuildScriptFixture()
  const squatter = spawn('/bin/sleep', ['30'])
  const holder = spawn('/bin/sleep', ['30'])
  const scratch = path.join(fixture.root, 'runtime', 'tmp', 'tests.noindex')

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
