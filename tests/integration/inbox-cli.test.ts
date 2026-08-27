import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createFixture } from '../helpers.js'
import { makeWorkflowRunId } from '../../src/lib/naming.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

interface InboxSnapshot {
  names: string[]
  contents: Record<string, string>
  mtimesMs: Record<string, number>
}

function snapshotInbox(root: string): InboxSnapshot {
  const inboxDirectory = path.join(root, 'runtime', 'inbox')

  if (!readdirSync(inboxDirectory).length) {
    return { names: [], contents: {}, mtimesMs: {} }
  }

  const names = readdirSync(inboxDirectory).sort()
  const contents: Record<string, string> = {}
  const mtimesMs: Record<string, number> = {}

  for (const name of names) {
    const filePath = path.join(inboxDirectory, name)
    const stat = statSync(filePath)

    if (!stat.isFile()) {
      continue
    }

    contents[name] = readFileSync(filePath, 'utf8')
    mtimesMs[name] = stat.mtimeMs
  }

  return {
    names: Object.keys(contents).sort(),
    contents,
    mtimesMs,
  }
}

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

test('pan inbox lists direct Markdown files in newest-first order', () => {
  const root = createFixture()
  const oldest = new Date('2024-01-01T12:00:00.000Z')
  const middle = new Date('2024-01-02T12:00:00.000Z')
  const newest = new Date('2024-01-03T12:00:00.000Z')

  writeInboxFile(root, 'oldest.md', '# Oldest\n', oldest)
  writeInboxFile(root, 'middle.md', '# Middle\n', middle)
  writeInboxFile(root, 'newest.md', '# Newest\n', newest)
  writeInboxFile(root, 'ignore.txt', 'skip\n', newest)
  writeInboxFile(root, 'nested/ignored.md', '# Nested\n', newest)

  const stdout = execFileSync(process.execPath, [CLI, 'inbox'], {
    cwd: root,
    encoding: 'utf8',
  })
  const lines = stdout.trim().split('\n')

  assert.equal(lines[0], 'FILE\tTITLE\tMODIFIED\tRUN')
  assert.deepEqual(
    lines.slice(1).map((line) => line.split('\t')[0]),
    ['newest.md', 'middle.md', 'oldest.md'],
  )
})

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
  writeInboxFile(root, 'heading-free.md', 'No heading.\n', modifiedAt)

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
})

test('pan inbox --json returns the ordered item array', () => {
  const root = createFixture()
  const oldest = new Date('2024-03-01T08:00:00.000Z')
  const newest = new Date('2024-03-02T08:00:00.000Z')

  writeInboxFile(root, 'older.md', '# Older\n', oldest)
  writeInboxFile(root, 'newer.md', '# Newer\n', newest)

  const stdout = execFileSync(process.execPath, [CLI, 'inbox', '--json'], {
    cwd: root,
    encoding: 'utf8',
  })
  const items = JSON.parse(stdout) as Array<{
    file_name: string
    title: string
    modified_at: string
    run_id: string | null
  }>

  assert.deepEqual(
    items.map((item) => item.file_name),
    ['newer.md', 'older.md'],
  )
  assert.deepEqual(Object.keys(items[0] ?? {}), [
    'file_name',
    'title',
    'modified_at',
    'run_id',
  ])
})

test('pan inbox exits successfully for missing, empty, plain, and JSON modes', () => {
  const root = createFixture()

  rmSync(path.join(root, 'runtime', 'inbox'), { recursive: true, force: true })

  for (const args of [['inbox'], ['inbox', '--json']]) {
    const missing = execFileSync(process.execPath, [CLI, ...args], {
      cwd: root,
      encoding: 'utf8',
    })

    if (args.includes('--json')) {
      assert.equal(missing.trim(), '[]')
    } else {
      assert.equal(missing, 'Inbox is empty.\n')
    }
  }

  mkdirSync(path.join(root, 'runtime', 'inbox'))

  for (const args of [['inbox'], ['inbox', '--json']]) {
    const empty = execFileSync(process.execPath, [CLI, ...args], {
      cwd: root,
      encoding: 'utf8',
    })

    if (args.includes('--json')) {
      assert.equal(empty.trim(), '[]')
    } else {
      assert.equal(empty, 'Inbox is empty.\n')
    }
  }
})

test('pan inbox does not mutate inbox items', () => {
  const root = createFixture()
  const firstTime = new Date('2024-04-01T09:00:00.000Z')
  const secondTime = new Date('2024-04-02T09:00:00.000Z')

  writeInboxFile(root, 'first.md', '# First\n', firstTime)
  writeInboxFile(root, 'second.md', '# Second\n', secondTime)

  const before = snapshotInbox(root)

  execFileSync(process.execPath, [CLI, 'inbox'], {
    cwd: root,
    encoding: 'utf8',
  })
  execFileSync(process.execPath, [CLI, 'inbox', '--json'], {
    cwd: root,
    encoding: 'utf8',
  })

  const after = snapshotInbox(root)

  assert.deepEqual(after, before)
})
