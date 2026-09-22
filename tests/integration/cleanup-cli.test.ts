import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  CLEANUP_ARTIFACT_CLASSES,
  applyCleanup,
  planCleanup,
} from '../../src/lib/cleanup.js'
import type { CleanupAction, CleanupSkip } from '../../src/lib/cleanup.js'
import { makeWorkflowRunId, temporalNamePrefix } from '../../src/lib/naming.js'
import { statePath } from '../../src/lib/state.js'
import {
  createWorktree,
  readWorktreeIndex,
  writeWorktreeIndex,
} from '../../src/lib/worktrees.js'
import { createFixture, writeJson } from '../helpers.js'
import { checkpoint } from './delivery-helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')
const DAY_MS = 24 * 60 * 60 * 1_000

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function runCleanup(
  root: string,
  args: string[],
): { status: number | null; result: Record<string, unknown> } {
  const child = spawnSync(
    process.execPath,
    [CLI, 'cleanup', ...args, '--json'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )

  assert.equal(child.status, 0, child.stderr)

  return {
    status: child.status,
    result: JSON.parse(child.stdout) as Record<string, unknown>,
  }
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS)
}

function readConfig(root: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.join(root, 'config.json'), 'utf8'),
  ) as Record<string, unknown>
}

function writeFile(target: string, contents: string, at?: Date): void {
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, contents)

  if (at) {
    utimesSync(target, at, at)
  }
}

function writeDirectory(target: string, at?: Date): void {
  mkdirSync(target, { recursive: true })
  writeFileSync(path.join(target, 'record.json'), '{}\n')

  if (at) {
    utimesSync(target, at, at)
  }
}

/** Every path under `runtime/`, so a report-only run can be compared. */
function listRuntime(root: string): string[] {
  return readdirSync(path.join(root, 'runtime'), { recursive: true })
    .map((entry) => String(entry))
    .sort()
}

function actions(result: Record<string, unknown>): CleanupAction[] {
  return result.actions as CleanupAction[]
}

function deletedPaths(result: Record<string, unknown>): Set<string> {
  return new Set(
    actions(result)
      .filter((entry) => entry.action === 'delete')
      .map((entry) => entry.path),
  )
}

function readState(root: string, runId: string): Record<string, unknown> {
  return JSON.parse(readFileSync(statePath(root, runId), 'utf8')) as Record<
    string,
    unknown
  >
}

/**
 * A second run record beside the checkpoint's run: the fixture template
 * drives one run, and inbox reconciliation and worktree liveness need several
 * run states at once.
 */
function cloneRun(
  root: string,
  sourceRunId: string,
  suffix: string,
  mutate: (state: Record<string, unknown>) => void,
  createdAt = new Date(),
): string {
  const runId = makeWorkflowRunId(createdAt, suffix)
  const workflows = path.join(root, 'runtime/logs/workflows')

  cpSync(path.join(workflows, sourceRunId), path.join(workflows, runId), {
    recursive: true,
  })

  const state = readState(root, runId)

  state.run_id = runId
  mutate(state)
  writeJson(statePath(root, runId), state)

  return runId
}

function ageWorktree(root: string, name: string): void {
  const index = readWorktreeIndex(root)
  const indexed = index.worktrees.find((entry) => entry.name === name)

  assert.ok(indexed)
  indexed.created_at = '2020-01-01T00:00:00.000Z'
  writeWorktreeIndex(root, index)
}

