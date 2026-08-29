import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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

import { createFixture } from '../helpers.js'
import { makeWorkflowRunId } from '../../src/lib/naming.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

function writeInboxFile(
  root: string,
  fileName: string,
  content: string,
  modifiedAt: Date,
): void {
  const filePath = path.join(root, 'runtime', 'inbox', fileName)

  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
  utimesSync(filePath, modifiedAt, modifiedAt)
}

test('pan inbox plain output shows columns, titles, run IDs, and empty states', () => {
  const root = createFixture()
  const modifiedAt = new Date('2024-02-01T10:00:00.000Z')
  const runId = makeWorkflowRunId(modifiedAt, 'inbox-cli')

  mkdirSync(path.join(root, 'runtime', 'logs', 'workflows', runId), {
    recursive: true,
  })
  writeInboxFile(
    root,
    `${runId}-verify-warnings.md`,
    ['```markdown', '# Ignored', '```', '', '# Warning summary', ''].join('\n'),
    modifiedAt,
  )
  writeInboxFile(
    root,
    'heading-free.md',
    'No heading.\n',
    new Date('2024-02-02T10:00:00.000Z'),
  )

  writeInboxFile(
    root,
    'oldest.md',
    '# Oldest\n',
    new Date('2024-01-01T12:00:00.000Z'),
  )
  writeInboxFile(
    root,
    'middle.md',
    '# Middle\n',
    new Date('2024-01-02T12:00:00.000Z'),
  )
  writeInboxFile(
    root,
    'newest.md',
    '# Newest\n',
    new Date('2024-03-03T12:00:00.000Z'),
  )
  writeInboxFile(
    root,
    'ignore.txt',
    'skip\n',
    new Date('2024-03-03T12:00:00.000Z'),
  )
  writeInboxFile(
    root,
    'nested/ignored.md',
    '# Nested\n',
    new Date('2024-03-03T12:00:00.000Z'),
  )

  const expectedOrder = [
    'newest.md',
    'heading-free.md',
    `${runId}-verify-warnings.md`,
    'middle.md',
    'oldest.md',
  ]
  const populated = execFileSync(process.execPath, [CLI, 'inbox'], {
    cwd: root,
    encoding: 'utf8',
  })

  assert.match(
    populated,
    new RegExp(
      `${runId}-verify-warnings\\.md\\tWarning summary\\t${modifiedAt.toISOString()}\\t${runId}`,
      'u',
    ),
  )
  assert.match(populated, /heading-free\.md\theading-free\.md\t[^\t]+\t-\n/u)

  const lines = populated.trim().split('\n')

  assert.equal(lines[0], 'FILE\tTITLE\tMODIFIED\tRUN')
  assert.deepEqual(
    lines.slice(1).map((line) => line.split('\t')[0]),
    expectedOrder,
  )

  const jsonOutput = execFileSync(process.execPath, [CLI, 'inbox', '--json'], {
    cwd: root,
    encoding: 'utf8',
  })
  const items = JSON.parse(jsonOutput) as Array<{
    file_name: string
    title: string
    modified_at: string
    run_id: string | null
  }>

  assert.deepEqual(
    items.map((item) => item.file_name),
    expectedOrder,
  )
  assert.deepEqual(Object.keys(items[0] ?? {}), [
    'file_name',
    'title',
    'modified_at',
    'run_id',
  ])

  const missingDirectoryRoot = mkdtempSync(
    path.join(tmpdir(), 'pancreator-inbox-cli-missing-'),
  )

  try {
    rmSync(path.join(root, 'runtime', 'inbox'), {
      recursive: true,
      force: true,
    })
    const missingDirectory = execFileSync(process.execPath, [CLI, 'inbox'], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.equal(missingDirectory, 'Inbox is empty.\n')

    const missingJson = execFileSync(
      process.execPath,
      [CLI, 'inbox', '--json'],
      { cwd: root, encoding: 'utf8' },
    )
    assert.equal(missingJson.trim(), '[]')
  } finally {
    rmSync(missingDirectoryRoot, { recursive: true, force: true })
  }

  rmSync(path.join(root, 'runtime', 'inbox'), { recursive: true, force: true })
  mkdirSync(path.join(root, 'runtime', 'inbox'))

  const emptyDirectory = execFileSync(process.execPath, [CLI, 'inbox'], {
    cwd: root,
    encoding: 'utf8',
  })

  assert.equal(emptyDirectory, 'Inbox is empty.\n')

  const emptyJson = execFileSync(process.execPath, [CLI, 'inbox', '--json'], {
    cwd: root,
    encoding: 'utf8',
  })

  assert.equal(emptyJson.trim(), '[]')
})
