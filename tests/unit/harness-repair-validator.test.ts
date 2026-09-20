import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
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
  prepare: (root: string) => void = () => {},
) {
  const root = scratchRoot()

  prepare(root)
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

/** Next-action body of the shared fixture's `Recommended next action`. */
const WORKFLOW_ROUTE =
  'Run /pan-start with this intake in the Pancreator self-development repository.'
const OUT_OF_BAND_ROUTE =
  'Hand this intake to a powerful model for out-of-band execution under close operator supervision.'
/**
 * The shared fixture's lead names no route token, so a fixture derived for
 * another category cannot inherit a lead that contradicts it.
 */
const NEUTRAL_LEAD_NEXT_ACTION =
  '**Next action:** Route this intake by the contract its category declares.'

const VALID_INTAKE = `# Harness repair intake

**State:** Ready for self-development intake 
**Outcome:** Confirmed one harness bug.
**Blockers:** None.
${NEUTRAL_LEAD_NEXT_ACTION}
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

${WORKFLOW_ROUTE}
`

/**
 * The valid intake, re-declared for one registry category. The lead and the
 * next-action section both carry that category's route, because the forbidden
 * tokens apply to every region a reader acts on.
 */
function intakeForCategory(slug: string): string {
  const category = CATEGORIES.find((entry) => entry.slug === slug)

  assert.ok(category, `registry MUST declare category ${slug}`)

  const route =
    category.next_action_contract.name === 'out-of-band'
      ? OUT_OF_BAND_ROUTE
      : WORKFLOW_ROUTE

  return VALID_INTAKE.replace(
    '**Category:** Runtime/build bugs (`build`)',
    `**Category:** ${category.display_name} (\`${category.slug}\`)`,
  )
    .replace(`${WORKFLOW_ROUTE}\n`, `${route}\n`)
    .replace(NEUTRAL_LEAD_NEXT_ACTION, `**Next action:** ${route}`)
}

test('harness repair validator accepts an intake for every declared category', () => {
  assert.ok(CATEGORIES.length > 0)

  for (const category of CATEGORIES) {
    const result = validate(intakeForCategory(category.slug))

    assert.equal(
      result.status,
      'passed',
      `category ${category.slug} MUST validate cleanly`,
    )
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

  const wrongDisplayName = validate(
    VALID_INTAKE.replace(
      '**Category:** Runtime/build bugs (`build`)',
      '**Category:** Performance (`build`)',
    ),
  )

  assert.equal(wrongDisplayName.status, 'failed')
  assert.ok(
    wrongDisplayName.issues.some(
      (item) => item.code === 'repair.category_display_name',
    ),
  )
})

test('harness repair validator applies the category next-action contract', () => {
  const outOfBand = validate(intakeForCategory('oob'))

  assert.equal(outOfBand.status, 'passed')

  const panStartInOutOfBand = validate(
    intakeForCategory('oob').replace(
      `## Recommended next action\n\n${OUT_OF_BAND_ROUTE}`,
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
    VALID_INTAKE.replace(`${WORKFLOW_ROUTE}\n`, 'Schedule the work.\n'),
  )

  assert.equal(missingPanStart.status, 'failed')
  assert.ok(
    missingPanStart.issues.some((item) => item.code === 'repair.next_action'),
  )
})

test('harness repair validator refuses a forbidden token in the operator lead', () => {
  const leadRecommendsPanStart = validate(
    intakeForCategory('oob').replace(
      `**Next action:** ${OUT_OF_BAND_ROUTE}`,
      '**Next action:** Run /pan-start with this file.',
    ),
  )

  assert.equal(leadRecommendsPanStart.status, 'failed')

  const forbidden = leadRecommendsPanStart.issues.filter(
    (item) => item.code === 'repair.next_action_forbidden',
  )

  assert.equal(forbidden.length, 1, 'only the lead names the forbidden token')
  assert.match(forbidden[0].message, /operator lead/u)
})

test('harness repair validator passes a lead and section that both honor the contract', () => {
  const outOfBand = intakeForCategory('oob')

  assert.ok(
    outOfBand.includes(`**Next action:** ${OUT_OF_BAND_ROUTE}`),
    'the derived lead MUST carry the category route',
  )
  assert.deepEqual(validate(outOfBand).issues, [])

  // The required tokens stay scoped to the next-action section: a lead that
  // names the token does not satisfy the section contract.
  // The section route stands on its own line; the lead route follows the
  // `**Next action:**` label, so this strips the section alone.
  const tokenOnlyInLead = validate(
    intakeForCategory('build').replace(
      `\n${WORKFLOW_ROUTE}\n`,
      '\nSchedule it.\n',
    ),
  )

  assert.ok(
    tokenOnlyInLead.issues.some((item) => item.code === 'repair.next_action'),
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

test('harness repair validator resolves every sibling intake it names', () => {
  const own = 'harness-repair-20260911T071836Z-build-retry-loop.md'
  const archived = 'harness-repair-20260910T000000Z-perf-slow-gate.md'
  const queued = 'harness-repair-20260910T000000Z-oob-policy-owner.md'
  const missing = 'harness-repair-20260910T000000Z-fric-dropped-candidate.md'
  const placeSiblings = (root: string) => {
    for (const [status, name] of [
      ['archive', archived],
      ['queue', queued],
    ] as const) {
      const directory = path.join(root, 'runtime', 'inbox', status)

      mkdirSync(directory, { recursive: true })
      writeFileSync(path.join(directory, name), '# Sibling\n')
    }
  }
  const citing = (names: string[]) =>
    VALID_INTAKE.replace(
      'Do not repair the target application or rewrite historical run records.',
      `Order this repair after ${names.map((name) => `\`${name}\``).join(' and ')}, and read \`${own}\` for the run shape.`,
    )

  // A sibling in any inbox status resolves, and a self-reference is not a sibling.
  const resolved = validate(
    citing([archived, queued]),
    `runtime/inbox/queue/${own}`,
    placeSiblings,
  )

  assert.deepEqual(resolved.issues, [])

  const dangling = validate(
    citing([archived, missing, missing]),
    `runtime/inbox/queue/${own}`,
    placeSiblings,
  )
  const siblingIssues = dangling.issues.filter(
    (item) => item.code === 'repair.sibling_reference',
  )

  assert.equal(dangling.status, 'failed')
  assert.equal(siblingIssues.length, 1, 'one issue per unresolved name')
  assert.ok(siblingIssues[0].message.includes(missing))
  assert.ok(!siblingIssues[0].message.includes(archived))
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
