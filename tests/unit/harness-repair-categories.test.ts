import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import {
  HARNESS_REPAIR_CATEGORIES_PATH,
  parseHarnessRepairCategories,
} from '../../src/lib/governance/harness-repair-categories.js'
import { readJson } from '../../src/lib/io.js'

const REPO_ROOT = process.cwd()

function shippedRegistry(): Record<string, unknown> {
  return readJson(
    path.join(REPO_ROOT, HARNESS_REPAIR_CATEGORIES_PATH),
  ) as Record<string, unknown>
}

function withCategories(
  mutate: (categories: Record<string, unknown>[]) => Record<string, unknown>[],
): Record<string, unknown> {
  const registry = shippedRegistry()
  const categories = registry.categories as Record<string, unknown>[]

  return { ...registry, categories: mutate(structuredClone(categories)) }
}

test('the shape check rejects a duplicate slug', () => {
  const result = parseHarnessRepairCategories(
    withCategories((categories) => [
      ...categories,
      { ...categories[0], id: `${categories[0].id as string}-copy` },
    ]),
  )

  assert.ok(
    result.errors.some((error) => error.includes('duplicates category slug')),
  )
})

test('the shape check rejects a missing field', () => {
  const result = parseHarnessRepairCategories(
    withCategories((categories) => {
      delete categories[0].scope
      return categories
    }),
  )

  assert.ok(
    result.errors.some((error) =>
      error.includes('.scope MUST be a non-empty string'),
    ),
  )
})

test('the shape check rejects an empty category list', () => {
  const result = parseHarnessRepairCategories(withCategories(() => []))

  assert.deepEqual(result.categories, [])
  assert.ok(
    result.errors.some((error) =>
      error.includes('MUST declare a non-empty categories array'),
    ),
  )
})

test('the shape check rejects an unknown next-action contract name', () => {
  const result = parseHarnessRepairCategories(
    withCategories((categories) => {
      const contract = categories[0].next_action_contract as Record<
        string,
        unknown
      >
      contract.name = 'pan-spotfix'
      return categories
    }),
  )

  assert.ok(
    result.errors.some((error) =>
      error.includes("'pan-spotfix' is not a known contract name"),
    ),
  )
})

test('the shape check accepts any category list the operator declares', () => {
  const result = parseHarnessRepairCategories({
    schema_version: 1,
    categories: [
      {
        id: 'only-category',
        slug: 'only',
        display_name: 'Only category',
        scope: 'Everything this hypothetical audit looks at.',
        next_action_contract: {
          name: 'pan-start',
          required_tokens: ['/pan-start'],
          forbidden_tokens: [],
        },
      },
    ],
  })

  assert.deepEqual(result.errors, [])
  assert.equal(result.categories.length, 1)
})
