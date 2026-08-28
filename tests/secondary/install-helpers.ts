import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const REPO_ROOT = process.cwd()
export const INSTALLER = path.join(REPO_ROOT, 'bin', 'install')
export const CURRENT_VERSION = readFileSync(
  path.join(REPO_ROOT, 'VERSION'),
  'utf8',
).trim()

export interface CommandResult {
  stdout: string
  stderr: string
  status: number | null
}

export interface InstallMarker {
  schema_version: number
  version: string
  source_commit: string
  source_dirty: boolean
  source_indexed: boolean
  payload_entries: string[]
  payload_files: Array<{ path: string; sha256: string }>
  cursor_files: Array<{ path: string; sha256: string }>
}

export function makeSkeletonProject(): string {
  const project = mkdtempSync(path.join(tmpdir(), 'pancreator-embed-'))

  writeFileSync(path.join(project, 'README.md'), '# skeleton\n')

  return project
}

export function run(
  executable: string,
  args: string[],
  cwd = REPO_ROOT,
): CommandResult {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
  }
}

export function runInstaller(
  project: string,
  args: string[] = [],
): CommandResult {
  return run(INSTALLER, [
    '--target',
    project,
    '--skip-dependencies',
    '--skip-shell-alias',
    ...args,
  ])
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

export function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function buildReleaseFixtureTemplate(): string {
  const fixture = mkdtempSync(
    path.join(tmpdir(), 'pancreator-release-template-'),
  )
  const entries = [
    '.gitignore',
    '.npmrc',
    '.prettierignore',
    'README.md',
    'CHANGELOG.md',
    'VERSION',
    'bin',
    'docs',
    'governance',
    'library',
    'package-lock.json',
    'package.json',
    'prettier.config.js',
    'config.json',
    'release',
    'src',
    'tests',
    'tsconfig.json',
  ]

  for (const entry of entries) {
    cpSync(path.join(REPO_ROOT, entry), path.join(fixture, entry), {
      recursive: true,
    })
  }

  // The tracked config.json blanks its model values; the effective specs live
  // in the untracked overrides file, which a real operator checkout carries.
  if (existsSync(path.join(REPO_ROOT, 'config_overrides.json'))) {
    cpSync(
      path.join(REPO_ROOT, 'config_overrides.json'),
      path.join(fixture, 'config_overrides.json'),
    )
  }

  writeFileSync(path.join(fixture, 'VERSION'), '0.1.0\n')

  writeFileSync(
    path.join(fixture, 'release', 'index.json'),
    '{\n  "schema_version": 1,\n  "releases": []\n}\n',
  )
  chmodSync(path.join(fixture, 'bin', 'install'), 0o755)
  chmodSync(path.join(fixture, 'bin', 'install-support'), 0o755)
  chmodSync(path.join(fixture, 'bin', 'update'), 0o755)

  git(fixture, ['init', '-q'])
  git(fixture, ['config', 'user.email', 'fixture@example.com'])
  git(fixture, ['config', 'user.name', 'Fixture'])
  git(fixture, ['add', '.'])
  git(fixture, ['commit', '-qm', 'release 0.1.0'])

  const release01 = git(fixture, ['rev-parse', 'HEAD'])

  writeFileSync(
    path.join(fixture, 'release', 'index.json'),
    `${JSON.stringify(
      {
        schema_version: 1,
        releases: [{ version: '0.1.0', commit: release01 }],
      },
      null,
      2,
    )}\n`,
  )
  git(fixture, ['add', 'release/index.json'])
  git(fixture, ['commit', '-qm', 'index 0.1.0'])

  return fixture
}

// Building the release fixture copies the repository and commits it twice —
// seconds of work every consuming test used to pay. The template is built
// once per process and each createReleaseFixture() call hands out a clone.
// macOS `cp -c` uses clonefile for a copy-on-write clone including `.git`;
// any failure falls back to a regular recursive copy.
let releaseFixtureTemplate: string | null = null

export function createReleaseFixture(): string {
  if (releaseFixtureTemplate === null) {
    releaseFixtureTemplate = buildReleaseFixtureTemplate()
  }

  const fixture = mkdtempSync(path.join(tmpdir(), 'pancreator-release-source-'))

  try {
    execFileSync('cp', ['-Rc', `${releaseFixtureTemplate}/.`, fixture])
  } catch {
    cpSync(releaseFixtureTemplate, fixture, { recursive: true })
  }

  return fixture
}
