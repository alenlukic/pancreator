import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BUILD_READY_ENV,
  profileCommandEnv,
} from '../../src/lib/repository-checks.js'

// `bin/run-built` exports the variable to say the build was current when the
// process tree started. A profile command checks the sources as they are now,
// so it never inherits that claim from the command that launched the gate.
test('a profile command does not inherit the build-ready assertion', () => {
  const previous = process.env[BUILD_READY_ENV]

  process.env[BUILD_READY_ENV] = '/stale/root'

  try {
    const inherited = profileCommandEnv('/workspace', {})

    assert.equal(inherited[BUILD_READY_ENV], undefined)
    assert.equal(BUILD_READY_ENV in inherited, false)
  } finally {
    if (previous === undefined) {
      delete process.env[BUILD_READY_ENV]
    } else {
      process.env[BUILD_READY_ENV] = previous
    }
  }
})

test('a caller that names the build-ready value keeps it', () => {
  const named = profileCommandEnv('/workspace', {
    [BUILD_READY_ENV]: '/named/root',
  })

  assert.equal(named[BUILD_READY_ENV], '/named/root')
})
