/**
 * Integration tests for `pan quality daily`.
 *
 * Each fixture is a self_development harness whose pan-dev is a small tree
 * holding only what the job reads: VERSION, the surfaces registry, and the
 * sample files the scans judge. A stub cursor-agent binary plays the repair
 * agent, and stub repository-check profiles stand in for static and fast.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { runDailyQuality } from '../../src/lib/daily-quality.js'
import { resetCursorAgentCapabilities } from '../../src/lib/executors/cursor-agent.js'
import { refreshScheduleAlerts, scheduleTick } from '../../src/lib/schedule.js'
import { createFixture, read, writeJson } from '../helpers.js'
import { createTestTempDirectory } from '../temp.js'

const REPO_ROOT = process.cwd()
const CLI = path.join(REPO_ROOT, 'dist', 'src', 'cli.js')
const SURFACES = path.join(
  'governance',
  'registries',
  'daily_quality_surfaces.json',
)
const WORKTREE = path.join('worktrees', 'operator', 'daily-quality')

const UNCLEAN_SOURCE =
  'export function sign(value: number): number {\n  if (value > 0) return 1\n\n  return 0\n}\n'
const CLEAN_SOURCE =
  'export function sign(value: number): number {\n  if (value > 0) {\n    return 1\n  }\n\n  return 0\n}\n'
const MOVED_SOURCE =
  'export function sign(value: number): number {\n  if (value >= 1) {\n    return 1\n  }\n\n  return 0\n}\n'
const UNCLEAN_CRITERION = '# Sample\n\nThe job runs daily; it repairs files.\n'
const CLEAN_CRITERION = '# Sample\n\nThe job runs daily. It repairs files.\n'

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }

  return (result.stdout ?? '').trim()
}

interface DailyFixture {
  root: string
  panDevTip: string
}

/** A harness whose pan-dev holds the sample files, unclean or clean. */
function createDailyFixture(options: { unclean?: boolean } = {}): DailyFixture {
  const root = createFixture()
  const config = read(path.join(root, 'config.json')) as Record<string, unknown>

  writeJson(path.join(root, 'config.json'), {
    ...config,
    installation_mode: 'self_development',
  })
  copyFileSync(
    path.join(REPO_ROOT, 'bin', 'check-landing'),
    path.join(root, 'bin', 'check-landing'),
  )
  chmodSync(path.join(root, 'bin', 'check-landing'), 0o755)
  writeJson(path.join(root, 'runtime', 'repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { description: 'stub static', probes: [], commands: ['true'] },
      fast: { description: 'stub fast', probes: [], commands: ['true'] },
    },
  })

  const tree = createTestTempDirectory('daily-pan-dev-')

  git(root, ['worktree', 'add', '-q', '--detach', tree])
  git(tree, ['switch', '-q', '--orphan', 'pan-dev'])
  mkdirSync(path.join(tree, 'src'), { recursive: true })
  mkdirSync(path.join(tree, 'governance', 'criteria'), { recursive: true })
  mkdirSync(path.dirname(path.join(tree, SURFACES)), { recursive: true })
  copyFileSync(path.join(REPO_ROOT, SURFACES), path.join(tree, SURFACES))
  // The ignore rules keep the worktree's projected `.cursor/` tree out of Git.
  copyFileSync(path.join(root, '.gitignore'), path.join(tree, '.gitignore'))
  writeFileSync(path.join(tree, 'VERSION'), '1.0.0\n')
  writeFileSync(
    path.join(tree, 'src', 'sample.ts'),
    options.unclean ? UNCLEAN_SOURCE : CLEAN_SOURCE,
  )
  writeFileSync(
    path.join(tree, 'governance', 'criteria', 'sample.md'),
    options.unclean ? UNCLEAN_CRITERION : CLEAN_CRITERION,
  )
  git(tree, ['add', '-A'])
  git(tree, ['commit', '-qm', 'pan-dev fixture'])
  git(root, ['worktree', 'remove', '--force', tree])

  return { root, panDevTip: git(root, ['rev-parse', 'pan-dev']) }
}

