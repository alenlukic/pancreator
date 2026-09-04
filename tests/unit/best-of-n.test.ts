import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  bestOfNDir,
  loadBestOfNState,
  parseBestOfNConfigs,
} from '../../src/lib/best-of-n.js'
import { createTestTempDirectory } from '../temp.js'

const VALID = {
  schema_version: 1,
  candidates: [
    { name: 'alpha', personas: { coder: 'model-a' } },
    { personas: { coder: 'model-b' } },
  ],
  consolidation: { personas: { metacritic: 'model-c' } },
  setup: ['npm ci'],
}

function configs(overrides: Record<string, unknown>): unknown {
  return { ...VALID, ...overrides }
}

test('session paths reject an invalid session id', () => {
  assert.throws(
    () => bestOfNDir('/fixture', '../../../../outside'),
    /Invalid best-of-N session id/u,
  )
})

test('session state rejects an unknown lifecycle status', () => {
  const root = createTestTempDirectory('pancreator-best-of-n-state-')
  const bonId = '63308_Sep-01-0459_sample'
  const statePath = path.join(bestOfNDir(root, bonId), 'state.json')

  mkdirSync(path.dirname(statePath), { recursive: true })
  writeFileSync(statePath, '{"schema_version":1,"status":"done"}\n')

  assert.throws(
    () => loadBestOfNState(root, bonId),
    /MUST record status 'initializing' or 'ready'/u,
  )
})

test('configs parsing names unnamed candidates and the consolidation slot', () => {
  const parsed = parseBestOfNConfigs(VALID, 'configs.json')

  assert.deepEqual(
    parsed.candidates.map((candidate) => candidate.name),
    ['alpha', 'candidate-2'],
  )
  assert.equal(parsed.consolidation.name, 'consolidation')
  assert.deepEqual(parsed.setup, ['npm ci'])
})

test('configs parsing requires at least two candidates', () => {
  const rejections: Array<[Record<string, unknown>, RegExp]> = [
    [
      { candidates: [VALID.candidates[0]] },
      /candidates MUST list at least 2 entries/,
    ],
    [
      {
        candidates: [
          { name: 'alpha', personas: { coder: 'model-a' } },
          { name: 'alpha', personas: { coder: 'model-b' } },
        ],
      },
      /names candidate 'alpha' more than once/,
    ],
    [
      { consolidation: { name: 'alpha', personas: { metacritic: 'model-c' } } },
      /reuses candidate name 'alpha'/,
    ],
    [
      {
        candidates: [
          { name: 'alpha', personas: { coder: 'no-such-executor:model' } },
          { name: 'beta', personas: { coder: 'model-b' } },
        ],
      },
      /executor/u,
    ],
    [
      {
        candidates: [
          { name: 'Alpha One', personas: { coder: 'model-a' } },
          { name: 'beta', personas: { coder: 'model-b' } },
        ],
      },
      /lowercase alphanumeric with single hyphens/,
    ],
    [{ setup: ['  '] }, /setup\[0\] MUST be a non-empty command string/],
  ]

  for (const [overrides, message] of rejections) {
    assert.throws(
      () => parseBestOfNConfigs(configs(overrides), 'configs.json'),
      message,
    )
  }
})
