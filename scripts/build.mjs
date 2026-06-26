#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'

rmSync('dist', { recursive: true, force: true })

const result = spawnSync('tsc', [], {
  cwd: process.cwd(),
  env: process.env,
  shell: false,
  stdio: 'inherit',
})

if (result.error !== undefined) {
  throw result.error
}

process.exitCode = result.status ?? 1
