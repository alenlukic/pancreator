import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { detectWorkspaceTechnologies } from '../../src/lib/technologies.js'

function createTechnologyFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-technologies-'))

  writeFileSync(
    path.join(root, 'config.json'),
    JSON.stringify({
      schema_version: 1,
      workspace_root: '.',
      installation_mode: 'embedded',
    }),
  )

  return root
}

function git(root: string, args: string[]): void {
  execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

test('detects sorted manifest and source language evidence', () => {
  const root = createTechnologyFixture()

  try {
    writeFileSync(path.join(root, 'package.json'), '{ "name": "fixture" }\n')
    writeFileSync(
      path.join(root, 'pyproject.toml'),
      '[project]\nname = "fixture"\n',
    )
    mkdirSync(path.join(root, 'src'), { recursive: true })
    writeFileSync(
      path.join(root, 'src', 'index.ts'),
      'export const value = 1\n',
    )
    writeFileSync(path.join(root, 'src', 'server.rs'), 'fn main() {}\n')
    mkdirSync(path.join(root, 'node_modules'), { recursive: true })
    writeFileSync(path.join(root, 'node_modules', 'ignored.py'), 'VALUE = 1\n')
    // Ignored paths (dependency trees, the embedded harness target) never
    // contribute language evidence.
    mkdirSync(path.join(root, '.pancreator', 'target'), { recursive: true })
    writeFileSync(
      path.join(root, '.pancreator', 'target', 'main.py'),
      'VALUE = 1\n',
    )

    assert.deepEqual(detectWorkspaceTechnologies(root), {
      languages: [
        { id: 'javascript', evidence: ['package.json'] },
        { id: 'python', evidence: ['pyproject.toml'] },
        { id: 'typescript', evidence: ['src/index.ts'] },
      ],
      unsupported_evidence: ['src/server.rs'],
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('detects inside an explicit workspace override', () => {
  const root = createTechnologyFixture()

  try {
    writeFileSync(path.join(root, 'package.json'), '{ "name": "fixture" }\n')
    mkdirSync(path.join(root, 'nested'), { recursive: true })
    writeFileSync(
      path.join(root, 'nested', 'pyproject.toml'),
      '[project]\nname = "nested"\n',
    )

    assert.deepEqual(
      detectWorkspaceTechnologies(root, { workspace: 'nested' }),
      {
        languages: [{ id: 'python', evidence: ['pyproject.toml'] }],
        unsupported_evidence: [],
      },
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('uses tracked source evidence in git workspaces', () => {
  const root = createTechnologyFixture()

  try {
    mkdirSync(path.join(root, 'src'), { recursive: true })
    writeFileSync(
      path.join(root, 'src', 'tracked.ts'),
      'export const value = 1\n',
    )
    writeFileSync(path.join(root, 'src', 'untracked.py'), 'VALUE = 1\n')
    writeFileSync(path.join(root, 'src', 'tracked.rs'), 'fn main() {}\n')

    git(root, ['init', '-q'])
    git(root, ['add', 'config.json', 'src/tracked.ts', 'src/tracked.rs'])

    assert.deepEqual(detectWorkspaceTechnologies(root), {
      languages: [{ id: 'typescript', evidence: ['src/tracked.ts'] }],
      unsupported_evidence: ['src/tracked.rs'],
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
