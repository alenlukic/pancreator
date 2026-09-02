import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  readProjectConfig,
  worktreesConfig,
} from '../../src/lib/project-config.js'
import {
  createWorktree,
  isWorktreeName,
  readWorktreeIndex,
  reconcileWorktrees,
  resolveWorktreeWorkspace,
  resolveWorkspacePathOrWorktree,
  writeWorktreeIndex,
  type WorktreeIndex,
} from '../../src/lib/worktrees.js'
import { createFixture, writeJson } from '../helpers.js'

const MINIMAL_CONFIG = { schema_version: 1 }

/** Bare root for helpers that read only config.json and the worktree index. */
function scratchRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pan-worktrees-'))

  writeJson(path.join(root, 'config.json'), MINIMAL_CONFIG)

  return root
}

test('worktree names use lowercase words with single hyphens', () => {
  assert.equal(isWorktreeName('feature-one'), true)
  assert.equal(isWorktreeName('feature--one'), false)
  assert.equal(isWorktreeName('Feature-one'), false)
  assert.equal(isWorktreeName('63328_Aug-12-1196_5360f379'), false)
})

test('worktree config uses defaults and local overrides', () => {
  const root = createFixture()

  assert.deepEqual(worktreesConfig(root), {
    root: 'worktrees/operator',
    branch_prefix: 'worktree/',
    setup: [],
  })

  writeJson(path.join(root, 'config_overrides.json'), {
    worktrees: {
      root: 'runtime/operator-worktrees',
      branch_prefix: 'task/',
      setup: ['node -e "process.exit(0)"'],
    },
  })

  assert.deepEqual(worktreesConfig(root), {
    root: 'runtime/operator-worktrees',
    branch_prefix: 'task/',
    setup: ['node -e "process.exit(0)"'],
  })
})

test('project config rejects malformed worktree settings', () => {
  const root = scratchRoot()
  const configPath = path.join(root, 'config.json')
  const config: Record<string, unknown> = MINIMAL_CONFIG

  const rejected: Array<[unknown, RegExp]> = [
    ['runtime/worktrees', /config\.json\.worktrees MUST be an object/u],
    [{ root: '' }, /worktrees\.root MUST be a non-empty repository-relative/u],
    [{ root: 7 }, /worktrees\.root MUST be a non-empty repository-relative/u],
    [
      { root: '/tmp/worktrees' },
      /worktrees\.root MUST be a non-empty repository-relative/u,
    ],
    [
      { root: '../outside' },
      /worktrees\.root MUST be a non-empty repository-relative/u,
    ],
    [
      { branch_prefix: 'not valid' },
      /worktrees\.branch_prefix MUST be a non-empty string without whitespace/u,
    ],
    [
      { branch_prefix: '' },
      /worktrees\.branch_prefix MUST be a non-empty string without whitespace/u,
    ],
    [{ setup: 'npm ci' }, /worktrees\.setup MUST be an array/u],
    [
      { setup: ['npm ci', ''] },
      /worktrees\.setup\[1\] MUST be a non-empty command string/u,
    ],
  ]

  for (const [worktrees, message] of rejected) {
    writeJson(configPath, { ...config, worktrees })

    assert.throws(() => readProjectConfig(root), message)
  }

  writeJson(configPath, {
    ...config,
    worktrees: { root: 'runtime/operator-worktrees', branch_prefix: 'task/' },
  })

  assert.equal(readProjectConfig(root)?.schema_version, 1)
})

test('worktree index round-trips through its atomic writer', () => {
  const root = scratchRoot()
  const index: WorktreeIndex = {
    schema_version: 1,
    worktrees: [
      {
        name: 'feature-one',
        path: 'worktrees/operator/feature-one',
        branch: 'worktree/feature-one',
        created_from: '0123456789abcdef',
        description: 'Feature one',
        created_at: '2026-08-12T00:00:00.000Z',
      },
    ],
  }

  writeWorktreeIndex(root, index)

  assert.deepEqual(readWorktreeIndex(root), index)

  const indexPath = path.join(root, 'worktrees', 'operator', 'index.json')

  assert.match(readFileSync(indexPath, 'utf8'), /\n$/u)

  writeFileSync(
    indexPath,
    '{"schema_version":1,"worktrees":[{"name":"bad name"}]}\n',
  )

  assert.throws(() => readWorktreeIndex(root), /MUST be a non-empty string/u)
})

