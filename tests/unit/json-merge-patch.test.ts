import assert from 'node:assert/strict'
import test from 'node:test'

import { applyJsonMergePatch } from '../../src/lib/json-merge-patch.js'

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

  const target = {
    summary: 'old summary',
    data: { stray: 'delete me' },
  }

  applyJsonMergePatch(target, {
    summary: 'new summary',
    data: { stray: null },
  })

  assert.equal(target.summary, 'old summary')
  assert.equal(target.data.stray, 'delete me')
})
