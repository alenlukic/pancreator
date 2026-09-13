import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  HARNESS_REPAIR_CATEGORIES_PATH,
  harnessRepairCategoryErrors,
  loadHarnessRepairCategories,
  parseHarnessRepairCategories,
} from '../../src/lib/governance/harness-repair-categories.js'
import { readJson, writeJsonAtomic } from '../../src/lib/io.js'
import { createTestTempDirectory } from '../temp.js'

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

test('the shape check rejects a slug the pattern does not admit', () => {
  const result = parseHarnessRepairCategories(
    withCategories((categories) => {
      categories[0].slug = 'Out-Of-Band'
      return categories
    }),
  )

  assert.ok(
    result.errors.some((error) =>
      error.includes('.slug MUST use lowercase hyphenated words'),
    ),
  )
})

test('the shape check rejects a duplicate category id', () => {
  const result = parseHarnessRepairCategories(
    withCategories((categories) => [
      ...categories,
      { ...categories[0], slug: `${categories[0].slug as string}-copy` },
    ]),
  )

  assert.ok(
    result.errors.some((error) => error.includes('duplicates category id')),
  )
})

test('the shape check rejects a registry that does not declare schema_version 1', () => {
  for (const schemaVersion of [undefined, 2]) {
    const registry = shippedRegistry()

    if (schemaVersion === undefined) {
      delete registry.schema_version
    } else {
      registry.schema_version = schemaVersion
    }

    const result = parseHarnessRepairCategories(registry)

    assert.deepEqual(result.categories, [])
    assert.deepEqual(result.errors, [
      `${HARNESS_REPAIR_CATEGORIES_PATH} MUST declare schema_version 1.`,
    ])
  }
})

test('the loader reads the shipped registry and reports no error for it', () => {
  const categories = loadHarnessRepairCategories(REPO_ROOT)

  assert.ok(categories.length > 0)

  for (const category of categories) {
    assert.match(category.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
    assert.ok(category.id.length > 0)
    assert.ok(category.display_name.length > 0)
    assert.ok(category.scope.length > 0)
    assert.ok(category.next_action_contract.required_tokens.length > 0)
  }

  assert.deepEqual(harnessRepairCategoryErrors(REPO_ROOT), [])
})

test('the loader refuses a registry the shape check rejects', () => {
  const root = createTestTempDirectory('harness-repair-categories-loader')
  const registryPath = path.join(root, HARNESS_REPAIR_CATEGORIES_PATH)

  mkdirSync(path.dirname(registryPath), { recursive: true })
  writeJsonAtomic(
    registryPath,
    withCategories((categories) => {
      categories[0].slug = 'Out-Of-Band'
      return categories
    }),
  )

  assert.ok(
    harnessRepairCategoryErrors(root).some((error) =>
      error.includes('.slug MUST use lowercase hyphenated words'),
    ),
  )
  assert.throws(() => loadHarnessRepairCategories(root), {
    code: 'INVALID_HARNESS_REPAIR_CATEGORIES',
  })
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
