import assert from 'node:assert/strict'
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { collectShellMonitorIssues } from '../../src/lib/validators/shell-monitor.js'
import { createTestTempDirectory } from '../temp.js'
import { launchRecordPath } from '../../src/lib/watch/launch.js'
import { watchRecordPath } from '../../src/lib/watch/paths.js'

const REPO_ROOT = process.cwd()
const HOOKS_SOURCE = 'library/cursor/hooks.json'
const HOOK_SCRIPT = 'bin/pan-hook-shell-monitor'
const PAN_RUN = 'bin/pan-run'
const POLICY = 'governance/policies/DELEGATE-001.json'

/** Set up a minimal repo root with the required files. */
function setupRoot(): string {
  const root = createTestTempDirectory('shell-monitor-validator-')

  mkdirSync(path.join(root, 'library', 'cursor'), { recursive: true })
  mkdirSync(path.join(root, 'bin'), { recursive: true })
  mkdirSync(path.join(root, 'governance', 'policies'), { recursive: true })

  cpSync(path.join(REPO_ROOT, HOOKS_SOURCE), path.join(root, HOOKS_SOURCE))
  cpSync(path.join(REPO_ROOT, HOOK_SCRIPT), path.join(root, HOOK_SCRIPT))
  cpSync(path.join(REPO_ROOT, PAN_RUN), path.join(root, PAN_RUN))
  cpSync(path.join(REPO_ROOT, POLICY), path.join(root, POLICY))

  // Preserve executable bits
  chmodSync(path.join(root, HOOK_SCRIPT), 0o755)
  chmodSync(path.join(root, PAN_RUN), 0o755)

  return root
}

test('optional observation receipts remain legacy compatible and reject invalid identities', () => {
  const root = setupRoot()
  const invocation = { run_id: 'metadata-run', invocation_id: 'metadata-inv' }
  assert.deepEqual(collectShellMonitorIssues(root, invocation), [])
  const launch = path.join(
    root,
    launchRecordPath(root, invocation.run_id, invocation.invocation_id),
  )
  mkdirSync(path.dirname(launch), { recursive: true })
  writeFileSync(
    launch,
    JSON.stringify({
      schema_version: 1,
      ...invocation,
      launched_at: new Date().toISOString(),
      executor_launch_id: 42,
    }),
  )
  assert.ok(
    collectShellMonitorIssues(root, invocation).some(
      (issue) => issue.code === 'shell_monitor.launch_identity_invalid',
    ),
  )
  rmSync(launch)
  const ledger = path.join(
    root,
    watchRecordPath(root, invocation.run_id, invocation.invocation_id),
  )
  writeFileSync(`${ledger}.blocking.jsonl`, '{"schema_version":1}\n')
  assert.ok(
    collectShellMonitorIssues(root, invocation).some(
      (issue) => issue.code === 'shell_monitor.blocking_receipt_invalid',
    ),
  )
  const now = new Date().toISOString()
  writeFileSync(
    ledger,
    JSON.stringify({
      schema_version: 1,
      ...invocation,
      event: 'session_started',
      recorded_at: now,
      watch_session_id: 'one',
      watcher_pid: 123,
      watcher_process_identity: 'fixture',
    }) + '\n',
  )
  const receipt = {
    schema_version: 1,
    ledger: path.relative(root, ledger),
    watch_session_id: 'one',
    watcher_pid: 123,
    watcher_process_identity: 'fixture',
    parent_pid: 456,
    parent_process_identity: 'fixture-parent',
    started_at: now,
    ended_at: now,
    result: 'attach_completed',
  }
  writeFileSync(`${ledger}.blocking.jsonl`, JSON.stringify(receipt) + '\n')
  assert.deepEqual(collectShellMonitorIssues(root, invocation), [])
  writeFileSync(
    `${ledger}.blocking.jsonl`,
    JSON.stringify({ ...receipt, watch_session_id: 'replacement' }) + '\n',
  )
  assert.ok(
    collectShellMonitorIssues(root, invocation).some(
      (issue) => issue.code === 'shell_monitor.blocking_identity_invalid',
    ),
  )
  rmSync(`${ledger}.blocking.jsonl`)
  assert.deepEqual(collectShellMonitorIssues(root, invocation), [])
})

