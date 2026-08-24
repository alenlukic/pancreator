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

import { createFixture } from '../helpers.js'

const ROOT = process.cwd()
const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')
const PAN = path.join(ROOT, 'bin', 'pan')

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

async function waitForPath(filePath: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
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
        'sleep 0.5',
        'mkdir -p dist/src',
        `printf '%s\\n' "process.stdout.write('ready')" > dist/src/cli.js`,
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
  // the rm -rf dist step in bin/build.
  const compiler = path.join(toolDirectory, 'tsc')

  writeFileSync(
    compiler,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'mkdir -p dist/src',
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

test('nested build-only reuses the prepared build in the same root', () => {
  const fixture = createBuildScriptFixture()

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
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('a prepared build in one root does not skip builds in another root', () => {
  const first = createBuildScriptFixture()
  const second = createBuildScriptFixture()

  try {
    const result = spawnSync(
      '/bin/bash',
      [first.runBuilt, '--', second.runBuilt, '--build-only'],
      {
        cwd: first.root,
        encoding: 'utf8',
        env: first.env,
        timeout: 30_000,
      },
    )

    assert.equal(result.status, 0, result.stderr)
    assert.equal(
      readFileSync(path.join(second.root, 'builds.log'), 'utf8'),
      'build\n',
    )
  } finally {
    rmSync(first.root, { recursive: true, force: true })
    rmSync(second.root, { recursive: true, force: true })
  }
})

test('command help does not create a workflow directory named --help', () => {
  const root = createFixture()
  const stdout = execFileSync(process.execPath, [CLI, 'prepare', '--help'], {
    cwd: root,
    encoding: 'utf8',
  })

  assert.match(stdout, /Usage:/u)
  assert.equal(
    existsSync(path.join(root, 'runtime/logs/workflows/--help')),
    false,
  )
})

test('workflow help exposes operator artifact controls', () => {
  const root = createFixture()
  const initHelp = execFileSync(process.execPath, [CLI, 'init', '--help'], {
    cwd: root,
    encoding: 'utf8',
  })
  const prepareHelp = execFileSync(
    process.execPath,
    [CLI, 'prepare', '--help'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
  const generateHelp = execFileSync(
    process.execPath,
    [CLI, 'briefs', 'generate', '--help'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )

  assert.match(initHelp, /--operator-artifacts/u)
  assert.match(prepareHelp, /--operator-artifacts/u)
  assert.match(generateHelp, /--run <run-id>/u)
  assert.match(generateHelp, /--stage <stage-slug>/u)
  assert.match(generateHelp, /--force/u)
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
