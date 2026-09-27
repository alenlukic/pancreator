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

import {
  collectShellMonitorIssues,
  SHELL_MONITOR_ALLOWLIST,
} from '../../src/lib/validators/shell-monitor.js'
import { createTestTempDirectory } from '../temp.js'

const REPO_ROOT = process.cwd()
const HOOKS_SOURCE = 'library/cursor/hooks.json'
const HOOK_SCRIPT = 'bin/pan-hook-shell-monitor'
const PAN_RUN = 'bin/pan-run'

/** Set up a minimal repo root with the required files. */
function setupRoot(): string {
  const root = createTestTempDirectory('shell-monitor-validator-')

  // Create needed directories
  mkdirSync(path.join(root, 'library', 'cursor'), { recursive: true })
  mkdirSync(path.join(root, 'bin'), { recursive: true })

  // Copy the real hooks.json and scripts
  cpSync(path.join(REPO_ROOT, HOOKS_SOURCE), path.join(root, HOOKS_SOURCE))
  cpSync(path.join(REPO_ROOT, HOOK_SCRIPT), path.join(root, HOOK_SCRIPT))
  cpSync(path.join(REPO_ROOT, PAN_RUN), path.join(root, PAN_RUN))

  // Preserve executable bits
  chmodSync(path.join(root, HOOK_SCRIPT), 0o755)
  chmodSync(path.join(root, PAN_RUN), 0o755)

  return root
}

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

  await t.test(
    'SHELL_MONITOR_ALLOWLIST contains the DELEGATE-001 entries',
    () => {
      const expected = [
        'git status',
        'git log',
        'git diff',
        'git show',
        'git rev-parse',
        'ls',
        'rg',
        'cat',
        'pwd',
      ]

      for (const entry of expected) {
        assert.ok(
          SHELL_MONITOR_ALLOWLIST.includes(entry),
          `allowlist must include '${entry}'`,
        )
      }

      assert.equal(
        SHELL_MONITOR_ALLOWLIST.length,
        expected.length,
        'allowlist must have exactly the expected entries',
      )
    },
  )
})
