/**
 * Unit tests for spend canvas bracket parsing, naming, and clamping.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  clampSpendBrackets,
  parseSpendBrackets,
  spendBracketName,
} from '../../src/lib/spend-brackets.js'

const WINDOW = {
  start: '2026-08-10T18:00:00.000Z',
  end: '2026-10-08T18:00:00.000Z',
}

test('labels become sentence-case names without hyphens', () => {
  assert.equal(spendBracketName('athene-demo'), 'Athene demo')
  assert.equal(
    spendBracketName('excessive-fast-mode-usage'),
    'Excessive Fast mode usage',
  )
  assert.equal(
    spendBracketName('pal-slack-message-about-spend'),
    'Pal Slack message about spend',
  )
  assert.equal(spendBracketName('qa_pr-review'), 'QA PR review')
})

test('inline periods resolve a label, and a file resolves the rest in --brackets order', () => {
  const requested = parseSpendBrackets({
    labels: 'carlyle-demo@2026-09-12..2026-09-23, athene-demo,unknown-event',
    file: [
      {
        label: 'athene-demo',
        name: 'Athene demo week',
        start: '2026-08-10',
        end: '2026-08-13',
        source: 'calendar',
        note: 'dropped',
      },
    ],
  })

  assert.deepEqual(requested, [
    {
      label: 'carlyle-demo',
      name: 'Carlyle demo',
      start: '2026-09-12',
      end: '2026-09-23',
      source: 'operator',
    },
    {
      label: 'athene-demo',
      name: 'Athene demo week',
      start: '2026-08-10',
      end: '2026-08-13',
      source: 'calendar',
    },
    { label: 'unknown-event', reason: 'unresolved' },
  ])
})

test('a file alone draws every entry, with a one-day period when end is absent', () => {
  const requested = parseSpendBrackets({
    labels: null,
    file: [{ label: 'pal-slack-message', start: '2026-09-23', source: 'x' }],
  })

  assert.deepEqual(requested, [
    {
      label: 'pal-slack-message',
      name: 'Pal Slack message',
      start: '2026-09-23',
      end: '2026-09-23',
      source: 'other',
    },
  ])
})

test('clamping trims periods to the window and skips periods outside it', () => {
  const result = clampSpendBrackets(
    parseSpendBrackets({
      labels:
        'early@2026-08-01..2026-08-12,late@2026-10-07..2026-10-20,gone@2026-07-01..2026-07-04,open',
      file: undefined,
    }),
    WINDOW,
  )

  assert.deepEqual(
    result.brackets.map((b) => [b.label, b.start, b.end]),
    [
      ['early', '2026-08-10', '2026-08-12'],
      ['late', '2026-10-07', '2026-10-08'],
    ],
  )
  assert.deepEqual(result.skipped, [
    { label: 'gone', reason: 'outside_window' },
    { label: 'open', reason: 'unresolved' },
  ])
})

test('malformed labels, dates, duplicates, and files are refused', () => {
  for (const input of [
    { labels: 'bad label@2026-09-01', file: undefined },
    { labels: 'x@2026-02-30', file: undefined },
    { labels: 'x@2026-09-02..2026-09-01', file: undefined },
    { labels: 'x,x', file: undefined },
    { labels: ' , ', file: undefined },
    { labels: null, file: { label: 'x' } },
    { labels: null, file: [{ label: 'x' }] },
  ]) {
    assert.throws(() => parseSpendBrackets(input), {
      code: 'INVALID_ARGUMENT',
    })
  }
})

test('names from a file drop control characters and stay short', () => {
  const [bracket] = parseSpendBrackets({
    labels: null,
    file: [
      { label: 'x', name: `a\u0007b ${'c'.repeat(80)}`, start: '2026-09-01' },
    ],
  })

  assert.ok(bracket !== undefined && 'name' in bracket)
  assert.ok(!/\p{Cc}/u.test(bracket.name))
  assert.equal(bracket.name.length, 60)
})
