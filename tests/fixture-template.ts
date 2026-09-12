/**
 * The harness fixture template and the clones every test takes of it.
 *
 * This module is deliberately free of the engine and of every module that
 * reaches it. A test that only reads a fixture imports it directly, so an
 * engine change no longer drags that test into the impacted selection.
 * `tests/helpers.ts` re-exports the same names for the tests that also drive
 * runs.
 */
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { recordFixtureEvent } from './reporters/fixture-profile.js'
import { sharedTemplate } from './shared-template.js'
import { createTestTempDirectory } from './temp.js'

import { readHarnessConfig } from '../src/lib/project-config.js'
import { syncCursorProjection } from '../src/lib/projection.js'

const REPO_ROOT = process.cwd()
const CURRENT_VERSION = readFileSync(
  path.join(REPO_ROOT, 'VERSION'),
  'utf8',
).trim()

// The suite runs one fixture per test file in parallel, so fixture setup shares
// the machine with every other suite. The limit guards against a hung Git
// process, not against a slow one.
const FIXTURE_GIT_TIMEOUT_MS = 180_000
const FIXTURE_GIT_MAX_BUFFER = 1_024 * 1_024
const FIXTURE_INVOLVEMENT_PROFILE = 'standard'

/** Cache key of the template every `createFixture` call clones. */
const MAIN_TEMPLATE_KEY = 'fixture:main'

export function fixtureGit(
  args: string[],
  options: { cwd: string; encoding: 'utf8' },
): string {
  return execFileSync('git', args, {
    cwd: options.cwd,
    encoding: options.encoding,
    timeout: FIXTURE_GIT_TIMEOUT_MS,
    maxBuffer: FIXTURE_GIT_MAX_BUFFER,
  })
}

/**
 * Pin the involvement profile a fixture run resolves.
 *
 * A fixture copies the repository configuration, so the checked-in operator
 * preference would otherwise decide which stages stop for approval in every
 * workflow test. Tests that need another profile select it explicitly.
 */
function pinFixtureInvolvement(root: string): void {
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    operator_involvement?: { active?: string }
  }

  if (!config.operator_involvement) {
    return
  }

  config.operator_involvement.active = FIXTURE_INVOLVEMENT_PROFILE

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
}

/**
 * Pin the model one persona resolves to in a fixture, in every named config.
 *
 * A fixture copies this checkout's effective configuration, so the operator's
 * untracked `config_overrides.json` would otherwise decide which model the
 * active config maps for the persona. The pin lives in `defaults` and no named
 * config shadows it, so the mapping is identical in every checkout. The Cursor
 * projection is re-synced so projected agent frontmatter agrees with it.
 */
export function pinFixturePersonaModel(
  root: string,
  persona: string,
  model: string,
): void {
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    defaults?: Record<string, string>
    configs?: Record<string, Record<string, unknown>>
  }

  config.defaults = { ...config.defaults, [persona]: model }

  for (const entry of Object.values(config.configs ?? {})) {
    if (!entry || typeof entry !== 'object') {
      continue
    }

    delete entry[persona]

    if (typeof entry.personas === 'object' && entry.personas !== null) {
      delete (entry.personas as Record<string, unknown>)[persona]
    }
  }

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  syncCursorProjection(root, { write: true })
}

export interface CloneTreeOptions {
  timeout?: number
  verbatimSymlinks?: boolean
}

/**
 * Copy a directory tree into `destination`. Uses copy-on-write when the
 * platform offers it and falls back to a plain recursive copy.
 */
export function cloneTree(
  template: string,
  destination: string,
  options: CloneTreeOptions = {},
): void {
  const timeout = options.timeout ?? FIXTURE_GIT_TIMEOUT_MS

  for (const flags of [['-Rc'], ['-a', '--reflink=auto']]) {
    try {
      execFileSync('cp', [...flags, `${template}/.`, destination], {
        stdio: 'ignore',
        timeout,
      })

      return
    } catch {
      // Fall back to the next flag set.
    }
  }

  cpSync(template, destination, {
    recursive: true,
    ...(options.verbatimSymlinks ? { verbatimSymlinks: true } : {}),
  })
}

// Scratch space comes from tests/temp.ts, which allocates under the runner's
// per-run directory rather than the shared OS temp directory. Re-exported so
// existing imports from helpers keep working.
export { createTestTempDirectory } from './temp.js'

