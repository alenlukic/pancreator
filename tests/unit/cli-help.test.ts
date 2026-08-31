import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

function help(): string {
  const result = spawnSync(process.execPath, [CLI, 'help'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 30_000,
  })

  assert.equal(result.status, 0, result.stderr)

  return result.stdout
}

// Run 63311 F-5: the displayed form omitted --invocation, and the command
// failed until the supervisor supplied it. The help line is the contract.
test('pan output validate help names the required --invocation argument', () => {
  const lines = help().split('\n')
  const line = lines.find((item) => item.includes('pan output validate '))

  assert.ok(line, 'help lists pan output validate')
  assert.equal(
    line.trim(),
    'pan output validate <run-id> --file <path> --invocation <path> [--json]',
  )
})

test('pan tune prepare help names the baseline option', () => {
  const lines = help().split('\n')
  const line = lines.find((item) => item.includes('pan tune prepare '))

  assert.ok(line, 'help lists pan tune prepare')
  assert.equal(line.trim(), 'pan tune prepare [--baseline <ref>] [--json]')
})

test('pan tune finalize help names the required session argument', () => {
  const lines = help().split('\n')
  const line = lines.find((item) => item.includes('pan tune finalize '))

  assert.ok(line, 'help lists pan tune finalize')
  assert.equal(line.trim(), 'pan tune finalize --session <id> [--json]')
})

test('pan watch help documents the cadence, stall, timeout, and marker options', () => {
  const text = help()

  assert.match(
    text,
    /pan watch <run-id> \[--invocation <invocation-id>\] \[--cadence-seconds <n>\] \[--stall-wakes <n>\] \[--timeout-seconds <n>\] \[--mark-background\] \[--agent-state running\|completed\] \[--json\]/u,
  )
  assert.match(
    text,
    /pan watch <run-id> --foreground-returned \[--invocation <invocation-id>\] \[--launched-at <iso-8601>\] \[--json\]/u,
  )
  assert.match(text, /DELEGATION_UNOBSERVED/u)
  assert.match(
    text,
    /pan status <run-id> \[--redline\] \[--occasion pan-start\|pan-resume\] \[--json\]/u,
  )
})