test('reconcile validates its target and source arguments before any merge', () => {
  const root = scratchRoot()

  assert.throws(
    () => reconcileWorktrees(root, {}, ['one', 'two']),
    /exactly one of --into or --into-branch/u,
  )
  assert.throws(
    () =>
      reconcileWorktrees(root, { into: 'target', into_branch: 'main' }, [
        'one',
        'two',
      ]),
    /exactly one of --into or --into-branch/u,
  )
  assert.throws(
    () => reconcileWorktrees(root, { into: 'target' }, ['one']),
    /at least two --source worktrees/u,
  )
  assert.throws(
    () => reconcileWorktrees(root, { into: 'target' }, ['one', 'one']),
    /MUST be unique/u,
  )
  assert.throws(
    () => reconcileWorktrees(root, { into: 'target' }, ['one', 'target']),
    /MUST NOT also be a source/u,
  )
})

test('workspace specifiers pass paths through and resolve recorded names', () => {
  const root = scratchRoot()

  assert.equal(
    resolveWorkspacePathOrWorktree(root, 'nested/project'),
    'nested/project',
  )
  assert.equal(resolveWorkspacePathOrWorktree(root, 'unknown'), 'unknown')

  writeWorktreeIndex(root, {
    schema_version: 1,
    worktrees: [
      {
        name: 'alpha',
        path: 'runtime/worktrees/operator/alpha',
        branch: 'worktree/alpha',
        created_from: '0123456789abcdef',
        description: 'Alpha',
        created_at: '2026-08-12T00:00:00.000Z',
      },
    ],
  })

  assert.equal(
    resolveWorkspacePathOrWorktree(root, 'alpha'),
    'runtime/worktrees/operator/alpha',
  )
})

test('legacy operator index remains active when the current index is absent', () => {
  const root = createFixture()
  const legacyIndexPath = path.join(
    root,
    'runtime',
    'worktrees',
    'operator',
    'index.json',
  )

  mkdirSync(path.dirname(legacyIndexPath), { recursive: true })
  writeJson(legacyIndexPath, {
    schema_version: 1,
    worktrees: [
      {
        name: 'legacy-one',
        path: 'runtime/worktrees/operator/legacy-one',
        branch: 'worktree/legacy-one',
        created_from: '0123456789abcdef',
        description: 'Legacy record',
        created_at: '2026-08-12T00:00:00.000Z',
      },
    ],
  })

  assert.deepEqual(readWorktreeIndex(root).worktrees[0]?.name, 'legacy-one')

  const currentIndexPath = path.join(
    root,
    'worktrees',
    'operator',
    'index.json',
  )

  mkdirSync(path.dirname(currentIndexPath), { recursive: true })
  writeJson(currentIndexPath, { schema_version: 1, worktrees: [] })

  assert.throws(
    () => readWorktreeIndex(root),
    /Both operator worktree indexes exist/u,
  )
})

test('new worktrees use the current root when the legacy index is active', () => {
  const root = createFixture()
  const legacyIndexPath = path.join(
    root,
    'runtime',
    'worktrees',
    'operator',
    'index.json',
  )

  mkdirSync(path.dirname(legacyIndexPath), { recursive: true })
  writeJson(legacyIndexPath, { schema_version: 1, worktrees: [] })

  const record = createWorktree(root, 'fresh')

  assert.equal(record.path, 'worktrees/operator/fresh')
  assert.equal(record.branch, 'fresh')
  assert.equal(readWorktreeIndex(root).worktrees[0]?.path, record.path)
})

