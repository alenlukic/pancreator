import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'
import {
  findLatestLogDir,
  PAN_RUN,
  PROCESS_TIMEOUT_MS,
} from '../integration/pan-run-fixture.js'

test('R-01: streaming exposes progress and an unterminated prompt before stdin is supplied', async () => {
  const root = createTestTempDirectory('pan-run-prompt-')
  const child = spawn(
    PAN_RUN,
    [
      '--',
      'bash',
      '-c',
      'printf "progress 1:%s\\rReady? " "$MY_TOKEN"; read answer; printf "received:%s\\n" "$answer"',
    ],
    {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        PANCREATOR_ROOT: root,
        PAN_VERBOSE: '1',
        PAN_RUN_LINE_WIDTH: '80',
        MY_TOKEN: 'synthetic-prompt-secret',
      },
      stdio: 'pipe',
      timeout: PROCESS_TIMEOUT_MS,
    },
  )
  let stdout = ''
  let stderr = ''
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  const prompt = new Promise<void>((resolve, reject) => {
    const guard = setTimeout(() => {
      reject(new Error(`prompt was withheld before input: ${stdout}`))
    }, 10_000)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk

      if (stdout.includes('progress 1') && stdout.includes('Ready?')) {
        clearTimeout(guard)
        resolve()
      }
    })
    child.once('close', () => {
      clearTimeout(guard)
      reject(new Error(`wrapper exited before input: ${stderr}`))
    })
  })

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })

  try {
    await prompt
    child.stdin.end('yes\n')
    assert.equal(await closed, 0, stderr)
    assert.equal(stdout.match(/Ready\?/gu)?.length, 1)
    assert.equal(stdout.match(/progress 1/gu)?.length, 1)
    assert.match(stdout, /received:yes/u)
    assert.match(stdout, /progress 1:\[REDACTED:MY_TOKEN\]/u)
    assert.ok(!stdout.includes('synthetic-prompt-secret'))
    assert.ok(stdout.split('\n').every((line) => line.length <= 80))

    const dir = findLatestLogDir(root)

    assert.ok(dir)
    assert.equal(
      readFileSync(path.join(dir, 'output.log'), 'utf8'),
      'progress 1:[REDACTED:MY_TOKEN]\rReady? received:yes\n',
    )
  } finally {
    if (!child.stdin.writableEnded) {
      child.stdin.end('cleanup\n')
    }
    await closed
  }
})
