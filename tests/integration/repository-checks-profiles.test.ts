import assert from 'node:assert/strict'
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  loadRepositoryChecks,
  repositoryChecksSourcePath,
  runRepositorySetup,
  runRepositoryCheck,
} from '../../src/lib/repository-checks.js'
import { createFixture, createTestTempDirectory } from '../helpers.js'
import { makeInstallation, writeChecks } from './repository-checks-helpers.js'

test('repository checks report missing profiles without guessing commands', () => {
  const { root } = makeInstallation()

  const result = runRepositoryCheck(root, 'full')

  assert.equal(result.status, 'not_configured')
  assert.deepEqual(result.results, [])

  writeChecks(root, {})

  const setup = runRepositorySetup(root)

  assert.equal(setup.status, 'not_configured')
  assert.deepEqual(setup.results, [])
})

test('self-development uses a tracked fallback without requiring runtime state', () => {
  const root = createFixture()
  const runtimeConfig = path.join(root, 'runtime', 'repository-checks.json')

  // Fixtures may copy ignored local runtime state from the source checkout.
  // Removing it verifies behavior from a clean Git clone.
  rmSync(runtimeConfig, { force: true })

  const config = loadRepositoryChecks(root)

  assert.deepEqual(config.profiles.static?.commands, ['npm run lint'])
  assert.match(
    repositoryChecksSourcePath(root),
    /library\/templates\/repository-checks\.self-development\.json$/u,
  )
})

test('repository checks run probes and commands in the configured workspace', () => {
  const { root, workspace } = makeInstallation()

  writeChecks(root, {
    fast: {
      description: 'fixture checks',
      probes: ['node -p "process.execPath"', 'node --version'],
      commands: ['node -e "process.stdout.write(process.cwd())"'],
    },
  })

  const result = runRepositoryCheck(root, 'fast')

  assert.equal(result.status, 'passed')
  assert.deepEqual(
    result.results.map((item) => item.kind),
    ['probe', 'probe', 'command'],
  )
  assert.equal(
    realpathSync(result.results[2]?.stdout ?? ''),
    realpathSync(workspace),
  )
  assert.match(result.results[0]?.stdout ?? '', /node/u)
  assert.match(result.results[1]?.stdout ?? '', /^v\d+/u)
})

test('a failed command does not stop the remaining command partitions', () => {
  const { root } = makeInstallation()

  writeChecks(root, {
    static: {
      probes: [],
      commands: [
        'node -e "console.error(\'backend partition failure\'); process.exit(1)"',
        'node -e "process.stdout.write(\'frontend partition ran\')"',
      ],
    },
  })

  const result = runRepositoryCheck(root, 'static')

  // Commands are independently meaningful partitions: an early backend
  // failure must not leave the frontend partition uncaptured, or a baseline
  // would represent surfaces it never observed.
  assert.equal(result.status, 'failed')
  assert.equal(result.results.length, 2)
  assert.equal(result.results[0]?.passed, false)
  assert.equal(result.results[1]?.passed, true)
  assert.match(result.results[1]?.stdout ?? '', /frontend partition ran/u)
})

test('repository checks run environment probes before ordinary probes', () => {
  const { root } = makeInstallation()

  writeChecks(root, {
    static: {
      environment_probes: ['node -e "process.exit(9)"'],
      probes: ['node -e "process.exit(0)"'],
      commands: ['node -e "process.exit(0)"'],
    },
  })

  const result = runRepositoryCheck(root, 'static')

  // One loop walks the environment probes, then the ordinary probes, then the
  // commands, and returns on the first failure.
  assert.equal(result.status, 'failed')
  assert.equal(result.results.length, 1)
  assert.equal(result.results[0]?.kind, 'probe')
  assert.equal(result.results[0]?.exit_code, 9)
})

test('repository check configuration rejects malformed command arrays', () => {
  const { root } = makeInstallation()

  writeChecks(root, {
    full: {
      probes: [],
      commands: [''],
    },
  })

  assert.throws(
    () => loadRepositoryChecks(root),
    /MUST be a non-empty command string/u,
  )
})

test('repository check configuration rejects identical fast and full commands', () => {
  const { root } = makeInstallation()

  writeChecks(root, {
    fast: {
      probes: ['node --version'],
      commands: ['node -e "process.exit(0)"'],
    },
    full: {
      probes: ['node --version'],
      commands: ['node   -e   "process.exit(0)"'],
    },
  })

  assert.throws(
    () => loadRepositoryChecks(root),
    /profiles\.fast MUST NOT duplicate profiles\.full/u,
  )
})

