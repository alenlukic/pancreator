import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  bestOfNDir,
  loadBestOfNState,
  parseBestOfNConfigs,
} from '../../src/lib/best-of-n.js'
import { createTestTempDirectory } from '../temp.js'

const EXAMPLE_CONFIGS = 'library/templates/best-of-n-config.example.json'

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

test('configs parsing rejects a tier alias in a candidate persona map', () => {
  // `cursor:advanced` parses as executor `cursor` with model `advanced`, so the
  // alias rejection must fire before executor routing accepts it.
  for (const alias of ['anthropic:advanced', 'cursor:advanced']) {
    assert.throws(
      () =>
        parseBestOfNConfigs(
          configs({
            candidates: [
              { name: 'alpha', personas: { coder: alias } },
              { name: 'beta', personas: { coder: 'model-b' } },
            ],
          }),
          'configs.json',
        ),
      /names tier alias/u,
    )
  }
})

test('the committed configs example parses through the real parser', () => {
  // Well-formed JSON is not the contract: the example is the only scaffolding
  // an operator gets for the untracked `best-of-n-config.json`, so it must
  // survive every rule the parser enforces at `best-of-n init`.
  const parsed = parseBestOfNConfigs(
    JSON.parse(readFileSync(path.join(process.cwd(), EXAMPLE_CONFIGS), 'utf8')),
    EXAMPLE_CONFIGS,
  )

  assert.deepEqual(
    parsed.candidates.map((candidate) => candidate.name),
    ['balanced', 'advanced'],
  )
  assert.equal(parsed.consolidation.name, 'consolidation')
  assert.ok(parsed.setup.length > 0)

  const models = [
    ...parsed.candidates.flatMap((candidate) =>
      Object.values(candidate.personas),
    ),
    ...Object.values(parsed.consolidation.personas),
  ]

  assert.ok(
    models.some((model) => model.startsWith('cursor:')),
    'the example demonstrates a cursor executor specification',
  )
})

test('configs parsing accepts a cursor executor specification', () => {
  // `cursor:composer-2.5` routes to the `cursor` executor rather than naming a
  // tier, so the alias rejection must not widen to every `cursor:` prefix.
  assert.doesNotThrow(() =>
    parseBestOfNConfigs(
      configs({
        candidates: [
          { name: 'alpha', personas: { coder: 'cursor:composer-2.5' } },
          { name: 'beta', personas: { coder: 'model-b' } },
        ],
      }),
      'configs.json',
    ),
  )
})
