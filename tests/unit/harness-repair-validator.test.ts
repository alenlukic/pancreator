import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { loadHarnessRepairCategories } from '../../src/lib/governance/harness-repair-categories.js'
import { validateHarnessRepairIntake } from '../../src/lib/validators/stage-validators.js'
import { createTestTempDirectory } from '../temp.js'

const REPO_ROOT = process.cwd()
const CATEGORY_REGISTRY = 'governance/registries/harness_repair_categories.json'
const CATEGORIES = loadHarnessRepairCategories(REPO_ROOT)

// The validator reads the intake Markdown and the category registry, so the
// scratch root carries the shipped registry rather than a second copy of the
// operator's category list.
function scratchRoot(): string {
  const root = createTestTempDirectory('pan-harness-repair-')
  const registry = path.join(root, CATEGORY_REGISTRY)

  mkdirSync(path.dirname(registry), { recursive: true })
  copyFileSync(path.join(REPO_ROOT, CATEGORY_REGISTRY), registry)

  return root
}

function validate(
  content: string,
  targetPath = 'runtime/inbox/harness-repair.md',
) {
  const root = scratchRoot()

  mkdirSync(path.dirname(path.join(root, targetPath)), { recursive: true })
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
**Category:** Runtime/build bugs (\`build\`)

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

HR-001: populate the retry cause in implementation invocations and add regression coverage.

## Acceptance criteria

1. AC-001 HR-001 A repeated implementation attempt includes the normalized prior failure and requires remediation evidence.
2. AC-002 HR-001 Fresh and refreshed embedded installations receive the corrected invocation behavior.

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

/** The valid intake, re-declared for one registry category. */
function intakeForCategory(slug: string): string {
  const category = CATEGORIES.find((entry) => entry.slug === slug)

  assert.ok(category, `registry MUST declare category ${slug}`)

  const nextAction =
    category.next_action_contract.name === 'out-of-band'
      ? 'Hand this intake to a powerful model for out-of-band execution under close operator supervision.'
      : 'Run /pan-start with this intake in the Pancreator self-development repository.'

  return VALID_INTAKE.replace(
    '**Category:** Runtime/build bugs (`build`)',
    `**Category:** ${category.display_name} (\`${category.slug}\`)`,
  ).replace(
    'Run /pan-start with this intake in the Pancreator self-development repository.\n',
    `${nextAction}\n`,
  )
}

test('harness repair validator accepts a transcript-aware root-cause intake', () => {
  const result = validate(VALID_INTAKE)

  assert.equal(result.status, 'passed')
  assert.deepEqual(result.issues, [])
})

test('harness repair validator accepts an intake for every declared category', () => {
  assert.ok(CATEGORIES.length > 0)

  for (const category of CATEGORIES) {
    const result = validate(intakeForCategory(category.slug))

    assert.deepEqual(
      result.issues,
      [],
      `category ${category.slug} MUST validate cleanly`,
    )
  }
})

test('harness repair validator rejects a missing or unknown category', () => {
  const missing = validate(
    VALID_INTAKE.replace('**Category:** Runtime/build bugs (`build`)\n', ''),
  )

  assert.equal(missing.status, 'failed')
  assert.ok(
    missing.issues.some((item) => item.code === 'repair.category_missing'),
  )

  const unknown = validate(
    VALID_INTAKE.replace(
      '**Category:** Runtime/build bugs (`build`)',
      '**Category:** Documentation (`docs`)',
    ),
  )

  assert.equal(unknown.status, 'failed')
  assert.ok(
    unknown.issues.some((item) => item.code === 'repair.category_unknown'),
  )
  assert.ok(
    !unknown.issues.some((item) => item.code === 'repair.category_missing'),
    'an unknown slug MUST NOT also report a missing declaration',
  )
})

test('harness repair validator rejects a display name the registry does not give the slug', () => {
  const result = validate(
    VALID_INTAKE.replace(
      '**Category:** Runtime/build bugs (`build`)',
      '**Category:** Performance (`build`)',
    ),
  )

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some((item) => item.code === 'repair.category_display_name'),
  )
})