test('cleanup reconciles inbox and keeps branches', () => {
  const { root, runId } = checkpoint('delivery@created')
  const prefix = temporalNamePrefix(new Date())
  const inbox = (status: string, name: string): string =>
    path.join(root, 'runtime/inbox', status, name)

  // Item A: active, claimed by a succeeded run.
  const succeededName = `${prefix}_succeeded-request.md`

  writeFile(inbox('active', succeededName), '# Succeeded\n')

  const succeeded = readState(root, runId)

  succeeded.status = 'succeeded'
  ;(succeeded.request as Record<string, unknown>).source_path =
    `runtime/inbox/active/${succeededName}`
  writeJson(statePath(root, runId), succeeded)

  // Item B: active, claimed by an aborted run.
  const abortedName = `${prefix}_aborted-request.md`

  writeFile(inbox('active', abortedName), '# Aborted\n')
  cloneRun(root, runId, 'aborted', (state) => {
    state.status = 'canceled'
    ;(state.request as Record<string, unknown>).source_path =
      `runtime/inbox/active/${abortedName}`
  })

  // Item C: complete, claimed by nothing, which is how a finished request
  // looks once its run record has aged out. Item D: queued.
  const unclaimedName = `${prefix}_unclaimed-request.md`
  const queuedName = `${prefix}_queued-request.md`

  writeFile(inbox('complete', unclaimedName), '# Unclaimed\n')
  writeFile(inbox('queue', queuedName), '# Queued\n')

  // Four aged worktrees: clean and merged, clean and unmerged, dirty, and one
  // a non-terminal run names.
  const merged = createWorktree(root, 'cleanup-merged')
  const unmerged = createWorktree(root, 'cleanup-unmerged')
  const dirty = createWorktree(root, 'cleanup-dirty')
  const bound = createWorktree(root, 'cleanup-bound')

  const unmergedPath = path.join(root, unmerged.path)

  writeFileSync(path.join(unmergedPath, 'ahead.md'), 'ahead\n')
  git(unmergedPath, ['add', 'ahead.md'])
  git(unmergedPath, [
    '-c',
    'user.name=Cleanup',
    '-c',
    'user.email=cleanup@example.com',
    'commit',
    '-q',
    '-m',
    'ahead of default',
  ])
  writeFileSync(path.join(root, dirty.path, 'README.md'), 'edited\n')
  cloneRun(root, runId, 'bound', (state) => {
    state.status = 'running'
    ;(state.request as Record<string, unknown>).source_path =
      'runtime/inbox/queue/bound-request.md'
    state.managed_worktree = {
      name: bound.name,
      path: bound.path,
      branch: bound.branch,
    }
  })

  for (const worktree of [merged, unmerged, dirty, bound]) {
    ageWorktree(root, worktree.name)
  }

  const config = readConfig(root)

  config.retention = { default_days: 36500, classes: { worktrees: 1 } }
  writeJson(path.join(root, 'config.json'), config)

  const { result: dry } = runCleanup(root, [])
  const dryWorktrees = dry.worktrees as Array<{ name: string; action: string }>

  assert.equal(dry.status, 'planned')
  assert.equal(existsSync(inbox('active', succeededName)), true)
  assert.equal(existsSync(path.join(root, merged.path)), true)
  assert.equal(
    dryWorktrees.find((entry) => entry.name === merged.name)?.action,
    'remove',
    JSON.stringify(dryWorktrees),
  )
  assert.deepEqual(
    actions(dry)
      .filter((entry) => entry.action === 'relocate')
      .map((entry) => entry.path)
      .sort(),
    [
      `runtime/inbox/active/${abortedName}`,
      `runtime/inbox/active/${succeededName}`,
    ],
  )
  assert.match(
    (dry.skipped as CleanupSkip[]).find(
      (entry) => entry.path === `runtime/inbox/complete/${unclaimedName}`,
    )?.reason ?? '',
    /no run record claims/u,
  )

  const { result: applied } = runCleanup(root, ['--apply'])
  const branches = applied.branches as Array<{
    branch: string
    merged_into_default: boolean | null
  }>
  const skipped = applied.skipped as CleanupSkip[]
  const moves = applied.inbox_moves as Array<{ from: string; to: string }>

  assert.equal(applied.status, 'applied')
  assert.equal(existsSync(inbox('complete', succeededName)), true)
  assert.equal(existsSync(inbox('canceled', abortedName)), true)
  assert.equal(existsSync(inbox('complete', unclaimedName)), true)
  assert.equal(existsSync(inbox('queue', queuedName)), true)
  assert.equal(moves.length, 2)
  assert.ok(
    moves.some(
      (move) =>
        move.from === `runtime/inbox/active/${succeededName}` &&
        move.to === `runtime/inbox/complete/${succeededName}`,
    ),
  )

  assert.equal(existsSync(path.join(root, merged.path)), false)
  assert.equal(existsSync(path.join(root, unmerged.path)), false)
  assert.equal(existsSync(path.join(root, dirty.path)), true)
  assert.equal(existsSync(path.join(root, bound.path)), true)
  assert.match(
    skipped.find((entry) => entry.path === dirty.path)?.reason ?? '',
    /uncommitted work: README\.md/u,
  )
  assert.match(
    skipped.find((entry) => entry.path === bound.path)?.reason ?? '',
    /non-terminal run/u,
  )

  const remaining = readWorktreeIndex(root).worktrees.map((entry) => entry.name)

  assert.deepEqual(remaining.sort(), [bound.name, dirty.name].sort())
  assert.equal(
    branches.find((entry) => entry.branch === merged.branch)
      ?.merged_into_default,
    true,
  )
  assert.equal(
    branches.find((entry) => entry.branch === unmerged.branch)
      ?.merged_into_default,
    false,
  )

  for (const branch of [merged.branch, unmerged.branch]) {
    assert.match(
      git(root, ['branch', '--list', branch]),
      new RegExp(branch, 'u'),
    )
  }
})

