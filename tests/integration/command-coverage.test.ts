import assert from 'node:assert/strict'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { assertWorktreeOptionSupported } from '../../src/cli.js'
import {
  COMMAND_GOVERNANCE_REGISTRY_PATH,
  validateCommandGovernance,
} from '../../src/lib/governance/command-coverage.js'
import { createFixture, writeJson } from '../helpers.js'

/**
 * Every `pan` command line a projected command file prescribes, as argv. An
 * optional `[...]` group is kept, because the session may pass it, and the
 * first alternative of a `|` choice stands for the group.
 */
function panInvocations(command: string): string[][] {
  return [
    ...command.matchAll(/`\{\{PANCREATOR_PAN_COMMAND\}\} ([^`]+)`/gu),
  ].map((match) =>
    (match[1] as string)
      .replaceAll(
        /\[([^\]]+)\]/gu,
        (_all, group: string) => group.split('|')[0] as string,
      )
      .trim()
      .split(/\s+/u),
  )
}

function run(root: string) {
  const errors: string[] = []
  const warnings: string[] = []

  validateCommandGovernance(root, errors, warnings)

  return { errors, warnings }
}

test('target-mutating commands must preserve every worktree forwarding step', () => {
  const root = createFixture()
  const releasePath = path.join(root, 'library/cursor/commands/pan-release.md')
  const release = readFileSync(releasePath, 'utf8')

  writeFileSync(
    releasePath,
    release.replaceAll('--worktree <name>', '--workspace-omitted'),
  )

  const missingForwarding = run(root)

  assert.ok(
    missingForwarding.errors.some(
      (error) =>
        error.includes('pan-release.md is target-mutating') &&
        error.includes('worktree'),
    ),
    missingForwarding.errors.join('\n'),
  )

  writeFileSync(releasePath, release)

  const registryPath = path.join(root, COMMAND_GOVERNANCE_REGISTRY_PATH)
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as Record<
    string,
    unknown
  >

  delete registry.target_mutating_commands
  writeJson(registryPath, registry)

  assert.ok(
    run(root).errors.some((error) =>
      error.includes('target_mutating_commands in schema 4'),
    ),
  )
})

test('pan-conform is explicitly registered with its conform card', () => {
  const root = createFixture()
  const command = readFileSync(
    path.join(root, 'library/cursor/commands/pan-conform.md'),
    'utf8',
  )
  const validationStep = command
    .split('\n')
    .find((line) => line.startsWith('8. '))

  assert.match(validationStep ?? '', /requirements run/u)

  // Conform is installation-scoped, so no step may prescribe a command line
  // the CLI refuses. Reading the steps back through the CLI's own option gate
  // observes that; counting steps and matching `--worktree` observed prose and
  // stayed green while `requirements run --worktree` exited non-zero.
  const invocations = panInvocations(command)

  assert.ok(invocations.length >= 4, command)

  for (const invocation of invocations) {
    assert.doesNotThrow(
      () =>
        assertWorktreeOptionSupported(
          invocation[0] as string,
          invocation.slice(1),
        ),
      invocation.join(' '),
    )
  }

  // The gate accepts `--worktree` for every step this command prints.
  // Installation scope is the decision, so no step may carry the option and
  // no `|` alternative may hide one from `panInvocations`. This negative
  // asserts a forbidden option is absent, unlike the pin it replaced, which
  // asserted a required option was absent and so held a defect in place.
  assert.doesNotMatch(command, /--worktree/u)
  assert.match(command, /installation-root harness artifacts/u)

  const registryPath = path.join(root, COMMAND_GOVERNANCE_REGISTRY_PATH)
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
    card_commands: Array<{ command: string; card_mode: string }>
  }
  const conform = registry.card_commands.find(
    (entry) => entry.command === 'pan-conform',
  )

  assert.deepEqual(conform, {
    command: 'pan-conform',
    card_mode: 'conform',
  })
  assert.deepEqual(
    registry.card_commands.find((entry) => entry.command === 'pan-author'),
    { command: 'pan-author', card_mode: 'author' },
  )
  assert.deepEqual(run(root).errors, [])

  assert.ok(conform)
  conform.card_mode = 'review'
  writeJson(registryPath, registry)

  assert.ok(
    run(root).errors.some((error) =>
      error.includes(
        'pan-conform.md MUST run `pan governance card --mode review`',
      ),
    ),
  )
})

test('pan-style is registered with its style card and forwards its worktree', () => {
  const root = createFixture()
  const command = readFileSync(
    path.join(root, 'library/cursor/commands/pan-style.md'),
    'utf8',
  )

  // The mode edits workspace source, so every style invocation must accept the
  // shared worktree option the command forwards.
  for (const invocation of panInvocations(command)) {
    assert.doesNotThrow(
      () =>
        assertWorktreeOptionSupported(
          invocation[0] as string,
          invocation.slice(1),
        ),
      invocation.join(' '),
    )
  }

  const registryPath = path.join(root, COMMAND_GOVERNANCE_REGISTRY_PATH)
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
    card_commands: Array<{ command: string; card_mode: string }>
    target_mutating_commands: Array<{
      command: string
      worktree_forwarding: string[]
    }>
  }

  assert.deepEqual(
    registry.card_commands.find((entry) => entry.command === 'pan-style'),
    { command: 'pan-style', card_mode: 'style' },
  )

  const mutating = registry.target_mutating_commands.find(
    (entry) => entry.command === 'pan-style',
  )

  assert.ok(mutating)
  assert.deepEqual(mutating.worktree_forwarding, [
    'style scan --worktree <name> --json',
    'style checkpoint --worktree <name> --json',
  ])
  assert.deepEqual(run(root).errors, [])

  mutating.worktree_forwarding = ['style scan --json']
  writeJson(registryPath, registry)

  assert.ok(
    run(root).errors.some((error) =>
      error.includes('pan-style.md is target-mutating and MUST forward'),
    ),
  )
})

test('pan-harden is registered with its harden card and forwards its worktree', () => {
  const root = createFixture()
  const command = readFileSync(
    path.join(root, 'library/cursor/commands/pan-harden.md'),
    'utf8',
  )

  // The session edits the workspace the card binds, so every invocation the
  // command prints must accept the shared worktree option it forwards.
  for (const invocation of panInvocations(command)) {
    assert.doesNotThrow(
      () =>
        assertWorktreeOptionSupported(
          invocation[0] as string,
          invocation.slice(1),
        ),
      invocation.join(' '),
    )
  }

  const registryPath = path.join(root, COMMAND_GOVERNANCE_REGISTRY_PATH)
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
    card_commands: Array<{ command: string; card_mode: string }>
    target_mutating_commands: Array<{
      command: string
      worktree_forwarding: string[]
    }>
  }

  assert.deepEqual(
    registry.card_commands.find((entry) => entry.command === 'pan-harden'),
    { command: 'pan-harden', card_mode: 'harden' },
  )

  const mutating = registry.target_mutating_commands.find(
    (entry) => entry.command === 'pan-harden',
  )

  assert.ok(mutating)
  assert.deepEqual(mutating.worktree_forwarding, [
    'governance card --mode harden --worktree <name>',
  ])
  assert.deepEqual(run(root).errors, [])

  mutating.worktree_forwarding = [
    'governance card --mode harden --worktree <name> --json',
  ]
  writeJson(registryPath, registry)

  assert.ok(
    run(root).errors.some((error) =>
      error.includes('pan-harden.md is target-mutating and MUST forward'),
    ),
  )
})

test('pan-polish is registered with its polish card and forwards its worktree', () => {
  const root = createFixture()
  const command = readFileSync(
    path.join(root, 'library/cursor/commands/pan-polish.md'),
    'utf8',
  )

  // The session edits the workspace the card binds, so every invocation the
  // command prints must accept the shared worktree option it forwards.
  for (const invocation of panInvocations(command)) {
    assert.doesNotThrow(
      () =>
        assertWorktreeOptionSupported(
          invocation[0] as string,
          invocation.slice(1),
        ),
      invocation.join(' '),
    )
  }

  const registryPath = path.join(root, COMMAND_GOVERNANCE_REGISTRY_PATH)
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
    card_commands: Array<{ command: string; card_mode: string }>
    target_mutating_commands: Array<{
      command: string
      worktree_forwarding: string[]
    }>
  }

  assert.deepEqual(
    registry.card_commands.find((entry) => entry.command === 'pan-polish'),
    { command: 'pan-polish', card_mode: 'polish' },
  )

  const mutating = registry.target_mutating_commands.find(
    (entry) => entry.command === 'pan-polish',
  )

  assert.ok(mutating)
  assert.deepEqual(mutating.worktree_forwarding, [
    'governance card --mode polish --worktree <name>',
  ])
  assert.deepEqual(run(root).errors, [])

  mutating.worktree_forwarding = [
    'governance card --mode polish --worktree <name> --json',
  ]
  writeJson(registryPath, registry)

  assert.ok(
    run(root).errors.some((error) =>
      error.includes('pan-polish.md is target-mutating and MUST forward'),
    ),
  )
})

test('pan-research is registered with its research card and validates its document', () => {
  const root = createFixture()
  const command = readFileSync(
    path.join(root, 'library/cursor/commands/pan-research.md'),
    'utf8',
  )

  // The session writes one harness-owned document and touches no workspace,
  // so the command binds no worktree and every step it prints must be one
  // the CLI accepts as written.
  assert.doesNotMatch(command, /--worktree/u)
  assert.match(command, /requirements run --persona researcher/u)
  assert.match(command, /SIMPLIFIED-ENGLISH-VALIDATE-001/u)
  assert.match(command, /runtime\/research\//u)

  for (const invocation of panInvocations(command)) {
    assert.doesNotThrow(
      () =>
        assertWorktreeOptionSupported(
          invocation[0] as string,
          invocation.slice(1),
        ),
      invocation.join(' '),
    )
  }

  const registryPath = path.join(root, COMMAND_GOVERNANCE_REGISTRY_PATH)
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
    card_commands: Array<{ command: string; card_mode: string }>
    target_mutating_commands: Array<{ command: string }>
  }
  const research = registry.card_commands.find(
    (entry) => entry.command === 'pan-research',
  )

  assert.deepEqual(research, {
    command: 'pan-research',
    card_mode: 'research',
  })
  assert.equal(
    registry.target_mutating_commands.some(
      (entry) => entry.command === 'pan-research',
    ),
    false,
  )
  assert.deepEqual(run(root).errors, [])

  assert.ok(research)
  research.card_mode = 'investigation'
  writeJson(registryPath, registry)

  assert.ok(
    run(root).errors.some((error) =>
      error.includes(
        'pan-research.md MUST run `pan governance card --mode investigation`',
      ),
    ),
  )
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

  // A registry that is gone entirely is the one error worth reporting.
  unlinkSync(registryPath)

  assert.deepEqual(run(root).errors, [
    `missing required file: ${COMMAND_GOVERNANCE_REGISTRY_PATH}`,
  ])
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
    (row) =>
      !(
        row.persona === 'release-steward' &&
        ((row.workflow === 'standalone' && row.stage === 'write-pr') ||
          (row.workflow === '*' && row.stage === '*'))
      ),
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
    ),
    errors.join('\n'),
  )
  assert.equal(
    errors.some((item) => /standalone mode 'release'/u.test(item)),
    false,
    errors.join('\n'),
  )
})

// int-con HR-005: the `target-` prefix exempted a standalone row by name, so
// a row that named a stage no installed extension supplied passed the check
// it was written to run.
test('a target- standalone row is exempt only when an extension supplies it', () => {
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
    stage: 'target-acme',
    policies: ['PAIR-001'],
  })
  writeJson(lookupPath, lookup)

  const uninstalled = run(root).errors

  assert.ok(
    uninstalled.some((item) =>
      /stage target-acme\) names a stage no STANDALONE_MODES entry declares and no policy_lookup\.d extension supplies/u.test(
        item,
      ),
    ),
    uninstalled.join('\n'),
  )

  writeJson(
    path.join(root, 'governance/registries/policy_lookup.d/acme.json'),
    {
      schema_version: 1,
      extension_id: 'acme',
      rows: [
        {
          persona: 'coder',
          workflow: 'standalone',
          stage: 'target-acme',
          policies: ['PAIR-001'],
        },
      ],
    },
  )

  const installed = run(root).errors

  assert.equal(
    installed.some((item) => /target-acme/u.test(item)),
    false,
    installed.join('\n'),
  )
})

// int-con HR-005: the supervisor form closed its code span after the mode,
// so the option the message names fell outside the span and a stray
// backtick trailed it.
test('the supervisor card requirement is one balanced code span', () => {
  const root = createFixture()
  const startPath = path.join(root, 'library/cursor/commands/pan-start.md')
  const start = readFileSync(startPath, 'utf8').replaceAll(
    'governance card --mode supervisor',
    'governance card --mode review',
  )

  writeFileSync(startPath, start)

  const message = run(root).errors.find((item) =>
    item.startsWith('library/cursor/commands/pan-start.md MUST run'),
  )

  assert.equal(
    message,
    'library/cursor/commands/pan-start.md MUST run ' +
      '`pan governance card --mode supervisor --run <run-id>`',
  )
  assert.equal((message?.match(/`/gu) ?? []).length % 2, 0)
})
