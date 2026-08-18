import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compressCursorModels,
  expandCursorModels,
  isCompactModel,
} from '../../src/lib/executors/cursor-catalog-codec.js'

const SAMPLE = [
  {
    id: 'example-model',
    displayName: 'Example',
    aliases: ['example'],
    parameters: [
      {
        id: 'effort',
        displayName: 'Effort',
        values: [{ value: 'low', displayName: 'Low' }, { value: 'high' }],
      },
      {
        id: 'fast',
        values: [{ value: 'false' }, { value: 'true', displayName: 'Fast' }],
      },
    ],
    variants: [
      {
        params: [
          { id: 'effort', value: 'low' },
          { id: 'fast', value: 'false' },
        ],
        displayName: 'Example',
      },
      {
        params: [
          { id: 'effort', value: 'high' },
          { id: 'fast', value: 'false' },
        ],
        displayName: 'Example Special Name',
        isDefault: true,
      },
    ],
  },
  {
    id: 'bare-model',
    displayName: 'Bare',
    variants: [{ params: [], displayName: 'Bare', isDefault: true }],
  },
]

test('the codec round-trips a verbatim models array losslessly', () => {
  const compact = compressCursorModels(structuredClone(SAMPLE))

  assert.ok(compact.every(isCompactModel))
  assert.deepEqual(expandCursorModels(compact), SAMPLE)
})

test('the compact form encodes defaults and divergent variant names', () => {
  const [example] = compressCursorModels(structuredClone(SAMPLE)) as Record<
    string,
    unknown
  >[]

  assert.deepEqual(example.variant_keys, ['effort', 'fast'])
  assert.deepEqual(example.variants, ['low|false', 'high|false'])
  assert.equal(example.default_variant, 'high|false')
  assert.deepEqual(example.variant_names, {
    'high|false': 'Example Special Name',
  })
})

test('a model the encoding cannot represent is kept verbatim, never approximated', () => {
  // Inconsistent per-variant key order defeats the tuple encoding.
  const awkward = [
    {
      id: 'awkward',
      displayName: 'Awkward',
      variants: [
        { params: [{ id: 'a', value: '1' }], displayName: 'Awkward' },
        { params: [{ id: 'b', value: '2' }], displayName: 'Awkward' },
      ],
    },
  ]
  const compact = compressCursorModels(structuredClone(awkward))

  assert.ok(!isCompactModel(compact[0]))
  assert.deepEqual(compact, awkward)
})
