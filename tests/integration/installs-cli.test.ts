import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')
const COMMAND_TIMEOUT_MS = 30_000
const COMMAND_MAX_BUFFER = 1024 * 1024

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(
    filePath,
    `${JSON.stringify(value, null, 2)}
`,
  )
}

function writeText(filePath: string, value: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, value)
}

function sourceRoot(
  installations: Array<{ id: string; path: string }>,
): string {
  const root = createTestTempDirectory('pancreator-installs-cli-')

  writeJson(path.join(root, 'package.json'), {
    name: 'pancreator-v2-prototype',
    type: 'module',
  })
  writeJson(path.join(root, 'config.json'), {
    schema_version: 1,
    installation_mode: 'self_development',
    installations,
  })
  writeText(path.join(root, 'VERSION'), '0.0.0-test\n')

  return root
}

function installationRoot(name: string, withConfig = true): string {
  const root = createTestTempDirectory(`pancreator-${name}-`)

  if (withConfig) {
    writeJson(path.join(root, 'config.json'), {
      schema_version: 1,
      installation_mode: 'embedded',
      workspace_root: '..',
    })
  }

  return root
}

function run(
  root: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: COMMAND_MAX_BUFFER,
  })

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

function git(root: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: COMMAND_MAX_BUFFER,
  })

  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

test('pan installs list reports healthy missing and unreadable installations', () => {
  const healthy = installationRoot('healthy')
  const missing = path.join(
    createTestTempDirectory('pancreator-missing-install-parent-'),
    'missing',
  )
  const broken = installationRoot('broken', false)

  writeText(path.join(healthy, 'VERSION'), '6.9.0\n')
  writeText(path.join(healthy, 'runtime/inbox/queue/one.md'), '# One\n')
  writeText(path.join(healthy, 'runtime/inbox/queue/ignore.txt'), 'ignore\n')
  writeText(path.join(broken, 'config.json'), '{not-json\n')

  const source = sourceRoot([
    { id: 'healthy', path: healthy },
    { id: 'missing', path: missing },
    { id: 'broken', path: broken },
  ])
  const result = run(source, ['installs', 'list', '--json'])

  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout) as Array<Record<string, unknown>>

  assert.deepEqual(
    payload.map((entry) => entry.id),
    ['healthy', 'missing', 'broken'],
  )
  assert.deepEqual(Object.keys(payload[0] ?? {}), [
    'id',
    'path',
    'pan_command',
    'exists',
    'installation_mode',
    'version',
    'queued_items',
    'error',
  ])
  assert.equal(payload[0]?.exists, true)
  assert.equal(payload[0]?.installation_mode, 'embedded')
  assert.equal(payload[0]?.version, '6.9.0')
  assert.equal(payload[0]?.queued_items, 1)
  assert.equal(payload[1]?.exists, false)
  assert.equal(payload[2]?.exists, true)
  assert.equal(payload[2]?.installation_mode, null)
  assert.equal(typeof payload[2]?.error, 'string')
  assert.notEqual(payload[2]?.error, '')
})

test('pan installs archive moves cited items without installation commands or target changes', () => {
  const target = createTestTempDirectory('pancreator-install-target-')
  const installation = path.join(target, '.pancreator')

  mkdirSync(installation, { recursive: true })
  writeText(path.join(target, '.gitignore'), '.pancreator/\n')
  writeText(path.join(target, 'target.txt'), 'target state\n')
  git(target, ['init', '-q'])
  git(target, ['config', 'user.email', 'fixture@example.com'])
  git(target, ['config', 'user.name', 'Fixture'])
  git(target, ['add', '.'])
  git(target, ['commit', '-qm', 'fixture'])

  writeJson(path.join(installation, 'config.json'), {
    schema_version: 1,
    installation_mode: 'embedded',
    workspace_root: '..',
  })
  const first = 'runtime/inbox/queue/first.md'
  const second = 'runtime/inbox/queue/second.md'

  writeText(path.join(installation, first), '# First\n')
  writeText(path.join(installation, second), '# Second\n')

  const source = sourceRoot([{ id: 'target', path: installation }])
  const intake = 'runtime/inbox/queue/consolidated.md'

  writeText(
    path.join(source, intake),
    '# Consolidated\n\nCites first.md and second.md.\n',
  )

  const result = run(source, [
    'installs',
    'archive',
    'target',
    '--intake',
    intake,
    '--item',
    first,
    '--item',
    second,
    '--json',
  ])

  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout) as {
    installation: string
    archived: Array<{ from: string; to: string }>
  }

  assert.equal(payload.installation, 'target')
  assert.deepEqual(
    payload.archived.map((item) => item.from),
    [first, second],
  )
  assert.equal(existsSync(path.join(installation, first)), false)
  assert.equal(existsSync(path.join(installation, second)), false)

  for (const item of payload.archived) {
    assert.equal(existsSync(path.join(installation, item.to)), true)
  }
  assert.equal(
    readFileSync(path.join(target, 'target.txt'), 'utf8'),
    'target state\n',
  )
  assert.equal(git(target, ['status', '--porcelain']), '')
})

