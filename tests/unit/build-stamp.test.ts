import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const REPO_ROOT = process.cwd()
const PROCESS_TIMEOUT_MS = 30_000

interface Fixture {
  root: string
  stubBin: string
  npmLog: string
  tscLog: string
}

function writeExecutable(filePath: string, body: string): void {
  writeFileSync(filePath, body)
  chmodSync(filePath, 0o755)
}

function buildFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'pan-build-stamp-'))
  const stubBin = path.join(root, 'stub-bin')
  const npmLog = path.join(root, 'npm.log')
  const tscLog = path.join(root, 'tsc.log')

  mkdirSync(path.join(root, 'bin'), { recursive: true })
  mkdirSync(path.join(root, 'src'), { recursive: true })
  mkdirSync(stubBin, { recursive: true })

  for (const script of ['build', 'lint']) {
    copyFileSync(
      path.join(REPO_ROOT, 'bin', script),
      path.join(root, 'bin', script),
    )
    chmodSync(path.join(root, 'bin', script), 0o755)
  }

  writeFileSync(path.join(root, 'tsconfig.json'), '{ "include": ["src"] }\n')
  writeFileSync(path.join(root, 'package.json'), '{ "name": "fixture" }\n')
  writeFileSync(path.join(root, 'package-lock.json'), '{}\n')
  writeFileSync(path.join(root, 'src', 'index.ts'), 'export const a = 1\n')

  // The stub compiler only proves it ran and gives dist a file to stamp.
  writeExecutable(
    path.join(stubBin, 'tsc'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "tsc $*" >>"${tscLog}"\nmkdir -p dist\nprintf 'built\\n' >dist/index.js\n`,
  )
  writeExecutable(
    path.join(stubBin, 'npm'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "npm $*" >>"${npmLog}"\n`,
  )

  return { root, stubBin, npmLog, tscLog }
}

function run(fixture: Fixture, script: string, args: string[] = []) {
  return spawnSync(path.join(fixture.root, 'bin', script), args, {
    cwd: fixture.root,
    encoding: 'utf8',
    timeout: PROCESS_TIMEOUT_MS,
    env: {
      ...process.env,
      PATH: `${fixture.stubBin}:${process.env.PATH ?? ''}`,
      TMPDIR: fixture.root,
    },
  })
}

function readLog(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
}

/** Move a file's mtime forward so the stamp fingerprint changes. */
function touchForward(filePath: string): void {
  const later = new Date(Date.now() + 10_000)

  utimesSync(filePath, later, later)
}

test('a fresh build stamp reports fresh and a changed input reports stale', () => {
  const fixture = buildFixture()

  const built = run(fixture, 'build')
  assert.equal(built.status, 0, built.stderr)
  assert.match(readLog(fixture.tscLog), /^tsc/mu)

  assert.equal(run(fixture, 'build', ['--stamp-fresh']).status, 0)

  touchForward(path.join(fixture.root, 'src', 'index.ts'))
  assert.equal(run(fixture, 'build', ['--stamp-fresh']).status, 1)

  assert.equal(run(fixture, 'build').status, 0)
  assert.equal(run(fixture, 'build', ['--stamp-fresh']).status, 0)

  writeFileSync(
    path.join(fixture.root, 'tsconfig.json'),
    '{ "include": ["src"], "compilerOptions": { "strict": true } }\n',
  )
  touchForward(path.join(fixture.root, 'tsconfig.json'))
  assert.equal(run(fixture, 'build', ['--stamp-fresh']).status, 1)
})

test('lint skips typecheck on a fresh stamp and runs it on a stale one', () => {
  const fixture = buildFixture()

  assert.equal(run(fixture, 'build').status, 0)

  const fresh = run(fixture, 'lint')
  assert.equal(fresh.status, 0, fresh.stderr)
  assert.match(readLog(fixture.npmLog), /^npm run format:check$/mu)
  assert.doesNotMatch(readLog(fixture.npmLog), /typecheck/u)

  touchForward(path.join(fixture.root, 'src', 'index.ts'))

  const stale = run(fixture, 'lint')
  assert.equal(stale.status, 0, stale.stderr)
  assert.match(readLog(fixture.npmLog), /^npm run typecheck$/mu)
})
