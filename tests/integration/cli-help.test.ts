import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createFixture } from '../helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

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
