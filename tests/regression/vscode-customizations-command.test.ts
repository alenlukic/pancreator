import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  applyCustomizations,
  loadCustomizationBundle,
  planCustomizations,
  revertCustomizations,
} from '../../src/lib/vscode-customizations.js'
import { createTestTempDirectory } from '../temp.js'

const bundle = loadCustomizationBundle(
  path.join(process.cwd(), 'library/vscode'),
)

function appFixture(): string {
  const app = createTestTempDirectory('vscode-customizations-command-')
  writeFileSync(
    path.join(app, 'package.json'),
    JSON.stringify({ version: bundle.version }),
  )
  writeFileSync(
    path.join(app, 'product.json'),
    JSON.stringify({ commit: bundle.commit, checksums: {} }),
  )
  return app
}

function command(args: string[]) {
  return spawnSync(
    'bash',
    [path.join(process.cwd(), 'bin/vscode-customizations'), ...args],
    { encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024 },
  )
}

test('the packaged command reports pending without writes, rejects invalid arguments, and refuses invalid JavaScript before changing the app', () => {
  assert.equal(command(['--help']).status, 0)
  assert.equal(command(['--apply', '--check']).status, 2)
  assert.equal(command(['--app']).status, 2)
  assert.equal(command(['--unknown']).status, 2)
  const app = appFixture()
  const contents = new Map<string, string[]>()

  for (const patch of bundle.patches) {
    for (const target of patch.targets) {
      const chunks = contents.get(target) ?? []
      chunks.push(patch.find)
      contents.set(target, chunks)
    }
  }

  for (const [target, chunks] of contents) {
    mkdirSync(path.dirname(path.join(app, target)), { recursive: true })
    writeFileSync(path.join(app, target), chunks.join('\n/* fixture */\n'))
  }

  const state = path.join(app, 'state')
  const args = ['--app', app, '--skip-settings', '--state-dir', state]
  const check = command([...args, '--check'])
  assert.equal(check.status, 1, check.stderr)
  assert.match(check.stdout, /pending/)
  const result = command([...args, '--apply'])
  assert.equal(result.status, 2, result.stderr)
  assert.match(result.stderr, /syntax check failed/)

  for (const [target, chunks] of contents) {
    assert.equal(
      readFileSync(path.join(app, target), 'utf8'),
      chunks.join('\n/* fixture */\n'),
    )
  }
})

test('the production syntax checker validates an app edit and preserves a runnable apply/check/revert cycle', () => {
  const app = appFixture()
  mkdirSync(path.join(app, 'out'))
  const file = path.join(app, 'out/fixture.js')
  writeFileSync(file, 'const value = 1')
  const selected = {
    ...bundle,
    patches: [
      {
        id: 'syntax',
        targets: ['out/fixture.js'],
        find: 'const value = 1',
        replace: 'const value = 2',
        occurrences: 1,
      },
    ],
  }
  const options = {
    appRoot: app,
    userDataDir: undefined,
    stateDir: path.join(app, 'state'),
  }
  assert.equal(applyCustomizations(selected, options).state, 'applied')
  assert.equal(readFileSync(file, 'utf8'), 'const value = 2')
  assert.equal(planCustomizations(selected, options).state, 'applied')
  revertCustomizations(selected, options)
  assert.equal(readFileSync(file, 'utf8'), 'const value = 1')
})
