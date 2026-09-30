import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { PanError } from '../../src/lib/errors.js'
import { validateProjectionDrift } from '../../src/lib/projection.js'
import {
  localConfigName,
  readProjectConfig,
} from '../../src/lib/project-config.js'
import {
  createWorktree,
  handoffSelfDevelopmentLocalConfig,
  readWorktreeIndex,
  removeWorktree,
  resolveOrCreateWorktree,
  resolveWorktreeWorkspace,
  worktreeReadiness,
  writeWorktreeIndex,
} from '../../src/lib/worktrees.js'
import { createFixture, writeJson } from '../helpers.js'
import { createTestTempDirectory } from '../temp.js'

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

  // The setup command records that it ran. Asserting only the copied file
  // left the case green when setup was bypassed entirely, which is the
  // ordering the case name promises.
  writeJson(path.join(root, 'config_overrides.json'), {
    marker: 'handoff-ok',
    worktrees: {
      setup: [
        String.raw`node -e "const fs=require('fs'); const c=JSON.parse(fs.readFileSync('config_overrides.json','utf8')); if(c.marker!=='handoff-ok') process.exit(1); fs.writeFileSync('setup-observed.txt', c.marker)"`,
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
  assert.equal(
    readFileSync(path.join(worktreePath, 'setup-observed.txt'), 'utf8'),
    'handoff-ok',
    'the declared setup command ran, after the config landed',
  )
  assert.deepEqual(
    readProjectConfig(worktreePath)?.worktrees?.setup,
    readProjectConfig(root)?.worktrees?.setup,
  )

  rmSync(path.join(worktreePath, 'setup-observed.txt'))

  // The copy is operator-local configuration, so it must not turn the new
  // worktree dirty; a gate reads that status as uncommitted work.
  assert.equal(
    execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: worktreePath,
      encoding: 'utf8',
    }),
    '',
  )
  assert.equal(
    execFileSync('git', ['check-ignore', 'config_overrides.json'], {
      cwd: worktreePath,
      encoding: 'utf8',
    }).trim(),
    'config_overrides.json',
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
  writeFileSync(path.join(root, '.env'), 'SECRET=1\n')
  writeFileSync(path.join(root, 'operator.local'), 'ignore me\n')

  const statusBeforeHandoff = gitStatus(root)
  const record = createWorktree(root, 'precedence')
  const worktreePath = path.join(root, record.path)

  assert.equal(
    JSON.parse(
      readFileSync(path.join(worktreePath, 'config_overrides.json'), 'utf8'),
    ).marker,
    'current-name',
  )
  assert.equal(existsSync(path.join(worktreePath, 'config.local.json')), false)

  // The handoff carries harness configuration, not secrets or unrelated
  // operator files, and it leaves the source checkout untouched.
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
  const targetRoot = createTestTempDirectory('pan-target-')

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

test('worktree creation and branch restoration refresh disposable Cursor projections', () => {
  const root = createFixture()
  const record = createWorktree(root, 'projection-fresh')
  const worktreePath = path.join(root, record.path)
  const projectionPath = path.join(
    worktreePath,
    '.cursor',
    'agents',
    'pan-coder.md',
  )

  assert.deepEqual(validateProjectionDrift(worktreePath).errors, [])

  execFileSync('git', ['switch', '-c', 'projection-stale'], {
    cwd: worktreePath,
  })
  writeFileSync(projectionPath, '# stale projection\n')
  assert.ok(
    validateProjectionDrift(worktreePath).errors.some((error) =>
      error.includes('projection drift'),
    ),
  )

  assert.equal(resolveWorktreeWorkspace(root, record.name), record.path)
  assert.deepEqual(validateProjectionDrift(worktreePath).errors, [])
})

// AC-016. HR-008's incident fast-forwarded a worktree on its recorded branch:
// the head moved, the branch name did not, and a refresh keyed to a branch
// switch never ran. The resolve-time refresh must follow the head.
test('worktree resolution refreshes the projection after a same-branch head move', () => {
  const root = createFixture()
  const record = createWorktree(root, 'projection-head-move')
  const worktreePath = path.join(root, record.path)
  const canonicalPath = path.join(
    worktreePath,
    'library',
    'cursor',
    'agents',
    'coder.md',
  )

  assert.deepEqual(validateProjectionDrift(worktreePath).errors, [])

  // Land a canonical-source change as a new commit on the recorded branch.
  // The checked-out projection now predates the head it should render.
  writeFileSync(
    canonicalPath,
    `${readFileSync(canonicalPath, 'utf8')}\nMoved with the head.\n`,
  )
  execFileSync('git', ['add', 'library/cursor/agents/coder.md'], {
    cwd: worktreePath,
  })
  execFileSync('git', ['commit', '-q', '-m', 'chore: move the head'], {
    cwd: worktreePath,
  })
  assert.ok(
    validateProjectionDrift(worktreePath).errors.some((error) =>
      error.includes('projection drift'),
    ),
  )

  assert.equal(resolveWorktreeWorkspace(root, record.name), record.path)
  assert.equal(
    execFileSync('git', ['branch', '--show-current'], {
      cwd: worktreePath,
      encoding: 'utf8',
    }).trim(),
    record.branch,
  )
  assert.deepEqual(validateProjectionDrift(worktreePath).errors, [])
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

test('readiness names each missing item and passes a provisioned worktree', () => {
  const root = createFixture()

  writeJson(path.join(root, 'config_overrides.json'), {
    marker: 'handoff',
    worktrees: { readiness_paths: ['deps', 'build'] },
  })

  const record = createWorktree(root, 'readiness-one')
  const worktreePath = path.join(root, record.path)
  const missing = worktreeReadiness(root, worktreePath)

  assert.equal(missing.ready, false)
  assert.deepEqual(
    missing.gaps.map((gap) => gap.path),
    ['deps', 'build'],
  )
  assert.deepEqual(missing.declared_setup_paths, ['deps', 'build'])

  mkdirSync(path.join(worktreePath, 'deps'), { recursive: true })

  assert.deepEqual(
    worktreeReadiness(root, worktreePath).gaps.map((gap) => gap.path),
    ['build'],
  )

  mkdirSync(path.join(worktreePath, 'build'), { recursive: true })

  const ready = worktreeReadiness(root, worktreePath)

  assert.equal(ready.ready, true)
  assert.deepEqual(ready.gaps, [])

  rmSync(path.join(worktreePath, 'config_overrides.json'))

  const handoffGap = worktreeReadiness(root, worktreePath)

  assert.equal(handoffGap.ready, false)
  assert.deepEqual(
    handoffGap.gaps.map((gap) => [gap.kind, gap.path]),
    [['configuration_handoff', 'config_overrides.json']],
  )
  assert.match(handoffGap.gaps[0]?.reason ?? '', /config_overrides\.json/u)
})

test('resolve adopts a Git-registered worktree at the expected path', () => {
  const root = createFixture()

  writeJson(path.join(root, 'config_overrides.json'), {
    marker: 'adopted',
    worktrees: {
      setup: [
        String.raw`node -e "require('fs').writeFileSync('setup-ran','1')"`,
      ],
    },
  })

  const worktreePath = path.join(root, 'worktrees', 'operator', 'adopt-one')

  mkdirSync(path.dirname(worktreePath), { recursive: true })
  execFileSync('git', ['worktree', 'add', '-b', 'adopt-one', worktreePath], {
    cwd: root,
    encoding: 'utf8',
  })

  const record = resolveOrCreateWorktree(root, 'adopt-one', 'Adopted')

  assert.equal(record.path, 'worktrees/operator/adopt-one')
  assert.equal(record.branch, 'adopt-one')
  assert.ok(record.adopted_at)
  assert.equal(readWorktreeIndex(root).worktrees[0]?.name, 'adopt-one')
  assert.equal(
    JSON.parse(
      readFileSync(path.join(worktreePath, 'config_overrides.json'), 'utf8'),
    ).marker,
    'adopted',
  )
  assert.equal(existsSync(path.join(worktreePath, 'setup-ran')), true)
})

test('adoption refuses a path that is not that worktree', () => {
  const plainRoot = createFixture()
  const plainPath = path.join(plainRoot, 'worktrees', 'operator', 'plain-dir')

  mkdirSync(plainPath, { recursive: true })

  assert.throws(
    () => createWorktree(plainRoot, 'plain-dir'),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'WORKTREE_PATH_EXISTS',
  )

  const branchRoot = createFixture()
  const branchPath = path.join(
    branchRoot,
    'worktrees',
    'operator',
    'other-branch',
  )

  mkdirSync(path.dirname(branchPath), { recursive: true })
  execFileSync('git', ['worktree', 'add', '-b', 'not-the-name', branchPath], {
    cwd: branchRoot,
    encoding: 'utf8',
  })

  assert.throws(
    () => createWorktree(branchRoot, 'other-branch'),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'WORKTREE_PATH_EXISTS',
  )
})

test('a dirty removal refuses before any index mutation', () => {
  const root = createFixture()
  const record = createWorktree(root, 'dirty-one')

  writeFileSync(path.join(root, record.path, 'scratch.txt'), 'work\n')

  assert.throws(
    () => removeWorktree(root, 'dirty-one'),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'WORKTREE_DIRTY',
  )

  assert.equal(readWorktreeIndex(root).worktrees.length, 1)

  const removed = removeWorktree(root, 'dirty-one', { force: true })

  assert.equal(removed.removed_worktree, true)
  assert.equal(readWorktreeIndex(root).worktrees.length, 0)
})

// AC-024. The copy escaped as a bare Node.js filesystem error, so an agent
// facing a half-prepared worktree had no harness code to route on and no
// statement of which file or operation had failed.
test('a failed override copy raises a coded error naming the file and operation', () => {
  const root = createFixture()
  const worktreePath = path.join(root, 'runtime/worktrees/operator/blocked')
  const configName = localConfigName(root)

  writeFileSync(path.join(root, configName), '{}\n', 'utf8')
  // A directory at the target path fails the copy the way a permission or a
  // full disk would, without depending on either.
  mkdirSync(path.join(worktreePath, configName), { recursive: true })

  assert.throws(
    () => handoffSelfDevelopmentLocalConfig(root, worktreePath),
    (error: unknown) => {
      assert.ok(error instanceof PanError)
      assert.equal(error.code, 'WORKTREE_OVERRIDE_COPY_FAILED')
      assert.match(error.message, new RegExp(configName, 'u'))
      assert.deepEqual(
        {
          operation: (error.details as { operation?: string }).operation,
          file: (error.details as { file?: string }).file,
        },
        { operation: 'configuration_handoff', file: configName },
      )

      return true
    },
  )
})