test('a declared operator root keeps new worktrees where the operator put them', () => {
  const root = createFixture()

  writeJson(path.join(root, 'config_overrides.json'), {
    worktrees: { root: 'runtime/worktrees/operator' },
  })

  const legacyIndexPath = path.join(
    root,
    'runtime',
    'worktrees',
    'operator',
    'index.json',
  )

  mkdirSync(path.dirname(legacyIndexPath), { recursive: true })
  writeJson(legacyIndexPath, { schema_version: 1, worktrees: [] })

  const record = createWorktree(root, 'pinned')

  assert.equal(record.path, 'runtime/worktrees/operator/pinned')
  assert.equal(readWorktreeIndex(root).worktrees[0]?.path, record.path)
})

function gitStatus(root: string): string {
  return execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  })
}

function configureHarness(
  root: string,
  overrides: Record<string, unknown>,
): void {
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  writeFileSync(
    configPath,
    `${JSON.stringify({ ...config, ...overrides }, null, 2)}\n`,
  )
}

function initTargetRepository(targetRoot: string): void {
  execFileSync('git', ['init', '-q'], { cwd: targetRoot, encoding: 'utf8' })
  execFileSync('git', ['config', 'user.email', 'target@example.com'], {
    cwd: targetRoot,
    encoding: 'utf8',
  })
  execFileSync('git', ['config', 'user.name', 'Target'], {
    cwd: targetRoot,
    encoding: 'utf8',
  })
  writeFileSync(path.join(targetRoot, 'README.md'), '# target\n')
  writeFileSync(path.join(targetRoot, '.gitignore'), 'local-only/\n')
  execFileSync('git', ['add', '.'], { cwd: targetRoot, encoding: 'utf8' })
  execFileSync('git', ['commit', '-qm', 'target'], {
    cwd: targetRoot,
    encoding: 'utf8',
  })
}

test('self-development worktree receives local config before setup', () => {
  const root = createFixture()

  writeJson(path.join(root, 'config_overrides.json'), {
    marker: 'handoff-ok',
    worktrees: {
      setup: [
        String.raw`node -e "const fs=require('fs'); const c=JSON.parse(fs.readFileSync('config_overrides.json','utf8')); if(c.marker!=='handoff-ok') process.exit(1)"`,
      ],
    },
  })

  const record = createWorktree(root, 'handoff')
  const worktreePath = path.join(root, record.path)

  assert.equal(
    JSON.parse(
      readFileSync(path.join(worktreePath, 'config_overrides.json'), 'utf8'),
    ).marker,
    'handoff-ok',
  )
  assert.deepEqual(
    readProjectConfig(worktreePath)?.worktrees?.setup,
    readProjectConfig(root)?.worktrees?.setup,
  )
})

test('worktree handoff follows recognized local config', () => {
  const withoutOverride = createFixture()
  const withoutRecord = createWorktree(withoutOverride, 'plain')

  assert.equal(
    existsSync(
      path.join(withoutOverride, withoutRecord.path, 'config_overrides.json'),
    ),
    false,
  )
  assert.equal(
    existsSync(
      path.join(withoutOverride, withoutRecord.path, 'config.local.json'),
    ),
    false,
  )

  const legacyOnly = createFixture()

  writeFileSync(
    path.join(legacyOnly, 'config.local.json'),
    `${JSON.stringify({ marker: 'legacy-only' }, null, 2)}\n`,
  )

  const legacyRecord = createWorktree(legacyOnly, 'legacy')
  const legacyWorktree = path.join(legacyOnly, legacyRecord.path)

  assert.equal(
    JSON.parse(
      readFileSync(path.join(legacyWorktree, 'config.local.json'), 'utf8'),
    ).marker,
    'legacy-only',
  )
  assert.equal(
    existsSync(path.join(legacyWorktree, 'config_overrides.json')),
    false,
  )
})

