import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { LOCAL_CATALOG_RELATIVE_PATH } from '../../src/lib/executors/cursor-catalog.js'
import { createFixture } from '../fixture-template.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

interface CommandResult {
  status: number | null
  stdout: string
  stderr: string
}

function pan(root: string, args: string[]): CommandResult {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
  })

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

/** A catalog the account still has, but which resolves no configured spec. */
function writeEmptyCatalog(root: string): void {
  writeFileSync(
    path.join(root, LOCAL_CATALOG_RELATIVE_PATH),
    `${JSON.stringify({ models: [] }, null, 2)}\n`,
  )
}

// `pan models` and `pan doctor` are the two commands an operator reaches for
// once the catalog has gone stale, so neither may fail at config load.
test('a stale catalog leaves the model diagnostic working', () => {
  const root = createFixture()

  writeEmptyCatalog(root)

  const diagnostic = pan(root, ['models', '--json'])

  assert.equal(
    diagnostic.status,
    0,
    `models exited ${diagnostic.status}: ${diagnostic.stderr}`,
  )

  const report = JSON.parse(diagnostic.stdout) as {
    catalog_skipped: boolean
    cursor_model_catalog: {
      present: boolean
      stale: boolean
      freshness: string
      refresh_command: string
    }
  }

  assert.equal(report.catalog_skipped, true)
  assert.equal(report.cursor_model_catalog.present, true)
  assert.equal(report.cursor_model_catalog.stale, true)
  assert.equal(report.cursor_model_catalog.freshness, 'incomplete')
  assert.equal(
    report.cursor_model_catalog.refresh_command,
    './bin/pan models --sync --force',
  )

  // The exemption covers diagnosis only. A sync writes projections, so it
  // still enforces the catalog unless the operator waives it by name.
  const sync = pan(root, ['models', '--sync', '--json'])

  assert.equal(sync.status, 1)
  assert.match(`${sync.stdout}${sync.stderr}`, /UNRESOLVED_CURSOR_MODEL/u)

  const forced = pan(root, ['models', '--sync', '--force', '--json'])

  assert.equal(
    forced.status,
    0,
    `models --sync --force exited ${forced.status}: ${forced.stderr}`,
  )
})

test('a stale catalog leaves the doctor diagnostic reporting the refresh', () => {
  const root = createFixture()

  writeEmptyCatalog(root)

  const doctor = pan(root, ['doctor', '--json'])
  const report = JSON.parse(doctor.stdout) as {
    cursor_model_catalog?: {
      present: boolean
      stale: boolean
      refresh_command: string
    }
  }

  // Doctor reports repository validation too, so its exit code belongs to
  // the whole sweep. The catalog block is the contract here.
  assert.equal(report.cursor_model_catalog?.present, true)
  assert.equal(report.cursor_model_catalog?.stale, true)
  assert.equal(
    report.cursor_model_catalog?.refresh_command,
    './bin/pan models --sync --force',
  )
})
