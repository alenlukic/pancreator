/**
 * The turn reminder profile registry: its roles, selector shapes, the card
 * templates each target mode resolves against, the strict parser, and
 * profile selector resolution.
 */

import path from 'node:path'

import { isRecord, readJson } from '../../io.js'

export const TURN_REMINDER_REGISTRY_PATH =
  'governance/registries/turn_reminder_profiles.json'
export const TURN_REMINDER_SCHEMA_PATH =
  'library/schemas/turn-reminder-profiles.schema.json'
export const TURN_REMINDER_STATE_PATH = '.cursor/hooks/state/conversations.json'

export const TURN_REMINDER_ROLES = [
  'regular-supervisor',
  'cohort-supervisor',
  'long-horizon-supervisor',
  'unbound',
  'pair',
  'shepherd',
  'debloat',
  'cleanup',
  'standalone-other',
  'none',
] as const

export type TurnReminderRole = (typeof TURN_REMINDER_ROLES)[number]

export interface PolicySelector {
  id: string
  type: 'policy'
  policy_id: string
  instruction_sha256: string
}

/**
 * Each installation mode ships a different operating card, so one card
 * selector pins a heading and digest per mode.
 */
export const TURN_REMINDER_CARD_MODES = [
  'self_development',
  'embedded',
  'detached',
] as const

export type TurnReminderCardMode = (typeof TURN_REMINDER_CARD_MODES)[number]

export interface CardSection {
  heading: string
  content_sha256: string
}

export interface CardSelector {
  id: string
  type: 'card'
  sections: Record<TurnReminderCardMode, CardSection>
}

export type TurnReminderSelector = PolicySelector | CardSelector

interface TurnReminderProfile {
  extends?: string
  selectors: TurnReminderSelector[]
}

export interface TurnReminderRegistry {
  schema_version: 1
  byte_budget: number
  state: {
    max_age_days: number
    max_entries: number
  }
  profiles: Record<string, TurnReminderProfile>
  roles: Record<TurnReminderRole, string | null>
}

export const ROLE_SET = new Set<string>(TURN_REMINDER_ROLES)
const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const SELECTOR_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u
const POLICY_ID_PATTERN = /^[A-Z][A-Z0-9-]*$/u
const PROFILE_ID_PATTERN = SELECTOR_ID_PATTERN
const CARD_HEADING_PATTERN = /^#{1,6} /u
export const CARD_PATH = 'AGENTS.md'

/**
 * The card template an installer writes for each target mode. Validating them
 * alongside the live card proves an install before it can fail on a selector
 * the installed card does not carry.
 */
export const CARD_MODE_TEMPLATES: Partial<
  Record<TurnReminderCardMode, string>
> = {
  embedded: 'library/templates/embedded-AGENTS.md',
  detached: 'library/templates/detached-AGENTS.md',
}

/**
 * The command that rewrites a stale pinned digest. Every stale-selector error
 * names it, so an edit to a pinned instruction or card section is repaired by
 * the harness rather than by a digest recomputed by hand.
 */
export const REFRESH_DIGESTS_COMMAND = 'pan governance refresh-digests'

/**
 * The file a card selector's section resolves against for one mode in the
 * self-development source: the live card for self-development, and the
 * installer's card template for each target mode.
 */
export function turnReminderCardPath(mode: TurnReminderCardMode): string {
  return CARD_MODE_TEMPLATES[mode] ?? CARD_PATH
}

/**
 * Throw an `Error` whose message is prefixed with `turn reminder registry:`.
 * Never returns.
 */
export function invalid(message: string): never {
  throw new Error(`turn reminder registry: ${message}`)
}

function positiveInteger(value: unknown, source: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    invalid(`${source} MUST be a positive integer.`)
  }

  return value as number
}

function nonEmptyString(value: unknown, source: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    invalid(`${source} MUST be a non-empty string.`)
  }

  return value
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  source: string,
): void {
  const allowedSet = new Set(allowed)
  const extra = Object.keys(value).filter((key) => !allowedSet.has(key))

  if (extra.length > 0) {
    invalid(`${source} contains unknown key '${extra[0]}'.`)
  }
}