/** Populate `root` with the harness fixture every test clones. */
function buildFixtureTemplate(root: string): void {
  for (const entry of [
    'governance',
    'library',
    'release',
    'docs',
    'target-extensions',
    '.pancreator',
  ]) {
    const source = path.join(REPO_ROOT, entry)

    if (existsSync(source)) {
      cpSync(source, path.join(root, entry), { recursive: true })
    }
  }

  for (const entry of [
    'CHANGELOG.md',
    'README.md',
    'VERSION',
    'package-lock.json',
    '.gitignore',
  ]) {
    cpSync(path.join(REPO_ROOT, entry), path.join(root, entry))
  }

  // The checked-in config.json intentionally blanks its model values; the
  // real specs live in the untracked config_overrides.json. Fixtures need a
  // complete standalone config, so they receive this checkout's effective
  // merged configuration. Operator toggles that an operator flips on a live
  // checkout are pinned to their defaults, so a checkout with away mode
  // enabled does not flip every fixture that asserts the disabled baseline;
  // a test that wants away mode calls enableAwayMode on its own fixture.
  const fixtureConfig = readHarnessConfig(
    REPO_ROOT,
    path.join(REPO_ROOT, 'config.json'),
  ) as Record<string, unknown>

  fixtureConfig.away_mode = { enabled: false }

  writeFileSync(
    path.join(root, 'config.json'),
    `${JSON.stringify(fixtureConfig, null, 2)}\n`,
  )

  pinFixtureInvolvement(root)

  mkdirSync(path.join(root, 'runtime', 'logs', 'orchestrator'), {
    recursive: true,
  })
  mkdirSync(path.join(root, 'runtime', 'logs', 'workflows'), {
    recursive: true,
  })
  mkdirSync(path.join(root, 'runtime', 'inbox'), { recursive: true })
  mkdirSync(path.join(root, 'runtime', 'backlog'), { recursive: true })
  mkdirSync(path.join(root, 'docs'), { recursive: true })
  mkdirSync(path.join(root, 'src'), { recursive: true })

  writeFileSync(
    path.join(root, 'AGENTS.md'),
    [
      '# fixture',
      '',
      'Ad-hoc Subagent calls MUST omit `model` so they inherit the parent model unless the operator explicitly selects a model.',
      'Named personas retain their projected model routing through projected frontmatter and `config.json`.',
      '',
    ].join('\n'),
  )
  writeFileSync(
    path.join(root, 'request.md'),
    'Build a dependency-free workflow harness.\n',
  )
  writeFileSync(path.join(root, 'src', 'base.ts'), 'export const base = true\n')
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'pancreator-v2-prototype',
        version: CURRENT_VERSION,
        private: true,
        type: 'module',
        scripts: {
          check: 'node -e "process.exit(0)"',
          lint: 'node -e "process.exit(0)"',
          test: 'node -e "process.exit(0)"',
          'test:coverage': 'node -e "process.exit(0)"',
          validate: 'node -e "process.exit(0)"',
        },
      },
      null,
      2,
    ),
  )
  // The self-development template's full profile also runs the installer
  // smoke harness; the fixture answers with a passing stub so a full gate
  // (verify and remediate submission) can pass without the real installer.
  mkdirSync(path.join(root, 'bin'), { recursive: true })
  writeFileSync(path.join(root, 'bin', 'install'), '#!/bin/sh\nexit 0\n')
  chmodSync(path.join(root, 'bin', 'install'), 0o755)

  syncCursorProjection(root, { write: true })

  fixtureGit(['init', '-q'], { cwd: root, encoding: 'utf8' })
  fixtureGit(['config', 'user.email', 'fixture@example.com'], {
    cwd: root,
    encoding: 'utf8',
  })
  fixtureGit(['config', 'user.name', 'Fixture'], {
    cwd: root,
    encoding: 'utf8',
  })
  fixtureGit(['add', '.'], { cwd: root, encoding: 'utf8' })
  fixtureGit(['commit', '-qm', 'fixture'], { cwd: root, encoding: 'utf8' })
  // The baseline commit leaves several thousand loose objects, and every
  // clone of this template copies each one as its own file. Packing them once
  // here turns that per-clone cost into a handful of files.
  fixtureGit(['repack', '-a', '-d', '-q'], { cwd: root, encoding: 'utf8' })
}

let fixtureTemplateRoot: string | null = null

function buildTemplateInThisProcess(): string {
  const started = performance.now()
  const root = createTestTempDirectory('v2-template-')

  buildFixtureTemplate(root)
  recordFixtureEvent('template_build', 'main', performance.now() - started)

  return root
}

/**
 * The template this process clones. The suite run builds it once: the first
 * process to arrive builds and publishes it, the rest wait for that copy.
 */
function mainTemplate(): string {
  if (fixtureTemplateRoot) {
    return fixtureTemplateRoot
  }

  const shared = sharedTemplate(MAIN_TEMPLATE_KEY, (destination) => {
    const started = performance.now()

    mkdirSync(destination, { recursive: true })
    buildFixtureTemplate(destination)
    recordFixtureEvent('template_build', 'main', performance.now() - started)

    return null
  })

  fixtureTemplateRoot = shared?.path ?? buildTemplateInThisProcess()

  return fixtureTemplateRoot
}

function cloneFixtureTemplate(template: string): string {
  const started = performance.now()
  const root = createTestTempDirectory('v2-')

  cloneTree(template, root)
  recordFixtureEvent('template_clone', 'main', performance.now() - started)

  return root
}

let sharedFixtureRoot: string | null = null

/**
 * One fixture clone per process for tests that only read. A test that writes
 * into its root must use createFixture(), because a shared root keeps every
 * earlier write.
 */
export function sharedFixture(): string {
  sharedFixtureRoot ??= createFixture()

  return sharedFixtureRoot
}

export function createFixture(): string {
  return cloneFixtureTemplate(mainTemplate())
}