test('cleanup report-only plan changes nothing and apply removes only expired artifacts', () => {
  const root = createFixture()
  const old = daysAgo(40)
  const recent = daysAgo(5)

  const oldPrefix = temporalNamePrefix(old)
  const recentPrefix = temporalNamePrefix(recent)

  const expired: string[] = []
  const kept: string[] = []

  const seed = (
    parentRelative: string,
    name: string,
    at: Date,
    into: string[],
  ): void => {
    const relative = `${parentRelative}/${name}`
    const absolute = path.join(root, relative)

    if (name.endsWith('.md') || name.endsWith('.json')) {
      writeFile(absolute, `${name}\n`, at)
    } else {
      writeDirectory(absolute, at)
    }

    into.push(relative)
  }

  for (const artifactClass of CLEANUP_ARTIFACT_CLASSES) {
    if (
      artifactClass.disposal === 'retain' ||
      artifactClass.disposal === 'remove_worktree'
    ) {
      continue
    }

    for (const parentRelative of artifactClass.paths) {
      if (parentRelative === 'runtime/cache/output-validate') {
        writeDirectory(path.join(root, parentRelative), old)
        expired.push(parentRelative)
        continue
      }

      const temporal = artifactClass.age_source === 'temporal_name'
      const extension =
        parentRelative.startsWith('runtime/inbox') ||
        parentRelative === 'runtime/research' ||
        parentRelative === 'runtime/pr-descriptions'
          ? '.md'
          : parentRelative === 'runtime/benchmarks' ||
              parentRelative.startsWith('runtime/tmp')
            ? '.json'
            : ''

      const oldName = temporal
        ? `${oldPrefix}_expired${extension}`
        : `expired${extension}`
      const recentName = temporal
        ? `${recentPrefix}_fresh${extension}`
        : `fresh${extension}`

      const tiers =
        artifactClass.disposal === 'archive_then_delete' &&
        !parentRelative.startsWith('runtime/inbox')
          ? [parentRelative, `${parentRelative}/archive`]
          : [parentRelative]

      for (const tier of tiers) {
        seed(tier, oldName, old, expired)
        seed(tier, recentName, recent, kept)
      }
    }
  }

  // The stray shapes AC-10 names, plus an open item in each open directory
  // that no retention window may reach.
  writeFile(path.join(root, 'runtime/.DS_Store'), '', recent)
  writeFile(path.join(root, 'runtime/inbox/loose-request.md'), '# Loose\n')
  writeFile(
    path.join(root, 'runtime/inbox/queue', `${oldPrefix}_open-queued.md`),
    '# Open\n',
    old,
  )

  const before = listRuntime(root)
  const { result: planned } = runCleanup(root, [])

  assert.equal(planned.status, 'planned')
  assert.deepEqual(listRuntime(root), before)
  assert.equal('inbox_moves' in planned, false)
  assert.ok(actions(planned).length > 0)

  for (const action of actions(planned)) {
    assert.equal(typeof action.class, 'string')
    assert.equal(typeof action.path, 'string')
    assert.ok(
      ['delete', 'relocate', 'rename', 'remove_worktree'].includes(
        action.action,
      ),
    )
    assert.equal(Number.isInteger(action.age_days), true)
    assert.ok(action.reason.length > 0)
  }

  const plannedDeletes = deletedPaths(planned)

  for (const relative of expired) {
    assert.ok(plannedDeletes.has(relative), `planned: ${relative}`)
  }

  for (const relative of kept) {
    assert.equal(
      plannedDeletes.has(relative),
      false,
      `not planned: ${relative}`,
    )
  }

  assert.ok(plannedDeletes.has('runtime/.DS_Store'))
  assert.ok(
    actions(planned).some(
      (action) =>
        action.action === 'relocate' &&
        action.path === 'runtime/inbox/loose-request.md',
    ),
  )

  const { result: applied } = runCleanup(root, ['--apply'])
  const appliedDeletes = deletedPaths(applied)

  assert.equal(applied.status, 'applied')

  for (const relative of expired) {
    assert.equal(existsSync(path.join(root, relative)), false, relative)
    assert.ok(appliedDeletes.has(relative), `named: ${relative}`)
  }

  for (const relative of kept) {
    assert.equal(existsSync(path.join(root, relative)), true, relative)
    assert.equal(appliedDeletes.has(relative), false, `unnamed: ${relative}`)
  }

  assert.equal(existsSync(path.join(root, 'runtime/.DS_Store')), false)
  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/loose-request.md')),
    false,
  )
  assert.equal(
    readdirSync(path.join(root, 'runtime/inbox/queue')).filter((name) =>
      name.endsWith('loose-request.md'),
    ).length,
    1,
  )
  assert.equal(applied.relocated_files, 1)
  assert.equal(
    existsSync(
      path.join(root, 'runtime/inbox/queue', `${oldPrefix}_open-queued.md`),
    ),
    true,
  )
})

