import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import type { SpawnSyncReturns } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { createTestTempDirectory } from '../temp.js'

export const ROOT = process.cwd()
export const PAN = path.join(ROOT, 'bin', 'pan')

// bin/build compiles into a staging directory named by `--outDir` and swaps it
// into place, so a fake compiler must honor that flag to be found.
export const FAKE_TSC_OUT_DIR =
  'out=dist; while [[ $# -gt 0 ]]; do if [[ "$1" == "--outDir" ]]; then out="$2"; shift; fi; shift; done'

export interface ProcessResult {
  status: number | null
  stderr: string
}

export function waitForProcess(
  child: ReturnType<typeof spawn>,
): Promise<ProcessResult> {
  let stderr = ''

  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk
  })

  return new Promise((resolve) => {
    child.on('close', (status) => {
      resolve({ status, stderr })
    })
  })
}

// The wait only sequences the second launch after the first command started.
// The first build in a freshly written temporary root can take several
// seconds on a loaded host, because every copied script runs for the first
// time there, so the budget is generous rather than a measure of the contract.
export const STARTED_WAIT_MS = 15_000

export async function waitForPath(filePath: string): Promise<void> {
  const deadline = Date.now() + STARTED_WAIT_MS

  while (Date.now() < deadline) {
    if (existsSync(filePath)) {
      return
    }

    await delay(10)
  }

  assert.fail(`Timed out waiting for ${filePath}`)
}

export interface BuildScriptFixture {
  root: string
  runBuilt: string
  env: NodeJS.ProcessEnv
}

export function createBuildScriptFixture(): BuildScriptFixture {
  const root = createTestTempDirectory('pancreator-build-reuse-')
  const binDirectory = path.join(root, 'bin')
  const toolDirectory = path.join(root, 'tools')

  mkdirSync(binDirectory, { recursive: true })
  mkdirSync(toolDirectory, { recursive: true })
  symlinkSync(process.execPath, path.join(toolDirectory, 'node'))

  for (const script of ['build', 'run-built', 'run-quiet', 'run-tests']) {
    const target = path.join(binDirectory, script)

    copyFileSync(path.join(ROOT, 'bin', script), target)
    chmodSync(target, 0o755)
  }

  // The fake compiler appends outside dist/ so builds stay countable across
  // the dist swap in bin/build.
  const compiler = path.join(toolDirectory, 'tsc')

  writeFileSync(
    compiler,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `${FAKE_TSC_OUT_DIR}`,
      'mkdir -p "$out/src"',
      `printf '%s\\n' build >> builds.log`,
      '',
    ].join('\n'),
  )
  chmodSync(compiler, 0o755)

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${toolDirectory}:/usr/bin:/bin`,
  }

  delete env.PANCREATOR_BUILD_READY

  return { root, runBuilt: path.join(binDirectory, 'run-built'), env }
}

// The wrapper pairs the holder's pid with its start time, so these helpers
// build the same token bin/run-built writes.
export function ownerToken(pid: number): string {
  return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8',
  })
    .replace(/ /gu, '')
    .trim()
}

// A reclaim test must not inherit the production ceiling. If ownership
// checking regresses, these cases should fail in seconds instead of waiting
// out the default five minutes.
export function reclaimEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, PANCREATOR_BUILD_LOCK_TIMEOUT_SECONDS: '20' }
}

export function writeBuildLock(root: string, contents: string): string {
  const lock = path.join(root, 'runtime', 'build', 'build.lock')

  mkdirSync(path.dirname(lock), { recursive: true })
  writeFileSync(lock, contents)

  return lock
}

export function runTests(
  fixture: BuildScriptFixture,
  command: string[],
): SpawnSyncReturns<string> {
  return spawnSync(
    '/bin/bash',
    [path.join(fixture.root, 'bin', 'run-tests'), '--', ...command],
    { cwd: fixture.root, encoding: 'utf8', env: fixture.env },
  )
}

export function scratchRuns(root: string): string[] {
  const scratch = path.join(root, 'runtime', 'tmp', 'tests')

  return existsSync(scratch)
    ? readdirSync(scratch).filter((entry) => entry.startsWith('run-'))
    : []
}

// A run directory renamed out of the way for a detached removal, and the
// marker naming the process doing it.
export function discardedRuns(root: string): string[] {
  const scratch = path.join(root, 'runtime', 'tmp', 'tests')

  return existsSync(scratch)
    ? readdirSync(scratch)
        .filter((entry) => entry.startsWith('discarded-'))
        .sort()
    : []
}

export function removalMarkers(root: string): string[] {
  const scratch = path.join(root, 'runtime', 'tmp', 'tests')

  return existsSync(scratch)
    ? readdirSync(scratch)
        .filter((entry) => entry.startsWith('.removing-'))
        .sort()
    : []
}

export async function waitForAbsence(filePath: string): Promise<void> {
  const deadline = Date.now() + STARTED_WAIT_MS

  while (Date.now() < deadline) {
    if (!existsSync(filePath)) {
      return
    }

    await delay(10)
  }

  assert.fail(`Timed out waiting for ${filePath} to be removed`)
}