test('repository check supersets cannot shorten subset timeouts', () => {
  const { root } = makeInstallation()

  writeChecks(root, {
    fast: {
      timeout_ms: 10_000,
      probes: [],
      commands: ['node -e "process.exit(0)"'],
    },
    full: {
      timeout_ms: 5_000,
      probes: [],
      commands: [
        'node -e "process.exit(0)"',
        'node -e "process.stdout.write(\'full\')"',
      ],
    },
  })

  assert.throws(
    () => loadRepositoryChecks(root),
    /profiles\.full\.timeout_ms MUST be at least .*profiles\.fast\.timeout_ms/u,
  )
})

test('an isolation command must select both the failing file and case', () => {
  const { root } = makeInstallation()

  writeChecks(root, {
    fast: {
      probes: [],
      commands: ['npm test'],
      isolation_command: 'npm test -- {file}',
    },
  })

  assert.throws(
    () => loadRepositoryChecks(root),
    /isolation_command MUST be .* \{file\} and either \{test_pattern\} or \{test\}/u,
  )

  for (const isolationCommand of [
    'npm test -- {file} --case {test}',
    'npm test -- {file} --name-pattern {test_pattern}',
  ]) {
    writeChecks(root, {
      fast: {
        probes: [],
        commands: ['npm test'],
        isolation_command: isolationCommand,
      },
    })

    assert.equal(
      loadRepositoryChecks(root).profiles.fast?.isolation_command,
      isolationCommand,
    )
  }
})

/**
 * The self-development runtime configuration is untracked per-installation
 * state that nothing regenerates. A selector added to the tracked template
 * therefore reached no live gate, and the whole classifier sat inert in the
 * one installation that declares one. Adoption is keyed on identical
 * commands, so an operator-rewritten profile keeps its own configuration.
 */
test('a self-development profile adopts the template isolation command', () => {
  const { root } = makeInstallation()
  const templateCommand = './run-one -- --pattern {test_pattern} --file {file}'

  writeFileSync(
    path.join(root, 'config.json'),
    `${JSON.stringify({ schema_version: 1, installation_mode: 'self_development' }, null, 2)}\n`,
  )
  mkdirSync(path.join(root, 'library/templates'), { recursive: true })
  writeFileSync(
    path.join(
      root,
      'library/templates/repository-checks.self-development.json',
    ),
    `${JSON.stringify({
      schema_version: 1,
      profiles: {
        fast: {
          probes: [],
          commands: ['npm test'],
          isolation_command: templateCommand,
        },
      },
    })}\n`,
  )

  writeChecks(root, { fast: { probes: [], commands: ['npm test'] } })

  assert.equal(
    loadRepositoryChecks(root).profiles.fast?.isolation_command,
    templateCommand,
  )

  // An operator who replaced the command replaced the runner too, so the
  // template's selector no longer describes anything this profile runs.
  writeChecks(root, { fast: { probes: [], commands: ['npm run verify'] } })

  assert.equal(
    loadRepositoryChecks(root).profiles.fast?.isolation_command,
    undefined,
  )
})

/**
 * An eval grader reads the profile commands of a synthetic run directory that
 * holds a repository-check file and nothing else. Loading those profiles must
 * not start requiring a harness configuration the directory never had.
 */
test('a directory with no harness configuration still loads its profiles', () => {
  const bare = createTestTempDirectory('bare-checks-')

  mkdirSync(path.join(bare, 'runtime'), { recursive: true })
  writeFileSync(
    path.join(bare, 'runtime', 'repository-checks.json'),
    `${JSON.stringify({
      schema_version: 1,
      profiles: { fast: { probes: [], commands: ['npm test'] } },
    })}\n`,
  )

  assert.deepEqual(loadRepositoryChecks(bare).profiles.fast?.commands, [
    'npm test',
  ])
})

test('a target installation adopts no isolation command', () => {
  const { root } = makeInstallation()

  mkdirSync(path.join(root, 'library/templates'), { recursive: true })
  writeFileSync(
    path.join(
      root,
      'library/templates/repository-checks.self-development.json',
    ),
    `${JSON.stringify({
      schema_version: 1,
      profiles: {
        fast: {
          probes: [],
          commands: ['npm test'],
          isolation_command: 'node --test --name {test_pattern} {file}',
        },
      },
    })}\n`,
  )
  writeChecks(root, { fast: { probes: [], commands: ['npm test'] } })

  assert.equal(
    loadRepositoryChecks(root).profiles.fast?.isolation_command,
    undefined,
  )
})

