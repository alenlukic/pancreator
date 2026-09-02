import type { RunStatus, StageOutcome } from '../types.js'

/**
 * Harness evals: on-demand, bounded toy workflow runs plus deterministic
 * graders over the run's records. Evals live outside `npm test` and outside
 * every workflow run. They exercise policy compliance that a unit test cannot
 * observe, because the behavior under test is an agent's.
 */

export const EVAL_SCENARIO_SCHEMA_VERSION = 1

export const EVAL_GRADER_IDS = [
  'profile-executions',
  'delegation-watch-record',
  'platform-guidance-conflict-recorded',
  'attempts-not-spent-on-mechanics',
  'stage-order-and-terminal-state',
] as const

export type EvalGraderId = (typeof EVAL_GRADER_IDS)[number]

export const EVAL_WORKFLOWS = ['delivery', 'prototype', 'design'] as const

export interface EvalPolicyInstruction {
  policy_id: string
  instruction: number
  summary: string
}

export interface EvalOperatorDecision {
  stage: string
  decision: 'approve' | 'reject' | 'revise'
  note?: string
}

export type EvalStageSequenceEntry =
  | string
  | { stage: string; outcome?: StageOutcome }

export interface EvalOutputAssertion {
  stage: string
  path: string
  equals: unknown
}

export interface EvalExpectedState {
  status: RunStatus
  current_stage?: string | null
  pending_action?: string
  stage_sequence?: EvalStageSequenceEntry[]
  output_assertions?: EvalOutputAssertion[]
}

export interface EvalGraderSpec {
  id: EvalGraderId
  policy?: string
  config?: Record<string, unknown>
}

export interface EvalScenario {
  schema_version: 1
  name: string
  description: string
  policy_instructions: EvalPolicyInstruction[]
  fixture: string
  request: string
  workflow: (typeof EVAL_WORKFLOWS)[number]
  verification: string
  involvement?: string
  /** Named pipeline config the run snapshots; the CLI flag overrides it. */
  pipeline_config?: string
  operator_decisions?: EvalOperatorDecision[]
  expected: EvalExpectedState
  graders: EvalGraderSpec[]
}

export interface LoadedEvalScenario {
  scenario: EvalScenario
  /** Harness-relative scenario file path. */
  path: string
}

/** One grader's verdict. Evidence paths are harness-relative. */
export interface EvalGraderVerdict {
  id: EvalGraderId
  policy: string | null
  passed: boolean
  summary: string
  evidence: string[]
  /** Grader-specific counts and observations, for the JSON report. */
  details: Record<string, unknown>
  /** What the grader can and cannot observe from run records. */
  observability: string
}

export interface EvalReport {
  schema_version: 1
  scenario: string
  scenario_path: string
  run_id: string
  run_status: RunStatus
  current_stage: string | null
  graded_at: string
  passed: boolean
  policy_instructions: EvalPolicyInstruction[]
  graders: EvalGraderVerdict[]
}
