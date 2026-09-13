import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ARGV_ELEMENT_BYTE_LIMIT,
  argvElementByteLength,
  assertArgvElementsWithinLimit,
  findOversizedArgvElement,
} from '../../src/lib/argv-limits.js'
import { PanError } from '../../src/lib/errors.js'

test('argv element length is measured in bytes, not characters', () => {
  assert.equal(argvElementByteLength('abc'), 3)
  assert.equal(argvElementByteLength('é'), 2)
  assert.equal(argvElementByteLength('🙂'), 4)
})

test('an argument list within the bound passes unchanged', () => {
  const args = ['decide', '63328_run', '--note', 'x'.repeat(899)]

  assert.equal(findOversizedArgvElement(args), null)
  assert.doesNotThrow(() => {
    assertArgvElementsWithinLimit(args)
  })
})

test('an oversized note is refused by name before the run is touched', () => {
  const note = 'x'.repeat(ARGV_ELEMENT_BYTE_LIMIT)

  let error: PanError | null = null

  try {
    assertArgvElementsWithinLimit(['decide', '63328_run', '--note', note])
  } catch (thrown) {
    error = thrown as PanError
  }

  assert.ok(error instanceof PanError)
  assert.equal(error.code, 'ARGV_ELEMENT_TOO_LARGE')
  assert.match(error.message, /The value of --note/u)
  assert.match(error.message, new RegExp(`${ARGV_ELEMENT_BYTE_LIMIT}`, 'u'))
  assert.match(error.message, /Use --note-file\./u)
  assert.match(error.message, /The run is unchanged\./u)
  assert.deepEqual(error.details, {
    option: '--note',
    argument_index: 3,
    byte_length: ARGV_ELEMENT_BYTE_LIMIT,
    byte_limit: ARGV_ELEMENT_BYTE_LIMIT,
  })
})

test('an oversized positional argument names its index, not an option', () => {
  const found = findOversizedArgvElement(['decide', 'x'.repeat(1200)])

  assert.deepEqual(found, { option: null, index: 1, byteLength: 1200 })

  assert.throws(() => {
    assertArgvElementsWithinLimit(['decide', 'x'.repeat(1200)])
  }, /Argument 2 is 1200 bytes/u)
})

test('the bound stays below the byte count that kills the process', () => {
  // Endpoint security kills the process at exec when one argv element
  // reaches 1000 bytes, so the refusal must fire first.
  assert.ok(ARGV_ELEMENT_BYTE_LIMIT < 1000)
})