test('harness repair validator applies the category next-action contract', () => {
  const outOfBand = validate(intakeForCategory('oob'))

  assert.equal(outOfBand.status, 'passed')

  const panStartInOutOfBand = validate(
    intakeForCategory('oob').replace(
      '## Recommended next action\n\nHand this intake to a powerful model for out-of-band execution under close operator supervision.',
      '## Recommended next action\n\nRun /pan-start with this intake under close operator supervision as out-of-band work.',
    ),
  )

  assert.equal(panStartInOutOfBand.status, 'failed')
  assert.ok(
    panStartInOutOfBand.issues.some(
      (item) => item.code === 'repair.next_action_forbidden',
    ),
  )

  const missingPanStart = validate(
    VALID_INTAKE.replace(
      'Run /pan-start with this intake in the Pancreator self-development repository.\n',
      'Schedule the work.\n',
    ),
  )

  assert.equal(missingPanStart.status, 'failed')
  assert.ok(
    missingPanStart.issues.some((item) => item.code === 'repair.next_action'),
  )
})

test('harness repair validator fails a filename slug that contradicts the declared category', () => {
  const disagreement = validate(
    VALID_INTAKE,
    'runtime/inbox/queue/harness-repair-20260911T071836Z-int-con-retry-loop.md',
  )

  assert.equal(disagreement.status, 'failed')
  assert.ok(
    disagreement.issues.some(
      (item) => item.code === 'repair.category_filename',
    ),
  )

  const agreement = validate(
    VALID_INTAKE,
    'runtime/inbox/queue/harness-repair-20260911T071836Z-build-retry-loop.md',
  )

  assert.deepEqual(agreement.issues, [])

  const unslugged = validate(
    VALID_INTAKE,
    'runtime/inbox/queue/harness-repair-20260911T071836Z-retry-loop.md',
  )

  assert.deepEqual(unslugged.issues, [])
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

test('the shipped category intake fixtures validate at their real paths', () => {
  const directory = 'tests/fixtures/harness-repair/category-intakes'
  const names = readdirSync(path.join(REPO_ROOT, directory)).filter((name) =>
    name.endsWith('.md'),
  )

  assert.ok(names.length >= 3, 'the fixtures MUST cover several categories')

  for (const name of names) {
    const result = validateHarnessRepairIntake({
      root: REPO_ROOT,
      targetPath: `${directory}/${name}`,
      requirement: {
        policy_id: 'REPAIR-001',
        requirement_id: 'harness-repair-validate',
        registry_id: 'HARNESS-REPAIR-VALIDATE-001',
        arguments: {},
      },
    })

    assert.deepEqual(result.issues, [], `${name} MUST validate cleanly`)
  }
})

test('harness repair validator accepts several findings and traces each one', () => {
  const secondFinding = `### HR-002 Retry evidence was not recorded

- **Classification:** compliance issue
- **Severity:** medium
- **Evidence:** The retry output carried no remediation entry.
- **Expected contract:** A retry records one remediation entry per prior cause.
- **Causal chain:** The submission gate accepted an empty remediation array.
- **Root cause:** The claims validator skipped the retry branch.
- **Affected surfaces:** implementation claims validator and its tests.

## Root-cause remediation`

  const traced = validate(
    VALID_INTAKE.replace('## Root-cause remediation', secondFinding)
      .replace(
        'HR-001: populate the retry cause in implementation invocations and add regression coverage.',
        'HR-001: populate the retry cause in implementation invocations.\n\nHR-002: require one remediation entry for each prior cause.',
      )
      .replace(
        '2. AC-002 HR-001 Fresh and refreshed embedded installations receive the corrected invocation behavior.',
        '2. AC-002 HR-002 A retry submission without a remediation entry fails its claims validator.',
      ),
  )

  assert.deepEqual(traced.issues, [])

  const untracedRemediation = validate(
    VALID_INTAKE.replace('## Root-cause remediation', secondFinding).replace(
      '2. AC-002 HR-001 Fresh and refreshed embedded installations receive the corrected invocation behavior.',
      '2. AC-002 HR-002 A retry submission without a remediation entry fails its claims validator.',
    ),
  )

  assert.equal(untracedRemediation.status, 'failed')
  assert.ok(
    untracedRemediation.issues.some(
      (item) =>
        item.code === 'repair.remediation_traceability' &&
        item.message.includes('HR-002'),
    ),
  )

  const untracedCriterion = validate(
    VALID_INTAKE.replace(
      '1. AC-001 HR-001 A repeated implementation attempt includes the normalized prior failure and requires remediation evidence.',
      '1. AC-001 A repeated implementation attempt includes the normalized prior failure and requires remediation evidence.',
    ),
  )

  assert.equal(untracedCriterion.status, 'failed')
  assert.ok(
    untracedCriterion.issues.some(
      (item) =>
        item.code === 'repair.acceptance_traceability' &&
        item.message.includes('AC-001'),
    ),
  )
})