test('pan installs archive refuses every unsafe batch before moving an item', () => {
  const cases = [
    { name: 'uncited', code: 'INTAKE_DOES_NOT_CITE_ITEM' },
    { name: 'active', code: 'INVALID_INBOX_TRANSITION' },
    { name: 'unknown', code: 'UNKNOWN_INSTALLATION' },
    { name: 'missing-installation', code: 'INSTALLATION_NOT_FOUND' },
    { name: 'missing-intake', code: 'INTAKE_NOT_FOUND' },
  ] as const

  for (const scenario of cases) {
    const installation = installationRoot(
      scenario.name,
      scenario.name !== 'missing-installation',
    )
    const first =
      scenario.name === 'active'
        ? 'runtime/inbox/active/first.md'
        : 'runtime/inbox/queue/first.md'
    const second = 'runtime/inbox/queue/second.md'

    writeText(path.join(installation, first), '# First\n')
    writeText(path.join(installation, second), '# Second\n')

    const source = sourceRoot([{ id: 'registered', path: installation }])
    const intake = 'runtime/inbox/queue/consolidated.md'

    if (scenario.name !== 'missing-intake') {
      writeText(
        path.join(source, intake),
        scenario.name === 'uncited'
          ? '# Consolidated\n\nCites second.md only.\n'
          : '# Consolidated\n\nCites first.md and second.md.\n',
      )
    }

    const result = run(source, [
      'installs',
      'archive',
      scenario.name === 'unknown' ? 'not-registered' : 'registered',
      '--intake',
      intake,
      '--item',
      first,
      '--item',
      second,
      '--json',
    ])

    assert.notEqual(result.status, 0, scenario.name)
    assert.equal(
      (JSON.parse(result.stderr) as { error: string }).error,
      scenario.code,
      scenario.name,
    )
    assert.equal(
      existsSync(path.join(installation, first)),
      true,
      scenario.name,
    )
    assert.equal(
      existsSync(path.join(installation, second)),
      true,
      scenario.name,
    )
    assert.equal(
      existsSync(path.join(installation, 'runtime/inbox/archive')),
      false,
      scenario.name,
    )
  }
})

test('pan installs archive refuses an item whose name only suffixes a cited name', () => {
  const installation = installationRoot('suffix-collision')
  const cited = 'runtime/inbox/queue/63291_Sep-18-0877_chunk-run-friction.md'
  const uncited = 'runtime/inbox/queue/chunk-run-friction.md'

  writeText(path.join(installation, cited), '# Cited\n')
  writeText(path.join(installation, uncited), '# Uncited\n')

  const source = sourceRoot([{ id: 'registered', path: installation }])
  const intake = 'runtime/inbox/queue/consolidated.md'

  writeText(
    path.join(source, intake),
    '# Consolidated\n\nCites 63291_Sep-18-0877_chunk-run-friction.md only.\n',
  )

  const refused = run(source, [
    'installs',
    'archive',
    'registered',
    '--intake',
    intake,
    '--item',
    uncited,
    '--json',
  ])

  assert.notEqual(refused.status, 0, refused.stdout)
  assert.equal(
    (JSON.parse(refused.stderr) as { error: string }).error,
    'INTAKE_DOES_NOT_CITE_ITEM',
  )
  assert.equal(existsSync(path.join(installation, uncited)), true)
  assert.equal(
    existsSync(path.join(installation, 'runtime/inbox/archive')),
    false,
  )

  const accepted = run(source, [
    'installs',
    'archive',
    'registered',
    '--intake',
    intake,
    '--item',
    cited,
    '--json',
  ])

  assert.equal(accepted.status, 0, accepted.stderr)
  assert.equal(existsSync(path.join(installation, cited)), false)
})

test('pan installs archive refuses a degenerate item path with a stable code', () => {
  const installation = installationRoot('degenerate-item')
  const item = 'runtime/inbox/queue/first.md'

  writeText(path.join(installation, item), '# First\n')

  const source = sourceRoot([{ id: 'registered', path: installation }])
  const intake = 'runtime/inbox/queue/consolidated.md'

  writeText(
    path.join(source, intake),
    '# Consolidated\n\nCites first.md, and ../sibling.md for context.\n',
  )

  const result = run(source, [
    'installs',
    'archive',
    'registered',
    '--intake',
    intake,
    '--item',
    'runtime/inbox/queue/..',
    '--json',
  ])

  assert.notEqual(result.status, 0, result.stdout)
  assert.equal(
    (JSON.parse(result.stderr) as { error: string }).error,
    'INBOX_ITEM_NOT_FOUND',
  )
  assert.equal(existsSync(path.join(installation, item)), true)
  assert.equal(
    existsSync(path.join(installation, 'runtime/inbox/archive')),
    false,
  )
})
