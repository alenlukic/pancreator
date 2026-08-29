import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { listInbox } from '../../src/lib/inbox.js'
import { makeWorkflowRunId } from '../../src/lib/naming.js'

function writeInboxFile(
  root: string,
  relativePath: string,
  content: string,
  modifiedAt: Date,
): void {
  const filePath = path.join(root, 'runtime', 'inbox', relativePath)

  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
  utimesSync(filePath, modifiedAt, modifiedAt)
}

test('listInbox ignores nested directories and non-Markdown files', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-inbox-unit-'))
  const oldest = new Date('2024-01-01T12:00:00.000Z')
  const middle = new Date('2024-01-02T12:00:00.000Z')
  const newest = new Date('2024-01-03T12:00:00.000Z')

  try {
    writeInboxFile(root, 'oldest.md', '# Oldest\n', oldest)
    writeInboxFile(root, 'middle.md', '# Middle\n', middle)
    writeInboxFile(root, 'newest.md', '# Newest\n', newest)
    writeInboxFile(root, 'notes.txt', 'ignore me\n', newest)
    writeInboxFile(root, 'nested/deep.md', '# Nested\n', newest)
    // Two files sharing the oldest mtime sort by file name.
    writeInboxFile(root, 'zebra.md', '# Z\n', oldest)
    writeInboxFile(root, 'alpha.md', '# A\n', oldest)

    const items = listInbox(root)

    assert.deepEqual(
      items.map((item) => item.file_name),
      ['newest.md', 'middle.md', 'alpha.md', 'oldest.md', 'zebra.md'],
    )
    assert.deepEqual(
      items.map((item) => item.title),
      ['Newest', 'Middle', 'A', 'Oldest', 'Z'],
    )
    // Modification times are ISO 8601 UTC.
    assert.equal(items[0]?.modified_at, newest.toISOString())
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('listInbox selects the first valid level-one heading and falls back to the file name', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-inbox-unit-'))
  const modifiedAt = new Date('2024-03-01T10:00:00.000Z')

  try {
    writeInboxFile(
      root,
      'fenced-heading.md',
      [
        '```markdown',
        '# Ignored heading',
        '```',
        '',
        '# Visible title',
        '',
      ].join('\n'),
      modifiedAt,
    )
    writeInboxFile(root, 'heading-free.md', 'No heading here.\n', modifiedAt)

    const items = listInbox(root)
    const byName = Object.fromEntries(
      items.map((item) => [item.file_name, item.title]),
    )

    assert.equal(byName['fenced-heading.md'], 'Visible title')
    assert.equal(byName['heading-free.md'], 'heading-free.md')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('listInbox matches the longest known run prefix', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-inbox-unit-'))
  const modifiedAt = new Date('2024-04-01T11:00:00.000Z')
  const shortRunId = makeWorkflowRunId(modifiedAt, 'short')
  const longRunId = makeWorkflowRunId(modifiedAt, 'longer-run')

  try {
    mkdirSync(path.join(root, 'runtime', 'logs', 'workflows', shortRunId), {
      recursive: true,
    })
    mkdirSync(path.join(root, 'runtime', 'logs', 'workflows', longRunId), {
      recursive: true,
    })
    writeInboxFile(
      root,
      `${longRunId}-verify-warnings.md`,
      '# Verify warnings\n',
      modifiedAt,
    )
    writeInboxFile(root, 'unrelated.md', '# Unrelated\n', modifiedAt)

    const items = listInbox(root)
    const byName = Object.fromEntries(
      items.map((item) => [item.file_name, item.run_id]),
    )

    assert.equal(byName[`${longRunId}-verify-warnings.md`], longRunId)
    assert.equal(byName['unrelated.md'], null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('listInbox falls back to a unique date-sequence base match', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-inbox-unit-'))
  const modifiedAt = new Date('2024-04-02T11:00:00.000Z')
  const runId = '63319_Aug-21-0127_operator-upd'

  try {
    mkdirSync(path.join(root, 'runtime', 'logs', 'workflows', runId), {
      recursive: true,
    })
    writeInboxFile(
      root,
      '63319_Aug-21-0127_request-operator-updates.md',
      '# Preserved request\n',
      modifiedAt,
    )
    writeInboxFile(
      root,
      '63319_Aug-21-0141_other-sequence.md',
      '# Different sequence\n',
      modifiedAt,
    )
    // Two run directories share the 0150 base, so that base is ambiguous.
    for (const ambiguous of [
      '63319_Aug-21-0150_first-run',
      '63319_Aug-21-0150_second-run',
    ]) {
      mkdirSync(path.join(root, 'runtime', 'logs', 'workflows', ambiguous), {
        recursive: true,
      })
    }
    writeInboxFile(
      root,
      '63319_Aug-21-0150_request-something.md',
      '# Ambiguous base\n',
      modifiedAt,
    )

    const items = listInbox(root)
    const byName = Object.fromEntries(
      items.map((item) => [item.file_name, item.run_id]),
    )

    assert.equal(byName['63319_Aug-21-0127_request-operator-updates.md'], runId)
    assert.equal(byName['63319_Aug-21-0141_other-sequence.md'], null)
    assert.equal(byName['63319_Aug-21-0150_request-something.md'], null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('listInbox returns an empty list when the inbox directory is missing', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-inbox-unit-'))

  try {
    assert.deepEqual(listInbox(root), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
