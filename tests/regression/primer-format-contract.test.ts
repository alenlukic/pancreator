import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { loadPolicyCatalog } from '../../src/lib/policies.js'
import {
  PRIMER_FLOW_STEP_LABELS,
  PRIMER_FRONTEND_LABELS,
} from '../../src/lib/validators/target-repo-primer.js'

const REPO_ROOT = process.cwd()

/**
 * The librarian only ever sees the card and its persona. A label the validator
 * rejects the primer for must therefore be stated where the librarian reads,
 * or the deterministic contract is unfollowable and the rebuild fails on
 * formatting the persona never named.
 */
test('PRIMER-001 states every bold label the primer validator enforces', () => {
  const policy = loadPolicyCatalog(REPO_ROOT).get('PRIMER-001')

  assert.ok(policy)

  const text = policy.instructions.join('\n')

  for (const label of [...PRIMER_FRONTEND_LABELS, ...PRIMER_FLOW_STEP_LABELS]) {
    assert.ok(
      text.includes(`\`**${label}:**\``),
      `PRIMER-001 MUST state the required label **${label}:**`,
    )
  }

  assert.match(
    text,
    /same line as its label/u,
    'PRIMER-001 MUST state that a label carries its value on the same line',
  )
  assert.match(
    text,
    /#### Step <n>/u,
    'PRIMER-001 MUST state the ordered flow-step heading shape',
  )
})

test('the librarian persona defers to PRIMER-001 for the primer label shape', () => {
  const persona = readFileSync(
    path.join(REPO_ROOT, 'library/personas/librarian.md'),
    'utf8',
  )

  assert.ok(
    persona.includes('PRIMER-001'),
    'the persona MUST name PRIMER-001 as the governing label contract',
  )

  for (const label of [...PRIMER_FRONTEND_LABELS, ...PRIMER_FLOW_STEP_LABELS]) {
    assert.ok(
      !persona.includes(`**${label}:**`),
      `the persona MUST NOT restate '${label}'; the policy travels on the card`,
    )
  }
})
