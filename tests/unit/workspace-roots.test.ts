import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  containsNestedGeneratedDirectory,
  isExcludedPath,
  matchWorkspaceGlob,
  resolveRoots,
} from '../../src/lib/workspace/roots.js'

function makeWorkspace(name: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `pancreator-roots-${name}-`))

  mkdirSync(path.join(root, '.pancreator'), { recursive: true })
  writeFileSync(path.join(root, 'README.md'), '# fixture\n')

  return root
}

test('resolveRoots excludes nested installation subtree', () => {
  const workspace = makeWorkspace('nested')
  const installation = path.join(
    workspace,
    'node_modules',
    '@pancreator',
    'core',
  )

  mkdirSync(installation, { recursive: true })

  const roots = resolveRoots({
    installation_root: installation,
    workspace_root: workspace,
  })

  assert.equal(
    roots.exclude.some((entry) =>
      entry.includes('node_modules/@pancreator/core'),
    ),
    true,
  )
})

test('resolveRoots keeps installation tracked during self-development', () => {
  const workspace = makeWorkspace('self-dev')
  const roots = resolveRoots({
    installation_root: workspace,
    workspace_root: workspace,
  })

  assert.equal(
    roots.exclude.some((entry) => entry === ''),
    false,
  )
  assert.equal(
    roots.exclude.some((entry) => entry === '.'),
    false,
  )
})

test('resolveRoots applies state-root precedence', () => {
  const workspace = makeWorkspace('precedence')
  const configPath = path.join(workspace, 'project.json')
  const envStateRoot = path.join(workspace, 'env-runtime')
  const explicitStateRoot = path.join(workspace, 'explicit-runtime')

  writeFileSync(
    configPath,
    JSON.stringify(
      {
        schema_version: 1,
        workspace_id: 'fixture-workspace',
        state_root: 'project-runtime',
      },
      null,
      2,
    ),
  )

  const previousEnv = process.env.PANCREATOR_STATE_ROOT
  process.env.PANCREATOR_STATE_ROOT = envStateRoot

  try {
    const fromEnv = resolveRoots({
      installation_root: workspace,
      workspace_root: workspace,
    })
    const fromExplicit = resolveRoots({
      installation_root: workspace,
      workspace_root: workspace,
      state_root: explicitStateRoot,
    })

    assert.equal(fromEnv.state_root, path.resolve(envStateRoot))
    assert.equal(fromExplicit.state_root, path.resolve(explicitStateRoot))
  } finally {
    if (previousEnv === undefined) {
      delete process.env.PANCREATOR_STATE_ROOT
    } else {
      process.env.PANCREATOR_STATE_ROOT = previousEnv
    }
  }
})

test('matchWorkspaceGlob preserves literal and directory glob exclusions', () => {
  assert.equal(
    matchWorkspaceGlob('package-lock.json', 'package-lock.json'),
    true,
  )
  assert.equal(
    matchWorkspaceGlob('package-lock.json', 'nested/package-lock.json'),
    false,
  )
  assert.equal(matchWorkspaceGlob('dist/**', 'dist/out.js'), true)
  assert.equal(matchWorkspaceGlob('dist/**', 'client/dist/out.js'), false)
  assert.equal(matchWorkspaceGlob('coverage/**', 'coverage/lcov.info'), true)
  assert.equal(matchWorkspaceGlob('exact/file.ts', 'exact/file.ts'), true)
  assert.equal(matchWorkspaceGlob('src/*/index.ts', 'src/lib/index.ts'), true)
  assert.equal(
    matchWorkspaceGlob('**/generated/**', 'client/generated/cache.json'),
    true,
  )
})

test('containsNestedGeneratedDirectory excludes dependency trees at any depth', () => {
  assert.equal(
    containsNestedGeneratedDirectory(
      'client/node_modules/.vite/vitest/da39a3ee/results.json',
    ),
    true,
  )
  assert.equal(
    containsNestedGeneratedDirectory('node_modules/pkg/index.js'),
    true,
  )
  assert.equal(containsNestedGeneratedDirectory('src/app.ts'), false)
})

test('isExcludedPath excludes nested generated files under node_modules', () => {
  const workspace = makeWorkspace('nested-generated')
  const configPath = path.join(workspace, 'project.json')

  writeFileSync(
    configPath,
    JSON.stringify(
      {
        schema_version: 1,
        workspace_id: 'fixture-workspace',
        tracking: {
          include: ['**/*'],
          exclude: [
            'dist/**',
            'node_modules/**',
            'coverage/**',
            'package-lock.json',
          ],
        },
      },
      null,
      2,
    ),
  )

  const roots = resolveRoots({
    installation_root: workspace,
    workspace_root: workspace,
  })

  assert.equal(
    isExcludedPath(
      roots,
      'client/node_modules/.vite/vitest/da39a3ee/results.json',
    ),
    true,
  )
  assert.equal(isExcludedPath(roots, 'src/tracked.ts'), false)
  assert.equal(isExcludedPath(roots, 'dist/out.js'), true)
})
