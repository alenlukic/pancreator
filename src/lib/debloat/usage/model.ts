import type { ReferenceGraph } from '../graph/model.js'
import type { IntentClassifier } from '../intent.js'

/**
 * How strong the evidence behind a facility's usage is.
 *
 * `execution` means a harness run record, a standalone session, a Cursor
 * command marker, a slash-command line, an agent's subagent launch, or an
 * agent's `pan` invocation named the facility. `reachable` means no record
 * named it but a facility that did run still depends on it. `direction` means
 * chat or an inbox request directed an agent to run, read, or apply it, or an
 * agent read it while doing work. `none` means the window holds no functional
 * use. A mention that is not a direction is counted and reported, and never
 * lifts a facility above `none`.
 */
export type EvidenceTier = 'execution' | 'reachable' | 'direction' | 'none'

export interface FacilityUsage {
  facility_id: string
  evidence_tier: EvidenceTier
  /** ISO-8601 instant of the most recent direct evidence, or null. */
  last_used_at: string | null
  execution_count: number
  /** Functional directions and agent lookups in chat and inbox text. */
  direction_count: number
  /** Lines that named the facility without using it. Never retains. */
  incidental_mention_count: number
  /** Live facilities and code files that still depend on this one. */
  depended_on_by: string[]
  /**
   * True when every structural reference to this facility comes from a test
   * or from a registration, and something references it at all.
   *
   * A facility in this state is held up only by the tests written to exercise
   * it. Nothing in the harness reaches it, so the tests prove that the code
   * runs rather than that anyone needs it. Removing it takes its tests too,
   * which is why the operator has to see the state rather than infer it.
   */
  test_only_references: boolean
  /** Up to five evidence locations, for the operator to spot-check. */
  samples: string[]
}

export interface UsageScanSources {
  workflow_runs: number
  sessions: number
  command_invocations: number
  transcript_files: number
  operator_request_files: number
  transcripts_root: string | null
  /** Transcripts that ran `/pan-debloat`, excluded from every count. */
  debloat_sessions_excluded: number
  /** Subagent launches and `pan` invocations agents made in transcripts. */
  agent_invocations: number
  /** Facility files agents read while doing work. */
  agent_lookups: number
  /** Lines that named a facility without using it, across chat and inbox. */
  incidental_mentions: number
  /** Every evidence source and the number of files read from it. */
  by_source: Record<string, number>
  /** Files or directories the exhaustive walk could not read. */
  unread: string[]
}

export interface UsageScan {
  usage: FacilityUsage[]
  sources: UsageScanSources
}

export interface UsageScanOptions {
  /** Inclusive lower bound of the window. */
  readonly windowStart: Date
  /** Static reference graph over the same facility set. */
  readonly graph: ReferenceGraph
  /** Separates a functional direction from a mention in chat and inbox text. */
  readonly classifier: IntentClassifier
  /** Overrides the derived Cursor transcript directory. */
  readonly transcriptsRoot?: string | null
}

export interface Hit {
  facilityId: string
  at: number
  source: string
}