test('class-filtered cleanup performs only the renames it reports', () => {
  const root = createFixture()
  const research = 'runtime/research/plain-note.md'
  const benchmark = 'runtime/benchmarks/benchmark-1789980890366.json'

  writeFile(path.join(root, research), '# Research\n')
  writeFile(path.join(root, benchmark), '{}\n')

  const plan = planCleanup(root, { classes: ['research'] })

  assert.deepEqual(
    plan.actions.map((action) => [action.action, action.path]),
    [['rename', research]],
  )

  const applied = applyCleanup(root, { classes: ['research'] })

  assert.equal(existsSync(path.join(root, research)), false)
  assert.equal(existsSync(path.join(root, benchmark)), true)
  assert.deepEqual(Object.keys(applied.renames), [research])
  assert.match(applied.renames[research] ?? '', /^runtime\/research\/\d+_/u)
})

test('cleanup never deletes open inbox items', () => {
  const root = createFixture()
  const prefix = temporalNamePrefix(daysAgo(400))
  const queued = `runtime/inbox/queue/${prefix}_open-queued.md`
  const active = `runtime/inbox/active/${prefix}_open-active.md`

  for (const relative of [queued, active]) {
    writeFile(path.join(root, relative), '# Open\n', daysAgo(400))
  }

  const plan = planCleanup(root, { days: 30 })
  const relocate = plan.actions.find(
    (action) => action.action === 'relocate' && action.path === active,
  )

  assert.equal(
    plan.actions.some(
      (action) =>
        action.action === 'delete' &&
        (action.path === queued || action.path === active),
    ),
    false,
  )
  // AC-8 owns the destination of an unclaimed active item: the queue.
  assert.match(relocate?.reason ?? '', /no run claims this item/u)

  const applied = applyCleanup(root, { days: 30 })

  assert.equal(existsSync(path.join(root, queued)), true)
  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/queue', path.basename(active))),
    true,
  )
  assert.equal(
    applied.actions.some(
      (action) =>
        action.action === 'delete' &&
        (action.path === queued || action.path === active),
    ),
    false,
  )
})

