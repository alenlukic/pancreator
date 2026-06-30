import path from 'node:path'

import { fileExists, isRecord, readJson, readText } from './io.js'

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u
const RELEASE_HEADING_PATTERN = /^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})$/gmu
const RELEASE_GROUPS = ['Changed', 'Added', 'Removed', 'Fixed'] as const
const RELEASE_METADATA_PATHS = new Set([
  'CHANGELOG.md',
  'README.md',
  'VERSION',
  'package-lock.json',
  'package.json',
])

export type ReleaseBump = 'major' | 'minor' | 'patch'

interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string | null
}

export interface ReleaseMetadataValidation {
  errors: string[]
}

export function isSemanticVersion(value: string): boolean {
  return SEMVER_PATTERN.test(value)
}

/** Whether a workspace path is writable during self-development release prep. */
export function isReleaseMetadataPath(relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join('/')

  return (
    RELEASE_METADATA_PATHS.has(normalized) ||
    (normalized.startsWith('docs/') && normalized.endsWith('.md'))
  )
}

function parseVersion(value: string): ParsedVersion | null {
  const match = SEMVER_PATTERN.exec(value)

  if (!match) {
    return null
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  }
}

/** Calculate the exact next stable version for an agent-selected bump. */
export function nextSemanticVersion(
  currentVersion: string,
  bump: ReleaseBump,
): string | null {
  const current = parseVersion(currentVersion)

  if (!current) {
    return null
  }

  switch (bump) {
    case 'major':
      return `${current.major + 1}.0.0`
    case 'minor':
      return `${current.major}.${current.minor + 1}.0`
    case 'patch':
      return `${current.major}.${current.minor}.${current.patch + 1}`
  }
}

function comparePrerelease(left: string | null, right: string | null): number {
  if (left === right) {
    return 0
  }

  if (left === null) {
    return 1
  }

  if (right === null) {
    return -1
  }

  const leftParts = left.split('.')
  const rightParts = right.split('.')
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index]
    const rightPart = rightParts[index]

    if (leftPart === undefined) {
      return -1
    }

    if (rightPart === undefined) {
      return 1
    }

    if (leftPart === rightPart) {
      continue
    }

    const leftNumeric = /^\d+$/u.test(leftPart)
    const rightNumeric = /^\d+$/u.test(rightPart)

    if (leftNumeric && rightNumeric) {
      return Number(leftPart) - Number(rightPart)
    }

    if (leftNumeric) {
      return -1
    }

    if (rightNumeric) {
      return 1
    }

    return leftPart.localeCompare(rightPart)
  }

  return 0
}

function compareVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left)
  const rightVersion = parseVersion(right)

  if (!leftVersion || !rightVersion) {
    return 0
  }

  for (const field of ['major', 'minor', 'patch'] as const) {
    const difference = leftVersion[field] - rightVersion[field]

    if (difference !== 0) {
      return difference
    }
  }

  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease)
}

