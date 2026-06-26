import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

interface PackageManifest {
  scripts: Record<string, string>
}

const ROOT = process.cwd()
const QUIET_RUNNER = 'scripts/run-quiet.mjs'

test('verification npm scripts use the quiet command wrapper', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
  ) as PackageManifest
  const scriptNames = [
    'build',
    'format',
    'format:check',
    'typecheck',
    'lint',
    'test',
    'test:unit',
    'test:migrations',
    'test:integration',
    'test:regression',
    'test:coverage',
    'check',
  ]

  for (const scriptName of scriptNames) {
    assert.match(
      manifest.scripts[scriptName] ?? '',
      new RegExp(QUIET_RUNNER, 'u'),
    )
  }
})

test('npm lifecycle banners are disabled for repository scripts', () => {
  const configuration = readFileSync(path.join(ROOT, '.npmrc'), 'utf8')

  assert.match(configuration, /^loglevel=silent$/mu)
})
