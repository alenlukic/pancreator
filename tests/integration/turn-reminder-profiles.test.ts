import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  loadTurnReminderRegistry,
  renderTurnReminder,
  TURN_REMINDER_ROLES,
  type TurnReminderRole,
  validateTurnReminderProfiles,
} from '../../src/lib/governance/prompt-context.js'
import { loadPolicyCatalog } from '../../src/lib/policies.js'
import { sha256 } from '../../src/lib/io.js'
import { createFixture } from '../fixture-template.js'

// The expected sets are written out here rather than read back through the
// registry, so a role pointed at the wrong profile or a broken `extends` chain
// fails this test instead of passing on the resolver's own answer.
const COMMON = [
  'comms-outcome',
  'comms-cap',
  'comms-terminal',
  'comms-incidents',
  'comms-next',
  'principles-objective',
  'principles-priority',
  'principles-judgment',
  'principles-escalation',
  'principles-verdict',
  'card-invariants',
]

const DELEGATING = [
  ...COMMON,
  'delegate-cadence',
  'delegate-turn',
  'delegate-outcome',
]

const EXPECTED_SELECTORS: Record<
  Exclude<TurnReminderRole, 'none'>,
  readonly string[]
> = {
  'regular-supervisor': [
    ...DELEGATING,
    'orch-pending',
    'orch-continuation',
    'orch-watch',
    'orch-redline',
    'orch-delivery-proof',
    'orch-reconcile',
    'single-run-recovery',
  ],
  'cohort-supervisor': [
    ...DELEGATING,
    'cohort-integration',
    'cohort-limit',
    'cohort-parallel',
    'cohort-one-worker',
    'cohort-retry',
  ],
  'long-horizon-supervisor': [
    ...DELEGATING,
    'horizon-progress',
    'horizon-hard-blocks',
    'horizon-cost',
    'horizon-self-caused',
    'horizon-lifecycle',
    'horizon-rebuild',
    'horizon-verification',
  ],
  unbound: [
    ...DELEGATING,
    'operator-authority',
    'operator-no-inference',
    'action-approval',
    'action-evidence',
  ],
  pair: [
    ...DELEGATING,
    'pair-scope',
    'pair-no-workflow',
    'pair-report',
    'pair-check',
    'pair-irreversible',
  ],
  shepherd: [
    ...DELEGATING,
    'shepherd-window',
    'shepherd-ledger',
    'shepherd-verify',
    'shepherd-review',
    'shepherd-branch',
  ],
  debloat: [
    ...DELEGATING,
    'debloat-selection',
    'debloat-closure',
    'debloat-static-gaps',
    'debloat-edits',
    'debloat-verify',
    'debloat-irreversible',
  ],
  cleanup: [...COMMON, 'cleanup-approval', 'cleanup-no-inference'],
  'standalone-other': [
    ...DELEGATING,
    'standalone-approval',
    'standalone-evidence',
  ],
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

test('every role resolves its declared canonical selectors within budget', () => {
  const root = process.cwd()
  const registry = loadTurnReminderRegistry(root)
  const catalog = loadPolicyCatalog(root)
  const agents = readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
  const card = { path: 'AGENTS.md', sha256: sha256(agents) }

  for (const role of TURN_REMINDER_ROLES) {
    if (role === 'none') {
      continue
    }

    const rendered = renderTurnReminder(root, role, { registry, card })

    assert.deepEqual(
      rendered.lines.map((line) => line.selector_id),
      EXPECTED_SELECTORS[role],
    )
    assert.ok(rendered.byte_length <= registry.byte_budget)
    assert.match(rendered.content, new RegExp(`Role: ${role}`, 'u'))
    assert.match(
      rendered.content,
      /Active card: AGENTS\.md \(sha256:[a-f0-9]{64}\)$/u,
    )

    for (const line of rendered.lines) {
      if (line.source.startsWith('AGENTS.md')) {
        assert.ok(agents.includes(line.content))
        continue
      }

      const policy = catalog.get(line.source)
      assert.ok(policy, `selector source ${line.source} exists`)
      assert.ok(
        policy.instructions.some(
          (instruction) => instruction.text === line.content,
        ),
        `${line.selector_id} resolves exact canonical text`,
      )
    }
  }
})

test('validation names a selector whose canonical instruction changed', () => {
  const root = createFixture()
  const policyPath = path.join(root, 'governance', 'policies', 'COMMS-001.json')
  const policy = readJson(policyPath) as {
    instructions: Array<string | { text: string; audience?: string[] }>
  }
  const selected = policy.instructions[1]

  assert.equal(typeof selected, 'string')
  policy.instructions[1] = `${selected} Changed in the fixture.`
  writeJson(policyPath, policy)

  const errors = validateTurnReminderProfiles(root)

  assert.ok(
    errors.some(
      (error) =>
        error.includes("policy selector 'comms-outcome'") &&
        error.includes("'COMMS-001'"),
    ),
    errors.join('\n'),
  )
})

test('validation names every role profile that exceeds the byte budget', () => {
  const root = createFixture()
  const registryPath = path.join(
    root,
    'governance',
    'registries',
    'turn_reminder_profiles.json',
  )
  const registry = readJson(registryPath)

  registry.byte_budget = 512
  writeJson(registryPath, registry)

  const errors = validateTurnReminderProfiles(root)

  assert.ok(
    errors.some(
      (error) =>
        error.includes("profile 'regular-supervisor'") &&
        error.includes('512-byte budget'),
    ),
    errors.join('\n'),
  )
})
