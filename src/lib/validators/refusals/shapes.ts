/**
 * The refusal declaration shapes, and the environment refusal every
 * workspace-diff handler shares.
 */

/** One refusal a stage validator can raise, and what it blocks on. */
export interface StageRefusal {
  /**
   * Stable issue code, or the `issue()` argument expression as the handler
   * spells it when the handler composes the code at runtime.
   */
  code: string
  /** Declared field paths the refusal blocks on. */
  paths: readonly string[]
  /** Required when `paths` is empty: why no declared field owns the rule. */
  unowned_reason?: string
  /** Set when `code` is a composed expression rather than a literal. */
  composed?: boolean
}

/** Where one validator raises its refusals. */
export interface RefusalSource {
  /** Repository-relative module path. */
  file: string
  /** Top-level functions in that module which raise the refusals. */
  functions: readonly string[]
}

/**
 * An `issue()` argument a handler passes through from a rule table, and the
 * codes that table can produce. The completeness proof expands the
 * expression to those codes, so a pass-through does not hide a refusal.
 */
export interface GeneratedRefusalCodes {
  expression: string
  codes: readonly string[]
}

/** One validator's complete refusal set for one stage. */
export interface StageValidatorRefusals {
  /** Validation-registry id that owns the refusals. */
  registry_id: string
  /**
   * Key of the shared field contract entry, or `null` when no entry binds the
   * validator. A validator with no entry has nowhere to declare a field, so
   * every one of its refusals MUST be unowned.
   *
   * The key is the stage slug, except where two workflows share one slug and
   * a different validator owns each. `intake` is the one such slug, so the
   * prototype entry is `prototype:intake` and the design intake keeps the
   * bare slug free.
   */
  stage: string | null
  sources: readonly RefusalSource[]
  refusals: readonly StageRefusal[]
  /** Rule-table pass-throughs the handler raises instead of a literal. */
  generated?: readonly GeneratedRefusalCodes[]
}

/** The blocking fields one registry owns within one stage. */
export interface ValidatorBlockingFields {
  stage: string
  registry_id: string
  fields: readonly string[]
}

/**
 * Raised by the shared `gitUnavailableIssue` helper, which four handlers
 * reach. Every validator that can reach it declares it.
 */
export const GIT_UNAVAILABLE: StageRefusal = {
  code: 'git.unavailable',
  paths: [],
  unowned_reason:
    'The workspace diff could not be read, which is an environment failure rather than a field requirement.',
}
