import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { listInbox, renderInbox } from '../../src/lib/inbox.js'
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

    const items = listInbox(root)

    assert.deepEqual(
      items.map((item) => item.file_name),
      ['newest.md', 'middle.md', 'oldest.md'],
    )
    assert.deepEqual(
      items.map((item) => item.title),
      ['Newest', 'Middle', 'Oldest'],
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('listInbox uses the file name tie breaker for equal modification times', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-inbox-unit-'))
  const sharedTime = new Date('2024-02-01T09:00:00.000Z')

  try {
    writeInboxFile(root, 'zebra.md', '# Z\n', sharedTime)
    writeInboxFile(root, 'alpha.md', '# A\n', sharedTime)

    const items = listInbox(root)

    assert.deepEqual(
      items.map((item) => item.file_name),
      ['alpha.md', 'zebra.md'],
    )
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

    const items = listInbox(root)
    const byName = Object.fromEntries(
      items.map((item) => [item.file_name, item.run_id]),
    )

    assert.equal(byName['63319_Aug-21-0127_request-operator-updates.md'], runId)
    assert.equal(byName['63319_Aug-21-0141_other-sequence.md'], null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('listInbox reports no run when the date-sequence base is ambiguous', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-inbox-unit-'))
  const modifiedAt = new Date('2024-04-03T11:00:00.000Z')

  try {
    for (const runId of [
      '63319_Aug-21-0127_first-run',
      '63319_Aug-21-0127_second-run',
    ]) {
      mkdirSync(path.join(root, 'runtime', 'logs', 'workflows', runId), {
        recursive: true,
      })
    }

    writeInboxFile(
      root,
      '63319_Aug-21-0127_request-something.md',
      '# Ambiguous base\n',
      modifiedAt,
    )

    const [item] = listInbox(root)

    assert.equal(item?.run_id, null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('listInbox returns ISO 8601 UTC modification times', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-inbox-unit-'))
  const modifiedAt = new Date('2024-05-01T15:30:00.000Z')

  try {
    writeInboxFile(root, 'timed.md', '# Timed\n', modifiedAt)

    const [item] = listInbox(root)

    assert.equal(item?.modified_at, modifiedAt.toISOString())
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('renderInbox prints the header, rows, and empty message', () => {
  const modifiedAt = '2024-06-01T08:00:00.000Z'
  const rendered = renderInbox([
    {
      file_name: 'sample.md',
      title: 'Sample title',
      modified_at: modifiedAt,
      run_id: '63313_Aug-27-0830_demo-run',
    },
    {
      file_name: 'orphan.md',
      title: 'orphan.md',
      modified_at: modifiedAt,
      run_id: null,
    },
  ])

  assert.match(rendered, /^FILE\tTITLE\tMODIFIED\tRUN\n/u)
  assert.match(
    rendered,
    /sample\.md\tSample title\t2024-06-01T08:00:00\.000Z\t63313_Aug-27-0830_demo-run\n/u,
  )
  assert.match(
    rendered,
    /orphan\.md\torphan\.md\t2024-06-01T08:00:00\.000Z\t-\n/u,
  )
  assert.equal(renderInbox([]), 'Inbox is empty.\n')
})

test('listInbox returns an empty list when the inbox directory is missing', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-inbox-unit-'))

  try {
    assert.deepEqual(listInbox(root), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('listInbox reads only direct inbox files without mutating them', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-inbox-unit-'))
  const modifiedAt = new Date('2024-07-01T12:00:00.000Z')
  const filePath = path.join(root, 'runtime', 'inbox', 'stable.md')

  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, '# Stable\n', 'utf8')
    utimesSync(filePath, modifiedAt, modifiedAt)

    const before = readFileSync(filePath, 'utf8')

    listInbox(root)

    assert.equal(readFileSync(filePath, 'utf8'), before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
