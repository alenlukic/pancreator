import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  resolveWriteSandbox,
  WRITE_SANDBOX_ENV,
  writeSandboxProfile,
} from '../../src/lib/executors/write-sandbox.js'
import { createTestTempDirectory } from '../temp.js'

function withEnv<T>(value: string | undefined, run: () => T): T {
  const previous = process.env[WRITE_SANDBOX_ENV]

  if (value === undefined) {
    delete process.env[WRITE_SANDBOX_ENV]
  } else {
    process.env[WRITE_SANDBOX_ENV] = value
  }

  try {
    return run()
  } finally {
    if (previous === undefined) {
      delete process.env[WRITE_SANDBOX_ENV]
    } else {
      process.env[WRITE_SANDBOX_ENV] = previous
    }
  }
}

test('the profile denies writes and allows each granted root', () => {
  const root = createTestTempDirectory('pancreator-write-sandbox-')
  const granted = path.join(root, 'granted')

  mkdirSync(granted, { recursive: true })

  const profile = writeSandboxProfile([granted])

  assert.match(profile, /^\(version 1\)$/mu)
  assert.match(profile, /^\(allow default\)$/mu)
  assert.match(profile, /^\(deny file-write\*\)$/mu)
  assert.ok(profile.includes(`(subpath "${granted}")`), profile)
})

// macOS resolves a fixture path through more than one prefix, and the
// sandbox matches the resolved one. A profile that named only the declared
// path would deny a write the caller granted.
test('the profile names the resolved path of a granted root', () => {
  const root = createTestTempDirectory('pancreator-write-sandbox-')
  const granted = path.join(root, 'granted')

  mkdirSync(granted, { recursive: true })

  const profile = writeSandboxProfile([
    path.join(root, 'nested', '..', 'granted'),
  ])

  assert.ok(profile.includes(`(subpath "${granted}")`), profile)
})

test('enforcement reports why it is unavailable', () => {
  const root = createTestTempDirectory('pancreator-write-sandbox-')

  const disabled = withEnv('0', () => resolveWriteSandbox([root]))

  assert.equal(disabled.mode, 'none')
  assert.match(disabled.reason, /PANCREATOR_WRITE_SANDBOX=0/u)

  const ungranted = withEnv(undefined, () => resolveWriteSandbox([]))

  assert.equal(ungranted.mode, 'none')
  assert.match(ungranted.reason, /no write roots/u)
})

test('an unenforced launch runs the original command unchanged', () => {
  const root = createTestTempDirectory('pancreator-write-sandbox-')
  const sandbox = withEnv('0', () => resolveWriteSandbox([root]))
  const launch = sandbox.wrap('/bin/echo', ['hello'])

  assert.equal(launch.binary, '/bin/echo')
  assert.deepEqual(launch.argv, ['hello'])
  launch.cleanup()
})

test(
  'an enforced launch runs the command through sandbox-exec with a profile file',
  {
    skip:
      process.platform === 'darwin'
        ? false
        : 'Write enforcement uses macOS sandbox-exec.',
  },
  () => {
    const root = createTestTempDirectory('pancreator-write-sandbox-')
    const sandbox = withEnv(undefined, () => resolveWriteSandbox([root]))

    assert.equal(sandbox.mode, 'sandbox-exec')
    assert.equal(sandbox.reason, '')

    const launch = sandbox.wrap('/bin/echo', ['hello'])

    assert.equal(launch.binary, '/usr/bin/sandbox-exec')
    assert.equal(launch.argv[0], '-f')
    assert.equal(launch.argv[2], '/bin/echo')
    assert.deepEqual(launch.argv.slice(3), ['hello'])
    // The profile travels in a file, so no argument carries its bytes.
    assert.ok(
      launch.argv.every((argument) => argument.length < 1000),
      'no argument may approach the exec size that endpoint security kills',
    )
    launch.cleanup()
  },
)
