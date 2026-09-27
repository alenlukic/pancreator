/**
 * Tests for AC-1 and AC-2: pan handoff argument resolution and config loading.
 *
 * AC-1: The command builds the prompt, accepts the declared options, and the
 *       help body lists both handoff surfaces.
 * AC-2: Model/effort precedence (flag > config > default) and INVALID_PROJECT_CONFIG
 *       on bad handoff block values.
 */

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  DEFAULT_HANDOFF_EFFORT,
  DEFAULT_HANDOFF_MODEL,
  loadProjectConfig,
  resolveHandoffConfig,
} from '../../src/lib/project-config.js'
import { HELP_BODY } from '../../src/lib/pan-command-grammar.js'
import { validatePanInvocation } from '../../src/lib/pan-command-grammar.js'
import { createTestTempDirectory } from '../temp.js'

// ---------------------------------------------------------------------------
// AC-1: Grammar — known options, help body
// ---------------------------------------------------------------------------

test('pan handoff with a run-id is a valid command surface', () => {
  const result = validatePanInvocation(['handoff', 'run-123'])
  assert.equal(result.valid, true)
  // The surface name is determined by the fixed tokens (e.g. 'handoff')
  assert.ok(result.surface !== null && result.surface.startsWith('handoff'))
})

test('pan handoff accepts --model, --effort, --note, --note-file, --dry-run, --json', () => {
  const knownOptions = [
    '--model',
    '--effort',
    '--note',
    '--note-file',
    '--dry-run',
    '--json',
  ]
  const result = validatePanInvocation(['handoff', 'run-123', '--dry-run'])
  assert.equal(result.valid, true)

  for (const opt of knownOptions) {
    assert.ok(
      result.accepted_options.includes(opt),
      `Expected ${opt} to be accepted`,
    )
  }
})

test('pan handoff --self-check is a valid surface', () => {
  const result = validatePanInvocation(['handoff', '--self-check'])
  assert.equal(result.valid, true)
})

test('pan handoff --self-check accepts --capture-tree and --json', () => {
  const result = validatePanInvocation(['handoff', '--self-check'])
  assert.ok(result.accepted_options.includes('--capture-tree'))
  assert.ok(result.accepted_options.includes('--json'))
})

test('pan handoff <run-id> rejects unknown option', () => {
  const result = validatePanInvocation(['handoff', 'run-123', '--unknown-opt'])
  assert.equal(result.valid, false)
  assert.ok(result.error?.includes('--unknown-opt'))
})

test('help body lists pan handoff <run-id> usage', () => {
  assert.ok(
    HELP_BODY.includes('pan handoff <run-id>'),
    'Help body must list the run-id surface',
  )
})

test('help body lists pan handoff --self-check usage', () => {
  assert.ok(
    HELP_BODY.includes('pan handoff --self-check'),
    'Help body must list the self-check surface',
  )
})

// ---------------------------------------------------------------------------
// AC-2: Model/effort precedence
// ---------------------------------------------------------------------------

test('resolveHandoffConfig returns built-in defaults when config and flags are absent', () => {
  const config = resolveHandoffConfig(null)
  assert.equal(config.model, DEFAULT_HANDOFF_MODEL)
  assert.equal(config.effort, DEFAULT_HANDOFF_EFFORT)
})

test('resolveHandoffConfig uses config.json handoff block over defaults', () => {
  const config = resolveHandoffConfig(
    {
      schema_version: 1,
      handoff: { model: 'Configured Model', effort: 'Medium' },
    },
    {},
  )
  assert.equal(config.model, 'Configured Model')
  assert.equal(config.effort, 'Medium')
})

test('resolveHandoffConfig uses flag values over config', () => {
  const config = resolveHandoffConfig(
    {
      schema_version: 1,
      handoff: { model: 'Configured Model', effort: 'Medium' },
    },
    { model: 'Flag Model', effort: 'Low' },
  )
  assert.equal(config.model, 'Flag Model')
  assert.equal(config.effort, 'Low')
})

test('resolveHandoffConfig uses flag value for model only when effort is absent', () => {
  const config = resolveHandoffConfig(
    {
      schema_version: 1,
      handoff: { model: 'Configured Model', effort: 'Medium' },
    },
    { model: 'Flag Model' },
  )
  assert.equal(config.model, 'Flag Model')
  assert.equal(config.effort, 'Medium')
})

for (const [label, flags] of [
  ['empty --model', { model: '' }],
  ['blank --effort', { effort: '   ' }],
  ['multi-line --model', { model: 'Claude\nOpus' }],
  ['over-long --effort', { effort: 'x'.repeat(101) }],
] as const) {
  test(`resolveHandoffConfig rejects an ${label} with INVALID_ARGUMENT`, () => {
    assert.throws(
      () => resolveHandoffConfig(null, flags),
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, 'INVALID_ARGUMENT')
        return true
      },
    )
  })
}

test('config.json ships handoff.model Claude Opus 5.5 and handoff.effort High', () => {
  const raw = readFileSync(path.resolve(process.cwd(), 'config.json'), 'utf8')
  const parsed = JSON.parse(raw) as {
    handoff?: { model?: string; effort?: string }
  }

  assert.equal(parsed.handoff?.model, 'Claude Opus 5.5')
  assert.equal(parsed.handoff?.effort, 'High')
})

test('loadProjectConfig rejects a non-object handoff block', () => {
  const tmpRoot = createTestTempDirectory('pancreator-handoff-config-')

  const base = JSON.parse(
    readFileSync(path.resolve(process.cwd(), 'config.json'), 'utf8'),
  ) as Record<string, unknown>

  writeFileSync(
    path.join(tmpRoot, 'config.json'),
    `${JSON.stringify({ ...base, handoff: 'bad' }, null, 2)}\n`,
  )

  assert.throws(
    () => loadProjectConfig(tmpRoot),
    (err: unknown) => {
      assert.ok(
        err instanceof Error &&
          err.message.includes('handoff MUST be an object'),
      )
      return true
    },
  )
})

test('loadProjectConfig rejects empty handoff.model', () => {
  const tmpRoot = createTestTempDirectory('pancreator-handoff-empty-model-')

  const base = JSON.parse(
    readFileSync(path.resolve(process.cwd(), 'config.json'), 'utf8'),
  ) as Record<string, unknown>

  writeFileSync(
    path.join(tmpRoot, 'config.json'),
    `${JSON.stringify({ ...base, handoff: { model: '', effort: 'High' } }, null, 2)}\n`,
  )

  assert.throws(
    () => loadProjectConfig(tmpRoot),
    (err: unknown) => {
      assert.ok(
        err instanceof Error &&
          err.message.includes('handoff.model MUST be a non-empty string'),
      )
      return true
    },
  )
})
