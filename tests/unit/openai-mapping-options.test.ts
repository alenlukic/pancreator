import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canonicalPersonaMapping,
  OPENAI_OPTION_KEYS,
  parsePersonaMapping,
  personaExecutorOf,
} from '../../src/lib/executors/mapping.js'
import { PanError } from '../../src/lib/errors.js'

const SUPPORTED = OPENAI_OPTION_KEYS.join(', ')

function rejection(spec: string): PanError {
  try {
    parsePersonaMapping(spec)
  } catch (error) {
    assert.ok(error instanceof PanError, `${spec} threw ${String(error)}`)
    return error
  }

  throw new assert.AssertionError({ message: `${spec} was accepted` })
}

test('an openai mapping parses into executor, model, and options', () => {
  const mapping = parsePersonaMapping(
    'openai:gpt-6-astra[effort=high,timeout-ms=600000]',
  )

  assert.equal(mapping.executor, 'openai')
  assert.equal(mapping.model, 'gpt-6-astra')
  assert.equal(mapping.model_spec, 'gpt-6-astra[effort=high,timeout-ms=600000]')
  assert.deepEqual(mapping.options, { effort: 'high', 'timeout-ms': '600000' })
  assert.equal(personaExecutorOf('openai:gpt-6-astra'), 'openai')
})

test('the canonical form round-trips an openai spec with sorted options', () => {
  assert.equal(
    canonicalPersonaMapping(
      'openai:gpt-6-astra[effort=high,timeout-ms=600000]',
    ),
    'openai:gpt-6-astra[effort=high,timeout-ms=600000]',
  )
  // Option order must not register as drift.
  assert.equal(
    canonicalPersonaMapping(
      'openai:gpt-6-astra[timeout-ms=600000,effort=high]',
    ),
    canonicalPersonaMapping(
      'openai:gpt-6-astra[effort=high,timeout-ms=600000]',
    ),
  )
  assert.equal(
    canonicalPersonaMapping('openai:gpt-6-astra'),
    'openai:gpt-6-astra',
  )
})

test('every supported openai option parses', () => {
  const mapping = parsePersonaMapping(
    'openai:gpt-6-astra[effort=xhigh,max-output-tokens=4096,' +
      'max-tool-rounds=25,session-resume=false,timeout-ms=1000]',
  )

  assert.deepEqual(Object.keys(mapping.options).sort(), [...OPENAI_OPTION_KEYS])
})

test('an invalid openai option is rejected and names the supported set', () => {
  const cases: { spec: string; detail: RegExp }[] = [
    {
      spec: 'openai:gpt-6-astra[thinking=true]',
      detail: /unknown openai option 'thinking'/u,
    },
    {
      spec: 'openai:gpt-6-astra[effort=turbo]',
      detail: /effort 'turbo' is not supported/u,
    },
    {
      spec: 'openai:gpt-6-astra[max-tool-rounds=0]',
      detail: /max-tool-rounds MUST be a positive integer/u,
    },
    {
      spec: 'openai:gpt-6-astra[max-output-tokens=-5]',
      detail: /max-output-tokens MUST be a positive integer/u,
    },
    {
      spec: 'openai:gpt-6-astra[session-resume=maybe]',
      detail: /session-resume MUST be true or false/u,
    },
    {
      spec: 'openai:gpt-6-astra[timeout-ms=50]',
      detail: /timeout-ms MUST be an integer of at least 1000/u,
    },
  ]

  for (const { spec, detail } of cases) {
    const error = rejection(spec)

    assert.equal(error.code, 'INVALID_PIPELINE_CONFIG', spec)
    assert.match(error.message, detail)
    assert.ok(
      error.message.includes(`Supported options: ${SUPPORTED}.`),
      `${spec} did not list the supported options: ${error.message}`,
    )
  }
})

test('claude-code option rules are unaffected by the third executor', () => {
  // The two validators are keyed on the executor, so an option valid for one
  // must stay invalid for the other.
  assert.throws(
    () => parsePersonaMapping('claude-code:claude-opus-5[effort=high]'),
    /unknown claude-code option 'effort'/u,
  )
  assert.throws(
    () => parsePersonaMapping('openai:gpt-6-astra[permission-mode=default]'),
    /unknown openai option 'permission-mode'/u,
  )
})
