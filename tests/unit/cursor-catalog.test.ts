import assert from 'node:assert/strict'
import test from 'node:test'

import {
  loadCursorCatalog,
  resolveCursorModelSlug,
} from '../../src/lib/executors/cursor-catalog.js'
import { parsePersonaMapping } from '../../src/lib/executors/mapping.js'

const root = process.cwd()

test('a valid spec is emitted verbatim in Cursor bracket grammar', () => {
  // Bracket notation is Cursor's documented grammar for the subagent model
  // field. Every historical rewrite here (flat slugs, key renames, option
  // reordering) produced strings Cursor silently degraded on.
  for (const spec of [
    'gpt-5.6-sol[context=272k,reasoning=high,fast=false]',
    'grok-4.6[effort=xhigh,fast=true]',
    'claude-opus-5[thinking=true,context=300k,effort=high,fast=false]',
    'claude-fable-5[thinking=true,context=1m,effort=high]',
    'composer-2.5[fast=false]',
    'auto',
  ]) {
    assert.equal(
      resolveCursorModelSlug(
        parsePersonaMapping(spec),
        'persona mapping',
        root,
      ),
      spec,
    )
  }
})

test('parameters are validated per model, not per family', () => {
  // GPT models take `reasoning`; Claude and Grok models take `effort`.
  // Assuming either key exists everywhere is the exact defect that ran Sol at
  // medium: Cursor falls back silently on an unknown parameter.
  assert.throws(
    () =>
      resolveCursorModelSlug(
        parsePersonaMapping('gpt-5.6-sol[context=272k,effort=high,fast=false]'),
        'persona mapping',
        root,
      ),
    /has no parameter 'effort'/u,
  )
  assert.throws(
    () =>
      resolveCursorModelSlug(
        parsePersonaMapping('claude-fable-5[reasoning=high]'),
        'persona mapping',
        root,
      ),
    /has no parameter 'reasoning'/u,
  )
})

test('parameter values are validated against the model declaration', () => {
  // grok-4.5 declares effort low|medium|high; xhigh exists only on grok-4.6.
  assert.throws(
    () =>
      resolveCursorModelSlug(
        parsePersonaMapping('grok-4.5[effort=xhigh]'),
        'persona mapping',
        root,
      ),
    /parameter 'effort' has no value 'xhigh'/u,
  )
  // gpt-5.5 spells its top tier extra-high, not xhigh.
  assert.throws(
    () =>
      resolveCursorModelSlug(
        parsePersonaMapping('gpt-5.5[reasoning=xhigh]'),
        'persona mapping',
        root,
      ),
    /parameter 'reasoning' has no value 'xhigh'/u,
  )
  assert.equal(
    resolveCursorModelSlug(
      parsePersonaMapping(
        'gpt-5.5[context=1m,reasoning=extra-high,fast=false]',
      ),
      'persona mapping',
      root,
    ),
    'gpt-5.5[context=1m,reasoning=extra-high,fast=false]',
  )
})

test('an underspecified spec fails: every declared parameter is required', () => {
  // Observed 2026-08-17: the cursor-agent CLI rejects claude-fable-5[] and
  // claude-opus-5[context=300k,effort=high] with "Cannot use this model",
  // while their fully-specified forms resolve to the requested variant.
  assert.throws(
    () =>
      resolveCursorModelSlug(
        parsePersonaMapping('claude-fable-5[]'),
        'persona mapping',
        root,
      ),
    /missing parameter/u,
  )
  assert.throws(
    () =>
      resolveCursorModelSlug(
        parsePersonaMapping('claude-opus-5[context=300k,effort=high]'),
        'persona mapping',
        root,
      ),
    /missing parameter/u,
  )
})

test('an unknown model fails loudly with a refresh pointer', () => {
  // The catalog is the verbatim Cursor.models.list() result, so an unknown id
  // is a configuration error. A flat effort-suffixed slug is one such id.
  assert.throws(
    () =>
      resolveCursorModelSlug(
        parsePersonaMapping('gpt-5.6-sol-high'),
        'persona mapping',
        root,
      ),
    /not in the Cursor model catalog/u,
  )
})

test('aliases resolve to a catalog model', () => {
  assert.equal(
    resolveCursorModelSlug(
      parsePersonaMapping('auto'),
      'persona mapping',
      root,
    ),
    'auto',
  )
  assert.equal(
    resolveCursorModelSlug(
      parsePersonaMapping('fable[thinking=true,context=1m,effort=high]'),
      'persona mapping',
      root,
    ),
    'fable[thinking=true,context=1m,effort=high]',
  )
})

test('without a root the resolution is grammar-only', () => {
  // Callers without an installation root (bare config parsing in tests)
  // cannot reach the catalog; full validation happens at loadPipelineConfig
  // and projection, which always have the root.
  assert.equal(
    resolveCursorModelSlug(parsePersonaMapping('unknown-model[foo=bar]')),
    'unknown-model[foo=bar]',
  )
})

test('the catalog loads models, aliases, and per-model parameters', () => {
  const catalog = loadCursorCatalog(root)
  const sol = catalog.models.get('gpt-5.6-sol')

  assert.ok(sol)
  assert.deepEqual([...sol.parameters.keys()].sort(), [
    'context',
    'fast',
    'reasoning',
  ])
  assert.ok(sol.parameters.get('reasoning')?.has('xhigh'))
  assert.ok(!sol.parameters.get('reasoning')?.has('extra-high'))
  assert.ok(catalog.aliases.get('gpt')?.length)
})