function parseSelector(value: unknown, source: string): TurnReminderSelector {
  if (!isRecord(value)) {
    invalid(`${source} MUST be an object.`)
  }

  const id = nonEmptyString(value.id, `${source}.id`)

  if (!SELECTOR_ID_PATTERN.test(id)) {
    invalid(`${source}.id MUST be a lowercase selector id.`)
  }

  if (value.type === 'policy') {
    assertOnlyKeys(
      value,
      ['id', 'type', 'policy_id', 'instruction_sha256'],
      source,
    )
    const policyId = nonEmptyString(value.policy_id, `${source}.policy_id`)
    const digest = nonEmptyString(
      value.instruction_sha256,
      `${source}.instruction_sha256`,
    )

    if (!POLICY_ID_PATTERN.test(policyId)) {
      invalid(`${source}.policy_id MUST be a policy id.`)
    }

    if (!SHA256_PATTERN.test(digest)) {
      invalid(`${source}.instruction_sha256 MUST be a SHA-256 digest.`)
    }

    return {
      id,
      type: 'policy',
      policy_id: policyId,
      instruction_sha256: digest,
    }
  }

  if (value.type === 'card') {
    assertOnlyKeys(value, ['id', 'type', 'sections'], source)

    if (!isRecord(value.sections)) {
      invalid(`${source}.sections MUST be an object.`)
    }

    assertOnlyKeys(
      value.sections,
      TURN_REMINDER_CARD_MODES,
      `${source}.sections`,
    )
    const sections = {} as Record<TurnReminderCardMode, CardSection>

    for (const mode of TURN_REMINDER_CARD_MODES) {
      const section = value.sections[mode]

      if (!isRecord(section)) {
        invalid(`${source}.sections.${mode} MUST be an object.`)
      }

      assertOnlyKeys(
        section,
        ['heading', 'content_sha256'],
        `${source}.sections.${mode}`,
      )
      const heading = nonEmptyString(
        section.heading,
        `${source}.sections.${mode}.heading`,
      )
      const digest = nonEmptyString(
        section.content_sha256,
        `${source}.sections.${mode}.content_sha256`,
      )

      if (!CARD_HEADING_PATTERN.test(heading)) {
        invalid(
          `${source}.sections.${mode}.heading MUST be a Markdown heading.`,
        )
      }

      if (!SHA256_PATTERN.test(digest)) {
        invalid(
          `${source}.sections.${mode}.content_sha256 MUST be a SHA-256 digest.`,
        )
      }

      sections[mode] = { heading, content_sha256: digest }
    }

    return { id, type: 'card', sections }
  }

  invalid(`${source}.type MUST be 'policy' or 'card'.`)
}

/**
 * Validate an untyped value as the turn reminder registry and return it typed.
 * Checks allowed keys, schema version, positive budgets, profile ids, selector
 * shapes, role-to-profile references (`none` must map to null), and resolves
 * every profile's inheritance chain. Throws through `invalid` on the first
 * violation.
 */
