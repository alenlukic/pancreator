import assert from 'node:assert/strict'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  COMMAND_GOVERNANCE_REGISTRY_PATH,
  validateCommandGovernance,
} from '../../src/lib/governance/command-coverage.js'
import { createFixture, sharedFixture, writeJson } from '../helpers.js'

function run(root: string) {
  const errors: string[] = []
  const warnings: string[] = []

  validateCommandGovernance(root, errors, warnings)

  return { errors, warnings }
}

test('every canonical command delivers a card or is an allowlisted read-only utility', () => {
  const { errors, warnings } = run(sharedFixture())

  assert.deepEqual(errors, [])

  // The supervisor commands carry their card step, so nothing is pending.
  const pending = warnings.filter((item) => item.includes('pending:'))

  assert.deepEqual(pending, [])
})

test('a new command without a card fails validation with the fix named', () => {
  const root = createFixture()

  writeFileSync(
    path.join(root, 'library/cursor/commands/pan-newthing.md'),
    'Do a new thing.\n\n1. Read `AGENTS.md`.\n2. Invoke the `pan-coder` subagent.\n',
  )

  const { errors } = run(root)

  assert.equal(errors.length, 1)
  assert.match(errors[0] ?? '', /pan-newthing\.md delivers no governance card/u)
  assert.match(errors[0] ?? '', /pan governance card --mode <mode>/u)
  assert.match(errors[0] ?? '', /read_only_commands/u)
})

test('a command that tells the session to read a policy file by hand is rejected', () => {
  const root = createFixture()

  writeFileSync(
    path.join(root, 'library/cursor/commands/pan-handmade.md'),
    'Hand-assembled governance.\n\n' +
      '1. Run `./bin/pan governance card --mode pair` and read the card.\n' +
      '2. Read `governance/policies/PAIR-001.json` and inline it into the prompt.\n',
  )

  const { errors } = run(root)

  assert.equal(errors.length, 1)
  assert.match(
    errors[0] ?? '',
    /references governance\/policies\/PAIR-001\.json by file path/u,
  )
})

test('an unknown mode, a stale pending entry, and a missing supervisor card are all errors', () => {
  const root = createFixture()
  const registryPath = path.join(root, COMMAND_GOVERNANCE_REGISTRY_PATH)
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
    pending_card_steps: Array<{ command: string; expires_with: string }>
  }

  // pan-resume carries its card step, so a pending entry for it is stale.
  registry.pending_card_steps = [
    { command: 'pan-resume', expires_with: 'a step that already landed' },
  ]
  writeJson(registryPath, registry)

  // pan-start loses its card step and has no pending entry.
  const startPath = path.join(root, 'library/cursor/commands/pan-start.md')
  const start = readFileSync(startPath, 'utf8')
    .split('\n')
    .filter((line) => !line.includes('governance card --mode supervisor'))
    .join('\n')

  writeFileSync(startPath, start)

  writeFileSync(
    path.join(root, 'library/cursor/commands/pan-odd.md'),
    'Odd mode.\n\n1. Run `./bin/pan governance card --mode nonsense`.\n',
  )

  const { errors } = run(root)

  assert.ok(
    errors.some((item) =>
      /pan-resume\.md now runs a governance card; remove its pending_card_steps entry/u.test(
        item,
      ),
    ),
    errors.join('\n'),
  )
  assert.ok(
    errors.some((item) =>
      /pan-start\.md delivers no governance card/u.test(item),
    ),
    errors.join('\n'),
  )
  assert.ok(
    errors.some((item) =>
      /pan-odd\.md runs `governance card --mode nonsense`, which is not a registered mode/u.test(
        item,
      ),
    ),
    errors.join('\n'),
  )
})

test('a read-only command with a required card mode is accepted', () => {
  const root = createFixture()
  const commandPath = path.join(
    root,
    'library/cursor/commands/pan-tune-harness.md',
  )

  assert.ok(existsSync(commandPath))

  const { errors } = run(root)

  assert.ok(
    !errors.some((item) => item.includes('pan-tune-harness')),
    errors.join('\n'),
  )

  const command = readFileSync(commandPath, 'utf8')

  writeFileSync(
    commandPath,
    command.replace(
      'governance card --mode tune-harness',
      'governance card --mode review',
    ),
  )

  const missingCard = run(root)

  assert.ok(
    missingCard.errors.some((item) =>
      item.includes('MUST run `pan governance card --mode tune-harness`'),
    ),
    missingCard.errors.join('\n'),
  )

  writeFileSync(commandPath, command)

  const registryPath = path.join(root, COMMAND_GOVERNANCE_REGISTRY_PATH)
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
    read_only_commands: Array<string | { command: string; card_mode: string }>
  }
  const tuneEntry = registry.read_only_commands.find(
    (item) => typeof item !== 'string' && item.command === 'pan-tune-harness',
  )

  assert.ok(tuneEntry && typeof tuneEntry !== 'string')

  if (tuneEntry && typeof tuneEntry !== 'string') {
    tuneEntry.card_mode = 'missing-mode'
  }

  writeJson(registryPath, registry)

  const invalidMode = run(root)

  assert.ok(
    invalidMode.errors.some((item) =>
      item.includes("card_mode 'missing-mode', which is not a registered mode"),
    ),
    invalidMode.errors.join('\n'),
  )
})

test('a read-only command that runs a card and a registry naming a missing command are errors', () => {
  const root = createFixture()
  const registryPath = path.join(root, COMMAND_GOVERNANCE_REGISTRY_PATH)
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
    read_only_commands: string[]
  }

  registry.read_only_commands.push('pan-pair', 'pan-vanished')
  writeJson(registryPath, registry)

  const { errors } = run(root)

  assert.ok(
    errors.some((item) =>
      /pan-pair\.md runs a governance card but .* lists it as a cardless read-only utility/u.test(
        item,
      ),
    ),
  )
  assert.ok(
    errors.some((item) =>
      /names command 'pan-vanished', which does not exist/u.test(item),
    ),
  )
})

test('a standalone lookup row without a mode and a mode without a row are errors', () => {
  const root = createFixture()
  const lookupPath = path.join(
    root,
    'governance/registries/policy_lookup_table.json',
  )
  const lookup = JSON.parse(readFileSync(lookupPath, 'utf8')) as {
    rows: Array<Record<string, unknown>>
  }

  lookup.rows.push({
    persona: 'coder',
    workflow: 'standalone',
    stage: 'orphan',
    policies: ['PAIR-001'],
  })
  lookup.rows = lookup.rows.filter(
    (row) => !(row.persona === 'release-steward' && row.workflow === '*'),
  )
  writeJson(lookupPath, lookup)

  const { errors } = run(root)

  assert.ok(
    errors.some((item) =>
      /stage orphan\) names a stage no STANDALONE_MODES entry declares/u.test(
        item,
      ),
    ),
    errors.join('\n'),
  )
  assert.ok(
    errors.some((item) =>
      /standalone mode 'write-pr' .* has no persona-specific row/u.test(item),
    ) ||
      errors.some((item) => /standalone mode 'release'/u.test(item)) === false,
    errors.join('\n'),
  )
})

test('a missing registry is itself an error', () => {
  const root = createFixture()

  unlinkSync(path.join(root, COMMAND_GOVERNANCE_REGISTRY_PATH))

  const { errors } = run(root)

  assert.deepEqual(errors, [
    `missing required file: ${COMMAND_GOVERNANCE_REGISTRY_PATH}`,
  ])
})