function validateChangelog(content: string, currentVersion: string): string[] {
  const errors: string[] = []

  if (!content.startsWith('# Changelog\n')) {
    errors.push('CHANGELOG.md MUST start with "# Changelog"')
  }

  const releases = [...content.matchAll(RELEASE_HEADING_PATTERN)].map(
    (match) => ({
      version: match[1],
      index: match.index ?? 0,
    }),
  )

  if (releases.length === 0) {
    errors.push('CHANGELOG.md MUST contain at least one versioned release')

    return errors
  }

  if (releases[0]?.version !== currentVersion) {
    errors.push(
      `CHANGELOG.md latest release MUST match VERSION (${currentVersion})`,
    )
  }

  const seen = new Set<string>()

  for (const [index, release] of releases.entries()) {
    if (!isSemanticVersion(release.version)) {
      errors.push(
        `CHANGELOG.md release '${release.version}' is not valid SemVer`,
      )
    }

    if (seen.has(release.version)) {
      errors.push(
        `CHANGELOG.md contains duplicate release '${release.version}'`,
      )
    }

    seen.add(release.version)

    const next = releases[index + 1]

    if (
      next &&
      isSemanticVersion(release.version) &&
      isSemanticVersion(next.version) &&
      compareVersions(release.version, next.version) <= 0
    ) {
      errors.push(
        `CHANGELOG.md releases MUST be ordered newest-first by SemVer: ${release.version} before ${next.version}`,
      )
    }

    const bodyEnd = next?.index ?? content.length
    const body = content.slice(release.index, bodyEnd)
    const groups = [...body.matchAll(/^### (.+)$/gmu)].map((match) => match[1])
    let priorGroupIndex = -1

    for (const group of groups) {
      const groupIndex = RELEASE_GROUPS.indexOf(
        group as (typeof RELEASE_GROUPS)[number],
      )

      if (groupIndex === -1) {
        errors.push(
          `CHANGELOG.md release '${release.version}' uses unsupported group '${group}'`,
        )
        continue
      }

      if (groupIndex <= priorGroupIndex) {
        errors.push(
          `CHANGELOG.md release '${release.version}' groups MUST follow Changed, Added, Removed, Fixed order without duplicates`,
        )
      }

      priorGroupIndex = groupIndex
    }
  }

  return errors
}

function validateVersionBearingDocuments(
  root: string,
  version: string,
): string[] {
  const errors: string[] = []
  const readmePath = path.join(root, 'README.md')
  const embeddedInstallationPath = path.join(
    root,
    'docs',
    'embedded-installation.md',
  )

  if (fileExists(readmePath)) {
    const readme = readText(readmePath)
    const headingVersion = /^# Pancreator v([^\s]+)$/mu.exec(readme)?.[1]
    const introductionVersion = /^Pancreator v([^\s]+) is /mu.exec(readme)?.[1]

    if (headingVersion !== version) {
      errors.push('README.md heading version MUST match VERSION')
    }

    if (introductionVersion !== version) {
      errors.push('README.md introduction version MUST match VERSION')
    }
  }

  if (fileExists(embeddedInstallationPath)) {
    const content = readText(embeddedInstallationPath)
    const documentedVersion = /currently agree on `([^`]+)`/u.exec(content)?.[1]

    if (documentedVersion !== version) {
      errors.push(
        'docs/embedded-installation.md current release version MUST match VERSION',
      )
    }
  }

  return errors
}

export function validateReleaseMetadata(
  root: string,
): ReleaseMetadataValidation {
  const errors: string[] = []
  const versionPath = path.join(root, 'VERSION')
  const packagePath = path.join(root, 'package.json')
  const lockPath = path.join(root, 'package-lock.json')
  const changelogPath = path.join(root, 'CHANGELOG.md')
  const releaseIndexPath = path.join(root, 'release', 'index.json')

  if (
    !fileExists(versionPath) ||
    !fileExists(packagePath) ||
    !fileExists(lockPath) ||
    !fileExists(changelogPath) ||
    !fileExists(releaseIndexPath)
  ) {
    return { errors }
  }

  const version = readText(versionPath).trim()
  const packageJson = readJson(packagePath)
  const packageLock = readJson(lockPath)
  const releaseIndex = readJson(releaseIndexPath)

  if (!isSemanticVersion(version)) {
    errors.push(
      `VERSION '${version}' is not valid complete Semantic Versioning`,
    )
  }

  const packageVersion = isRecord(packageJson) ? packageJson.version : null
  const lockVersion = isRecord(packageLock) ? packageLock.version : null
  const rootPackage = isRecord(packageLock) ? packageLock.packages : null
  const rootLockVersion =
    isRecord(rootPackage) && isRecord(rootPackage[''])
      ? rootPackage[''].version
      : null

  if (packageVersion !== version) {
    errors.push('package.json.version MUST match VERSION')
  }

  if (lockVersion !== version || rootLockVersion !== version) {
    errors.push(
      'package-lock.json top-level and root package versions MUST match VERSION',
    )
  }

  errors.push(...validateChangelog(readText(changelogPath), version))
  errors.push(...validateVersionBearingDocuments(root, version))

  if (
    !isRecord(releaseIndex) ||
    releaseIndex.schema_version !== 1 ||
    !Array.isArray(releaseIndex.releases)
  ) {
    errors.push('release/index.json MUST use schema_version 1 with releases[]')

    return { errors }
  }

  const indexedVersions = new Set<string>()

  for (const [index, entry] of releaseIndex.releases.entries()) {
    if (
      !isRecord(entry) ||
      typeof entry.version !== 'string' ||
      typeof entry.commit !== 'string'
    ) {
      errors.push(`release/index.json releases[${index}] has invalid shape`)
      continue
    }

    if (!isSemanticVersion(entry.version)) {
      errors.push(
        `release/index.json version '${entry.version}' is not valid SemVer`,
      )
    }

    if (indexedVersions.has(entry.version)) {
      errors.push(
        `release/index.json contains duplicate version '${entry.version}'`,
      )
    }

    indexedVersions.add(entry.version)

    if (!/^[0-9a-f]{40}$/u.test(entry.commit)) {
      errors.push(
        `release/index.json commit for '${entry.version}' MUST be a full 40-character lowercase Git hash`,
      )
    }
  }

  return { errors }
}
