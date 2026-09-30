/** The grader registry and the entry point that runs one grader. */

import type { EvalGraderId, EvalGraderVerdict } from '../types.js'
import type { Grader, GraderContext } from './context.js'
import { profileExecutions } from './profile.js'
import {
  delegationWatchRecord,
  platformGuidanceConflictRecorded,
} from './delegation.js'
import {
  attemptsNotSpentOnMechanics,
  stageOrderAndTerminalState,
} from './stages.js'
import { cohortFanout } from './cohort.js'

// ---------------------------------------------------------------------------

export const GRADERS: Record<EvalGraderId, Grader> = {
  'profile-executions': profileExecutions,
  'delegation-watch-record': delegationWatchRecord,
  'platform-guidance-conflict-recorded': platformGuidanceConflictRecorded,
  'attempts-not-spent-on-mechanics': attemptsNotSpentOnMechanics,
  'stage-order-and-terminal-state': stageOrderAndTerminalState,
  'cohort-fanout': cohortFanout,
}

export function runGrader(context: GraderContext): EvalGraderVerdict {
  const grader = GRADERS[context.spec.id]
  const verdict = grader(context)

  return {
    id: context.spec.id,
    policy: context.spec.policy ?? null,
    ...verdict,
  }
}
