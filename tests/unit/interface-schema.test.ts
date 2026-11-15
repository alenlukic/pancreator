import assert from 'node:assert/strict'
import test from 'node:test'

import {
  findInterfaceDrift,
  parseInterfaceSchema,
} from '../../src/lib/interface-schema.js'

const ADAPTER = {
  name: 'createAdapter',
  signature: '(provider: string) => Adapter',
}

test('parseInterfaceSchema accepts named signatures and notes', () => {
  const parsed = parseInterfaceSchema({
    interfaces: [ADAPTER],
    notes: 'Fixture adapter contract.',
  })

  assert.deepEqual(parsed, {
    schema: {
      interfaces: [ADAPTER],
      notes: 'Fixture adapter contract.',
    },
  })
})

test('parseInterfaceSchema rejects a missing notes field', () => {
  const parsed = parseInterfaceSchema({ interfaces: [ADAPTER] })

  assert.equal('error' in parsed, true)
})

test('findInterfaceDrift is empty when names and signatures match', () => {
  assert.deepEqual(findInterfaceDrift([ADAPTER], [ADAPTER]), [])
})

test('findInterfaceDrift reports a signature mismatch', () => {
  assert.deepEqual(
    findInterfaceDrift(
      [ADAPTER],
      [{ name: 'createAdapter', signature: '() => Adapter' }],
    ),
    [
      {
        name: 'createAdapter',
        kind: 'signature',
        schemaSignature: '(provider: string) => Adapter',
        claimedSignature: '() => Adapter',
      },
    ],
  )
})

test('findInterfaceDrift reports a claimed name the schema omits', () => {
  assert.deepEqual(findInterfaceDrift([], [ADAPTER]), [
    {
      name: 'createAdapter',
      kind: 'missing_in_schema',
      claimedSignature: '(provider: string) => Adapter',
    },
  ])
})
