import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createFixture } from '../helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

test('requirements run validates a standalone decomposition artifact', () => {
  const root = createFixture()
  const targetPath = 'runtime/inbox/decomposition.md'

  writeFileSync(
    path.join(root, targetPath),
    `# Scope decomposition

## Decision

retain

## Scope summary

One coherent outcome.

## Threshold assessment

The independence gate does not justify a split. No hard trigger and only one pressure indicator apply. File count is not controlling.

## Fragmentation economics

Workflow overhead exceeds the expected risk reduction.

## Requirement traceability

All scope remains in the retained intake.

## Retained intake spec

Implement the request as one systematic run.

## Risks and unknowns

None.

## Next action

Run /pan-start.
`,
  )

  const stdout = execFileSync(
    process.execPath,
    [
      CLI,
      'requirements',
      'run',
      '--persona',
      'decomposer',
      '--workflow',
      'standalone',
      '--stage',
      'decompose',
      '--kind',
      'decomposition',
      '--registry',
      'DECOMPOSITION-VALIDATE-001',
      '--target',
      targetPath,
      '--json',
    ],
    { cwd: root, encoding: 'utf8' },
  )
  const result = JSON.parse(stdout) as { status: string; exit_code: number }

  assert.equal(result.status, 'passed')
  assert.equal(result.exit_code, 0)
})

test('requirements run validates a standalone harness repair intake', () => {
  const root = createFixture()
  const targetPath = 'runtime/inbox/harness-repair.md'

  writeFileSync(
    path.join(root, targetPath),
    `# Harness repair intake

**State:** Ready
**Outcome:** One governance miss is confirmed.
**Blockers:** None.
**Next action:** Run /pan-start with this intake.

## Original report

A review stage skipped required remediation.

## Investigation scope

Review-stage governance and one workflow run.

## Evidence examined

State, events, invocation, output, and validation evidence.

## Agent transcript coverage

The reviewer transcript was examined. The delegation prompt was reviewed only as
delegation evidence and was not treated as the agent transcript.

## Execution timeline

1. Review identified a bounded defect.
2. Review returned it to implementation instead of repairing it.

## Findings

### HR-001 Reviewer remediation contract was omitted

- **Classification:** governance miss
- **Severity:** medium
- **Evidence:** The invocation omitted bounded-remediation guidance.
- **Expected contract:** Review repairs local low-risk findings.
- **Causal chain:** Missing unrolled governance changed agent behavior.
- **Root cause:** Invocation construction did not include the governing clause.
- **Affected surfaces:** review prompt generation and regression tests.

## Root-cause remediation

Unroll the remediation contract into review invocations and test the behavior.

## Acceptance criteria

1. AC-001 Review invocations include bounded-remediation guidance.
2. AC-002 Regression tests cover repair versus implementation routing.

## Validation plan

Run focused unit and integration tests plus repository validation.

## Installation and migration impact

Refreshes project the corrected review behavior into embedded installs.

## Constraints and out of scope

Do not alter historical run records.

## Open questions and unknowns

None.

## Recommended next action

Run /pan-start with this intake.
`,
  )

  const stdout = execFileSync(
    process.execPath,
    [
      CLI,
      'requirements',
      'run',
      '--persona',
      'harness-technician',
      '--workflow',
      'standalone',
      '--stage',
      'repair',
      '--kind',
      'repair',
      '--registry',
      'HARNESS-REPAIR-VALIDATE-001',
      '--target',
      targetPath,
      '--json',
    ],
    { cwd: root, encoding: 'utf8' },
  )
  const result = JSON.parse(stdout) as { status: string; exit_code: number }

  assert.equal(result.status, 'passed')
  assert.equal(result.exit_code, 0)
})

test('requirements run validates a target repository primer', () => {
  const root = createFixture()
  const targetPath = 'docs/target-repo-primer.md'

  writeFileSync(
    path.join(root, targetPath),
    `# Target repository primer

<!-- pancreator-primer-status: ready -->
<!-- generated-at: 2026-06-28T12:00:00Z -->
<!-- source-head: unavailable -->

## Summary

A small command-line application.

## Administrative commands

### Install

Run \`npm ci\`.

### Build

Run \`npm run build\`.

### Test

Run \`npm test\`.

### Other

None identified.

## Architecture

\`\`\`mermaid
flowchart LR
  CLI --> Library
\`\`\`

## Project structure

- \`src/cli.ts\`: command entry point

## Public interfaces

- CLI commands from \`src/cli.ts\`.

## Gotchas

None identified.
`,
  )

  const stdout = execFileSync(
    process.execPath,
    [
      CLI,
      'requirements',
      'run',
      '--persona',
      'librarian',
      '--workflow',
      'standalone',
      '--stage',
      'build-docs',
      '--kind',
      'documentation',
      '--registry',
      'TARGET-REPO-PRIMER-VALIDATE-001',
      '--target',
      targetPath,
      '--json',
    ],
    { cwd: root, encoding: 'utf8' },
  )
  const result = JSON.parse(stdout) as { status: string; exit_code: number }

  assert.equal(result.status, 'passed')
  assert.equal(result.exit_code, 0)
})
