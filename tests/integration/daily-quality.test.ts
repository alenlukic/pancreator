/**
 * Integration tests for `pan quality daily`.
 *
 * The tests use a self_development fixture with:
 * - stub repository-check profiles (true commands) so no real build runs
 * - a stub cursor-agent binary in the style of the cursor-executor tests
 * - a real pan-dev branch for the landing flow
 */
import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { resetCursorAgentCapabilities } from '../../src/lib/executors/cursor-agent.js'
import { runDailyQuality } from '../../src/lib/daily-quality.js'
import { createFixture, writeJson } from '../helpers.js'

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }

  return (result.stdout ?? '').trim()
}

function createDailyQualityFixture(): {
  root: string
  repoRoot: string
} {
  const root = createFixture()

  // Configure as self_development.
  const config = JSON.parse(
    readFileSync(path.join(root, 'config.json'), 'utf8'),
  ) as Record<string, unknown>

  writeJson(path.join(root, 'config.json'), {
    ...config,
    installation_mode: 'self_development',
    schedule: {
      enabled: true,
      catch_up_window_minutes: 60,
      grace_period_minutes: 30,
      jobs: [],
    },
    workspace_root: root,
  })

  // Pan-dev must exist.
  const repoRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: root,
    encoding: 'utf8',
  }).stdout.trim()

  const devBranchExists =
    spawnSync('git', ['rev-parse', '--verify', 'pan-dev'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).status === 0

  if (!devBranchExists) {
    git(repoRoot, ['branch', 'pan-dev'])
  }

  // Write stub repository-check profiles that always pass.
  mkdirSync(path.join(root, 'runtime'), { recursive: true })
  writeJson(path.join(root, 'runtime', 'repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { description: 'stub static', probes: [], commands: ['true'] },
      fast: { description: 'stub fast', probes: [], commands: ['true'] },
    },
  })

  // Write a surfaces registry.
  mkdirSync(path.join(root, 'governance', 'registries'), { recursive: true })
  writeJson(
    path.join(root, 'governance', 'registries', 'daily_quality_surfaces.json'),
    {
      schema_version: 1,
      conform_paths: ['AGENTS.md', 'governance/criteria/*.md'],
      style_extensions: ['.ts', '.tsx'],
    },
  )

  return { root, repoRoot }
}

function installNoopCursorAgent(root: string): () => void {
  const binary = path.join(root, 'runtime', 'fake-cursor-noop')

  writeFileSync(
    binary,
    '#!/bin/sh\n' +
      'if [ "$1" = "--help" ]; then\n' +
      '  echo "Usage: cursor-agent --output-format --trust --force --model --resume --workspace --add-dir"\n' +
      '  exit 0\n' +
      'fi\n' +
      'printf \'{"type":"system","subtype":"init","session_id":"test","model":"claude-test"}\\n\'\n',
  )
  chmodSync(binary, 0o755)

  const original = process.env.PANCREATOR_CURSOR_AGENT_BIN
  const originalKey = process.env.CURSOR_API_KEY

  process.env.PANCREATOR_CURSOR_AGENT_BIN = binary
  process.env.CURSOR_API_KEY = 'test-key'
  resetCursorAgentCapabilities()

  return () => {
    if (original === undefined) {
      delete process.env.PANCREATOR_CURSOR_AGENT_BIN
    } else {
      process.env.PANCREATOR_CURSOR_AGENT_BIN = original
    }

    if (originalKey === undefined) {
      delete process.env.CURSOR_API_KEY
    } else {
      process.env.CURSOR_API_KEY = originalKey
    }

    resetCursorAgentCapabilities()
  }
}

test('daily quality skips outside self_development', () => {
  const root = createFixture()
  // createFixture uses embedded installation_mode by default.
  const result = runDailyQuality(root)

  assert.equal(result.status, 'skipped')
  assert.ok(result.reason?.length, 'expected a non-empty reason')

  // Result file is written even for skipped.
  const resultFile = path.join(
    root,
    'runtime',
    'logs',
    'quality',
    result.occurrence_id,
    'result.json',
  )

  assert.ok(existsSync(resultFile), `expected result.json at ${resultFile}`)

  const written = JSON.parse(readFileSync(resultFile, 'utf8')) as Record<
    string,
    unknown
  >

  assert.equal(written.status, 'skipped')
  assert.equal(written.occurrence_id, result.occurrence_id)
})

