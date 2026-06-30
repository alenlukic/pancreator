import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { resolveRoots } from '../../src/lib/workspace/roots.js'

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
