import assert from 'node:assert/strict'
import test from 'node:test'

import {
  loadCursorCatalog,
  resolveCursorModelSlug,
} from '../../src/lib/executors/cursor-catalog.js'
import { parsePersonaMapping } from '../../src/lib/executors/mapping.js'

const root = process.cwd()

test('a configured spec passes through in Cursor native form', () => {
  // Cursor's own picker generates the bracketed spec, so projection must not
  // rewrite it. The flat effort-suffixed form it previously emitted is a string
  // Cursor never produces.
  assert.equal(
    resolveCursorModelSlug(
      parsePersonaMapping('gpt-5.6-sol[context=272k,reasoning=high,fast=true]'),
      'persona mapping',
      root,
    ),
    'gpt-5.6-sol[context=272k,fast=true,reasoning=high]',
  )
})

test('a mapping without options resolves to the bare model', () => {
  assert.equal(
    resolveCursorModelSlug(
      parsePersonaMapping('claude-fable-5[]'),
      'persona mapping',
      root,
    ),
    'claude-fable-5',
  )
  assert.equal(
    resolveCursorModelSlug(
      parsePersonaMapping('auto'),
      'persona mapping',
      root,
    ),
    'auto',
  )
})

test('an unlisted model or effort value is accepted, not rejected', () => {
  // Absence from the catalog is not evidence of invalidity. A hardcoded list
  // previously rejected grok-4.6 and effort=xhigh, both of which Cursor
  // accepts, so an unrecorded identifier MUST pass through.
  assert.equal(
    resolveCursorModelSlug(
      parsePersonaMapping('some-new-model[effort=high]'),
      'persona mapping',
      root,
    ),
    'some-new-model[effort=high]',
  )
  assert.equal(
    resolveCursorModelSlug(
      parsePersonaMapping('grok-4.6[effort=ultra,fast=true]'),
      'persona mapping',
      root,
    ),
    'grok-4.6[effort=ultra,fast=true]',
  )
})

test('a catalog-verified model resolves', () => {
  assert.equal(
    resolveCursorModelSlug(
      parsePersonaMapping('grok-4.6[effort=xhigh,fast=true]'),
      'persona mapping',
      root,
    ),
    'grok-4.6[effort=xhigh,fast=true]',
  )
})

test('options on auto still fail with a named error', () => {
  assert.throws(
    () =>
      resolveCursorModelSlug(
        parsePersonaMapping('auto[effort=high]'),
        'persona mapping',
        root,
      ),
    /cannot apply Cursor options to model 'auto'/u,
  )
})

test('the catalog records provenance for every entry', () => {
  const catalog = loadCursorCatalog(root)

  for (const [id, entry] of catalog.models) {
    assert.ok(
      entry.evidence.trim().length > 0,
      `model ${id} MUST cite evidence`,
    )
  }

  for (const [name, entry] of catalog.parameters) {
    assert.ok(
      entry.evidence.trim().length > 0,
      `parameter ${name} MUST cite evidence`,
    )
  }

  // reasoning= is the spelling Cursor's own picker generates, so it must never
  // be recorded as rejected again.
  assert.equal(catalog.parameters.get('reasoning')?.status, 'verified')
  assert.notEqual(catalog.parameters.get('thinking')?.status, 'rejected')
})