export function parseTurnReminderRegistry(
  value: unknown,
  source = TURN_REMINDER_REGISTRY_PATH,
): TurnReminderRegistry {
  if (!isRecord(value)) {
    invalid(`${source} MUST contain an object.`)
  }

  assertOnlyKeys(
    value,
    ['schema_version', 'byte_budget', 'state', 'profiles', 'roles'],
    source,
  )

  if (value.schema_version !== 1) {
    invalid(`${source}.schema_version MUST equal 1.`)
  }

  if (!isRecord(value.state)) {
    invalid(`${source}.state MUST be an object.`)
  }

  assertOnlyKeys(
    value.state,
    ['max_age_days', 'max_entries'],
    `${source}.state`,
  )

  if (!isRecord(value.profiles)) {
    invalid(`${source}.profiles MUST be an object.`)
  }

  const profiles: Record<string, TurnReminderProfile> = {}

  for (const [profileId, candidate] of Object.entries(value.profiles)) {
    if (!PROFILE_ID_PATTERN.test(profileId)) {
      invalid(`${source}.profiles.${profileId} MUST use a lowercase id.`)
    }

    if (!isRecord(candidate)) {
      invalid(`${source}.profiles.${profileId} MUST be an object.`)
    }

    assertOnlyKeys(
      candidate,
      ['extends', 'selectors'],
      `${source}.profiles.${profileId}`,
    )

    if (!Array.isArray(candidate.selectors)) {
      invalid(`${source}.profiles.${profileId}.selectors MUST be an array.`)
    }

    const selectors = candidate.selectors.map((selector, index) =>
      parseSelector(
        selector,
        `${source}.profiles.${profileId}.selectors[${index}]`,
      ),
    )
    const selectorIds = selectors.map((selector) => selector.id)

    if (new Set(selectorIds).size !== selectorIds.length) {
      invalid(
        `${source}.profiles.${profileId} contains a duplicate selector id.`,
      )
    }

    const parent =
      candidate.extends === undefined
        ? null
        : nonEmptyString(
            candidate.extends,
            `${source}.profiles.${profileId}.extends`,
          )

    if (parent !== null && !PROFILE_ID_PATTERN.test(parent)) {
      invalid(`${source}.profiles.${profileId}.extends MUST name a profile.`)
    }

    profiles[profileId] = {
      ...(parent === null ? {} : { extends: parent }),
      selectors,
    }
  }

  if (Object.keys(profiles).length === 0) {
    invalid(`${source}.profiles MUST NOT be empty.`)
  }

  if (!isRecord(value.roles)) {
    invalid(`${source}.roles MUST be an object.`)
  }

  assertOnlyKeys(value.roles, TURN_REMINDER_ROLES, `${source}.roles`)
  const roles = {} as Record<TurnReminderRole, string | null>

  for (const role of TURN_REMINDER_ROLES) {
    const profile = value.roles[role]

    if (role === 'none') {
      if (profile !== null) {
        invalid(`${source}.roles.none MUST be null.`)
      }
      roles[role] = null
      continue
    }

    const profileId = nonEmptyString(profile, `${source}.roles.${role}`)

    if (!profiles[profileId]) {
      invalid(
        `${source}.roles.${role} references unknown profile '${profileId}'.`,
      )
    }

    roles[role] = profileId
  }

  const registry: TurnReminderRegistry = {
    schema_version: 1,
    byte_budget: positiveInteger(value.byte_budget, `${source}.byte_budget`),
    state: {
      max_age_days: positiveInteger(
        value.state.max_age_days,
        `${source}.state.max_age_days`,
      ),
      max_entries: positiveInteger(
        value.state.max_entries,
        `${source}.state.max_entries`,
      ),
    },
    profiles,
    roles,
  }

  for (const profileId of Object.keys(profiles)) {
    resolveProfileSelectors(registry, profileId)
  }

  return registry
}

/**
 * Read and validate `governance/registries/turn_reminder_profiles.json` under
 * `root`. Throws when the file is missing, is not JSON, or fails
 * `parseTurnReminderRegistry`.
 */
export function loadTurnReminderRegistry(root: string): TurnReminderRegistry {
  return parseTurnReminderRegistry(
    readJson(path.join(root, TURN_REMINDER_REGISTRY_PATH)),
  )
}

/**
 * Return the selectors a profile resolves to, inherited selectors first,
 * following `extends` recursively. Throws through `invalid` on an unknown
 * profile, an inheritance cycle, or a duplicate selector id across the chain.
 */
export function resolveProfileSelectors(
  registry: TurnReminderRegistry,
  profileId: string,
  stack: string[] = [],
): TurnReminderSelector[] {
  const profile = registry.profiles[profileId]

  if (!profile) {
    invalid(`unknown profile '${profileId}'.`)
  }

  if (stack.includes(profileId)) {
    invalid(`profile inheritance cycle: ${[...stack, profileId].join(' -> ')}.`)
  }

  const inherited = profile.extends
    ? resolveProfileSelectors(registry, profile.extends, [...stack, profileId])
    : []
  const selectors = [...inherited, ...profile.selectors]
  const ids = selectors.map((selector) => selector.id)

  if (new Set(ids).size !== ids.length) {
    invalid(`profile '${profileId}' resolves a duplicate selector id.`)
  }

  return selectors
}
