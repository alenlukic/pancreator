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

test('CLI prints --json scan output and exits non-zero on issues', () => {
  const root = createFixture()

  write(root, 'CHANGELOG.md', '# Changelog\n\nRun this command.\n')
  git(root, ['add', 'CHANGELOG.md'])
  git(root, ['commit', '-qm', 'pin changelog'])

  write(root, 'runtime/pr-descriptions/example.md', "# PR\n\nDon't do this.\n")

  const cli = path.join(process.cwd(), 'dist', 'src', 'cli.js')
  const result = spawnSync(
    process.execPath,
    ['--no-warnings', cli, 'conform', 'scan', '--json'],
    { cwd: root, encoding: 'utf8' },
  )

  assert.equal(result.status, 1)

  const parsed = JSON.parse(result.stdout) as {
    schema_version: number
    status: string
    summary: { editable_issue_files: number }
  }

  assert.equal(parsed.schema_version, 1)
  assert.equal(parsed.status, 'failed')
  assert.ok(parsed.summary.editable_issue_files > 0)

  // Scan writes nothing, so the checkpoint branch runs on the same clone.
  const checkpoint = spawnSync(
    process.execPath,
    ['--no-warnings', cli, 'conform', 'checkpoint', '--json'],
    { cwd: root, encoding: 'utf8' },
  )

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

test('CLI text output labels the selected file count', () => {
  const root = createFixture()
  const cli = path.join(process.cwd(), 'dist', 'src', 'cli.js')
  const result = spawnSync(
    process.execPath,
    ['--no-warnings', cli, 'conform', 'scan', '--all'],
    { cwd: root, encoding: 'utf8' },
  )

  assert.match(result.stdout, /^Conform scan: (?:passed|failed)$/mu)
  assert.match(result.stdout, /^Files: \d+$/mu)
  assert.doesNotMatch(result.stdout, /^Changed:/mu)
})
