import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canonicalPersonaMapping,
  parsePersonaMapping,
  personaExecutorOf,
} from '../../src/lib/executors/mapping.js'

test('a plain model string parses as a cursor mapping', () => {
  const cases: {
    spec: string
    executor: string
    model: string
    model_spec: string
    options: Record<string, string>
  }[] = [
    {
      spec: 'gpt-5.6-sol[context=272k,effort=high,fast=false]',
      executor: 'cursor',
      model: 'gpt-5.6-sol',
      model_spec: 'gpt-5.6-sol[context=272k,effort=high,fast=false]',
      options: { context: '272k', effort: 'high', fast: 'false' },
    },
    // Bare and empty-option cursor mappings parse unchanged.
    {
      spec: 'auto',
      executor: 'cursor',
      model: 'auto',
      model_spec: 'auto',
      options: {},
    },
    {
      spec: 'kimi-k3[]',
      executor: 'cursor',
      model: 'kimi-k3',
      model_spec: 'kimi-k3[]',
      options: {},
    },
    // A claude-code mapping parses executor, model, and options.
    {
      spec: 'claude-code:claude-opus-5[permission-mode=default,session-resume=true]',
      executor: 'claude-code',
      model: 'claude-opus-5',
      model_spec: 'claude-opus-5[permission-mode=default,session-resume=true]',
      options: { 'permission-mode': 'default', 'session-resume': 'true' },
    },
    // An explicit cursor prefix is accepted and stripped from the model spec.
    {
      spec: 'cursor:composer-2.5[fast=false]',
      executor: 'cursor',
      model: 'composer-2.5',
      model_spec: 'composer-2.5[fast=false]',
      options: { fast: 'false' },
    },
  ]

  for (const expected of cases) {
    const mapping = parsePersonaMapping(expected.spec)
    assert.equal(mapping.executor, expected.executor, expected.spec)
    assert.equal(mapping.model, expected.model, expected.spec)
    assert.equal(mapping.model_spec, expected.model_spec, expected.spec)
    assert.deepEqual(mapping.options, expected.options, expected.spec)
  }

  // personaExecutorOf resolves the executor without full validation.
  assert.equal(personaExecutorOf('claude-opus-5[thinking=true]'), 'cursor')
  assert.equal(personaExecutorOf('claude-code:claude-opus-5'), 'claude-code')
  assert.equal(personaExecutorOf('cursor:auto'), 'cursor')
})

test('unknown executor prefixes are rejected against the closed set', () => {
  assert.throws(
    () => parsePersonaMapping('codex:gpt-5.6-sol'),
    /unknown executor 'codex'.*cursor, claude-code/su,
  )
})

test('claude-code options are validated because the harness consumes them', () => {
  assert.throws(
    () => parsePersonaMapping('claude-code:claude-opus-5[thinking=true]'),
    /unknown claude-code option 'thinking'/u,
  )
  assert.throws(
    () =>
      parsePersonaMapping('claude-code:claude-opus-5[permission-mode=yolo]'),
    /permission-mode 'yolo' is not supported/u,
  )
  assert.throws(
    () =>
      parsePersonaMapping('claude-code:claude-opus-5[session-resume=maybe]'),
    /session-resume MUST be true or false/u,
  )
  assert.throws(
    () => parsePersonaMapping('claude-code:claude-opus-5[timeout-ms=50]'),
    /timeout-ms MUST be an integer of at least 1000/u,
  )
})

test('cursor bracket options accept keys the harness has not recorded', () => {
  // Cursor owns this grammar. Rejecting an unrecorded key made Pancreator
  // refuse the exact spec Cursor's own picker generates, so validity now comes
  // from the evidence-based catalog rather than a hardcoded list here.
  assert.doesNotThrow(() =>
    parsePersonaMapping('gpt-5.6-sol[context=272k,reasoning=high,fast=true]'),
  )
  assert.doesNotThrow(() => parsePersonaMapping('claude-opus-5[thinking=true]'))
  assert.doesNotThrow(() => parsePersonaMapping('claude-opus-5[unknown=true]'))
  assert.doesNotThrow(() =>
    parsePersonaMapping('claude-opus-5[context=300k,effort=high]'),
  )
  assert.doesNotThrow(() =>
    parsePersonaMapping('grok-4.6[effort=xhigh,fast=true]'),
  )
})

test('canonical mapping compares specs order-insensitively without renaming keys', () => {
  // Option order must not register as drift.
  assert.equal(
    canonicalPersonaMapping('gpt-5.4[reasoning=high,context=272k]'),
    canonicalPersonaMapping('gpt-5.4[context=272k,reasoning=high]'),
  )
  // reasoning and effort are DISTINCT real parameters on distinct models.
  // The v3.5.0 aliasing of one onto the other made a spec Cursor accepts
  // compare equal to one it silently degrades on, so no key is renamed.
  assert.notEqual(
    canonicalPersonaMapping(
      'gpt-5.6-sol[context=272k,reasoning=high,fast=false]',
    ),
    canonicalPersonaMapping('gpt-5.6-sol[context=272k,effort=high,fast=false]'),
  )
  // Empty brackets pin the standard variant and a bare id takes the default,
  // so the two forms are genuinely different selections.
  assert.notEqual(
    canonicalPersonaMapping('claude-fable-5[]'),
    canonicalPersonaMapping('claude-fable-5'),
  )
  // A genuine model or value difference must still register as drift.
  assert.notEqual(
    canonicalPersonaMapping('gpt-5.6-sol[reasoning=high]'),
    canonicalPersonaMapping('gpt-5.6-sol[reasoning=medium]'),
  )
  assert.notEqual(
    canonicalPersonaMapping('gpt-5.4[reasoning=high]'),
    canonicalPersonaMapping('gpt-5.6-sol[reasoning=high]'),
  )
  // Executor prefixes and bare models normalize without throwing.
  assert.equal(canonicalPersonaMapping('auto'), 'cursor:auto')
  assert.equal(
    canonicalPersonaMapping('claude-code:claude-opus-5[permission-mode=plan]'),
    'claude-code:claude-opus-5[permission-mode=plan]',
  )
})
