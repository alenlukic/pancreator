import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  archiveInboxRequest,
  claimInboxRequest,
  finishInboxRequest,
  migrateLegacyInboxLayout,
  restoreInboxRequest,
  rollbackInboxClaim,
  listInbox,
  renderInbox,
} from '../../src/lib/inbox.js'
import { PanError } from '../../src/lib/errors.js'
import { makeWorkflowRunId } from '../../src/lib/naming.js'
import { eventPath } from '../../src/lib/state.js'
import { maintainWorkflowRuntime } from '../../src/lib/workflow-artifacts.js'
import { createFixture } from '../fixture-template.js'
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

// claimInboxRequest, finishInboxRequest, and rollbackInboxClaim move files
// inside runtime/inbox/ and read nothing else, so these cases take a bare
// scratch root rather than a clone of the harness fixture template.
function inboxRoot(): string {
  return createTestTempDirectory('pancreator-inbox-unit-')
}

test('listInbox includes every regular file and ignores nested directories', () => {
  const root = createTestTempDirectory('pancreator-inbox-unit-')
  const oldest = new Date('2024-01-01T12:00:00.000Z')
  const middle = new Date('2024-01-02T12:00:00.000Z')
  const newest = new Date('2024-01-03T12:00:00.000Z')

  try {
    assert.deepEqual(
      listInbox(root),
      [],
      'a root without a queue directory lists nothing',
    )

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
      [
        'newest.md',
        'notes.txt',
        'middle.md',
        'alpha.md',
        'oldest.md',
        'zebra.md',
      ],
    )
    assert.deepEqual(
      items.map((item) => item.title),
      ['Newest', 'notes.txt', 'Middle', 'A', 'Oldest', 'Z'],
    )
    assert.equal(items[0]?.modified_at, newest.toISOString())
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('listInbox reports invalid UTF-8 without mutating any inbox file', () => {
  const root = inboxRoot()
  const files = [
    ['queue', 'plain.txt', Buffer.from('plain text without a heading\n')],
    ['active', 'invalid.bin', Buffer.from([0xc3, 0x28])],
    ['canceled', 'request.md', Buffer.from('# Canceled request\n')],
    ['complete', 'result.data', Buffer.from('complete\n')],
  ] as const

  for (const [status, fileName, content] of files) {
    const target = path.join(root, 'runtime/inbox', status, fileName)

    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
  }

  const nested = path.join(root, 'runtime/inbox/queue/nested/ignored.txt')

  mkdirSync(path.dirname(nested), { recursive: true })
  writeFileSync(nested, 'nested\n', 'utf8')

  const snapshot = (target: string) => {
    const content = readFileSync(target)
    const stat = statSync(target)

    return {
      content,
      sha256: createHash('sha256').update(content).digest('hex'),
      stat: {
        mode: stat.mode,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      },
    }
  }
  const before = new Map(
    files.map(([status, fileName]) => {
      const target = path.join(root, 'runtime/inbox', status, fileName)

      return [target, snapshot(target)] as const
    }),
  )
  const items = listInbox(root)

  assert.deepEqual(
    items.map((item) => [item.status, item.file_name]),
    [
      ['queue', 'plain.txt'],
      ['active', 'invalid.bin'],
      ['canceled', 'request.md'],
      ['complete', 'result.data'],
    ],
  )
  assert.equal(
    items.find((item) => item.file_name === 'plain.txt')?.title,
    'plain.txt',
  )
  assert.equal(
    items.find((item) => item.file_name === 'plain.txt')?.reason,
    undefined,
  )

  const invalid = items.find((item) => item.file_name === 'invalid.bin')

  assert.equal(invalid?.title, 'invalid.bin')
  assert.ok((invalid?.reason?.length ?? 0) > 0)
  assert.equal(
    items.some((item) => item.file_name === 'ignored.txt'),
    false,
  )

  for (const [target, prior] of before) {
    assert.deepEqual(snapshot(target), prior)
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

test('finishInboxRequest moves active items to complete or canceled', () => {
  const root = inboxRoot()
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
  const root = inboxRoot()
  const originalPaths = [
    'runtime/inbox/queue/queued-rollback.md',
    'runtime/inbox/canceled/canceled-rollback.md',
    'runtime/inbox/legacy-rollback.md',
  ]

  for (const originalPath of originalPaths) {
    const absolute = path.join(root, originalPath)
    const content = `# ${path.basename(originalPath)}\n`

    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, content, 'utf8')

    const activePath = claimInboxRequest(root, originalPath)

    // A claim lands under active/ under the source file's own name and copies
    // the bytes through untouched, whichever directory it came from.
    assert.equal(
      activePath,
      `runtime/inbox/active/${path.basename(originalPath)}`,
    )
    assert.equal(existsSync(absolute), false)
    assert.equal(readFileSync(path.join(root, activePath), 'utf8'), content)

    const restored = rollbackInboxClaim(root, activePath, originalPath)

    assert.equal(restored, originalPath)
    assert.equal(existsSync(absolute), true)
    assert.equal(existsSync(path.join(root, activePath)), false)
  }
})

test('finishInboxRequest recovers a missing active item from stored evidence', () => {
  const root = inboxRoot()
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
  const root = inboxRoot()
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
  const root = inboxRoot()
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
  const legacyTextPath = path.join(root, 'runtime/inbox/legacy-notes.txt')
  const finderArtifactPath = path.join(root, 'runtime/inbox/.DS_Store')
  const archivePath = path.join(root, 'runtime/inbox/archive/preserved.md')

  mkdirSync(path.dirname(legacyPath), { recursive: true })
  writeFileSync(legacyPath, '# Unlinked\n', 'utf8')
  writeFileSync(legacyTextPath, 'Unlinked text\n', 'utf8')
  writeFileSync(finderArtifactPath, Buffer.from([0, 0, 0, 1, 0x42, 0x75]))

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

  assert.equal(summary.migrated_files, 5)
  assert.equal(summary.updated_runs, 3)
  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/queue/legacy-unlinked.md')),
    true,
  )
  assert.equal(
    readFileSync(
      path.join(root, 'runtime/inbox/queue/legacy-notes.txt'),
      'utf8',
    ),
    'Unlinked text\n',
  )
  // A dot-prefixed host artifact is not a request. The sweep leaves it in
  // place rather than queueing it as one the operator never wrote.
  assert.equal(existsSync(finderArtifactPath), true)
  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/queue/.DS_Store')),
    false,
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

test('renderInbox writes a stable table and names an empty inbox', () => {
  assert.equal(renderInbox([]), 'Inbox is empty.\n')
  assert.equal(
    renderInbox([
      {
        file_name: 'newest.md',
        title: 'Newest',
        modified_at: '2024-03-03T12:00:00.000Z',
        run_id: '10000_Mar-03-1200_inbox',
        status: 'queue',
      },
      {
        file_name: 'heading-free.md',
        title: 'heading-free.md',
        modified_at: '2024-02-02T10:00:00.000Z',
        run_id: null,
        status: 'complete',
        reason: 'invalid UTF-8',
      },
    ]),
    [
      'STATUS\tFILE\tTITLE\tMODIFIED\tRUN\tREASON',
      'queue\tnewest.md\tNewest\t2024-03-03T12:00:00.000Z\t10000_Mar-03-1200_inbox\t-',
      'complete\theading-free.md\theading-free.md\t2024-02-02T10:00:00.000Z\t-\tinvalid UTF-8',
      '',
    ].join('\n'),
  )
})

// The ordering inside maintainWorkflowRuntime is the contract: the legacy
// layout migrates before the archive pass, so one call moves the file into
// its status directory and then archives it.
test('runtime maintenance migrates a legacy complete item before archiving it', () => {
  const root = inboxRoot()
  const runId = '63309_Aug-31-0403_complete-item'
  const runDirectory = path.join(root, 'runtime/logs/workflows', runId)

  const legacyAbsolute = path.join(root, 'runtime/inbox/legacy-complete.md')
  const stale = new Date('2026-06-22T21:22:54.051Z')

  writeFileSync(path.join(root, 'config.json'), '{"schema_version":1}\n')
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
      run_id: runId,
      workflow_slug: 'delivery',
      title: 'Legacy inbox fixture',
      status: 'succeeded',
      pending_action: { type: 'none' },
      current_stage: null,
      current_invocation: null,
      request: {
        source_path: 'runtime/inbox/legacy-complete.md',
        stored_path: `runtime/logs/workflows/${runId}/operator/request.md`,
        sha256: 'abc',
      },
      workflow_snapshot: {
        path: `runtime/logs/workflows/${runId}/workflow.snapshot.json`,
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
      created_at: '2026-06-22T21:22:54.051Z',
      updated_at: '2026-06-22T21:22:54.051Z',
    })}\n`,
    'utf8',
  )
  mkdirSync(path.dirname(legacyAbsolute), { recursive: true })
  writeFileSync(legacyAbsolute, '# Legacy complete\n', 'utf8')
  utimesSync(legacyAbsolute, stale, stale)

  const summary = maintainWorkflowRuntime(root, { retentionDays: 7 })
  const archivedName = summary.archive.inbox_files[0]

  assert.equal(summary.inbox_layout.migrated_files, 1)
  assert.equal(summary.archive.inbox_files.length, 1)
  assert.ok(archivedName)
  assert.equal(existsSync(legacyAbsolute), false)
  assert.equal(
    readFileSync(
      path.join(root, 'runtime/inbox/archive', archivedName),
      'utf8',
    ),
    '# Legacy complete\n',
  )
})

test('runtime maintenance migrates and archives old workflow directories', () => {
  const root = inboxRoot()
  const legacyRunId = '20200101T120000000Z-abcdef12'
  const createdAt = new Date('2020-01-01T12:00:00.000Z')
  const currentRunId = makeWorkflowRunId(createdAt, 'old-fixture')

  const logDirectory = path.join(root, 'runtime/logs/workflows', legacyRunId)
  const stateDirectory = path.join(root, 'runtime/workflows', legacyRunId)

  const write = (target: string, content: string): void => {
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }

  writeFileSync(path.join(root, 'config.json'), '{"schema_version":1}\n')
  write(
    path.join(logDirectory, 'state.json'),
    `${JSON.stringify({
      schema_version: 1,
      run_id: legacyRunId,
      workflow_slug: 'delivery',
      title: 'old fixture',
      status: 'succeeded',
      pending_action: { type: 'none' },
      stage_history: [],
      attempts: {},
      created_at: createdAt.toISOString(),
    })}\n`,
  )
  write(
    path.join(logDirectory, 'workflow.snapshot.json'),
    '{"stages":[{"slug":"plan"}]}\n',
  )
  write(path.join(logDirectory, 'events.jsonl'), '')
  write(
    path.join(stateDirectory, 'modifications.jsonl'),
    `${JSON.stringify({ run_id: legacyRunId })}\n`,
  )

  const summary = maintainWorkflowRuntime(root, { retentionDays: 7 })

  assert.equal(summary.migration.run_directories, 1)
  assert.equal(summary.migration.state_directories, 1)
  assert.equal(summary.archive.run_directories, 1)
  assert.equal(summary.archive.state_directories, 1)
  assert.deepEqual(summary.archive.run_ids, [currentRunId])
  assert.equal(
    existsSync(
      path.join(
        root,
        'runtime/logs/workflows/archive',
        currentRunId,
        'state.json',
      ),
    ),
    true,
  )
  assert.equal(
    existsSync(
      path.join(
        root,
        'runtime/workflows/archive',
        currentRunId,
        'modifications.jsonl',
      ),
    ),
    true,
  )
})

function writeRunWithInboxSource(
  root: string,
  runId: string,
  sourcePath: string,
): void {
  const runDirectory = path.join(root, 'runtime/logs/workflows', runId)

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
      run_id: runId,
      workflow_slug: 'delivery',
      title: runId,
      status: 'running',
      pending_action: { type: 'prepare_invocation' },
      current_stage: 'implement',
      current_invocation: null,
      request: {
        source_path: sourcePath,
        stored_path: `runtime/logs/workflows/${runId}/operator/request.md`,
        sha256: 'abc',
      },
      workflow_snapshot: {
        path: `runtime/logs/workflows/${runId}/workflow.snapshot.json`,
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
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T01:00:00.000Z',
    })}\n`,
    'utf8',
  )
}

// AC-007. `claimInboxRequest` already accepts a canceled item, so the reverse
// edge was a supported state with no command: the only route was a manual
// file move that left the operator's decision unrecorded.
// AC-007. The criterion asks for the move to be recorded as an inbox event,
// and a run's event stream is the only audit surface an inbox move has. Only
// the active path wrote one, so the canceled restore — the common case, since
// an aborted run is what puts an item in `canceled/` — left the operator's
// decision unrecorded exactly as the manual file move did.
test('restoreInboxRequest records a canceled restore on the run that held it', () => {
  const root = createFixture()
  const runId = '63400_Sep-01-0200_canceled-item'
  const canceled = 'runtime/inbox/canceled/reopen.md'
  const absolute = path.join(root, canceled)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, '# Reopen\n', 'utf8')
  writeRunWithInboxSource(root, runId, canceled)

  const result = restoreInboxRequest(root, canceled)

  // A canceled item's run released it before the restore, so nothing detaches.
  assert.equal(result.detached_run_id, null)

  const events = readFileSync(eventPath(root, runId), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map(
      (line) =>
        JSON.parse(line) as { type: string; from?: string; to?: string },
    )
  const restored = events.filter(
    (event) => event.type === 'inbox_request_restored',
  )

  assert.equal(restored.length, 1)
  assert.equal(restored[0]?.from, canceled)
  assert.equal(restored[0]?.to, result.to)

  // The run is repointed at its own stored copy, so the quoted request path
  // still resolves once the file has moved back to the queue.
  const state = JSON.parse(
    readFileSync(
      path.join(root, 'runtime/logs/workflows', runId, 'agent/state.json'),
      'utf8',
    ),
  ) as { request: { source_path: string; stored_path: string } }

  assert.equal(state.request.source_path, state.request.stored_path)
})

// AC-008. The run keeps its own stored copy of the request, so repointing it
// there costs the run nothing and leaves the queued item free to be claimed
// again.
test('restoreInboxRequest detaches the run that holds an active item', () => {
  const root = createFixture()
  const runId = '63400_Sep-01-0100_active-item'
  const active = 'runtime/inbox/active/held.md'
  const absolute = path.join(root, active)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, '# Held\n', 'utf8')
  writeRunWithInboxSource(root, runId, active)

  const result = restoreInboxRequest(root, active)

  assert.equal(result.to, 'runtime/inbox/queue/held.md')
  assert.equal(result.detached_run_id, runId)

  const state = JSON.parse(
    readFileSync(
      path.join(root, 'runtime/logs/workflows', runId, 'agent/state.json'),
      'utf8',
    ),
  ) as { request: { source_path: string; stored_path: string } }

  assert.equal(state.request.source_path, state.request.stored_path)
})

test('restoreInboxRequest refuses a completed and an already-queued item', () => {
  const root = inboxRoot()

  for (const [status, code] of [
    ['complete', 'INVALID_INBOX_TRANSITION'],
    ['queue', 'INVALID_INBOX_TRANSITION'],
  ] as const) {
    const relative = `runtime/inbox/${status}/settled.md`
    const absolute = path.join(root, relative)

    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, '# Settled\n', 'utf8')

    assert.throws(
      () => restoreInboxRequest(root, relative),
      (error: unknown) =>
        error instanceof PanError &&
        error.code === code &&
        // The refusal says which status blocked it, so the operator does not
        // have to look the item up to learn why.
        error.message.includes(
          status === 'queue' ? 'already in the queue' : status,
        ),
      status,
    )
    assert.equal(existsSync(absolute), true)
  }
})

test('archiveInboxRequest moves terminal work safely and refuses live history', () => {
  const root = inboxRoot()
  const permitted = [
    'runtime/inbox/queue/queued.md',
    'runtime/inbox/complete/completed.md',
    'runtime/inbox/canceled/canceled.md',
    'runtime/inbox/legacy.md',
  ]

  for (const relative of permitted) {
    const absolute = path.join(root, relative)

    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, `# ${path.basename(relative)}\n`, 'utf8')

    const archived = archiveInboxRequest(root, relative)

    assert.equal(archived.from, relative)
    assert.match(archived.to, /^runtime\/inbox\/archive\//u)
    assert.equal(existsSync(absolute), false)
    assert.equal(existsSync(path.join(root, archived.to)), true)
  }

  const queueCollision = 'runtime/inbox/queue/collision.md'
  const completeCollision = 'runtime/inbox/complete/collision.md'

  for (const relative of [queueCollision, completeCollision]) {
    const absolute = path.join(root, relative)

    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, '# Collision\n', 'utf8')
  }

  assert.equal(
    archiveInboxRequest(root, queueCollision).to,
    'runtime/inbox/archive/collision.md',
  )
  assert.equal(
    archiveInboxRequest(root, completeCollision).to,
    'runtime/inbox/archive/collision-2.md',
  )

  const active = 'runtime/inbox/active/live.md'
  const activeAbsolute = path.join(root, active)

  mkdirSync(path.dirname(activeAbsolute), { recursive: true })
  writeFileSync(activeAbsolute, '# Live\n', 'utf8')

  for (const relative of [active, 'runtime/inbox/archive/collision.md']) {
    assert.throws(
      () => archiveInboxRequest(root, relative),
      (error: unknown) =>
        error instanceof PanError && error.code === 'INVALID_INBOX_TRANSITION',
      relative,
    )
    assert.equal(existsSync(path.join(root, relative)), true)
  }
})
