import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  buildPanFunctionBlock,
  configureShellAlias,
  countPanFunctionBlocks,
  resolvePanWalkUp,
  shellRcCandidates,
  upsertPanFunctionBlock,
} from '../../src/lib/shell-alias.js'

function makeHome(): string {
  return mkdtempSync(path.join(tmpdir(), 'pancreator-shell-home-'))
}

function walkDeps(
  roots: Record<string, 'embedded' | 'self_development' | 'invalid'>,
) {
  return {
    pathExists: (filePath: string) => {
      const normalized = path.resolve(filePath)

      for (const [root, kind] of Object.entries(roots)) {
        if (
          kind === 'embedded' &&
          normalized === path.join(root, '.pancreator', 'bin', 'pan')
        ) {
          return true
        }

        if (
          kind === 'self_development' &&
          normalized === path.join(root, 'bin', 'pan')
        ) {
          return true
        }

        if (
          kind === 'invalid' &&
          normalized === path.join(root, 'bin', 'pan')
        ) {
          return true
        }

        if (
          (kind === 'self_development' || kind === 'invalid') &&
          normalized === path.join(root, 'project.json')
        ) {
          return true
        }
      }

      return false
    },
    readFile: (filePath: string) => {
      const normalized = path.resolve(filePath)

      for (const [root, kind] of Object.entries(roots)) {
        if (normalized !== path.join(root, 'project.json')) {
          continue
        }

        if (kind === 'self_development') {
          return JSON.stringify({ installation_mode: 'self_development' })
        }

        return JSON.stringify({ installation_mode: 'embedded' })
      }

      throw new Error(`missing file: ${filePath}`)
    },
  }
}

test('shellRcCandidates includes bash and zsh startup files', () => {
  const candidates = shellRcCandidates('/tmp/home')

  assert.deepEqual(
    candidates.map((candidate) => candidate.path),
    ['/tmp/home/.zshrc', '/tmp/home/.bashrc'],
  )
})

test('buildPanFunctionBlock emits a single guarded pan shell function', () => {
  const block = buildPanFunctionBlock()

  assert.match(block, /^# >>> pancreator pan >>>/u)
  assert.match(block, /pan\(\) \{/u)
  assert.match(block, /\.pancreator\/bin\/pan/u)
  assert.match(block, /installation_mode==="self_development"/u)
  assert.match(block, /# <<< pancreator pan <<<$/u)
  assert.doesNotMatch(block, /alias pan=/u)
})

test('resolvePanWalkUp finds the nearest embedded pan from a nested directory', () => {
  const repoA = '/tmp/repo-a'
  const repoB = '/tmp/repo-b'
  const match = resolvePanWalkUp(
    path.join(repoA, 'apps', 'service'),
    walkDeps({
      [repoA]: 'embedded',
      [repoB]: 'embedded',
    }),
  )

  assert.deepEqual(match, {
    kind: 'embedded',
    panPath: path.join(repoA, '.pancreator', 'bin', 'pan'),
    rootDir: repoA,
  })
})

test('resolvePanWalkUp prefers the nearest repo when multiple installs exist', () => {
  const repoA = '/tmp/nested/repo-a'
  const repoB = '/tmp/nested'
  const fromA = resolvePanWalkUp(
    path.join(repoA, 'pkg'),
    walkDeps({
      [repoA]: 'embedded',
      [repoB]: 'embedded',
    }),
  )
  const fromB = resolvePanWalkUp(
    path.join(repoB, 'other'),
    walkDeps({
      [repoA]: 'embedded',
      [repoB]: 'embedded',
    }),
  )

  assert.equal(fromA?.rootDir, repoA)
  assert.equal(fromB?.rootDir, repoB)
})

test('resolvePanWalkUp finds a self-development source checkout', () => {
  const source = '/tmp/pancreator-source'
  const match = resolvePanWalkUp(
    path.join(source, 'src', 'lib'),
    walkDeps({
      [source]: 'self_development',
    }),
  )

  assert.deepEqual(match, {
    kind: 'self_development',
    panPath: path.join(source, 'bin', 'pan'),
    rootDir: source,
  })
})

test('resolvePanWalkUp returns null when no install exists in the ancestor tree', () => {
  const match = resolvePanWalkUp('/tmp/nowhere/deep/path', walkDeps({}))

  assert.equal(match, null)
})

test('resolvePanWalkUp ignores bin/pan without self_development project.json', () => {
  const root = '/tmp/not-self-dev'
  const match = resolvePanWalkUp(root, walkDeps({ [root]: 'invalid' }))

  assert.equal(match, null)
})

test('upsertPanFunctionBlock appends without destructive edits outside markers', () => {
  const original = 'export PATH="$HOME/bin:$PATH"\n'
  const next = upsertPanFunctionBlock(original)

  assert.match(next, /^export PATH="\$HOME\/bin:\$PATH"/u)
  assert.match(next, /pan\(\) \{/u)
  assert.equal(countPanFunctionBlocks(next), 1)
})

test('upsertPanFunctionBlock is idempotent across repeated installs', () => {
  const first = upsertPanFunctionBlock('')
  const second = upsertPanFunctionBlock(first)

  assert.equal(first, second)
  assert.equal(countPanFunctionBlocks(second), 1)
})

test('upsertPanFunctionBlock migrates legacy per-workspace alias blocks', () => {
  const legacy = [
    '# >>> pancreator pan@/tmp/repo-a >>>',
    "alias pan='/tmp/repo-a/.pancreator/bin/pan'",
    '# <<< pancreator pan@/tmp/repo-a <<<',
    '',
    '# >>> pancreator pan@/tmp/repo-b >>>',
    "alias pan='/tmp/repo-b/.pancreator/bin/pan'",
    '# <<< pancreator pan@/tmp/repo-b <<<',
  ].join('\n')
  const next = upsertPanFunctionBlock(legacy)

  assert.doesNotMatch(next, /repo-a/u)
  assert.doesNotMatch(next, /repo-b/u)
  assert.doesNotMatch(next, /alias pan=/u)
  assert.equal(countPanFunctionBlocks(next), 1)
})

test('configureShellAlias leaves exactly one pan block after two repo installs', () => {
  const home = makeHome()

  try {
    const first = configureShellAlias({ homeDir: home })
    const second = configureShellAlias({ homeDir: home })

    assert.equal(first.updated.length, 2)
    assert.equal(second.updated.length, 0)
    assert.equal(second.skipped.length, 2)

    const zshrc = readFileSync(path.join(home, '.zshrc'), 'utf8')
    const bashrc = readFileSync(path.join(home, '.bashrc'), 'utf8')

    assert.equal(countPanFunctionBlocks(zshrc), 1)
    assert.equal(countPanFunctionBlocks(bashrc), 1)
    assert.doesNotMatch(zshrc, /alias pan=/u)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('configureShellAlias tolerates unreadable rc files without throwing', () => {
  const home = makeHome()
  const blocked = path.join(home, '.bashrc')

  writeFileSync(blocked, 'export FOO=1\n', 'utf8')
  chmodSync(blocked, 0o000)

  try {
    const result = configureShellAlias({ homeDir: home })

    assert.ok(result.updated.includes(path.join(home, '.zshrc')))
    assert.ok(result.skipped.includes(blocked))
    assert.match(result.messages.join('\n'), /Skipped/u)
    assert.ok(existsSync(path.join(home, '.zshrc')))
  } finally {
    chmodSync(blocked, 0o644)
    rmSync(home, { recursive: true, force: true })
  }
})
