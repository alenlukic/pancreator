import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

const INSTALL_SUPPORT = path.join(process.cwd(), 'bin', 'install-support')

// An embedded install copied Pancreator's own fast-wall ceiling, which
// measures Pancreator's suite on Pancreator's hardware, into every target.
function writeProject(source: string, destination: string): unknown {
  const result = spawnSync(
    process.execPath,
    [
      INSTALL_SUPPORT,
      'write-project',
      '--source',
      source,
      '--destination',
      destination,
      '--workspace-id',
      'target-one',
    ],
    { encoding: 'utf8' },
  )

  assert.equal(result.status, 0, result.stderr)

  return (
    JSON.parse(readFileSync(destination, 'utf8')) as Record<string, unknown>
  ).fast_wall
}

test('an embedded install ships an empty fast-wall ceiling and keeps only a calibrated one', () => {
  const root = createTestTempDirectory('pancreator-embedded-fast-wall-')
  const source = path.join(root, 'source', 'config.json')
  const destination = path.join(root, 'target', '.pancreator', 'config.json')
  const shipped = {
    ceiling_ms: 240_000,
    anchor_date: '2026-09-14',
    weekly_allowance_ms: 1000,
    max_load_average_per_cpu: 1,
    minimum_qualified_samples: 5,
  }

  mkdirSync(path.dirname(source), { recursive: true })
  mkdirSync(path.dirname(destination), { recursive: true })
  writeFileSync(
    source,
    JSON.stringify({
      schema_version: 1,
      installation_mode: 'self_development',
      active_config: 'balanced',
      defaults: { coder: 'claude-sonnet-5' },
      configs: { balanced: {} },
      fast_wall: shipped,
    }),
  )

  assert.deepEqual(writeProject(source, destination), {
    ...shipped,
    ceiling_ms: null,
  })

  // A refresh over an older install that inherited the number empties it.
  const installed = JSON.parse(readFileSync(destination, 'utf8')) as {
    fast_wall: Record<string, unknown>
  }

  writeFileSync(
    destination,
    JSON.stringify({
      ...installed,
      fast_wall: { ...installed.fast_wall, ceiling_ms: 240_000 },
    }),
  )
  assert.equal(
    (writeProject(source, destination) as { ceiling_ms: unknown }).ceiling_ms,
    null,
  )

  // A ceiling the target's own baseline measured survives a refresh.
  const calibrated = {
    ceiling_ms: 33_000,
    calibrated_at: '2026-09-24T12:00:00.000Z',
    anchor_date: '2026-09-24',
  }

  writeFileSync(
    destination,
    JSON.stringify({
      ...installed,
      fast_wall: { ...installed.fast_wall, ...calibrated },
    }),
  )
  assert.deepEqual(writeProject(source, destination), {
    ...shipped,
    ...calibrated,
  })
})
