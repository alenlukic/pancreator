import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  claimInboxRequest,
  finishInboxRequest,
  migrateLegacyInboxLayout,
  rollbackInboxClaim,
  listInbox,
} from '../../src/lib/inbox.js'
import { PanError } from '../../src/lib/errors.js'
import { makeWorkflowRunId } from '../../src/lib/naming.js'
import { createFixture } from '../helpers.js'
import { createTestTempDirectory } from '../temp.js'

function writeInboxFile(
  root: string,
  relativePath: string,
  content: string,
  modifiedAt: Date,
): void {
  const filePath = path.join(root, 'runtime', 'inbox', 'queue', relativePath)

  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
  utimesSync(filePath, modifiedAt, modifiedAt)
}

test('listInbox ignores nested directories and non-Markdown files', () => {
  const root = createTestTempDirectory('pancreator-inbox-unit-')
  const oldest = new Date('2024-01-01T12:00:00.000Z')
  const middle = new Date('2024-01-02T12:00:00.000Z')
  const newest = new Date('2024-01-03T12:00:00.000Z')

  try {
    writeInboxFile(root, 'oldest.md', '# Oldest\n', oldest)
    writeInboxFile(root, 'middle.md', '# Middle\n', middle)
    writeInboxFile(root, 'newest.md', '# Newest\n', newest)
    writeInboxFile(root, 'notes.txt', 'ignore me\n', newest)
    writeInboxFile(root, 'nested/deep.md', '# Nested\n', newest)
    // Two files share the oldest mtime, so the file name breaks the tie.
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
    assert.equal(items[0]?.modified_at, newest.toISOString())
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('listInbox selects the first valid level-one heading and falls back to the file name', () => {
  const root = createTestTempDirectory('pancreator-inbox-unit-')
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
  const root = createTestTempDirectory('pancreator-inbox-unit-')
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
  const root = createTestTempDirectory('pancreator-inbox-unit-')
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
  const root = createTestTempDirectory('pancreator-inbox-unit-')

  try {
    assert.deepEqual(listInbox(root), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('claimInboxRequest moves queue items to active without changing bytes', () => {
  const root = createFixture()
  const content = '# Claim me\n'
  const queuePath = path.join(root, 'runtime/inbox/queue/queued.md')

  mkdirSync(path.dirname(queuePath), { recursive: true })
  writeFileSync(queuePath, content, 'utf8')

  const activePath = claimInboxRequest(root, 'runtime/inbox/queue/queued.md')

  assert.equal(activePath, 'runtime/inbox/active/queued.md')
  assert.equal(existsSync(queuePath), false)
  assert.equal(readFileSync(path.join(root, activePath), 'utf8'), content)
})

test('finishInboxRequest moves active items to complete or canceled', () => {
  const root = createFixture()
  const content = '# Finish me\n'
  const activePath = path.join(root, 'runtime/inbox/active/finish.md')

  mkdirSync(path.dirname(activePath), { recursive: true })
  writeFileSync(activePath, content, 'utf8')

  const completePath = finishInboxRequest(
    root,
    'runtime/inbox/active/finish.md',
    'complete',
  )

  assert.equal(completePath, 'runtime/inbox/complete/finish.md')
  assert.equal(existsSync(activePath), false)

  writeFileSync(activePath, content, 'utf8')
  const canceledPath = finishInboxRequest(
    root,
    'runtime/inbox/active/finish.md',
    'canceled',
  )

  assert.equal(canceledPath, 'runtime/inbox/canceled/finish.md')
})

test('rollbackInboxClaim restores queue canceled and legacy paths', () => {
  const root = createFixture()
  const originalPaths = [
    'runtime/inbox/queue/queued-rollback.md',
    'runtime/inbox/canceled/canceled-rollback.md',
    'runtime/inbox/legacy-rollback.md',
  ]

  for (const originalPath of originalPaths) {
    const absolute = path.join(root, originalPath)

    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, `# ${path.basename(originalPath)}\n`, 'utf8')

    const activePath = claimInboxRequest(root, originalPath)
    const restored = rollbackInboxClaim(root, activePath, originalPath)

    assert.equal(restored, originalPath)
    assert.equal(existsSync(absolute), true)
    assert.equal(existsSync(path.join(root, activePath)), false)
  }
})

test('finishInboxRequest recovers a missing active item from stored evidence', () => {
  const root = createFixture()
  const storedPath = 'runtime/logs/workflows/run/operator/request.md'
  const storedAbsolute = path.join(root, storedPath)

  mkdirSync(path.dirname(storedAbsolute), { recursive: true })
  writeFileSync(storedAbsolute, '# Durable request\n', 'utf8')

  const canceledPath = finishInboxRequest(
    root,
    'runtime/inbox/active/missing.md',
    'canceled',
    storedPath,
  )

  assert.equal(canceledPath, 'runtime/inbox/canceled/missing.md')
  assert.equal(
    readFileSync(path.join(root, canceledPath ?? ''), 'utf8'),
    '# Durable request\n',
  )
})

test('inbox moves fail before overwrite when the target already exists', () => {
  const root = createFixture()
  const queueDirectory = path.join(root, 'runtime/inbox/queue')
  const activeDirectory = path.join(root, 'runtime/inbox/active')

  mkdirSync(queueDirectory, { recursive: true })
  mkdirSync(activeDirectory, { recursive: true })
  writeFileSync(path.join(queueDirectory, 'collision.md'), '# Queue\n', 'utf8')
  writeFileSync(
    path.join(activeDirectory, 'collision.md'),
    '# Active\n',
    'utf8',
  )

  assert.throws(
    () => claimInboxRequest(root, 'runtime/inbox/queue/collision.md'),
    (error: unknown) =>
      error instanceof PanError && error.code === 'INBOX_MOVE_COLLISION',
  )
})

test('a finished request takes a suffixed name when history holds its name', () => {
  // One intake file can be run more than once. The second run must still
  // finish, and history keeps both copies untouched.
  const root = createFixture()
  const activeDirectory = path.join(root, 'runtime/inbox/active')
  const completeDirectory = path.join(root, 'runtime/inbox/complete')

  mkdirSync(activeDirectory, { recursive: true })
  mkdirSync(completeDirectory, { recursive: true })
  writeFileSync(path.join(completeDirectory, 'drill.md'), '# First\n', 'utf8')
  writeFileSync(
    path.join(completeDirectory, 'drill-2.md'),
    '# Second\n',
    'utf8',
  )
  writeFileSync(path.join(activeDirectory, 'drill.md'), '# Third\n', 'utf8')

  const completed = finishInboxRequest(
    root,
    'runtime/inbox/active/drill.md',
    'complete',
  )

  assert.equal(completed, 'runtime/inbox/complete/drill-3.md')
  assert.equal(
    readFileSync(path.join(completeDirectory, 'drill.md'), 'utf8'),
    '# First\n',
  )
  assert.equal(
    readFileSync(path.join(completeDirectory, 'drill-3.md'), 'utf8'),
    '# Third\n',
  )
  assert.equal(existsSync(path.join(activeDirectory, 'drill.md')), false)
})

test('migrates legacy inbox layout into status directories', () => {
  const root = createFixture()
  const legacyPath = path.join(root, 'runtime/inbox/legacy-unlinked.md')
  const archivePath = path.join(root, 'runtime/inbox/archive/preserved.md')

  mkdirSync(path.dirname(legacyPath), { recursive: true })
  writeFileSync(legacyPath, '# Unlinked\n', 'utf8')

  mkdirSync(path.dirname(archivePath), { recursive: true })
  writeFileSync(archivePath, '# Preserved\n', 'utf8')

  const linkedCases = [
    {
      runId: '63311_Aug-29-0403_active-item',
      fileName: 'legacy-active.md',
      runStatus: 'failed',
      inboxStatus: 'active',
    },
    {
      runId: '63310_Aug-30-0403_canceled-item',
      fileName: 'legacy-canceled.md',
      runStatus: 'canceled',
      inboxStatus: 'canceled',
    },
    {
      runId: '63309_Aug-31-0403_complete-item',
      fileName: 'legacy-complete.md',
      runStatus: 'succeeded',
      inboxStatus: 'complete',
    },
  ] as const

  for (const item of linkedCases) {
    const linkedPath = path.join(root, 'runtime/inbox', item.fileName)
    const runDirectory = path.join(root, 'runtime/logs/workflows', item.runId)

    writeFileSync(linkedPath, `# ${item.fileName}\n`, 'utf8')
    mkdirSync(path.join(runDirectory, 'agent'), { recursive: true })
    writeFileSync(
      path.join(runDirectory, 'workflow.snapshot.json'),
      '{"stages":[{"slug":"plan"}]}\n',
      'utf8',
    )
    writeFileSync(
      path.join(runDirectory, 'agent', 'state.json'),
      `${JSON.stringify({
        schema_version: 2,
        run_id: item.runId,
        workflow_slug: 'delivery',
        title: item.fileName,
        status: item.runStatus,
        pending_action: { type: 'none' },
        current_stage: null,
        current_invocation: null,
        request: {
          source_path: `runtime/inbox/${item.fileName}`,
          stored_path: `runtime/logs/workflows/${item.runId}/operator/request.md`,
          sha256: 'abc',
        },
        workflow_snapshot: {
          path: `runtime/logs/workflows/${item.runId}/workflow.snapshot.json`,
          sha256: 'def',
        },
        pipeline_config: null,
        limits: {
          max_stage_attempts: 3,
          max_total_transitions: 30,
          max_consecutive_failures: 3,
        },
        attempts: {},
        transition_count: 0,
        consecutive_failures: 0,
        stage_history: [],
        revision: 0,
        created_at: '2026-08-29T00:00:00.000Z',
        updated_at: '2026-08-29T01:00:00.000Z',
      })}\n`,
      'utf8',
    )
  }

  const requestlessRunDirectory = path.join(
    root,
    'runtime/logs/workflows/legacy-run',
  )

  mkdirSync(requestlessRunDirectory, { recursive: true })
  writeFileSync(
    path.join(requestlessRunDirectory, 'state.json'),
    `${JSON.stringify({
      schema_version: 1,
      run_id: 'legacy-run',
      workflow_slug: 'dev',
      title: 'legacy run',
      status: 'succeeded',
      pending_action: { type: 'none' },
      stage_history: [],
      attempts: {},
      created_at: '2026-06-22T21:22:54.051Z',
      updated_at: '2026-06-22T21:22:54.051Z',
    })}\n`,
    'utf8',
  )

  const summary = migrateLegacyInboxLayout(root)

  assert.equal(summary.migrated_files, 4)
  assert.equal(summary.updated_runs, 3)
  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/queue/legacy-unlinked.md')),
    true,
  )

  for (const item of linkedCases) {
    const migratedPath = path.join(
      root,
      'runtime/inbox',
      item.inboxStatus,
      item.fileName,
    )
    const statePath = path.join(
      root,
      'runtime/logs/workflows',
      item.runId,
      'agent/state.json',
    )

    assert.equal(existsSync(migratedPath), true)
    assert.match(
      readFileSync(statePath, 'utf8'),
      new RegExp(`runtime/inbox/${item.inboxStatus}/${item.fileName}`, 'u'),
    )
  }

  assert.equal(readFileSync(archivePath, 'utf8'), '# Preserved\n')

  for (const status of ['queue', 'active', 'canceled', 'complete', 'archive']) {
    assert.equal(existsSync(path.join(root, 'runtime/inbox', status)), true)
  }
})
