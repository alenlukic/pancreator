import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  custodyProtectionAvailable,
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

test('subprocess denial is collector-specific and opt-in', () => {
  const roots = [createTestTempDirectory('pancreator-process-sandbox-')]

  assert.doesNotMatch(writeSandboxProfile(roots), /\(deny process-fork\)/u)
  assert.doesNotMatch(
    writeSandboxProfile(roots, true),
    /\(deny process-fork\)/u,
  )
  assert.match(writeSandboxProfile(roots, true, true), /\(deny process-fork\)/u)
})

test('Copilot state is an agent exception, never a strict collector grant', () => {
  const home = createTestTempDirectory('pancreator-copilot-home-')
  const granted = path.join(home, 'runtime')
  const state = path.join(home, '.copilot')
  const previousHome = process.env.HOME
  process.env.HOME = home

  try {
    const profile = writeSandboxProfile([granted])
    const sandbox = withEnv(undefined, () => resolveWriteSandbox([granted]))

    assert.ok(profile.includes(`(subpath "${state}")`), profile)
    assert.ok(sandbox.effectiveWriteRoots.includes(state))
    assert.deepEqual(sandbox.writeRoots, [granted])
    assert.ok(!writeSandboxProfile([granted], true, true).includes(state))
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = previousHome
    }
  }
})

// macOS resolves a fixture path through more than one prefix, and the
// sandbox matches the resolved one. A profile that named only the declared
// path would deny a write the caller granted.
test('containment denies a harness path even when it sits under an agent-state root', () => {
  const root = createTestTempDirectory('pancreator-write-sandbox-containment-')
  const granted = path.join(root, 'granted')

  mkdirSync(granted, { recursive: true })

  const profile = writeSandboxProfile([granted], [], true, {
    containmentRoots: [root],
  })

  assert.match(profile, /^\(deny file-write\*\)$/mu)
  assert.ok(profile.includes(`(deny file-write* (subpath "${root}"))`), profile)
  const grantAllow = `(allow file-write* (subpath "${granted}"))`
  const lastGrant = profile.lastIndexOf(grantAllow)
  const containmentDeny = profile.lastIndexOf(
    `(deny file-write* (subpath "${root}"))`,
  )

  assert.ok(lastGrant > containmentDeny, profile)
})

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
  assert.match(
    disabled.reason,
    custodyProtectionAvailable()
      ? /PANCREATOR_WRITE_SANDBOX=0/u
      : /sandbox-exec/u,
  )

  const ungranted = withEnv(undefined, () => resolveWriteSandbox([]))

  assert.equal(ungranted.mode, 'none')
  assert.match(
    ungranted.reason,
    custodyProtectionAvailable() ? /no write roots/u : /sandbox-exec/u,
  )
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
    assert.equal(launch.argv[2], '--')
    assert.equal(launch.argv[3], '/bin/echo')
    assert.deepEqual(launch.argv.slice(4), ['hello'])
    // The profile travels in a file, so no argument carries its bytes.
    assert.ok(
      launch.argv.every((argument) => argument.length < 1000),
      'no argument may approach the exec size that endpoint security kills',
    )
    launch.cleanup()
  },
)

test(
  'the wrapper stops option parsing before a child vector that starts with -p',
  {
    skip:
      process.platform === 'darwin'
        ? false
        : 'Write enforcement uses macOS sandbox-exec.',
  },
  () => {
    const root = createTestTempDirectory('pancreator-write-sandbox-')
    const sandbox = withEnv(undefined, () => resolveWriteSandbox([root]))
    const launch = sandbox.wrap('/bin/echo', ['-p', '--output-format', 'json'])

    assert.equal(launch.argv[2], '--')
    assert.deepEqual(launch.argv.slice(3), [
      '/bin/echo',
      '-p',
      '--output-format',
      'json',
    ])
    launch.cleanup()
  },
)
