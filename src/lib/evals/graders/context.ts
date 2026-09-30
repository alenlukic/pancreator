import path from 'node:path'

import type { StageHistoryItem } from '../../types.js'
import type { RunRecords } from '../run-records.js'
import type {
  EvalGraderSpec,
  EvalGraderVerdict,
  EvalScenario,
} from '../types.js'

/**
 * Deterministic graders over a finished or paused run's records. Each grader
 * reads records only, names the evidence it used, and states what it cannot
 * observe. A grader never spawns a process or calls a model.
 */

export interface GraderContext {
  records: RunRecords
  scenario: EvalScenario
  spec: EvalGraderSpec
}

export type Grader = (
  context: GraderContext,
) => Omit<EvalGraderVerdict, 'id' | 'policy'>

/**
 * A grader's configured value for `key` from the scenario's grader spec, or
 * the fallback when unset. The value is cast, not validated.
 */
export function config<T>(context: GraderContext, key: string, fallback: T): T {
  const value = context.spec.config?.[key]

  return value === undefined ? fallback : (value as T)
}

/** Repository-relative, slash-separated path of a file under the run's agent directory, for citing as evidence. */
export function relativeEvidence(
  records: RunRecords,
  ...segments: string[]
): string {
  return path
    .relative(
      records.root,
      path.join(records.layout.agent.absolute, ...segments),
    )
    .split(path.sep)
    .join('/')
}

/** The stage history entry recorded for an invocation id, or undefined when none matches. */
export function historyForInvocation(
  records: RunRecords,
  invocationId: string,
): StageHistoryItem | undefined {
  return records.state.stage_history.find(
    (item) => item.invocation_id === invocationId,
  )
}
