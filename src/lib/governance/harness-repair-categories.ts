import path from 'node:path'

import { invariant } from '../errors.js'
import { fileExists, isRecord, readJson } from '../io.js'

export const HARNESS_REPAIR_CATEGORIES_PATH =
  'governance/registries/harness_repair_categories.json'

/**
 * Contract names the registry may declare. A name selects the operator route a
 * category intake recommends; the token lists carry the deterministic proof.
 */
const NEXT_ACTION_CONTRACT_NAMES = new Set(['pan-start', 'out-of-band'])

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

export interface HarnessRepairNextActionContract {
  name: string
  required_tokens: string[]
  forbidden_tokens: string[]
}

export interface HarnessRepairCategory {
  id: string
  slug: string
  display_name: string
  scope: string
  next_action_contract: HarnessRepairNextActionContract
}

export interface HarnessRepairCategoryParseResult {
  categories: HarnessRepairCategory[]
  errors: string[]
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function tokenList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  return value.every(nonEmptyString) ? (value as string[]) : null
}

function parseContract(
  value: unknown,
  label: string,
  errors: string[],
): HarnessRepairNextActionContract | null {
  if (!isRecord(value)) {
    errors.push(`${label}.next_action_contract MUST be an object.`)
    return null
  }

  if (!nonEmptyString(value.name)) {
    errors.push(`${label}.next_action_contract.name MUST be a non-empty name.`)
    return null
  }

  if (!NEXT_ACTION_CONTRACT_NAMES.has(value.name)) {
    errors.push(
      `${label}.next_action_contract.name '${value.name}' is not a known ` +
        `contract name.`,
    )
    return null
  }

  const required = tokenList(value.required_tokens)
  const forbidden = tokenList(value.forbidden_tokens)

  if (!required || required.length === 0) {
    errors.push(
      `${label}.next_action_contract.required_tokens MUST list at least one ` +
        `token.`,
    )
    return null
  }

  if (!forbidden) {
    errors.push(
      `${label}.next_action_contract.forbidden_tokens MUST be a string array.`,
    )
    return null
  }

  return {
    name: value.name,
    required_tokens: required,
    forbidden_tokens: forbidden,
  }
}

/**
 * Shape-check a parsed registry document. The check never asserts how many
 * categories exist or what they are called: the operator owns that list, and a
 * count assertion would fail the next time the operator changes it.
 */
export function parseHarnessRepairCategories(
  value: unknown,
): HarnessRepairCategoryParseResult {
  const errors: string[] = []

  if (!isRecord(value) || value.schema_version !== 1) {
    return {
      categories: [],
      errors: [
        `${HARNESS_REPAIR_CATEGORIES_PATH} MUST declare schema_version 1.`,
      ],
    }
  }

  if (!Array.isArray(value.categories) || value.categories.length === 0) {
    return {
      categories: [],
      errors: [
        `${HARNESS_REPAIR_CATEGORIES_PATH} MUST declare a non-empty ` +
          `categories array.`,
      ],
    }
  }

  const categories: HarnessRepairCategory[] = []
  const slugs = new Set<string>()
  const ids = new Set<string>()

  for (const [index, entry] of value.categories.entries()) {
    const label = `${HARNESS_REPAIR_CATEGORIES_PATH}.categories[${index}]`

    if (!isRecord(entry)) {
      errors.push(`${label} MUST be an object.`)
      continue
    }

    for (const field of ['id', 'slug', 'display_name', 'scope']) {
      if (!nonEmptyString(entry[field])) {
        errors.push(`${label}.${field} MUST be a non-empty string.`)
      }
    }

    const contract = parseContract(entry.next_action_contract, label, errors)

    if (
      !nonEmptyString(entry.id) ||
      !nonEmptyString(entry.slug) ||
      !nonEmptyString(entry.display_name) ||
      !nonEmptyString(entry.scope) ||
      !contract
    ) {
      continue
    }

    if (!SLUG_PATTERN.test(entry.slug)) {
      errors.push(`${label}.slug MUST use lowercase hyphenated words.`)
      continue
    }

    if (ids.has(entry.id)) {
      errors.push(`${label}.id duplicates category id '${entry.id}'.`)
      continue
    }

    if (slugs.has(entry.slug)) {
      errors.push(`${label}.slug duplicates category slug '${entry.slug}'.`)
      continue
    }

    ids.add(entry.id)
    slugs.add(entry.slug)
    categories.push({
      id: entry.id,
      slug: entry.slug,
      display_name: entry.display_name,
      scope: entry.scope,
      next_action_contract: contract,
    })
  }

  return { categories, errors }
}

/**
 * Registry shape errors for the repository validation sweep. Presence belongs
 * to the required-file list, so an absent registry reports nothing here.
 */
export function harnessRepairCategoryErrors(root: string): string[] {
  const absolute = path.join(root, HARNESS_REPAIR_CATEGORIES_PATH)

  if (!fileExists(absolute)) {
    return []
  }

  return parseHarnessRepairCategories(readJson(absolute)).errors
}

/**
 * Categories an audit partitions its intakes by. A broken registry is a
 * programmer invariant rather than a recoverable state: every surface that
 * writes or validates an intake depends on this list agreeing with itself.
 */
export function loadHarnessRepairCategories(
  root: string,
): HarnessRepairCategory[] {
  const absolute = path.join(root, HARNESS_REPAIR_CATEGORIES_PATH)

  invariant(
    fileExists(absolute),
    `${HARNESS_REPAIR_CATEGORIES_PATH} is missing. The installation MUST ship ` +
      `the harness repair category registry.`,
    { code: 'INVALID_HARNESS_REPAIR_CATEGORIES' },
  )

  const parsed = parseHarnessRepairCategories(readJson(absolute))

  invariant(
    parsed.errors.length === 0,
    `${HARNESS_REPAIR_CATEGORIES_PATH} is invalid: ${parsed.errors.join(' ')}`,
    { code: 'INVALID_HARNESS_REPAIR_CATEGORIES' },
  )

  return parsed.categories
}