test('AC-19: shell-monitor validator pass and fail cases', async (t) => {
  await t.test('passes on the real repository', () => {
    const issues = collectShellMonitorIssues(REPO_ROOT)

    assert.deepEqual(
      issues.map((i) => i.code),
      [],
      `validator must pass on repo root; issues: ${JSON.stringify(issues)}`,
    )
  })

  await t.test(
    'fails when the beforeShellExecution hook entry is removed',
    () => {
      const root = setupRoot()

      const hooksPath = path.join(root, HOOKS_SOURCE)
      const hooks = JSON.parse(readFileSync(hooksPath, 'utf8'))

      // Remove the beforeShellExecution section
      delete hooks.hooks.beforeShellExecution

      writeFileSync(hooksPath, JSON.stringify(hooks, null, 2))

      const issues = collectShellMonitorIssues(root)

      assert.ok(
        issues.some(
          (i) => i.code === 'shell_monitor.before_shell_execution_hook_missing',
        ),
        `must report before_shell_execution_hook_missing; got: ${JSON.stringify(issues.map((i) => i.code))}`,
      )
    },
  )

  await t.test('fails when bin/pan-hook-shell-monitor is missing', () => {
    const root = setupRoot()

    rmSync(path.join(root, HOOK_SCRIPT))

    const issues = collectShellMonitorIssues(root)

    assert.ok(
      issues.some((i) => i.code === 'shell_monitor.hook_script_missing'),
      'must report hook_script_missing',
    )
  })

  await t.test('fails when bin/pan-run is missing', () => {
    const root = setupRoot()

    rmSync(path.join(root, PAN_RUN))

    const issues = collectShellMonitorIssues(root)

    assert.ok(
      issues.some((i) => i.code === 'shell_monitor.pan_run_missing'),
      'must report pan_run_missing',
    )
  })

  await t.test(
    'fails when bin/pan-hook-shell-monitor is not executable',
    () => {
      const root = setupRoot()

      chmodSync(path.join(root, HOOK_SCRIPT), 0o644)

      const issues = collectShellMonitorIssues(root)

      assert.ok(
        issues.some(
          (i) => i.code === 'shell_monitor.hook_script_not_executable',
        ),
        'must report hook_script_not_executable',
      )
    },
  )

  await t.test('fails when the hook is not fail-closed', () => {
    const root = setupRoot()

    const hooksPath = path.join(root, HOOKS_SOURCE)
    const hooks = JSON.parse(readFileSync(hooksPath, 'utf8'))

    const entry = (hooks.hooks.beforeShellExecution as unknown[]).find(
      (e) =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as Record<string, unknown>).command === 'string' &&
        ((e as Record<string, unknown>).command as string).includes(
          'pan-hook-shell-monitor',
        ),
    )

    if (entry && typeof entry === 'object') {
      ;(entry as Record<string, unknown>).failClosed = false
    }

    writeFileSync(hooksPath, JSON.stringify(hooks, null, 2))

    const issues = collectShellMonitorIssues(root)

    assert.ok(
      issues.some((i) => i.code === 'shell_monitor.hook_not_fail_closed'),
      'must report hook_not_fail_closed',
    )
  })

  await t.test('passes on an unmodified copy of the three sources', () => {
    assert.deepEqual(
      collectShellMonitorIssues(setupRoot()).map((i) => i.code),
      [],
    )
  })

  await t.test(
    'fails with allowlist drift when the hook gains an entry',
    () => {
      const root = setupRoot()
      const hookPath = path.join(root, HOOK_SCRIPT)
      const hook = readFileSync(hookPath, 'utf8')
      const edited = hook.replace('"ps"]', '"ps", "find"]')

      assert.notEqual(edited, hook, 'the fixture edit must change the hook')
      writeFileSync(hookPath, edited)

      assert.deepEqual(
        collectShellMonitorIssues(root).map((i) => i.code),
        ['shell_monitor.allowlist_drift'],
      )
    },
  )

  await t.test(
    'fails with allowlist drift when the policy drops an entry',
    () => {
      const root = setupRoot()
      const policyPath = path.join(root, POLICY)
      const policy = readFileSync(policyPath, 'utf8')
      const edited = policy.replace('`cat`, `pwd`, `ps`.', '`cat`, `pwd`.')

      assert.notEqual(edited, policy, 'the fixture edit must change the policy')
      writeFileSync(policyPath, edited)

      assert.deepEqual(
        collectShellMonitorIssues(root).map((i) => i.code),
        ['shell_monitor.allowlist_drift'],
      )
    },
  )

  await t.test('fails when the policy no longer states the allowlist', () => {
    const root = setupRoot()
    const policyPath = path.join(root, POLICY)

    writeFileSync(
      policyPath,
      readFileSync(policyPath, 'utf8').replace(
        'The allowlist contains:',
        'Allowed:',
      ),
    )

    assert.deepEqual(
      collectShellMonitorIssues(root).map((i) => i.code),
      ['shell_monitor.policy_allowlist_unreadable'],
    )
  })
})