/** A harness-root memo that conform can edit but the worktree-bound agent cannot reach. */
function writeUncleanRuntimeMemo(root: string): string {
  const memo = path.join(root, 'runtime', 'research', 'unclean-memo.md')

  mkdirSync(path.dirname(memo), { recursive: true })
  writeFileSync(memo, UNCLEAN_CRITERION)

  return memo
}

/**
 * Install a stub cursor-agent whose run executes `body` in the workspace.
 * The default body repairs both sample files.
 */
function installStubAgent(root: string, body?: string): () => void {
  const binary = path.join(root, 'runtime', 'fake-cursor-agent')
  const repair = [
    `cat > src/sample.ts <<'EOF'\n${CLEAN_SOURCE}EOF`,
    `cat > governance/criteria/sample.md <<'EOF'\n${CLEAN_CRITERION}EOF`,
  ].join('\n')

  writeFileSync(
    binary,
    [
      '#!/bin/sh',
      'if [ "$1" = "--help" ]; then',
      '  echo "Usage: cursor-agent --output-format --trust --force --model --resume --workspace --add-dir"',
      '  exit 0',
      'fi',
      body ?? repair,
      'printf \'{"type":"system","subtype":"init","session_id":"test","model":"claude-test"}\\n\'',
      '',
    ].join('\n'),
  )
  chmodSync(binary, 0o755)

  const original = process.env.PANCREATOR_CURSOR_AGENT_BIN
  const originalKey = process.env.CURSOR_API_KEY

  process.env.PANCREATOR_CURSOR_AGENT_BIN = binary
  process.env.CURSOR_API_KEY = 'test-key'
  resetCursorAgentCapabilities()

  return () => {
    if (original === undefined) {
      delete process.env.PANCREATOR_CURSOR_AGENT_BIN
    } else {
      process.env.PANCREATOR_CURSOR_AGENT_BIN = original
    }

    if (originalKey === undefined) {
      delete process.env.CURSOR_API_KEY
    } else {
      process.env.CURSOR_API_KEY = originalKey
    }

    resetCursorAgentCapabilities()
  }
}

function setFastCommand(root: string, command: string): void {
  const checksPath = path.join(root, 'runtime', 'repository-checks.json')
  const checks = read(checksPath) as {
    profiles: Record<string, { commands: string[] }>
  }

  writeJson(checksPath, {
    ...checks,
    profiles: {
      ...checks.profiles,
      fast: { ...checks.profiles.fast, commands: [command] },
    },
  })
}

/**
 * Make the first fast profile run commit `file` with `content` on top of
 * pan-dev without a checkout, the way another landing moves the tip while
 * the repair runs. The profile runs outside the agent's write sandbox, which
 * keeps the stub agent from moving a ref itself.
 */
function moveTipDuringFastProfile(
  root: string,
  file: string,
  content: string,
): void {
  const index = path.join(root, 'runtime', 'moved.index')
  const marker = path.join(root, 'runtime', 'tip-moved')
  const script = path.join(root, 'runtime', 'move-tip.sh')

  writeFileSync(
    script,
    [
      `if [ ! -f '${marker}' ]; then`,
      `  touch '${marker}'`,
      `  GIT_INDEX_FILE='${index}' git read-tree pan-dev`,
      `  blob=$(printf '${content.replaceAll('\n', '\\n')}' | git hash-object -w --stdin)`,
      `  GIT_INDEX_FILE='${index}' git update-index --add --cacheinfo "100644,$blob,${file}"`,
      `  tree=$(GIT_INDEX_FILE='${index}' git write-tree)`,
      '  moved=$(git commit-tree "$tree" -p pan-dev -m "another landing")',
      '  git update-ref refs/heads/pan-dev "$moved"',
      'fi',
      '',
    ].join('\n'),
  )
  setFastCommand(root, `sh '${script}'`)
}

function resultDirectories(root: string): string[] {
  const resultRoot = path.join(root, 'runtime', 'logs', 'quality')

  return existsSync(resultRoot)
    ? readdirSync(resultRoot).map((entry) => path.join(resultRoot, entry))
    : []
}