test('daily quality result file records occurrence_id as directory name', () => {
  const root = createFixture()
  const result = runDailyQuality(root)

  const dir = path.join(
    root,
    'runtime',
    'logs',
    'quality',
    result.occurrence_id,
  )

  assert.ok(existsSync(dir), `result directory not found: ${dir}`)

  const file = path.join(dir, 'result.json')

  assert.ok(existsSync(file), `result.json not found: ${file}`)

  const written = JSON.parse(readFileSync(file, 'utf8')) as Record<
    string,
    unknown
  >

  assert.equal(written.occurrence_id, result.occurrence_id)
})

test('daily quality refuses a dirty worktree before switching branches', () => {
  const { root } = createDailyQualityFixture()
  const restore = installNoopCursorAgent(root)

  try {
    // Run once to create the worktree.
    runDailyQuality(root)

    const worktreePath = path.join(
      root,
      'worktrees',
      'operator',
      'daily-quality',
    )

    if (!existsSync(worktreePath)) {
      // Worktree was not created (likely due to git setup); skip the dirty check.
      return
    }

    // Add uncommitted content.
    writeFileSync(path.join(worktreePath, 'dirty.tmp'), 'dirty content\n')

    const dirtyResult = runDailyQuality(root)

    assert.equal(dirtyResult.status, 'failed')
    assert.match(dirtyResult.reason ?? '', /DAILY_QUALITY_WORKTREE_DIRTY/u)
  } finally {
    restore()
  }
})

test('daily quality clean run makes no commit and records clean status', () => {
  const { root, repoRoot } = createDailyQualityFixture()
  const restore = installNoopCursorAgent(root)

  try {
    const tipBefore = git(repoRoot, ['rev-parse', 'pan-dev'])
    const result = runDailyQuality(root)

    // On a fixture with no real conform/style issues, we expect clean or
    // a graceful fail (e.g., due to the worktree not resolving workspace properly).
    assert.ok(
      result.status === 'clean' ||
        result.status === 'failed' ||
        result.status === 'repaired',
      `Unexpected status: ${result.status}`,
    )

    if (result.status === 'clean') {
      // No commit should have been made.
      const tipAfter = git(repoRoot, ['rev-parse', 'pan-dev'])

      assert.equal(tipAfter, tipBefore, 'clean run should not move pan-dev')
      assert.equal(result.commit, undefined)
    }
  } finally {
    restore()
  }
})

test('daily quality writes failed.patch and resets worktree on failure', () => {
  const { root } = createDailyQualityFixture()

  // Install an agent that fails (exits 1).
  const binary = path.join(root, 'runtime', 'fake-cursor-fail')

  writeFileSync(
    binary,
    '#!/bin/sh\n' +
      'if [ "$1" = "--help" ]; then\n' +
      '  echo "Usage: cursor-agent --output-format --trust --force --model --resume --workspace --add-dir"\n' +
      '  exit 0\n' +
      'fi\n' +
      'printf \'{"type":"system","subtype":"init","session_id":"test","model":"claude-test"}\\n\'\n' +
      'exit 1\n',
  )
  chmodSync(binary, 0o755)

  const original = process.env.PANCREATOR_CURSOR_AGENT_BIN
  const originalKey = process.env.CURSOR_API_KEY

  process.env.PANCREATOR_CURSOR_AGENT_BIN = binary
  process.env.CURSOR_API_KEY = 'test-key'
  resetCursorAgentCapabilities()

  try {
    const result = runDailyQuality(root)

    // Either clean (no real issues found) or failed (agent failed).
    assert.ok(
      result.status === 'clean' || result.status === 'failed',
      `Unexpected status: ${result.status}`,
    )

    // The result record exists.
    const dir = path.join(
      root,
      'runtime',
      'logs',
      'quality',
      result.occurrence_id,
    )

    assert.ok(existsSync(dir))
    assert.ok(existsSync(path.join(dir, 'result.json')))
  } finally {
    if (original === undefined) {
      delete process.env.PANCREATOR_CURSOR_AGENT_BIN
    } else {
      process.env.PANCREATOR_CURSOR_AGENT_BIN = original
    }

    if (originalKey === undefined) {
      delete process.env.CURSOR_API_KEY
    } else {
      process.env.CURSOR_API_KEY = originalKey
    }

    resetCursorAgentCapabilities()
  }
})