test('cleanup skips live owned artifacts', () => {
  const { root, runId: templateRunId } = checkpoint('delivery@created')
  const old = daysAgo(40)
  // A run whose name says it is 40 days old and whose state is still open.
  const runId = cloneRun(
    root,
    templateRunId,
    'live',
    (state) => {
      state.status = 'running'
    },
    old,
  )

  const runDirectory = path.join(root, 'runtime/logs/workflows', runId)
  const scratch = path.join(root, 'runtime/tmp/owned.json')
  const capture = path.join(root, 'runtime/tmp/quiet.LIVE')
  const suiteRun = path.join(root, 'runtime/tmp/tests.noindex/run-live')

  writeFile(scratch, `${JSON.stringify({ owner_pid: process.pid })}\n`, old)
  writeFile(capture, 'captured output\n', old)
  writeFile(`${capture}.owner`, `${process.pid}\n`, old)
  writeDirectory(suiteRun, old)
  writeFile(path.join(suiteRun, '.owner'), `${process.pid}\nstarted\n`, old)
  utimesSync(suiteRun, old, old)

  const marker = `${capture}.owner`
  const live = [runDirectory, scratch, capture, marker, suiteRun]
  const protectedPaths = [
    `runtime/logs/workflows/${runId}`,
    'runtime/tmp/owned.json',
    'runtime/tmp/quiet.LIVE',
    'runtime/tmp/quiet.LIVE.owner',
    'runtime/tmp/tests.noindex/run-live',
  ]

  // Two consecutive applies, because the protection is only as durable as the
  // ownership evidence: an apply that keeps a capture and deletes the marker
  // proving it is live hands the next apply an unowned expired file.
  for (const pass of [1, 2]) {
    const applied = applyCleanup(root, {
      days: 30,
      classes: ['workflow-runs', 'scratch'],
    })
    const skipReason = (suffix: string): string =>
      applied.skipped.find((entry) => entry.path.endsWith(suffix))?.reason ?? ''

    for (const target of live) {
      assert.equal(existsSync(target), true, `pass ${pass}: ${target}`)
    }

    for (const relative of protectedPaths) {
      assert.equal(
        applied.actions.some((action) => action.path === relative),
        false,
        `pass ${pass}: ${relative}`,
      )
    }

    assert.match(skipReason(runId), /not terminal/u)
    assert.match(skipReason('owned.json'), new RegExp(String(process.pid), 'u'))
    assert.match(skipReason('quiet.LIVE'), new RegExp(String(process.pid), 'u'))
    assert.match(
      skipReason('quiet.LIVE.owner'),
      new RegExp(String(process.pid), 'u'),
    )
    assert.match(skipReason('run-live'), new RegExp(String(process.pid), 'u'))
  }
})

test('cleanup plans past an entry it cannot stat', () => {
  const root = createFixture()
  const expired = 'runtime/tmp/expired.json'
  const dangling = 'runtime/tmp/dangling'

  writeFile(path.join(root, expired), '{}\n', daysAgo(40))
  // A dangling link takes the same ENOENT path as an entry another process
  // removes between the directory read and the stat.
  symlinkSync(
    path.join(root, 'runtime/tmp/does-not-exist'),
    path.join(root, dangling),
  )

  const plan = planCleanup(root, { days: 30, classes: ['scratch'] })

  assert.deepEqual(
    plan.actions
      .filter((action) => action.action === 'delete')
      .map((action) => action.path),
    [expired],
  )
  assert.equal(
    plan.actions.some((action) => action.path === dangling),
    false,
  )

  const planned = plan.skipped.filter((entry) => entry.path === dangling)

  assert.equal(planned.length, 1, JSON.stringify(plan.skipped))
  assert.equal(planned[0]?.class, 'scratch')
  assert.match(planned[0]?.reason ?? '', /cannot be read \(ENOENT\)/u)

  // The operator reads the same account back from an apply, which is the mode
  // that already removed the expired file.
  const applied = applyCleanup(root, { days: 30, classes: ['scratch'] })

  assert.equal(
    applied.skipped.filter((entry) => entry.path === dangling).length,
    1,
    JSON.stringify(applied.skipped),
  )
})

test('cleanup reports a directory it cannot read', (t) => {
  if (process.getuid?.() === 0) {
    t.skip('root reads a directory whatever its mode')
    return
  }

  const root = createFixture()
  const sealed = path.join(root, 'runtime/tmp')

  writeFile(path.join(root, 'runtime/tmp/keep.json'), '{}\n')
  chmodSync(sealed, 0o000)

  try {
    const plan = planCleanup(root, { days: 30, classes: ['scratch'] })
    // The scratch scan and the host-metadata walk both reach this directory,
    // and the operator reads one account of it.
    const reported = plan.skipped.filter(
      (entry) => entry.path === 'runtime/tmp',
    )

    assert.equal(reported.length, 1, JSON.stringify(plan.skipped))
    assert.match(
      reported[0]?.reason ?? '',
      /directory cannot be read \(EACCES\)/u,
    )
  } finally {
    chmodSync(sealed, 0o755)
  }
})

test('retention configuration rejects a nonpositive or fractional window', () => {
  const { root } = checkpoint('delivery@created')
  const configPath = path.join(root, 'config.json')
  const rejects = (defaultDays: number): void => {
    const config = readConfig(root)

    config.retention = { default_days: defaultDays }
    writeJson(configPath, config)

    assert.throws(
      () => planCleanup(root),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'INVALID_RETENTION_DAYS',
      String(defaultDays),
    )
  }

  rejects(0)
  rejects(1.5)
  assert.throws(
    () => planCleanup(root, { classes: ['no-such-class'] }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'UNKNOWN_CLEANUP_CLASS',
  )
})
