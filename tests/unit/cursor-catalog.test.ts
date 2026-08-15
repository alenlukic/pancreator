import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveCursorModelSlug } from '../../src/lib/executors/cursor-catalog.js'
import { parsePersonaMapping } from '../../src/lib/executors/mapping.js'

test('the audited mapping resolves to its executor-native slug', () => {
  // The audited run projected this exact spec and Cursor silently fell back to
  // a default model. Projection now writes the catalog slug instead.
  const mapping = parsePersonaMapping(
    'gpt-5.6-sol[context=272k,effort=high,fast=false]',
  )

  assert.equal(resolveCursorModelSlug(mapping), 'gpt-5.6-sol-high')
})

test('a mapping without effort resolves to the base slug', () => {
  assert.equal(
    resolveCursorModelSlug(parsePersonaMapping('composer-2.5[fast=false]')),
    'composer-2.5',
  )
  assert.equal(resolveCursorModelSlug(parsePersonaMapping('auto')), 'auto')
})

test('unresolved specs fail with a named error', () => {
  assert.throws(
    () => resolveCursorModelSlug(parsePersonaMapping('made-up-model[]')),
    /not in the Cursor model catalog/u,
  )
  assert.throws(
    () => resolveCursorModelSlug(parsePersonaMapping('auto[effort=high]')),
    /cannot apply Cursor options to model 'auto'/u,
  )
})
