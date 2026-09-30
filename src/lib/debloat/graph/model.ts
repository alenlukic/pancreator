import type { IntentClassifier } from '../intent.js'

/**
 * How a file that references a facility behaves when that facility is removed.
 *
 * The class decides two different things. Whether the reference blocks an
 * implicit cascade removal, and whether the referring file is repaired or
 * deleted. Code is the only class that blocks, because code that names a
 * facility stops compiling when the facility disappears and a human has to
 * decide what replaces it.
 *
 * `registry` covers a registration rather than a use. A lookup row, a model
 * mapping, and a string-keyed dispatch table all name every facility of their
 * kind by construction, so treating one as a use would immunize the whole
 * category. A registration proves a facility is wired in, never that anything
 * still reaches it, so liveness has to come from a resolution edge instead.
 */
export type ReferrerClass = 'code' | 'doc' | 'facility' | 'registry' | 'test'

export interface Reference {
  /** Repo-relative path of the file that carries the reference. */
  from: string
  referrer_class: ReferrerClass
  /** Facility that owns `from`, when one does. */
  owner_facility: string | null
  to: string
  /** Literal text that produced the edge, for the operator to spot-check. */
  token: string
  /**
   * Whether the referring text uses the facility rather than mentioning it.
   *
   * A typed edge and a code edge are always functional. A prose edge is
   * functional only when the intent classifier reads its line as a direction
   * to run, read, apply, or follow the facility. An index entry, a description,
   * and a passing mention stay in the graph so the closure can repair them,
   * but they neither keep a facility reachable nor block a cascade.
   */
  functional: boolean
}

export interface ReferenceGraph {
  references: Reference[]
  /** Facility id to the facilities it functionally references. */
  outgoing: Map<string, Set<string>>
  /** Facility id to every reference that reaches it. */
  incoming: Map<string, Reference[]>
}

export interface ReferenceGraphOptions {
  /**
   * Classifier for prose edges. Without one every prose edge counts as
   * functional, which is the older and more conservative reading.
   */
  readonly classifier?: IntentClassifier
}

/**
 * Files every agent reads in full before any card exists.
 *
 * A functional direction in one of these files keeps its target live even
 * though the file owns no facility node of its own.
 */
export const ALWAYS_READ_PATHS: readonly string[] = ['AGENTS.md']
