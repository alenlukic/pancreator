import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import type { InboxWorkStatus } from '../../src/lib/inbox.js'
import { createFixture } from '../fixture-template.js'
import { checkpoint } from './delivery-helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

function writeStatusFile(
  root: string,
  status: InboxWorkStatus,
  fileName: string,
  content: string,
  modifiedAt: Date,
): string {
  const relative = path.join('runtime', 'inbox', status, fileName)
  const filePath = path.join(root, relative)

  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
  utimesSync(filePath, modifiedAt, modifiedAt)

  return relative
}

function writeInboxFile(
  root: string,
  fileName: string,
  content: string,
  modifiedAt: Date,
): void {
  writeStatusFile(root, 'queue', fileName, content, modifiedAt)
}

/** Run the CLI without throwing, so a refusal can be read from its output. */
function run(
  root: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    encoding: 'utf8',
  })

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  }
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
    status: string
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
    'status',
  ])
})

// HR3-012: the listing read the queue directory alone, so an operator who
// wanted to see an active, canceled, or completed item read the directories
// by hand.
test('pan inbox lists an item of every lifecycle status with its status', () => {
  const root = createFixture()
  const modifiedAt = new Date('2024-05-05T12:00:00.000Z')

  for (const status of ['queue', 'active', 'canceled', 'complete'] as const) {
    writeStatusFile(
      root,
      status,
      `${status}-item.md`,
      `# ${status} item\n`,
      modifiedAt,
    )
  }

  const listed = run(root, ['inbox'])

  assert.equal(listed.status, 0, listed.stderr)

  const rows = listed.stdout.trim().split('\n')

  assert.equal(rows[0], 'STATUS\tFILE\tTITLE\tMODIFIED\tRUN')
  assert.deepEqual(rows.slice(1), [
    `queue\tqueue-item.md\tqueue item\t${modifiedAt.toISOString()}\t-`,
    `active\tactive-item.md\tactive item\t${modifiedAt.toISOString()}\t-`,
    `canceled\tcanceled-item.md\tcanceled item\t${modifiedAt.toISOString()}\t-`,
    `complete\tcomplete-item.md\tcomplete item\t${modifiedAt.toISOString()}\t-`,
  ])
})

// HR3-015: every automated restore assertion called restoreInboxRequest
// directly, so nothing held the command surface the operator actually runs.
test('pan inbox restore returns a canceled item and refuses a completed one', () => {
  const root = createFixture()
  const modifiedAt = new Date('2024-06-06T12:00:00.000Z')
  const canceled = writeStatusFile(
    root,
    'canceled',
    'canceled-intake.md',
    '# Canceled intake\n',
    modifiedAt,
  )
  const complete = writeStatusFile(
    root,
    'complete',
    'complete-intake.md',
    '# Complete intake\n',
    modifiedAt,
  )

  const restored = run(root, ['inbox', 'restore', canceled])

  assert.equal(restored.status, 0, restored.stderr)

  const payload = JSON.parse(restored.stdout) as {
    status: string
    from: string
    to: string
    detached_run_id: string | null
    next_command: string
  }

  assert.equal(payload.status, 'restored')
  assert.equal(payload.from, 'runtime/inbox/canceled/canceled-intake.md')
  // The printed destination is the queue path, and the file is really there.
  assert.equal(payload.to, 'runtime/inbox/queue/canceled-intake.md')
  assert.equal(payload.detached_run_id, null)
  assert.match(payload.next_command, /init --request runtime\/inbox\/queue\//u)
  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/queue/canceled-intake.md')),
    true,
  )
  assert.equal(existsSync(path.join(root, canceled)), false)

  const refused = run(root, ['inbox', 'restore', complete])

  assert.notEqual(refused.status, 0)
  assert.equal(
    (JSON.parse(refused.stderr) as { error: string }).error,
    'INVALID_INBOX_TRANSITION',
  )
  // History stays where it is.
  assert.equal(existsSync(path.join(root, complete)), true)
})

// HR3-015: the shared `--worktree` option on the decision and cohort routing
// commands was held by a help-text match alone, so nothing proved the option
// reached the router. These cases share this file with the restore surface
// because both close the same command-surface gap (US-027).
test('pan decide binds the routed delivery run to the named worktree', () => {
  const { root, runId } = checkpoint('planning@plan-awaiting-operator')
  const created = run(root, ['worktree', 'create', 'decide-target', '--json'])

  assert.equal(created.status, 0, created.stderr)

  const decided = run(root, [
    'decide',
    runId,
    'approve',
    '--note',
    'Ratified.',
    '--worktree',
    'decide-target',
    '--json',
  ])

  assert.equal(decided.status, 0, decided.stderr)

  const payload = JSON.parse(decided.stdout) as {
    autostart?: { status: string; worktree?: string }
  }

  assert.equal(payload.autostart?.status, 'started', decided.stdout)
  assert.match(payload.autostart?.worktree ?? '', /decide-target/u)
})

test('pan cohort route binds the routed delivery run to the named worktree', () => {
  const { root, runId } = checkpoint('planning@plan-awaiting-operator')
  const statePath = path.join(
    root,
    'runtime/logs/workflows',
    runId,
    'agent/state.json',
  )
  const state = JSON.parse(readFileSync(statePath, 'utf8')) as Record<
    string,
    unknown
  >

  // A planning run that predates routing records no opt-in, so the approval
  // routes nothing and the operator command is the only way in.
  delete state.autostart_delivery
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)

  const created = run(root, ['worktree', 'create', 'route-target', '--json'])

  assert.equal(created.status, 0, created.stderr)

  const decided = run(root, ['decide', runId, 'approve'])

  assert.equal(decided.status, 0, decided.stderr)

  const routed = run(root, [
    'cohort',
    'route',
    '--plan-run',
    runId,
    '--worktree',
    'route-target',
    '--json',
  ])

  assert.equal(routed.status, 0, routed.stderr)

  const payload = JSON.parse(routed.stdout) as {
    status: string
    worktree?: string
  }

  assert.equal(payload.status, 'started', routed.stdout)
  assert.match(payload.worktree ?? '', /route-target/u)
})
