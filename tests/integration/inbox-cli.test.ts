import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createFixture } from '../fixture-template.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

function writeInboxFile(
  root: string,
  fileName: string,
  content: string,
  modifiedAt: Date,
): void {
  const filePath = path.join(root, 'runtime', 'inbox', 'queue', fileName)

  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
  utimesSync(filePath, modifiedAt, modifiedAt)
}

// The command reads through listInbox and prints renderInbox, both covered in
// tests/unit/inbox.test.ts. What only the process boundary proves is the JSON
// item shape an operator tool parses.
test('pan inbox --json reports the queued item shape', () => {
  const root = createFixture()

  writeInboxFile(
    root,
    'newest.md',
    '# Newest\n',
    new Date('2024-03-03T12:00:00.000Z'),
  )
  writeInboxFile(
    root,
    'oldest.md',
    '# Oldest\n',
    new Date('2024-01-01T12:00:00.000Z'),
  )

  const items = JSON.parse(
    execFileSync(process.execPath, [CLI, 'inbox', '--json'], {
      cwd: root,
      encoding: 'utf8',
    }),
  ) as Array<{
    file_name: string
    title: string
    modified_at: string
    run_id: string | null
  }>

  assert.deepEqual(
    items.map((item) => item.file_name),
    ['newest.md', 'oldest.md'],
  )
  assert.deepEqual(Object.keys(items[0] ?? {}), [
    'file_name',
    'title',
    'modified_at',
    'run_id',
  ])
})