test('worktree handoff preserves local config precedence', () => {
  const root = createFixture()

  writeJson(path.join(root, 'config_overrides.json'), {
    marker: 'current-name',
  })
  writeFileSync(
    path.join(root, 'config.local.json'),
    `${JSON.stringify({ marker: 'legacy-name' }, null, 2)}\n`,
  )

  const record = createWorktree(root, 'precedence')
  const worktreePath = path.join(root, record.path)

  assert.equal(
    JSON.parse(
      readFileSync(path.join(worktreePath, 'config_overrides.json'), 'utf8'),
    ).marker,
    'current-name',
  )
  assert.equal(existsSync(path.join(worktreePath, 'config.local.json')), false)
})

test('worktree handoff excludes secret and unrelated files', () => {
  const root = createFixture()

  writeJson(path.join(root, 'config_overrides.json'), { marker: 'handoff' })
  writeFileSync(path.join(root, '.env'), 'SECRET=1\n')
  writeFileSync(path.join(root, 'operator.local'), 'ignore me\n')
  const statusBeforeHandoff = gitStatus(root)

  const record = createWorktree(root, 'secrets')
  const worktreePath = path.join(root, record.path)

  assert.equal(
    existsSync(path.join(worktreePath, 'config_overrides.json')),
    true,
  )
  assert.equal(existsSync(path.join(worktreePath, '.env')), false)
  assert.equal(existsSync(path.join(worktreePath, 'operator.local')), false)
  assert.equal(gitStatus(root), statusBeforeHandoff)
})

test('target worktrees keep harness config at installation root', () => {
  const embeddedHarness = createFixture()
  const embeddedGitignore = readFileSync(
    path.join(embeddedHarness, '.gitignore'),
    'utf8',
  )
  const embeddedReadme = readFileSync(
    path.join(embeddedHarness, 'README.md'),
    'utf8',
  )

  configureHarness(embeddedHarness, {
    installation_mode: 'embedded',
    workspace_root: '.',
  })
  writeJson(path.join(embeddedHarness, 'config_overrides.json'), {
    marker: 'embedded-harness',
  })

  const embeddedStatusBefore = gitStatus(embeddedHarness)
  const embeddedRecord = createWorktree(embeddedHarness, 'embedded-target')
  const embeddedWorktree = path.join(embeddedHarness, embeddedRecord.path)

  assert.equal(
    existsSync(path.join(embeddedWorktree, 'config_overrides.json')),
    false,
  )
  assert.equal(
    readFileSync(path.join(embeddedHarness, '.gitignore'), 'utf8'),
    embeddedGitignore,
  )
  assert.equal(
    readFileSync(path.join(embeddedHarness, 'README.md'), 'utf8'),
    embeddedReadme,
  )
  assert.equal(gitStatus(embeddedHarness), embeddedStatusBefore)

  const detachedHarness = createFixture()
  const targetRoot = mkdtempSync(path.join(tmpdir(), 'pan-target-'))

  try {
    initTargetRepository(targetRoot)
    const targetGitignore = readFileSync(
      path.join(targetRoot, '.gitignore'),
      'utf8',
    )
    const targetReadme = readFileSync(
      path.join(targetRoot, 'README.md'),
      'utf8',
    )

    configureHarness(detachedHarness, {
      installation_mode: 'detached',
      workspace_root: targetRoot,
    })
    writeJson(path.join(detachedHarness, 'config_overrides.json'), {
      marker: 'detached-harness',
    })

    const targetStatusBefore = gitStatus(targetRoot)
    const detachedRecord = createWorktree(detachedHarness, 'detached-target')
    const detachedWorktree = path.join(detachedHarness, detachedRecord.path)

    assert.equal(
      existsSync(path.join(detachedWorktree, 'config_overrides.json')),
      false,
    )
    assert.equal(
      readFileSync(path.join(targetRoot, '.gitignore'), 'utf8'),
      targetGitignore,
    )
    assert.equal(
      readFileSync(path.join(targetRoot, 'README.md'), 'utf8'),
      targetReadme,
    )
    assert.equal(gitStatus(targetRoot), targetStatusBefore)
  } finally {
    rmSync(targetRoot, { recursive: true, force: true })
  }
})
test('worktree resolution restores the recorded branch only when clean', () => {
  const root = createFixture()
  const record = createWorktree(root, 'release-one')
  const worktreePath = path.join(root, record.path)

  execFileSync('git', ['switch', '-c', 'other-clean'], {
    cwd: worktreePath,
  })

  assert.equal(resolveWorktreeWorkspace(root, record.name), record.path)
  assert.equal(
    execFileSync('git', ['branch', '--show-current'], {
      cwd: worktreePath,
      encoding: 'utf8',
    }).trim(),
    'release-one',
  )

  execFileSync('git', ['switch', '-c', 'other-dirty'], {
    cwd: worktreePath,
  })
  writeFileSync(path.join(worktreePath, 'dirty.txt'), 'preserve me\n')

  const snapshot = (): Record<string, string> => ({
    branch: execFileSync('git', ['branch', '--show-current'], {
      cwd: worktreePath,
      encoding: 'utf8',
    }).trim(),
    head: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: worktreePath,
      encoding: 'utf8',
    }).trim(),
    index: execFileSync('git', ['diff', '--cached'], {
      cwd: worktreePath,
      encoding: 'utf8',
    }),
    status: execFileSync('git', ['status', '--porcelain=v1'], {
      cwd: worktreePath,
      encoding: 'utf8',
    }),
    file: readFileSync(path.join(worktreePath, 'dirty.txt'), 'utf8'),
    registry: readFileSync(
      path.join(root, 'worktrees', 'operator', 'index.json'),
      'utf8',
    ),
  })
  const before = snapshot()

  assert.throws(
    () => resolveWorktreeWorkspace(root, record.name),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'WORKTREE_DIRTY_BRANCH_MISMATCH',
  )
  assert.deepEqual(snapshot(), before)
})

