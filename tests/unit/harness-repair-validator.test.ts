import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validateHarnessRepairIntake } from '../../src/lib/validators/stage-validators.js'
import { createFixture } from '../helpers.js'

function validate(content: string) {
  const root = createFixture()
  const targetPath = 'runtime/inbox/harness-repair.md'

  writeFileSync(path.join(root, targetPath), content)

  return validateHarnessRepairIntake({
    root,
    targetPath,
    requirement: {
      policy_id: 'REPAIR-001',
      requirement_id: 'harness-repair-validate',
      registry_id: 'HARNESS-REPAIR-VALIDATE-001',
      arguments: {},
    },
  })
}

const VALID_INTAKE = `# Harness repair intake

**State:** Ready for self-development intake 
**Outcome:** Confirmed one harness bug.
**Blockers:** None.
**Next action:** Run /pan-start with this file.

## Original report

The run retried without addressing the failure.

## Investigation scope

Pancreator workflow retry behavior and its generated run records.

## Evidence examined

- state.json and events.jsonl
- workflow snapshot, invocations, outputs, and validation results

## Agent transcript coverage

The coder transcript was examined. The delegation record was examined separately;
the delegation prompt is not an agent transcript.

## Execution timeline

1. Implementation failed a deterministic gate.
2. The next implementation attempt repeated the same work.

## Findings

### HR-001 Retry remediation was not enforced

- **Classification:** harness bug
- **Severity:** high
- **Evidence:** The second invocation omitted the recorded failure signature.
- **Expected contract:** Retry invocations carry the prior loop cause.
- **Causal chain:** Missing invocation context allowed an unchanged retry.
- **Root cause:** Retry card construction omitted the remediation field.
- **Affected surfaces:** engine invocation construction, workflow tests, embedded payload.

## Root-cause remediation

Populate the retry cause in implementation invocations and add regression coverage.

## Acceptance criteria

1. AC-001 A repeated implementation attempt includes the normalized prior failure and requires remediation evidence.
2. AC-002 Fresh and refreshed embedded installations receive the corrected invocation behavior.

## Validation plan

Run focused engine tests, integration workflow tests, and the configured repository checks.

## Installation and migration impact

No state migration is required; installer payloads and projected artifacts must include the change.

## Constraints and out of scope

Do not repair the target application or rewrite historical run records.

## Open questions and unknowns

None.

## Recommended next action

Run /pan-start with this intake in the Pancreator self-development repository.
`

test('harness repair validator accepts a transcript-aware root-cause intake', () => {
  const result = validate(VALID_INTAKE)

  assert.equal(result.status, 'passed')
  assert.deepEqual(result.issues, [])
})

test('harness repair validator rejects missing transcript accounting and stable ids', () => {
  const result = validate(
    VALID_INTAKE.replace('### HR-001', '### Retry finding')
      .replaceAll(/\d+\. AC-\d{3}/gu, 'Acceptance')
      .replace(
        'The coder transcript was examined. The delegation record was examined separately;\nthe delegation prompt is not an agent transcript.',
        'Run records were reviewed.',
      ),
  )

  assert.equal(result.status, 'failed')
  assert.ok(result.issues.some((item) => item.code === 'repair.finding_id'))
  assert.ok(result.issues.some((item) => item.code === 'repair.acceptance_id'))
  assert.ok(
    result.issues.some((item) => item.code === 'repair.transcript_coverage'),
  )
})

test('harness repair validator checks every finding and scoped acceptance section', () => {
  const result = validate(
    VALID_INTAKE.replace(
      '## Root-cause remediation',
      `### HR-002 Unresolved secondary behavior

- **Classification:** unresolved hypothesis
- **Severity:** low
- **Evidence:** A later event has no matching transcript.
- **Expected contract:** Every relevant agent exchange is accounted for.
- **Causal chain:** Transcript evidence is missing.
- **Affected surfaces:** transcript capture and run export.

## Root-cause remediation`,
    ).replaceAll(
      /^\d+\. (AC-\d{3})/gmu,
      '$1 was mentioned but not defined as a numbered criterion.',
    ),
  )

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (item) =>
        item.code === 'repair.finding_field' &&
        item.message.includes('HR-002') &&
        item.message.includes('root cause'),
    ),
  )
  assert.ok(result.issues.some((item) => item.code === 'repair.acceptance_id'))
})
