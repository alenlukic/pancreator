import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

const ROOT = process.cwd()
const TEMPLATE_MODULE = path.join(ROOT, 'dist', 'tests', 'shared-template.js')

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

  assert.equal(readdirSync(witness).length, 1)
  assert.equal(first, second)
})
