import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { createFixture } from '../fixture-template.js'

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function write(root: string, relativePath: string, content: string): void {
  const absolute = path.join(root, relativePath)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
}

function runStyle(root: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [
      '--no-warnings',
      path.join(process.cwd(), 'dist', 'src', 'cli.js'),
      'style',
      ...args,
    ],
    { cwd: root, encoding: 'utf8' },
  )
}

test('CLI prints --json scan output and exits non-zero on issues', () => {
  const root = createFixture()

  write(root, 'src/module.ts', 'export const total: any = 1\n')
  git(root, ['add', 'src/module.ts'])
  git(root, ['commit', '-qm', 'add dirty source'])

  const result = runStyle(root, ['scan', '--json'])

  assert.equal(result.status, 1)

  const parsed = JSON.parse(result.stdout) as {
    schema_version: number
    status: string
    languages: string[]
    summary: { editable_issue_files: number }
  }

  assert.equal(parsed.schema_version, 1)
  assert.equal(parsed.status, 'failed')
  assert.ok(parsed.languages.includes('typescript'))
  assert.ok(parsed.summary.editable_issue_files > 0)

  // Scan writes nothing, so the checkpoint branch runs on the same clone.
  const checkpoint = runStyle(root, ['checkpoint', '--json'])

  assert.equal(checkpoint.status, 1)

  const blocked = JSON.parse(checkpoint.stdout) as {
    schema_version: number
    status: string
    wrote_checkpoint: boolean
  }

  assert.equal(blocked.schema_version, 1)
  assert.equal(blocked.status, 'blocked')
  assert.equal(blocked.wrote_checkpoint, false)
})

test('CLI text output labels the selected file count and passes when clean', () => {
  const root = createFixture()

  write(root, 'src/module.ts', 'export const total = 1\n')
  git(root, ['add', 'src/module.ts'])
  git(root, ['commit', '-qm', 'add clean source'])

  const result = runStyle(root, ['scan', '--all'])

  assert.equal(result.status, 0)
  assert.match(result.stdout, /^Style scan: passed$/mu)
  assert.match(result.stdout, /^Languages: .+$/mu)
  assert.match(result.stdout, /^Files: \d+$/mu)
})

test('CLI forwards a selected worktree to the scanned workspace', () => {
  const root = createFixture()

  write(root, 'src/module.ts', 'export const total = 1\n')
  git(root, ['add', 'src/module.ts'])
  git(root, ['commit', '-qm', 'add clean source'])

  const result = runStyle(root, ['scan', '--worktree', 'style-probe', '--json'])

  assert.equal(result.status, 0, result.stderr)

  const parsed = JSON.parse(result.stdout) as { workspace_root: string }

  assert.match(parsed.workspace_root, /style-probe$/u)
})

test('CLI refuses a combined selection and an unknown subcommand', () => {
  const root = createFixture()
  const combined = runStyle(root, ['scan', '--all', '--since', 'HEAD'])
  const unknown = runStyle(root, ['inspect'])

  assert.equal(combined.status, 1)
  assert.match(combined.stderr, /--since and --all cannot be used together/u)
  assert.equal(unknown.status, 1)
  assert.match(unknown.stderr, /Unknown style subcommand: inspect/u)
})
