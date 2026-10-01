import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { nextSemanticVersion } from '../../src/lib/versioning.js'
import { createWorktree } from '../../src/lib/worktrees.js'
import { createFixture } from '../fixture-template.js'

export const REPO_ROOT = process.cwd()

export const PAN_DEV = 'pan-dev'

export function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

export function readLandingLog(root: string): Array<Record<string, unknown>> {
  const logPath = path.join(root, 'runtime', 'release', 'landing.jsonl')

  if (!existsSync(logPath)) {
    return []
  }

  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

export function landingLockExists(root: string): boolean {
  return existsSync(path.join(root, 'runtime', 'release', 'landing.lock'))
}

/**
 * A fixture root with pan-dev at the fixture commit and the landing guard in
 * place. Embedded mode keeps finalize's self-development conform and style
 * scans out of scope, because the fixture copy carries unrelated prose debt.
 */
export function landingFixture(): string {
  const root = createFixture()
  const checkLanding = path.join(root, 'bin', 'check-landing')
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  git(root, ['branch', PAN_DEV])
  copyFileSync(path.join(REPO_ROOT, 'bin', 'check-landing'), checkLanding)
  chmodSync(checkLanding, 0o755)
  config.installation_mode = 'embedded'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  return root
}

/** Stub a fixture repository-check profile's command, e.g. the land default `impacted-release` or `full` for an explicit operator request. */
export function setProfileCommand(
  root: string,
  profile: string,
  command: string,
): void {
  const checksPath = path.join(root, 'runtime', 'repository-checks.json')
  const checks = JSON.parse(readFileSync(checksPath, 'utf8')) as {
    profiles: Record<string, { commands: string[] }>
  }

  ;(checks.profiles[profile] as { commands: string[] }).commands = [command]
  writeFileSync(checksPath, `${JSON.stringify(checks, null, 2)}\n`)
}

function prependChangelogEntry(
  checkout: string,
  version: string,
  body: string,
): void {
  const changelogPath = path.join(checkout, 'CHANGELOG.md')
  const content = readFileSync(changelogPath, 'utf8')
  const firstEntry = content.indexOf('\n## [')
  const entry = `\n## [${version}] - 2026-09-26\n\n${body}\n`

  writeFileSync(
    changelogPath,
    content.slice(0, firstEntry) + entry + content.slice(firstEntry + 1),
  )
}

/** Commit a complete release pair for `version` on the checkout's branch. */
export function commitReleasePair(
  checkout: string,
  version: string,
  notes = 'This release moves the tip.\n\n### Fixed\n\n- Move the tip past the candidate.',
): void {
  const previous = readFileSync(path.join(checkout, 'VERSION'), 'utf8').trim()
  const packagePath = path.join(checkout, 'package.json')
  const lockPath = path.join(checkout, 'package-lock.json')
  const embeddedPath = path.join(checkout, 'docs', 'embedded-installation.md')
  const indexPath = path.join(checkout, 'release', 'index.json')
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as {
    version: string
  }
  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
    version: string
    packages?: Record<string, { version?: string }>
  }

  writeFileSync(path.join(checkout, 'VERSION'), `${version}\n`)
  pkg.version = version
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)
  lock.version = version

  if (lock.packages?.['']) {
    lock.packages[''].version = version
  }

  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
  writeFileSync(
    embeddedPath,
    readFileSync(embeddedPath, 'utf8').replace(
      `currently agree on \`${previous}\``,
      `currently agree on \`${version}\``,
    ),
  )
  prependChangelogEntry(checkout, version, notes)
  git(checkout, [
    'add',
    'VERSION',
    'package.json',
    'package-lock.json',
    'CHANGELOG.md',
    'docs/embedded-installation.md',
  ])
  git(checkout, ['commit', '-qm', `release: prepare v${version}`])

  const releaseCommit = git(checkout, ['rev-parse', 'HEAD'])
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
    releases: Array<{ version: string; commit: string }>
  }

  index.releases.push({ version, commit: releaseCommit })
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`)
  git(checkout, ['add', 'release/index.json'])
  git(checkout, ['commit', '-qm', `chore: index release v${version}`])
}

/**
 * Move pan-dev one patch release ahead, optionally with a tip-side change to
 * `src/base.ts`, through a checkout that is removed again afterward so no
 * checkout holds pan-dev when the landing runs.
 */
export function advanceTip(
  root: string,
  options: { sourceChange?: boolean } = {},
) {
  const checkout = path.join(root, 'tip-advance')

  git(root, ['worktree', 'add', '-q', checkout, PAN_DEV])

  if (options.sourceChange) {
    writeFileSync(
      path.join(checkout, 'src', 'base.ts'),
      "export const base = true\nexport const tipSide = 'tip'\n",
    )
    git(checkout, ['add', 'src/base.ts'])
    git(checkout, ['commit', '-qm', 'feat: tip-side source change'])
  }

  const tipVersion = nextSemanticVersion(
    readFileSync(path.join(checkout, 'VERSION'), 'utf8').trim(),
    'patch',
  ) as string

  commitReleasePair(checkout, tipVersion)
  git(root, ['worktree', 'remove', checkout])

  return tipVersion
}

export function makeCandidate(
  root: string,
  name: string,
  notes: string,
  sourceChange?: string,
): string {
  const worktreePath = path.join(root, createWorktree(root, name).path)
  const sourcePath = sourceChange ? 'src/base.ts' : `src/${name}.ts`

  writeFileSync(
    path.join(worktreePath, sourcePath),
    sourceChange ?? `export const marker = '${name}'\n`,
  )
  git(worktreePath, ['add', sourcePath])
  git(worktreePath, ['commit', '-qm', `feat: ${name} change`])
  prependChangelogEntry(worktreePath, '9.9.9', notes)
  git(worktreePath, ['add', 'CHANGELOG.md'])
  git(worktreePath, ['commit', '-qm', `docs: release notes for ${name}`])

  return worktreePath
}

/**
 * A candidate that was finalized before landing, the flow every landing path
 * prescribes: one source commit, then a complete release pair for `version`.
 */
export function finalizedCandidate(
  root: string,
  name: string,
  version: string,
  notes: string,
): string {
  const worktreePath = path.join(root, createWorktree(root, name).path)
  const sourcePath = `src/${name}.ts`

  writeFileSync(
    path.join(worktreePath, sourcePath),
    `export const marker = '${name}'\n`,
  )
  git(worktreePath, ['add', sourcePath])
  git(worktreePath, ['commit', '-qm', `feat: ${name} change`])
  commitReleasePair(worktreePath, version, notes)

  return worktreePath
}

export function versionAt(root: string, ref: string): string {
  return git(root, ['show', `${ref}:VERSION`])
}