test('worktree resolution preserves legacy branches and rejects unavailable recorded branches', () => {
  const legacyRoot = createFixture()
  const legacyRecord = createWorktree(legacyRoot, 'legacy-one')
  const legacyPath = path.join(legacyRoot, legacyRecord.path)

  execFileSync('git', ['branch', '-m', 'worktree/legacy-one'], {
    cwd: legacyPath,
  })
  writeWorktreeIndex(legacyRoot, {
    schema_version: 1,
    worktrees: [{ ...legacyRecord, branch: 'worktree/legacy-one' }],
  })
  execFileSync('git', ['switch', '-c', 'legacy-alternate'], {
    cwd: legacyPath,
  })

  assert.equal(
    resolveWorktreeWorkspace(legacyRoot, legacyRecord.name),
    legacyRecord.path,
  )
  assert.equal(
    execFileSync('git', ['branch', '--show-current'], {
      cwd: legacyPath,
      encoding: 'utf8',
    }).trim(),
    'worktree/legacy-one',
  )

  const missingRoot = createFixture()
  const missingRecord = createWorktree(missingRoot, 'missing-one')
  const missingPath = path.join(missingRoot, missingRecord.path)

  execFileSync('git', ['switch', '-c', 'missing-alternate'], {
    cwd: missingPath,
  })
  execFileSync('git', ['branch', '-D', missingRecord.branch], {
    cwd: missingRoot,
  })

  assert.throws(
    () => resolveWorktreeWorkspace(missingRoot, missingRecord.name),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'WORKTREE_BRANCH_NOT_FOUND',
  )

  const heldRoot = createFixture()
  const heldRecord = createWorktree(heldRoot, 'held-one')
  const heldPath = path.join(heldRoot, heldRecord.path)

  execFileSync('git', ['switch', '-c', 'held-alternate'], { cwd: heldPath })
  execFileSync('git', ['switch', heldRecord.branch], { cwd: heldRoot })

  assert.throws(
    () => resolveWorktreeWorkspace(heldRoot, heldRecord.name),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'WORKTREE_BRANCH_HELD',
  )
})
