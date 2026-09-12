import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  bestOfNDir,
  bestOfNStatus,
  loadBestOfNState,
  parseBestOfNConfigs,
} from '../../src/lib/best-of-n.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
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

  // `cursor:composer-2.5` routes to the `cursor` executor rather than naming
  // a tier, so the rejection must not widen to every `cursor:` prefix.
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

test('a candidate circuit breaker ends that candidate without operator input', () => {
  // bestOfNStatus reads the session record and each candidate's run state and
  // nothing else, so the terminal classification is provable against written
  // state. Driving it through a worktree-backed 'ready' checkpoint proved one
  // status per clone; a written state proves every terminal status at once.
  const root = createTestTempDirectory('bon-terminal-status-')
  const bonId = '63297_Sep-12-0001_terminal'
  const terminal = ['succeeded', 'failed', 'canceled'] as const
  const candidates = terminal.map((status, index) => ({
    slot: `slot-${index + 1}`,
    run_id: `63297_Sep-12-000${index + 1}_bon-${status}`,
    agent_suffix: `${bonId}-slot-${index + 1}`,
    request_path: `runtime/logs/best-of-n/${bonId}/request.md`,
  }))
  const sessionDirectory = bestOfNDir(root, bonId)

  mkdirSync(sessionDirectory, { recursive: true })
  writeFileSync(
    path.join(sessionDirectory, 'state.json'),
    `${JSON.stringify(
      {
        schema_version: 1,
        bon_id: bonId,
        status: 'ready',
        candidates,
        pending: [],
      },
      null,
      2,
    )}\n`,
  )

  for (const [index, candidate] of candidates.entries()) {
    const statePath = resolveRunLayout(root, candidate.run_id).state.absolute

    mkdirSync(path.dirname(statePath), { recursive: true })
    writeFileSync(
      statePath,
      `${JSON.stringify(
        {
          schema_version: 1,
          run_id: candidate.run_id,
          workflow_slug: 'delivery',
          title: 'Candidate run',
          // A circuit breaker ends the candidate where it stands: no stage is
          // current and no action waits on the operator.
          status: terminal[index],
          current_stage: null,
          pending_action: { type: 'none' },
          stage_history: [],
          attempts: {},
          best_of_n: { bon_id: bonId, role: 'candidate', slot: candidate.slot },
        },
        null,
        2,
      )}\n`,
    )
  }

  const status = bestOfNStatus(root, bonId)

  assert.deepEqual(
    status.candidates.map((candidate) => [
      candidate.status,
      candidate.terminal,
    ]),
    terminal.map((value) => [value, true]),
  )
  assert.deepEqual(status.unresolved, [], 'no terminal candidate is unresolved')
})
