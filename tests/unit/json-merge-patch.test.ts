import assert from 'node:assert/strict'
import test from 'node:test'

import { applyJsonMergePatch } from '../../src/lib/json-merge-patch.js'

test('objects merge recursively, null deletes, arrays replace whole', () => {
  const target = {
    invocation_id: 'plan-1',
    summary: 'old summary',
    data: {
      engineering_plan: { approach: 'keep me', risks: ['r1'] },
      acceptance_criteria: [{ id: 'AC-1' }, { id: 'AC-2' }],
      stray: 'delete me',
    },
  }

  const merged = applyJsonMergePatch(target, {
    invocation_id: 'plan-2',
    summary: 'new summary',
    data: {
      acceptance_criteria: [{ id: 'AC-1' }, { id: 'AC-2' }, { id: 'AC-3' }],
      stray: null,
    },
  }) as Record<string, unknown>

  assert.deepEqual(merged, {
    invocation_id: 'plan-2',
    summary: 'new summary',
    data: {
      engineering_plan: { approach: 'keep me', risks: ['r1'] },
      acceptance_criteria: [{ id: 'AC-1' }, { id: 'AC-2' }, { id: 'AC-3' }],
    },
  })
  // The original is never mutated.
  assert.equal(target.summary, 'old summary')
  assert.equal(target.data.stray, 'delete me')
})

test('RFC 7386 appendix examples hold', () => {
  assert.deepEqual(applyJsonMergePatch({ a: 'b' }, { a: 'c' }), { a: 'c' })
  assert.deepEqual(applyJsonMergePatch({ a: 'b' }, { b: 'c' }), {
    a: 'b',
    b: 'c',
  })
  assert.deepEqual(applyJsonMergePatch({ a: 'b' }, { a: null }), {})
  assert.deepEqual(applyJsonMergePatch({ a: 'b', b: 'c' }, { a: null }), {
    b: 'c',
  })
  assert.deepEqual(applyJsonMergePatch({ a: ['b'] }, { a: 'c' }), { a: 'c' })
  assert.deepEqual(applyJsonMergePatch({ a: 'c' }, { a: ['b'] }), { a: ['b'] })
  assert.deepEqual(
    applyJsonMergePatch({ a: { b: 'c' } }, { a: { b: 'd', c: null } }),
    { a: { b: 'd' } },
  )
  assert.deepEqual(applyJsonMergePatch({ a: [{ b: 'c' }] }, { a: [1] }), {
    a: [1],
  })

  assert.deepEqual(applyJsonMergePatch({ a: 1 }, [1, 2]), [1, 2])
  assert.equal(applyJsonMergePatch({ a: 1 }, 'text'), 'text')
  assert.deepEqual(applyJsonMergePatch('scalar', { a: 1 }), { a: 1 })
})
