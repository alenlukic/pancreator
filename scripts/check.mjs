#!/usr/bin/env node

import { spawn } from 'node:child_process'

const scriptNames = ['lint', 'build', 'validate', 'test']

async function runScript(scriptName) {
  const child = spawn('npm', ['run', scriptName], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: 'inherit',
  })

  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      resolve({ code, signal })
    })
  })
}

for (const scriptName of scriptNames) {
  const result = await runScript(scriptName)

  if (result.code === 0) {
    continue
  }

  if (result.signal !== null) {
    process.stderr.write(
      `npm run ${scriptName} terminated by ${result.signal}\n`,
    )
  }

  process.exitCode = result.code ?? 1
  break
}
