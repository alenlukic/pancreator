/**
 * Tests for `.githooks/post-checkout` and `.githooks/post-merge`, which
 * refresh the ignored `.cursor` projection when HEAD moves across a change to
 * its sources.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

const REPO_ROOT = process.cwd()
const SYNC_MARKER = 'sync-calls.log'

function git(cwd: string, args: string[]): { status: number; stderr: string } {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
  })

  assert.equal(result.error, undefined)

  return { status: result.status ?? -1, stderr: result.stderr }
}

function gitOk(cwd: string, args: string[]): string {
  const result = git(cwd, args)

  assert.equal(result.status, 0, result.stderr)

  return result.stderr
}

/**
 * A repository wired to the shipped hooks, with a stub `bin/pan` that records
 * each call and exits with `panExit`.
 */
function createRepo(options: { cursor?: boolean; panExit?: number } = {}): {
  root: string
} {
  const root = createTestTempDirectory('githooks-projection-')

  gitOk(root, ['init', '-q', '--initial-branch=main'])
  gitOk(root, ['config', 'user.email', 'test@example.com'])
  gitOk(root, ['config', 'user.name', 'Test'])
  gitOk(root, ['config', 'core.hooksPath', '.githooks'])

  mkdirSync(path.join(root, '.githooks'))
  for (const hook of ['post-checkout', 'post-merge']) {
    const target = path.join(root, '.githooks', hook)

    copyFileSync(path.join(REPO_ROOT, '.githooks', hook), target)
    chmodSync(target, 0o755)
  }

  mkdirSync(path.join(root, 'bin'))
  writeFileSync(
    path.join(root, 'bin', 'pan'),
    `#!/usr/bin/env bash\necho "$*" >> "$(pwd)/${SYNC_MARKER}"\nexit ${options.panExit ?? 0}\n`,
  )
  chmodSync(path.join(root, 'bin', 'pan'), 0o755)

  mkdirSync(path.join(root, 'governance', 'policies'), { recursive: true })
  writeFileSync(
    path.join(root, 'governance', 'policies', 'COMMS-001.json'),
    '{}\n',
  )
  writeFileSync(path.join(root, 'README.md'), '# Fixture\n')
  writeFileSync(path.join(root, '.gitignore'), `.cursor/\n${SYNC_MARKER}\n`)

  if (options.cursor !== false) {
    mkdirSync(path.join(root, '.cursor', 'rules'), { recursive: true })
  }

  gitOk(root, ['add', '.'])
  gitOk(root, ['commit', '-q', '-m', 'initial'])

  return { root }
}

function commitOnBranch(root: string, branch: string, file: string): void {
  gitOk(root, ['checkout', '-q', '-b', branch])
  writeFileSync(path.join(root, file), `${branch}\n`)
  gitOk(root, ['commit', '-q', '-am', branch])
  gitOk(root, ['checkout', '-q', 'main'])
}

function syncCalls(root: string): string[] {
  const marker = path.join(root, SYNC_MARKER)

  return existsSync(marker)
    ? readFileSync(marker, 'utf8').trim().split('\n')
    : []
}

test('a fast-forward merge across a policy change resyncs the projection', () => {
  const { root } = createRepo()

  commitOnBranch(root, 'release', 'governance/policies/COMMS-001.json')
  const before = syncCalls(root).length

  gitOk(root, ['merge', '-q', '--ff-only', 'release'])

  assert.deepEqual(syncCalls(root).slice(before), ['models --sync'])
})

test('a checkout across a policy change resyncs, and one across other files does not', () => {
  const { root } = createRepo()

  commitOnBranch(root, 'policy', 'governance/policies/COMMS-001.json')
  commitOnBranch(root, 'docs', 'README.md')
  const before = syncCalls(root).length

  gitOk(root, ['checkout', '-q', 'docs'])
  assert.equal(syncCalls(root).length, before)

  gitOk(root, ['checkout', '-q', 'policy'])
  assert.deepEqual(syncCalls(root).slice(before), ['models --sync'])
})

test('a checkout without a local .cursor projection never syncs', () => {
  const { root } = createRepo({ cursor: false })

  commitOnBranch(root, 'policy', 'governance/policies/COMMS-001.json')
  gitOk(root, ['checkout', '-q', 'policy'])

  assert.deepEqual(syncCalls(root), [])
})

test('a VS Code projection alone resyncs when a VS Code source changes', () => {
  const { root } = createRepo({ cursor: false })

  mkdirSync(path.join(root, 'library', 'vscode'), { recursive: true })
  writeFileSync(path.join(root, 'library', 'vscode', 'hooks.json'), '{}\n')
  gitOk(root, ['add', '.'])
  gitOk(root, ['commit', '-q', '-m', 'vscode source'])
  mkdirSync(path.join(root, '.github', 'hooks'), { recursive: true })
  writeFileSync(path.join(root, '.github', 'hooks', 'pan-hooks.json'), '{}\n')
  writeFileSync(
    path.join(root, '.gitignore'),
    `.cursor/\n.github/\n${SYNC_MARKER}\n`,
  )
  gitOk(root, ['commit', '-q', '-am', 'ignore projection'])

  commitOnBranch(root, 'hooks', 'library/vscode/hooks.json')
  const before = syncCalls(root).length

  gitOk(root, ['checkout', '-q', 'hooks'])
  assert.deepEqual(syncCalls(root).slice(before), ['models --sync'])
})

test('a failed sync reports the manual command and never fails the merge', () => {
  const { root } = createRepo({ panExit: 1 })

  commitOnBranch(root, 'release', 'governance/policies/COMMS-001.json')
  const stderr = gitOk(root, ['merge', '-q', '--ff-only', 'release'])

  assert.match(stderr, /run \.\/bin\/pan models --sync/u)
})
