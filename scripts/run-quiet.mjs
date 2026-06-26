#!/usr/bin/env node

import { spawn } from 'node:child_process'

const MAX_CAPTURE_BYTES = 16 * 1024 * 1024

function parseCommand(argv) {
  const separatorIndex = argv.indexOf('--')
  const commandParts =
    separatorIndex === -1 ? argv : argv.slice(separatorIndex + 1)

  if (commandParts.length === 0) {
    throw new Error('Usage: node scripts/run-quiet.mjs -- <command> [args...]')
  }

  const [command, ...args] = commandParts

  return { command, args }
}

function isVerbose() {
  const value = process.env.PAN_VERBOSE?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

function createCapture() {
  const chunks = []
  let capturedBytes = 0
  let truncated = false

  return {
    append(stream, data) {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
      chunks.push({ stream, data: buffer })
      capturedBytes += buffer.byteLength

      while (capturedBytes > MAX_CAPTURE_BYTES && chunks.length > 1) {
        const removed = chunks.shift()
        capturedBytes -= removed.data.byteLength
        truncated = true
      }
    },
    flush() {
      if (truncated) {
        process.stderr.write(
          `[quiet runner] output truncated to the last ${MAX_CAPTURE_BYTES} bytes\n`,
        )
      }

      for (const chunk of chunks) {
        const destination =
          chunk.stream === 'stdout' ? process.stdout : process.stderr
        destination.write(chunk.data)
      }
    },
  }
}

async function main() {
  const { command, args } = parseCommand(process.argv.slice(2))
  const verbose = isVerbose()
  const capture = createCapture()

  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: ['inherit', 'pipe', 'pipe'],
  })

  child.stdout.on('data', (data) => {
    if (verbose) {
      process.stdout.write(data)
    } else {
      capture.append('stdout', data)
    }
  })

  child.stderr.on('data', (data) => {
    if (verbose) {
      process.stderr.write(data)
    } else {
      capture.append('stderr', data)
    }
  })

  const result = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      resolve({ code, signal })
    })
  })

  if (result.code === 0) {
    return
  }

  if (!verbose) {
    capture.flush()
  }

  if (result.signal !== null) {
    process.stderr.write(
      `[quiet runner] command terminated by ${result.signal}\n`,
    )
  }

  process.exitCode = result.code ?? 1
}

try {
  await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[quiet runner] ${message}\n`)
  process.exitCode = 1
}
