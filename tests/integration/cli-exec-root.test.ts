import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { ROOT } from './cli-build-helpers.js'
import { createTestTempDirectory } from '../temp.js'

interface StubCheckout {
  /** Absolute, symlink-resolved path, because `bin/pan` reports `pwd`. */
  root: string
  pan: string
}

interface CliAnswer {
  checkout: string
  cli: string
  pancreator_root: string | null
  cwd: string
}

/**
 * A checkout that answers like Pancreator without compiling one. The contract
 * under test is which tree `bin/pan` builds and dispatches, so the CLI it
 * reaches only has to name the tree it came from.
 */
function stubCheckout(parent: string, name: string): StubCheckout {
  const root = path.join(parent, name)

  mkdirSync(path.join(root, 'bin'), { recursive: true })
  mkdirSync(path.join(root, 'dist', 'src'), { recursive: true })
  writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'pancreator-v2-prototype' }, null, 2)}\n`,
  )
  copyFileSync(path.join(ROOT, 'bin', 'pan'), path.join(root, 'bin', 'pan'))
  chmodSync(path.join(root, 'bin', 'pan'), 0o755)

  // Records that this checkout's own wrapper ran, which is how the build the
  // override selects is told apart from the installation's build.
  writeFileSync(
    path.join(root, 'bin', 'run-built'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"',
      'printf \'%s\\n\' "$HERE" >> "$HERE/run-built.log"',
      'shift',
      'exec "$@"',
      '',
    ].join('\n'),
  )
  chmodSync(path.join(root, 'bin', 'run-built'), 0o755)
  writeFileSync(
    path.join(root, 'dist', 'src', 'cli.js'),
    [
      'process.stdout.write(',
      '  JSON.stringify({',
      `    checkout: ${JSON.stringify(name)},`,
      '    cli: process.argv[1],',
      '    pancreator_root: process.env.PANCREATOR_ROOT ?? null,',
      '    cwd: process.cwd(),',
      '  }),',
      ')',
      '',
    ].join('\n'),
  )

  return { root: realpathSync(root), pan: path.join(root, 'bin', 'pan') }
}

function toolPath(parent: string): string {
  const tools = path.join(parent, 'tools')

  mkdirSync(tools, { recursive: true })
  symlinkSync(process.execPath, path.join(tools, 'node'))

  return tools
}

function panEnvironment(tools: string, execRoot?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${tools}:/usr/bin:/bin`,
  }

  delete env.PANCREATOR_ROOT
  delete env.PANCREATOR_BUILD_READY

  if (execRoot === undefined) {
    delete env.PANCREATOR_EXEC_ROOT
  } else {
    env.PANCREATOR_EXEC_ROOT = execRoot
  }

  return env
}

function runPan(
  pan: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('/bin/bash', [pan, 'status'], {
    cwd,
    encoding: 'utf8',
    env,
    timeout: 60_000,
  })

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

function answer(stdout: string): CliAnswer {
  return JSON.parse(stdout) as CliAnswer
}

test('without the override bin/pan dispatches its own checkout', () => {
  const parent = createTestTempDirectory('pan-exec-root-')
  const installation = stubCheckout(parent, 'installation')
  const result = runPan(
    installation.pan,
    panEnvironment(toolPath(parent)),
    parent,
  )

  assert.equal(result.status, 0, result.stderr)

  const reported = answer(result.stdout)

  assert.equal(reported.checkout, 'installation')
  assert.equal(path.dirname(reported.cli), `${installation.root}/dist/src`)
  assert.equal(reported.cwd, installation.root)
  // Discovery, not an exported override, still decides where run state lives.
  assert.equal(reported.pancreator_root, null)
  assert.equal(existsSync(path.join(installation.root, 'run-built.log')), true)
})

test('the override dispatches the named checkout while run state stays on the installation', () => {
  const parent = createTestTempDirectory('pan-exec-root-')
  const installation = stubCheckout(parent, 'installation')
  const workspace = stubCheckout(parent, 'workspace')
  const result = runPan(
    installation.pan,
    panEnvironment(toolPath(parent), workspace.root),
    parent,
  )

  assert.equal(result.status, 0, result.stderr)

  const reported = answer(result.stdout)

  assert.equal(reported.checkout, 'workspace')
  assert.equal(path.dirname(reported.cli), `${workspace.root}/dist/src`)
  assert.equal(reported.pancreator_root, installation.root)
  assert.equal(reported.cwd, installation.root)
  assert.equal(
    existsSync(path.join(workspace.root, 'run-built.log')),
    true,
    'the selected checkout builds through its own bin/run-built',
  )
  assert.equal(existsSync(path.join(installation.root, 'run-built.log')), false)
})

// The ship contract hands the steward a harness-relative workspace path, so
// the value must mean the same thing wherever the operator happens to stand.
test('the override resolves against the installation root rather than the working directory', () => {
  const parent = createTestTempDirectory('pan-exec-root-')
  const installation = stubCheckout(parent, 'installation')
  const elsewhere = createTestTempDirectory('pan-exec-root-cwd-')

  mkdirSync(path.join(installation.root, 'worktrees'), { recursive: true })

  const nested = stubCheckout(
    path.join(installation.root, 'worktrees'),
    'release-lane',
  )
  const result = runPan(
    installation.pan,
    panEnvironment(toolPath(parent), 'worktrees/release-lane'),
    elsewhere,
  )

  assert.equal(result.status, 0, result.stderr)

  const reported = answer(result.stdout)

  assert.equal(reported.checkout, 'release-lane')
  assert.equal(path.dirname(reported.cli), `${nested.root}/dist/src`)
})

test('an override that is not a Pancreator checkout is refused and names the path', () => {
  const parent = createTestTempDirectory('pan-exec-root-')
  const installation = stubCheckout(parent, 'installation')
  const tools = toolPath(parent)
  const stranger = createTestTempDirectory('pan-exec-root-stranger-')
  const refused = runPan(
    installation.pan,
    panEnvironment(tools, stranger),
    parent,
  )

  assert.equal(refused.status, 1)
  assert.equal(refused.stdout, '')
  assert.match(refused.stderr, /EXEC_ROOT_INVALID/u)
  assert.ok(refused.stderr.includes(realpathSync(stranger)))

  const missing = runPan(
    installation.pan,
    panEnvironment(tools, path.join(parent, 'no-such-checkout')),
    parent,
  )

  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /EXEC_ROOT_INVALID/u)
  assert.ok(missing.stderr.includes(path.join(parent, 'no-such-checkout')))
})

// A staged or half-copied tree carries the manifest without the wrapper the
// dispatch needs, so the name alone must not qualify it.
test('a tree that carries the manifest but no dispatchable build is refused', () => {
  const parent = createTestTempDirectory('pan-exec-root-')
  const installation = stubCheckout(parent, 'installation')
  const partial = createTestTempDirectory('pan-exec-root-partial-')

  writeFileSync(
    path.join(partial, 'package.json'),
    `${JSON.stringify({ name: 'pancreator-v2-prototype' }, null, 2)}\n`,
  )

  const result = runPan(
    installation.pan,
    panEnvironment(toolPath(parent), partial),
    parent,
  )

  assert.equal(result.status, 1)
  assert.match(result.stderr, /EXEC_ROOT_INVALID/u)
})
