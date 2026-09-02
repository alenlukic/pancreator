import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  BUILT_IN_VERIFICATION_LEVELS,
  DEFAULT_VERIFICATION_LEVEL,
  effectiveRepositoryCheckProfile,
  parseVerification,
  resolveVerification,
} from '../../src/lib/verification.js'

test('a config without a verification block gets the built-in levels and the light default', () => {
  const file = parseVerification({})

  assert.equal(file.active, DEFAULT_VERIFICATION_LEVEL)
  assert.equal(file.active, 'light')
  assert.deepEqual(
    Object.keys(file.levels).sort(),
    Object.keys(BUILT_IN_VERIFICATION_LEVELS).sort(),
  )
})

test('minimal disables every full gate and thorough is an alias of light', () => {
  assert.deepEqual(BUILT_IN_VERIFICATION_LEVELS.light.gates, {
    'test.full_suite': 'full',
    'verify.full_suite': 'full',
    'remediate.full_suite': 'full',
  })
  assert.deepEqual(BUILT_IN_VERIFICATION_LEVELS.minimal.gates, {
    'test.full_suite': false,
    'verify.full_suite': false,
    'remediate.full_suite': false,
  })
  // thorough keeps every workflow-declared profile, which is full at both
  // submission gates: the same effective mapping as light.
  assert.deepEqual(BUILT_IN_VERIFICATION_LEVELS.thorough.gates, {})

  for (const criterionId of ['verify.full_suite', 'remediate.full_suite']) {
    const criterion = { id: criterionId, command: 'pan repository-check full' }
    const light = effectiveRepositoryCheckProfile(
      {
        level: 'light',
        summary: '',
        gates: BUILT_IN_VERIFICATION_LEVELS.light.gates,
      },
      criterion,
    )
    const thorough = effectiveRepositoryCheckProfile(
      { level: 'thorough', summary: '', gates: {} },
      criterion,
    )

    assert.deepEqual(thorough, light)
  }

  for (const level of Object.values(BUILT_IN_VERIFICATION_LEVELS)) {
    for (const [criterionId, profile] of Object.entries(level.gates)) {
      assert.ok(criterionId.endsWith('.full_suite'))
      assert.notEqual(profile, 'fast')
    }
  }
})

test('operator levels merge over the built-ins and can change the active level', () => {
  const file = parseVerification({
    verification: {
      active: 'ci-mirror',
      levels: {
        'ci-mirror': {
          summary: 'Mirror the CI gate exactly.',
          gates: { 'test.full_suite': 'secondary' },
        },
        light: {
          summary: 'Retuned light.',
          gates: { 'test.full_suite': false },
        },
      },
    },
  })

  assert.equal(file.active, 'ci-mirror')
  assert.deepEqual(file.levels['ci-mirror'].gates, {
    'test.full_suite': 'secondary',
  })
  assert.deepEqual(file.levels.light.gates, { 'test.full_suite': false })
  assert.ok(file.levels.minimal)
  assert.ok(file.levels.thorough)
})

test('a gate value that is neither a profile name nor false is rejected', () => {
  assert.throws(
    () =>
      parseVerification({
        verification: {
          levels: {
            broken: { summary: 'x', gates: { 'test.full_suite': 7 } },
          },
        },
      }),
    /MUST name a repository-check profile or be false/u,
  )

  assert.throws(
    () => parseVerification({ verification: { active: 'exhaustive' } }),
    /not a defined verification level/u,
  )
})

test('resolveVerification snapshots the named level from config.json', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pan-verification-'))

  writeFileSync(
    path.join(root, 'config.json'),
    JSON.stringify({ verification: { active: 'minimal' } }),
  )

  const active = resolveVerification(root)

  assert.equal(active.level, 'minimal')
  assert.deepEqual(active.gates, {
    'test.full_suite': false,
    'verify.full_suite': false,
    'remediate.full_suite': false,
  })

  const named = resolveVerification(root, 'thorough')

  assert.equal(named.level, 'thorough')
  assert.deepEqual(named.gates, {})

  assert.throws(() => resolveVerification(root, 'nope'), /not defined/u)
})

test('effectiveRepositoryCheckProfile applies the level remap only to repository-check gates', () => {
  const light = {
    level: 'light',
    summary: '',
    gates: {
      'test.full_suite': 'fast',
      'implement.lint': false,
    } as Record<string, string | false>,
  }

  // Remapped gate runs the level's profile.
  assert.deepEqual(
    effectiveRepositoryCheckProfile(light, {
      id: 'test.full_suite',
      command: 'pan repository-check full',
    }),
    { profile: 'fast', skipped: false },
  )

  // A gate the level does not name keeps its workflow-declared profile.
  assert.deepEqual(
    effectiveRepositoryCheckProfile(light, {
      id: 'implement.unit_tests',
      command: 'pan repository-check fast',
    }),
    { profile: 'fast', skipped: false },
  )

  // false skips the gate.
  assert.deepEqual(
    effectiveRepositoryCheckProfile(light, {
      id: 'implement.lint',
      command: 'pan repository-check static',
    }),
    { profile: null, skipped: true },
  )

  // A non-repository-check shell criterion is never remapped or skipped.
  assert.deepEqual(
    effectiveRepositoryCheckProfile(light, {
      id: 'test.full_suite',
      command: 'npm test',
    }),
    { profile: null, skipped: false },
  )

  // A run without a snapshot keeps workflow-declared behavior.
  assert.deepEqual(
    effectiveRepositoryCheckProfile(undefined, {
      id: 'test.full_suite',
      command: 'pan repository-check full',
    }),
    { profile: 'full', skipped: false },
  )
})