function landingEvents(root: string): Record<string, unknown>[] {
  const log = path.join(root, 'runtime', 'release', 'landing.jsonl')

  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

/** Invariants every failed run keeps: pan-dev, lock, patch, clean worktree. */
function assertFailureLeftNothingBehind(
  root: string,
  panDevTip: string,
  resultDir: string,
): string {
  assert.equal(git(root, ['rev-parse', 'pan-dev']), panDevTip)
  assert.equal(
    existsSync(path.join(root, 'runtime', 'release', 'landing.lock')),
    false,
    'the landing lock must be released',
  )
  assert.equal(git(path.join(root, WORKTREE), ['status', '--porcelain']), '')

  const patch = path.join(resultDir, 'failed.patch')

  assert.ok(existsSync(patch), 'failed.patch must hold the unlanded work')

  return readFileSync(patch, 'utf8')
}

test('daily quality skips outside self_development', () => {
  const root = createFixture()
  const config = read(path.join(root, 'config.json')) as Record<string, unknown>

  writeJson(path.join(root, 'config.json'), {
    ...config,
    installation_mode: 'embedded',
  })

  const result = runDailyQuality(root)
  const written = read(
    path.join(
      root,
      'runtime',
      'logs',
      'quality',
      result.occurrence_id,
      'result.json',
    ),
  ) as Record<string, unknown>

  assert.equal(result.status, 'skipped')
  assert.equal(written.status, 'skipped')
  assert.equal(written.occurrence_id, result.occurrence_id)
})

test('daily quality repairs both files and fast-forwards pan-dev by one marked commit', () => {
  const { root, panDevTip } = createDailyFixture({ unclean: true })
  const restore = installStubAgent(root)

  try {
    const result = runDailyQuality(root)
    const landed = git(root, ['rev-parse', 'pan-dev'])

    assert.equal(result.status, 'repaired', String(result.reason))
    assert.equal(result.landed_tip, landed)
    assert.equal(git(root, ['rev-parse', `${landed}^`]), panDevTip)
    assert.equal(
      git(root, [
        'log',
        '-1',
        '--format=%(trailers:key=Pancreator-Daily-Quality,valueonly)',
        landed,
      ]),
      result.occurrence_id,
    )
    assert.deepEqual(
      git(root, ['diff', '--name-only', panDevTip, landed]).split('\n'),
      ['governance/criteria/sample.md', 'src/sample.ts'],
    )
    assert.deepEqual(
      result.validator_results?.map((entry) => [
        entry.path,
        entry.registry_id,
        entry.status,
      ]),
      [
        [
          'governance/criteria/sample.md',
          'SIMPLIFIED-ENGLISH-VALIDATE-001',
          'passed',
        ],
        ['src/sample.ts', 'CODE-STYLE-VALIDATE-001', 'passed'],
      ],
    )
    assert.deepEqual(
      result.profile_results?.map((entry) => [entry.profile, entry.status]),
      [
        ['static', 'passed'],
        ['fast', 'passed'],
      ],
    )
    assert.ok(existsSync(path.join(root, 'runtime', 'cache', 'conform.json')))
    assert.ok(existsSync(path.join(root, 'runtime', 'cache', 'style.json')))
    assert.ok(
      landingEvents(root).some(
        (event) =>
          event.event === 'acquired' && event.worktree === 'daily-quality',
      ),
      'landing.jsonl must record a daily-quality holder',
    )
    assert.equal(
      existsSync(path.join(root, 'runtime', 'release', 'landing.lock')),
      false,
    )
  } finally {
    restore()
  }
})

test('daily quality on a clean pan-dev makes no commit and records clean', () => {
  const { root, panDevTip } = createDailyFixture()
  const restore = installStubAgent(root, 'exit 1')

  try {
    const result = runDailyQuality(root)

    assert.equal(result.status, 'clean', String(result.reason))
    assert.equal(result.commit, undefined)
    assert.equal(git(root, ['rev-parse', 'pan-dev']), panDevTip)
    assert.ok(existsSync(path.join(root, 'runtime', 'cache', 'conform.json')))
    assert.ok(existsSync(path.join(root, 'runtime', 'cache', 'style.json')))
  } finally {
    restore()
  }
})

test('an unclean harness-root runtime memo neither fails the clean decision nor blocks a repair', () => {
  const clean = createDailyFixture()
  const memo = writeUncleanRuntimeMemo(clean.root)
  const restoreClean = installStubAgent(clean.root, 'exit 1')

  try {
    const result = runDailyQuality(clean.root)

    assert.equal(result.status, 'clean', String(result.reason))
    assert.equal(result.commit, undefined)
    assert.equal(git(clean.root, ['rev-parse', 'pan-dev']), clean.panDevTip)
    assert.equal(readFileSync(memo, 'utf8'), UNCLEAN_CRITERION)
  } finally {
    restoreClean()
  }

  const unclean = createDailyFixture({ unclean: true })

  writeUncleanRuntimeMemo(unclean.root)
  const restore = installStubAgent(unclean.root)

  try {
    const result = runDailyQuality(unclean.root)

    assert.equal(result.status, 'repaired', String(result.reason))
    assert.equal(
      git(unclean.root, ['rev-parse', 'pan-dev^']),
      unclean.panDevTip,
    )
  } finally {
    restore()
  }
})

test('a scheduled daily run whose agent edits outside the surfaces fails and opens an alert', () => {
  const { root, panDevTip } = createDailyFixture({ unclean: true })
  const restore = installStubAgent(
    root,
    [
      `cat > src/sample.ts <<'EOF'\n${CLEAN_SOURCE}EOF`,
      `printf '{"name":"widened"}\\n' > package.json`,
    ].join('\n'),
  )
  const config = read(path.join(root, 'config.json')) as Record<string, unknown>

  writeJson(path.join(root, 'config.json'), {
    ...config,
    schedule: {
      enabled: true,
      catch_up_window_minutes: 30,
      grace_period_minutes: 30,
      jobs: [
        {
          id: 'daily-quality',
          enabled: true,
          hour: 4,
          minute: 30,
          timezone: 'UTC',
          workspace: '.',
          self_development_only: true,
          action: {
            kind: 'command',
            command: `"${process.execPath}" "${CLI}" quality daily --json`,
          },
        },
      ],
    },
  })

  try {
    const tick = scheduleTick(root, {
      now: new Date('2026-01-05T04:30:02.000Z'),
    })
    const [resultDir] = resultDirectories(root)
    const result = read(path.join(resultDir ?? '', 'result.json')) as {
      status: string
      reason: string
    }
    const alerts = refreshScheduleAlerts(
      root,
      new Date('2026-01-05T04:31:00.000Z'),
    )

    assert.equal(tick.decisions[0]?.outcome, 'failed')
    assert.equal(tick.decisions[0]?.exit_status, 1)
    assert.equal(result.status, 'failed')
    assert.match(
      result.reason,
      /outside the daily quality surfaces: package\.json/u,
    )
    assert.match(
      assertFailureLeftNothingBehind(root, panDevTip, resultDir ?? ''),
      /package\.json/u,
    )
    assert.ok(
      alerts.alerts.some((alert) => alert.job_id === 'daily-quality'),
      'the failed decision must open an alert at once',
    )
  } finally {
    restore()
  }
})

test('daily quality fails when the fast profile fails and leaves pan-dev unchanged', () => {
  const { root, panDevTip } = createDailyFixture({ unclean: true })
  const restore = installStubAgent(root)

  setFastCommand(root, 'node -e "process.exit(1)"')

  try {
    const result = runDailyQuality(root)

    assert.equal(result.status, 'failed')
    assert.match(result.reason ?? '', /fast profile failed/u)
    assert.deepEqual(
      result.profile_results?.map((entry) => [entry.profile, entry.status]),
      [
        ['static', 'passed'],
        ['fast', 'failed'],
      ],
    )
    assert.match(
      assertFailureLeftNothingBehind(
        root,
        panDevTip,
        path.join(root, 'runtime', 'logs', 'quality', result.occurrence_id),
      ),
      /src\/sample\.ts/u,
    )
  } finally {
    restore()
  }
})

test('daily quality fails when a changed file fails its validator and runs no profile', () => {
  const { root, panDevTip } = createDailyFixture({ unclean: true })
  const restore = installStubAgent(
    root,
    [
      `cat > src/sample.ts <<'EOF'\n${CLEAN_SOURCE}EOF`,
      `printf '# Sample\\n\\nThe job runs daily; it repairs some files.\\n' > governance/criteria/sample.md`,
    ].join('\n'),
  )

  try {
    const result = runDailyQuality(root)

    assert.equal(result.status, 'failed')
    assert.equal(
      result.reason,
      'Validation failed for: governance/criteria/sample.md (SIMPLIFIED-ENGLISH-VALIDATE-001)',
    )
    assert.equal(result.profile_results, undefined)
    assert.match(
      assertFailureLeftNothingBehind(
        root,
        panDevTip,
        path.join(root, 'runtime', 'logs', 'quality', result.occurrence_id),
      ),
      /governance\/criteria\/sample\.md/u,
    )
  } finally {
    restore()
  }
})

test('daily quality rebases onto a moved pan-dev tip and lands on top of it', () => {
  const { root, panDevTip } = createDailyFixture({ unclean: true })
  const restore = installStubAgent(root)

  moveTipDuringFastProfile(root, 'MOVED.md', 'moved\n')

  try {
    const result = runDailyQuality(root)
    const landed = git(root, ['rev-parse', 'pan-dev'])
    const movedTip = git(root, ['rev-parse', `${landed}^`])

    assert.equal(result.status, 'repaired', String(result.reason))
    assert.notEqual(movedTip, panDevTip)
    assert.equal(git(root, ['rev-parse', `${movedTip}^`]), panDevTip)
    assert.equal(
      git(root, [
        'log',
        '-1',
        '--format=%(trailers:key=Pancreator-Daily-Quality,valueonly)',
        landed,
      ]),
      result.occurrence_id,
    )
    assert.deepEqual(
      result.profile_results?.map((entry) => `${entry.phase}:${entry.profile}`),
      ['repair:static', 'repair:fast', 'rebase:static', 'rebase:fast'],
    )
  } finally {
    restore()
  }
})

test('a rebase conflict fails the run, saves the commit, and the next run proceeds', () => {
  const { root } = createDailyFixture({ unclean: true })
  const restore = installStubAgent(root)

  moveTipDuringFastProfile(root, 'src/sample.ts', MOVED_SOURCE)

  try {
    const first = runDailyQuality(root)
    const movedTip = git(root, ['rev-parse', 'pan-dev'])
    const worktree = path.join(root, WORKTREE)
    const gitDir = git(worktree, ['rev-parse', '--absolute-git-dir'])

    assert.equal(first.status, 'failed')
    assert.match(first.reason ?? '', /Rebase onto moved pan-dev tip failed/u)
    assert.equal(existsSync(path.join(gitDir, 'rebase-merge')), false)
    assert.equal(first.unlanded_head, git(worktree, ['rev-parse', 'HEAD']))
    assert.match(
      assertFailureLeftNothingBehind(
        root,
        movedTip,
        path.join(root, 'runtime', 'logs', 'quality', first.occurrence_id),
      ),
      /style: daily conform and style pass/u,
    )

    const second = runDailyQuality(root)

    assert.equal(second.status, 'repaired', String(second.reason))
    assert.equal(git(root, ['rev-parse', 'pan-dev^']), movedTip)
  } finally {
    restore()
  }
})

test('daily quality refuses a dirty worktree and keeps its uncommitted paths', () => {
  const { root, panDevTip } = createDailyFixture()
  const restore = installStubAgent(root, 'exit 1')

  try {
    assert.equal(runDailyQuality(root).status, 'clean')

    const untracked = path.join(root, WORKTREE, 'notes.txt')

    writeFileSync(untracked, 'operator notes\n')

    const result = runDailyQuality(root)

    assert.equal(result.status, 'failed')
    assert.match(result.reason ?? '', /^DAILY_QUALITY_WORKTREE_DIRTY/u)
    assert.equal(readFileSync(untracked, 'utf8'), 'operator notes\n')
    assert.equal(git(root, ['rev-parse', 'pan-dev']), panDevTip)
  } finally {
    restore()
  }
})
