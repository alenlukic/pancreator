import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { sharedTemplate, templateName } from '../shared-template.js'
import { createTestTempDirectory } from '../temp.js'

const ROOT = process.cwd()
const TEMPLATE_MODULE = path.join(ROOT, 'dist', 'tests', 'shared-template.js')

// The cache keys off PANCREATOR_TEST_TMP, so each case gets its own run
// directory and restores whatever the suite runner set.
function restore(previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env.PANCREATOR_TEST_TMP
  } else {
    process.env.PANCREATOR_TEST_TMP = previous
  }
}

function withRunDirectory<Result>(
  body: (runDirectory: string) => Result,
): Result {
  const previous = process.env.PANCREATOR_TEST_TMP
  const directory = createTestTempDirectory('shared-run-')

  process.env.PANCREATOR_TEST_TMP = directory

  try {
    return body(directory)
  } finally {
    restore(previous)
  }
}

function withoutRunDirectory<Result>(body: () => Result): Result {
  const previous = process.env.PANCREATOR_TEST_TMP

  delete process.env.PANCREATOR_TEST_TMP

  try {
    return body()
  } finally {
    restore(previous)
  }
}

/** A pid that has certainly been reaped, for the stale-lock case. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', ''])

  assert.equal(child.status, 0)

  return child.pid as number
}

test('a test file run outside the suite runner gets no shared cache', () => {
  let builds = 0

  const result = withoutRunDirectory(() =>
    sharedTemplate('outside', (destination) => {
      builds += 1
      mkdirSync(destination, { recursive: true })

      return null
    }),
  )

  // Null is the signal to build per process, so the build must not have run
  // here: a template built outside a run directory would never be removed.
  assert.equal(result, null)
  assert.equal(builds, 0)
})

test('a template is built once and reused for the rest of the run', () => {
  const builds: string[] = []

  withRunDirectory(() => {
    const build = (destination: string) => {
      builds.push(destination)
      mkdirSync(destination, { recursive: true })
      writeFileSync(path.join(destination, 'payload'), 'built\n')

      return { runId: `run-${builds.length}` }
    }

    const first = sharedTemplate('fixture:main', build)
    const second = sharedTemplate('fixture:main', build)

    assert.notEqual(first, null)
    assert.equal(second?.path, first?.path)
    assert.equal(builds.length, 1)
    // The metadata the builder returned survives the publish, so the second
    // caller recovers the run id it never built.
    assert.deepEqual(second?.metadata, { runId: 'run-1' })
    assert.equal(readdirSync(first?.path as string).join(), 'payload')
  })
})

test('distinct keys get distinct templates', () => {
  withRunDirectory(() => {
    const build = (destination: string) => {
      mkdirSync(destination, { recursive: true })

      return null
    }

    const main = sharedTemplate('fixture:main', build)
    const checkpoint = sharedTemplate('checkpoint:plan', build)

    assert.notEqual(main?.path, checkpoint?.path)
    assert.equal(
      path.basename(main?.path as string),
      templateName('fixture:main'),
    )
  })
})

test('a template appears under its published name only once it is complete', () => {
  withRunDirectory((runDirectory) => {
    const published = path.join(
      runDirectory,
      'templates',
      templateName('staged'),
    )

    let destinationExisted = true
    let publishedDuringBuild = true

    const result = sharedTemplate('staged', (destination) => {
      // The contract the callers rely on: the builder owns the path and
      // creates it, and nothing is visible under the published name until
      // the builder returns.
      destinationExisted = existsSync(destination)
      publishedDuringBuild = existsSync(published)
      mkdirSync(destination, { recursive: true })

      return null
    })

    assert.equal(destinationExisted, false)
    assert.equal(publishedDuringBuild, false)
    assert.equal(result?.path, published)
    assert.equal(existsSync(published), true)
  })
})

test('a build that never creates its destination fails naming the key', () => {
  withRunDirectory(() => {
    assert.throws(
      () => sharedTemplate('checkpoint:absent', () => null),
      /checkpoint:absent/u,
    )
  })
})

test('a failed build publishes nothing and the next caller retries', () => {
  withRunDirectory(() => {
    let attempts = 0

    const build = (destination: string) => {
      attempts += 1

      if (attempts === 1) {
        throw new Error('git exploded')
      }

      mkdirSync(destination, { recursive: true })

      return null
    }

    assert.throws(() => sharedTemplate('flaky', build), /git exploded/u)

    // A failure that published its half-built tree would poison every later
    // caller in the run, so the retry must reach the builder again.
    const recovered = sharedTemplate('flaky', build)

    assert.equal(attempts, 2)
    assert.equal(existsSync(recovered?.path as string), true)
  })
})

test('a lock left by a builder that died is reclaimed', () => {
  withRunDirectory((runDirectory) => {
    const cache = path.join(runDirectory, 'templates')
    const lock = path.join(cache, `${templateName('abandoned')}.lock`)

    mkdirSync(lock, { recursive: true })
    writeFileSync(path.join(lock, 'owner'), `${deadPid()}\n`)

    let built = false

    const result = sharedTemplate('abandoned', (destination) => {
      built = true
      mkdirSync(destination, { recursive: true })

      return null
    })

    // Waiting on a dead holder would stall the run for the lock timeout.
    assert.equal(built, true)
    assert.equal(existsSync(result?.path as string), true)
    assert.equal(existsSync(lock), false)
  })
})

test('concurrent processes in one run share a single build', async () => {
  const runDirectory = createTestTempDirectory('shared-race-')
  const witness = path.join(runDirectory, 'builds')

  mkdirSync(witness, { recursive: true })

  const script = `
    import { mkdirSync, writeFileSync } from 'node:fs'
    import path from 'node:path'
    import { sharedTemplate } from ${JSON.stringify(TEMPLATE_MODULE)}
    const signal = new Int32Array(new SharedArrayBuffer(4))
    const result = sharedTemplate('raced', (destination) => {
      writeFileSync(path.join(${JSON.stringify(witness)}, String(process.pid)), '')
      mkdirSync(destination, { recursive: true })
      Atomics.wait(signal, 0, 0, 750)
      return { owner: process.pid }
    })
    process.stdout.write(result.path)
  `

  const run = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--input-type=module', '-e', script],
        {
          cwd: ROOT,
          env: { ...process.env, PANCREATOR_TEST_TMP: runDirectory },
        },
      )
      let out = ''
      let err = ''

      child.stdout.on('data', (chunk) => {
        out += String(chunk)
      })
      child.stderr.on('data', (chunk) => {
        err += String(chunk)
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) {
          resolve(out)
        } else {
          reject(new Error(`child exited ${code}: ${err}`))
        }
      })
    })

  const [first, second] = await Promise.all([run(), run()])

  // One build for the whole run is the entire point: the suite starts one
  // process per test file, and each of them asks for the same templates.
  assert.equal(readdirSync(witness).length, 1)
  assert.equal(first, second)
})
