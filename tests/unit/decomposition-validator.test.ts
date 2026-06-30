import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validateDecompositionArtifact } from '../../src/lib/validators/stage-validators.js'
import { createFixture } from '../helpers.js'

function validate(content: string) {
  const root = createFixture()
  const targetPath = 'runtime/inbox/decomposition.md'

  writeFileSync(path.join(root, targetPath), content)

  return validateDecompositionArtifact({
    root,
    targetPath,
    requirement: {
      policy_id: 'DECOMP-001',
      requirement_id: 'decomposition-validate',
      registry_id: 'DECOMPOSITION-VALIDATE-001',
      arguments: {},
    },
  })
}

const COMMON = `# Scope decomposition

## Scope summary

Preserve the requested operator outcome.

## Threshold assessment

The independence gate passes only for standalone outcomes. No hard trigger is present, only one pressure indicator applies, and file count is not controlling.

## Fragmentation economics

The workflow overhead would exceed the expected risk reduction.

## Requirement traceability

All requirements remain in the retained intake.
`

test('decomposition validator accepts a conservative retain decision', () => {
  const result = validate(`${COMMON}

## Decision

retain

## Retained intake spec

Build the requested capability as one systematic run.

## Risks and unknowns

None beyond the original intake.

## Next action

Run /pan-start with the retained intake.
`)

  assert.equal(result.status, 'passed')
  assert.deepEqual(result.issues, [])
})

test('decomposition validator accepts complete low-coupling chunks', () => {
  const result = validate(`${COMMON.replace(
    'No hard trigger is present, only one pressure indicator applies',
    'A hard trigger is present and four pressure indicators span three dimensions',
  ).replace(
    'would exceed the expected risk reduction',
    'is lower than the expected risk reduction',
  )}

## Decision

decompose

## Dependency graph

The directed acyclic graph (DAG) is Chunk 1 -> Chunk 2.

## Execution order

1. Complete Chunk 1.
2. Complete Chunk 2.

## Chunk 1: Stable contract

### Objective

Create the independently useful contract.

### In scope

Contract behavior.

### Out of scope

Consumer behavior.

### Acceptance criteria

1. The contract is independently validated.

### Dependencies

None.

### Validation

Run focused contract tests.

### Handoff contract

Publish the stable interface consumed by Chunk 2.

## Chunk 2: Consumer behavior

### Objective

Implement the operator-facing behavior.

### In scope

Consumer behavior.

### Out of scope

Unrelated integrations.

### Acceptance criteria

1. The consumer uses the stable contract.

### Dependencies

Chunk 1.

### Validation

Run integration and regression tests.

### Handoff contract

No downstream dependency.

## Risks and unknowns

The stable contract may require operator ratification.

## Next action

Run Chunk 1 through /pan-start.
`)

  assert.equal(result.status, 'passed')
  assert.deepEqual(result.issues, [])
})

test('decomposition validator rejects unstructured over-fragmentation', () => {
  const chunks = Array.from(
    { length: 6 },
    (_, index) => `## Chunk ${index + 1}: Fragment ${index + 1}

### Objective

Fragment.

### In scope

One detail.

### Out of scope

Everything else.

### Acceptance criteria

1. The detail works.

### Dependencies

None.

### Validation

Run a check.

### Handoff contract

No handoff.
`,
  ).join('\n')
  const result = validate(`${COMMON}

## Decision

decompose

## Dependency graph

The DAG has no edges.

## Execution order

Run every fragment.

${chunks}
## Risks and unknowns

Excess workflow overhead.

## Next action

Merge fragments.
`)

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some((item) => item.code === 'decomposition.over_fragmented'),
  )
})