test('the concurrent field must be a boolean and the gate runner ignores it', () => {
  const { root } = makeInstallation()

  writeChecks(root, {
    full: { probes: [], commands: ['echo ok'], concurrent: 'yes' },
  })

  assert.throws(
    () => loadRepositoryChecks(root),
    /profiles\.full\.concurrent MUST be a boolean when present/u,
  )

  // The gate path is synchronous and stays serial, so a configuration written
  // for the asynchronous runner cannot change what a gate verifies.
  writeChecks(root, {
    full: {
      timeout_ms: 20_000,
      concurrent: true,
      probes: [],
      commands: [
        'node -e "setTimeout(() => process.exit(0), 600)"',
        'node -e "setTimeout(() => process.exit(0), 600)"',
      ],
    },
  })

  const startedAt = Date.now()
  const result = runRepositoryCheck(root, 'full')

  assert.equal(result.status, 'passed')
  assert.ok(
    Date.now() - startedAt >= 1_200,
    'the synchronous runner honoured the concurrent field',
  )
})

test('a current-path harness-managed worktree resolves the owning installation runtime config', () => {
  const { root } = makeInstallation()

  writeChecks(root, { fast: { probes: [], commands: ['echo ok'] } })

  const worktree = path.join(root, 'worktrees', 'operator', 'wt')
  const runtimeWorktree = path.join(
    root,
    'runtime',
    'worktrees',
    'operator',
    'wt',
  )

  mkdirSync(worktree, { recursive: true })
  mkdirSync(runtimeWorktree, { recursive: true })
  // A linked worktree carries a `.git` file that names its gitdir.
  writeFileSync(
    path.join(worktree, '.git'),
    'gitdir: ../../../.git/worktrees/wt\n',
  )
  writeFileSync(
    path.join(runtimeWorktree, '.git'),
    'gitdir: ../../../../.git/worktrees/wt\n',
  )

  assert.equal(
    repositoryChecksSourcePath(worktree),
    path.join(root, 'runtime', 'repository-checks.json'),
  )
  // The runtime configuration is untracked, so the worktree never carries it;
  // resolution must reach the owning installation rather than fall back to a
  // weaker template suite.
  assert.equal(
    repositoryChecksSourcePath(runtimeWorktree),
    path.join(root, 'runtime', 'repository-checks.json'),
  )
})

test('a directory under a worktree that is not itself a worktree keeps its own resolution', () => {
  // Test fixtures live under <checkout>/runtime/tmp/tests.noindex/. When the checkout
  // is a cohort worktree, every fixture path contains a `worktrees` segment.
  // The path alone must not send the fixture to the installation's file.
  const { root } = makeInstallation()

  writeChecks(root, { fast: { probes: [], commands: ['echo ok'] } })

  const worktree = path.join(root, 'worktrees', 'operator', 'wt')
  const fixture = path.join(
    worktree,
    'runtime',
    'tmp',
    'tests.noindex',
    'run-1',
    'checks-1',
  )

  mkdirSync(fixture, { recursive: true })
  writeFileSync(
    path.join(worktree, '.git'),
    'gitdir: ../../../.git/worktrees/wt\n',
  )
  writeFileSync(
    path.join(fixture, 'config.json'),
    `${JSON.stringify({ schema_version: 1, workspace_root: '.', state_root: 'runtime', installation_mode: 'self_development' })}\n`,
  )

  assert.equal(
    repositoryChecksSourcePath(fixture),
    path.join(
      fixture,
      'library',
      'templates',
      'repository-checks.self-development.json',
    ),
  )
})

test('workspace setup commands load, run in order, and stop at the first failure', () => {
  const { root } = makeInstallation()

  writeFileSync(
    path.join(root, 'runtime', 'repository-checks.json'),
    `${JSON.stringify({
      schema_version: 1,
      setup: ['echo one', 'node -e "process.exit(1)"', 'echo never'],
      profiles: {},
    })}\n`,
  )

  const config = loadRepositoryChecks(root)

  assert.deepEqual(config.setup, [
    'echo one',
    'node -e "process.exit(1)"',
    'echo never',
  ])

  const result = runRepositorySetup(root)

  assert.equal(result.status, 'failed')
  assert.equal(result.results.length, 2)
  assert.equal(result.results[0].passed, true)
  assert.equal(result.results[1].passed, false)
})
