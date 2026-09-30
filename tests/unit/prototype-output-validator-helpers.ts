import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { validatePrototypeOutput } from '../../src/lib/validators/prototype-output.js'
import { createTestTempDirectory } from '../fixture-template.js'

// The validator reads only the stage outputs and run state it is handed, so a
// bare directory stands in for the repository root.
export function scratchRoot(): string {
  return createTestTempDirectory('prototype-output-')
}

export function writeOutput(
  root: string,
  relativePath: string,
  value: Record<string, unknown>,
): string {
  const absolute = path.join(root, relativePath)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`)

  return relativePath
}

export function validatorInput(
  root: string,
  targetPath: string,
  stageSlug: string,
  runState?: Record<string, unknown>,
) {
  return {
    root,
    targetPath,
    requirement: {
      policy_id: 'PROTO-001',
      requirement_id: 'prototype-output-validate',
      registry_id: 'PROTOTYPE-OUTPUT-VALIDATE-001',
      arguments: {},
    },
    stage: { slug: stageSlug },
    invocation: {
      workflow: { slug: 'prototype' },
      stage: { slug: stageSlug },
    },
    runState,
  }
}

export const OPERATOR_DECISION_PATH =
  'runtime/logs/workflows/run-1/agent/decisions/operator-feedback-1.md'

export function operatorFeedback(
  note: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    decision: 'approve',
    source: 'operator',
    from_stage: 'intake',
    to_stage: 'approach',
    attempt: 1,
    note,
    path: OPERATOR_DECISION_PATH,
    timestamp: '2026-08-28T00:00:00.000Z',
    ...overrides,
  }
}

export function excludedPrecondition(
  decisionPath: string,
): Record<string, unknown> {
  return {
    id: 'PRE-01',
    affected_questions: ['TQ-01'],
    check: 'auth probe',
    status: 'unavailable',
    evidence: ['missing auth'],
    volatile: true,
    exclusions: [
      {
        excluded_questions: ['TQ-01'],
        operator_decision_path: decisionPath,
      },
    ],
  }
}

export function codesOf(result: ReturnType<typeof validatePrototypeOutput>) {
  return new Set(result.issues.map((issue) => issue.code))
}
