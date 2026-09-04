import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { attestRunCard, createFixture } from '../helpers.js'

const ROOT = process.cwd()
const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')
const PAN = path.join(ROOT, 'bin', 'pan')

// bin/build compiles into a staging directory named by `--outDir` and swaps it
// into place, so a fake compiler must honor that flag to be found.
const FAKE_TSC_OUT_DIR =
  'out=dist; while [[ $# -gt 0 ]]; do if [[ "$1" == "--outDir" ]]; then out="$2"; shift; fi; shift; done'

interface ProcessResult {
  status: number | null
  stderr: string
}

function waitForProcess(
  child: ReturnType<typeof spawn>,
): Promise<ProcessResult> {
  let stderr = ''

  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk
  })

  return new Promise((resolve) => {
    child.on('close', (status) => {
      resolve({ status, stderr })
    })
  })
}

// The wait only sequences the second launch after the first command started.
// The first build in a freshly written temporary root can take several
// seconds on a loaded host, because every copied script runs for the first
// time there, so the budget is generous rather than a measure of the contract.
const STARTED_WAIT_MS = 15_000

async function waitForPath(filePath: string): Promise<void> {
  const deadline = Date.now() + STARTED_WAIT_MS

  while (Date.now() < deadline) {
    if (existsSync(filePath)) {
      return
    }

    await delay(10)
  }

  assert.fail(`Timed out waiting for ${filePath}`)
}

test('pan reuses the prepared build during a repository test run', () => {
  const toolDirectory = mkdtempSync(path.join(tmpdir(), 'pancreator-tools-'))

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
  } finally {
    rmSync(toolDirectory, { recursive: true, force: true })
  }
})

test('build lock keeps the CLI available during concurrent commands', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-build-lock-'))
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

interface BuildScriptFixture {
  root: string
  runBuilt: string
  env: NodeJS.ProcessEnv
}

function createBuildScriptFixture(): BuildScriptFixture {
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-build-reuse-'))
  const binDirectory = path.join(root, 'bin')
  const toolDirectory = path.join(root, 'tools')

  mkdirSync(binDirectory, { recursive: true })
  mkdirSync(toolDirectory, { recursive: true })
  symlinkSync(process.execPath, path.join(toolDirectory, 'node'))

  for (const script of ['build', 'run-built', 'run-quiet']) {
    const target = path.join(binDirectory, script)

    copyFileSync(path.join(ROOT, 'bin', script), target)
    chmodSync(target, 0o755)
  }

  // The fake compiler appends outside dist/ so builds stay countable across
  // the dist swap in bin/build.
  const compiler = path.join(toolDirectory, 'tsc')

  writeFileSync(
    compiler,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `${FAKE_TSC_OUT_DIR}`,
      'mkdir -p "$out/src"',
      `printf '%s\\n' build >> builds.log`,
      '',
    ].join('\n'),
  )
  chmodSync(compiler, 0o755)

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${toolDirectory}:/usr/bin:/bin`,
  }

  delete env.PANCREATOR_BUILD_READY

  return { root, runBuilt: path.join(binDirectory, 'run-built'), env }
}

// The wrapper pairs the holder's pid with its start time, so these helpers
// build the same token bin/run-built writes.
function ownerToken(pid: number): string {
  return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8',
  })
    .replace(/ /gu, '')
    .trim()
}

// A reclaim test must not inherit the production ceiling. If ownership
// checking regresses, these cases should fail in seconds instead of waiting
// out the default five minutes.
function reclaimEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, PANCREATOR_BUILD_LOCK_TIMEOUT_SECONDS: '20' }
}

function writeBuildLock(root: string, contents: string): string {
  const lock = path.join(root, 'runtime', 'build', 'build.lock')

  mkdirSync(path.dirname(lock), { recursive: true })
  writeFileSync(lock, contents)

  return lock
}

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

test('workflow help does not create a run named --help', () => {
  const root = createFixture()

  execFileSync(process.execPath, [CLI, 'prepare', '--help'], {
    cwd: root,
    encoding: 'utf8',
  })

  assert.equal(
    existsSync(path.join(root, 'runtime/logs/workflows/--help')),
    false,
  )
})

test('CLI artifact options persist run-wide and stage selections', () => {
  const root = createFixture()
  const runWide = JSON.parse(
    execFileSync(
      process.execPath,
      [
        CLI,
        'init',
        '--workflow',
        'preflight',
        '--request',
        'request.md',
        '--operator-artifacts',
        '--json',
      ],
      { cwd: root, encoding: 'utf8' },
    ),
  ) as {
    operator_artifacts: {
      mode: string
      requested_stages: string[]
    }
  }

  assert.deepEqual(runWide.operator_artifacts, {
    mode: 'requested',
    requested_stages: [],
  })

  const stageOnly = JSON.parse(
    execFileSync(
      process.execPath,
      [
        CLI,
        'init',
        '--workflow',
        'preflight',
        '--request',
        'request.md',
        '--json',
      ],
      { cwd: root, encoding: 'utf8' },
    ),
  ) as { run_id: string; state_path: string }

  // The CLI drove init, so the test carries the supervisor's attestation duty
  // before prepare, exactly as a supervisor session does.
  attestRunCard(root, stageOnly.run_id)

  execFileSync(
    process.execPath,
    [CLI, 'prepare', stageOnly.run_id, '--operator-artifacts', '--json'],
    { cwd: root, encoding: 'utf8' },
  )

  const state = JSON.parse(
    readFileSync(path.join(root, stageOnly.state_path), 'utf8'),
  ) as {
    operator_artifacts: {
      mode: string
      requested_stages: string[]
    }
  }

  assert.deepEqual(state.operator_artifacts, {
    mode: 'suppressed',
    requested_stages: ['inspect'],
  })
})
