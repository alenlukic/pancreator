import assert from 'node:assert/strict'
import test from 'node:test'

import { bestOfNDir, parseBestOfNConfigs } from '../../src/lib/best-of-n.js'

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
  assert.throws(
    () =>
      parseBestOfNConfigs(
        configs({ candidates: [VALID.candidates[0]] }),
        'configs.json',
      ),
    /candidates MUST list at least 2 entries/,
  )
})

test('configs parsing rejects duplicate candidate names', () => {
  assert.throws(
    () =>
      parseBestOfNConfigs(
        configs({
          candidates: [
            { name: 'alpha', personas: { coder: 'model-a' } },
            { name: 'alpha', personas: { coder: 'model-b' } },
          ],
        }),
        'configs.json',
      ),
    /names candidate 'alpha' more than once/,
  )
})

test('configs parsing rejects a consolidation name that shadows a candidate', () => {
  assert.throws(
    () =>
      parseBestOfNConfigs(
        configs({
          consolidation: { name: 'alpha', personas: { metacritic: 'model-c' } },
        }),
        'configs.json',
      ),
    /reuses candidate name 'alpha'/,
  )
})

test('configs parsing rejects an unusable persona mapping', () => {
  assert.throws(
    () =>
      parseBestOfNConfigs(
        configs({
          candidates: [
            { name: 'alpha', personas: { coder: 'no-such-executor:model' } },
            { name: 'beta', personas: { coder: 'model-b' } },
          ],
        }),
        'configs.json',
      ),
    /executor/u,
  )
})

test('configs parsing rejects a name a Cursor agent filename cannot carry', () => {
  assert.throws(
    () =>
      parseBestOfNConfigs(
        configs({
          candidates: [
            { name: 'Alpha One', personas: { coder: 'model-a' } },
            { name: 'beta', personas: { coder: 'model-b' } },
          ],
        }),
        'configs.json',
      ),
    /lowercase alphanumeric with single hyphens/,
  )
})

test('configs parsing rejects consecutive hyphens in a name', () => {
  assert.throws(
    () =>
      parseBestOfNConfigs(
        configs({
          candidates: [
            { name: 'alpha--one', personas: { coder: 'model-a' } },
            { name: 'beta', personas: { coder: 'model-b' } },
          ],
        }),
        'configs.json',
      ),
    /lowercase alphanumeric with single hyphens/,
  )
})

test('configs parsing rejects an empty setup command', () => {
  assert.throws(
    () => parseBestOfNConfigs(configs({ setup: ['  '] }), 'configs.json'),
    /setup\[0\] MUST be a non-empty command string/,
  )
})
