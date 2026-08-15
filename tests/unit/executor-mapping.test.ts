import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canonicalPersonaMapping,
  parsePersonaMapping,
  personaExecutorOf,
} from '../../src/lib/executors/mapping.js'

test('a plain model string parses as a cursor mapping', () => {
  const mapping = parsePersonaMapping(
    'gpt-5.6-sol[context=272k,effort=high,fast=false]',
  )

  assert.equal(mapping.executor, 'cursor')
  assert.equal(
    mapping.model_spec,
    'gpt-5.6-sol[context=272k,effort=high,fast=false]',
  )
  assert.equal(mapping.model, 'gpt-5.6-sol')
  assert.deepEqual(mapping.options, {
    context: '272k',
    effort: 'high',
    fast: 'false',
  })
})

test('bare and empty-option cursor mappings parse unchanged', () => {
  assert.equal(parsePersonaMapping('auto').model, 'auto')
  assert.deepEqual(parsePersonaMapping('kimi-k3[]').options, {})
  assert.equal(parsePersonaMapping('kimi-k3[]').model_spec, 'kimi-k3[]')
})

test('a claude-code mapping parses executor, model, and options', () => {
  const mapping = parsePersonaMapping(
    'claude-code:claude-opus-5[permission-mode=default,session-resume=true]',
  )

  assert.equal(mapping.executor, 'claude-code')
  assert.equal(mapping.model, 'claude-opus-5')
  assert.equal(
    mapping.model_spec,
    'claude-opus-5[permission-mode=default,session-resume=true]',
  )
  assert.deepEqual(mapping.options, {
    'permission-mode': 'default',
    'session-resume': 'true',
  })
})

test('an explicit cursor prefix is accepted and stripped from the model spec', () => {
  const mapping = parsePersonaMapping('cursor:composer-2.5[fast=false]')

  assert.equal(mapping.executor, 'cursor')
  assert.equal(mapping.model_spec, 'composer-2.5[fast=false]')
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

test('cursor bracket options reject obsolete and unknown keys', () => {
  assert.throws(
    () => parsePersonaMapping('claude-opus-5[thinking=true]'),
    /obsolete Cursor option 'thinking'/u,
  )
  assert.throws(
    () => parsePersonaMapping('claude-opus-5[unknown=true]'),
    /unknown Cursor option 'unknown'/u,
  )
  assert.doesNotThrow(() =>
    parsePersonaMapping('claude-opus-5[context=300k,effort=high]'),
  )
})

test('canonical mapping equates a retired option spelling with the current one', () => {
  // A snapshot written before the grammar change must still match live config.
  assert.equal(
    canonicalPersonaMapping(
      'claude-opus-5[thinking=true,context=300k,effort=high]',
    ),
    canonicalPersonaMapping('claude-opus-5[context=300k,effort=high]'),
  )
  assert.equal(
    canonicalPersonaMapping(
      'gpt-5.6-sol[context=272k,reasoning=high,fast=false]',
    ),
    canonicalPersonaMapping('gpt-5.6-sol[context=272k,effort=high,fast=false]'),
  )
  // Option order must not register as drift.
  assert.equal(
    canonicalPersonaMapping('gpt-5.4[effort=high,context=272k]'),
    canonicalPersonaMapping('gpt-5.4[context=272k,effort=high]'),
  )
  // A current key wins over the retired key that aliases onto it.
  assert.equal(
    canonicalPersonaMapping('gpt-5.6-sol[reasoning=low,effort=high]'),
    'cursor:gpt-5.6-sol[effort=high]',
  )
  // A genuine model or effort difference must still register as drift.
  assert.notEqual(
    canonicalPersonaMapping('gpt-5.6-sol[effort=high]'),
    canonicalPersonaMapping('gpt-5.6-sol[effort=medium]'),
  )
  assert.notEqual(
    canonicalPersonaMapping('gpt-5.4[effort=high]'),
    canonicalPersonaMapping('gpt-5.6-sol[effort=high]'),
  )
  // Executor prefixes and bare models normalize without throwing.
  assert.equal(canonicalPersonaMapping('auto'), 'cursor:auto')
  assert.equal(
    canonicalPersonaMapping('claude-code:claude-opus-5[permission-mode=plan]'),
    'claude-code:claude-opus-5[permission-mode=plan]',
  )
})

test('personaExecutorOf resolves the executor without full validation', () => {
  assert.equal(personaExecutorOf('claude-opus-5[thinking=true]'), 'cursor')
  assert.equal(personaExecutorOf('claude-code:claude-opus-5'), 'claude-code')
  assert.equal(personaExecutorOf('cursor:auto'), 'cursor')
})
