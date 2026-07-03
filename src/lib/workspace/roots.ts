import { accessSync, constants, lstatSync, statSync } from 'node:fs'
import path from 'node:path'

import { invariant } from '../errors.js'
import { canonicalize, ensureDir, fileExists, sha256 } from '../io.js'
import { readProjectConfig } from '../project-config.js'
import type { ResolvedRoots } from '../types.js'

export interface ResolveRootsOptions {
  installation_root: string
  workspace_root: string
  state_root?: string | null
}

function isPathWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)

  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  )
}

function isDescendantPath(parent: string, candidate: string): boolean {
  if (parent === candidate) {
    return false
  }

  const relative = path.relative(parent, candidate)

  return (
    relative.length > 0 &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  )
}

function ensureWritableDirectory(directoryPath: string): void {
  ensureDir(directoryPath)

  invariant(
    statSync(directoryPath).isDirectory(),
    `State root must be a directory: ${directoryPath}`,
    { code: 'INVALID_STATE_ROOT' },
  )

  try {
    accessSync(directoryPath, constants.W_OK)
  } catch {
    throw new Error(`State root must be writable: ${directoryPath}`)
  }
}

function normalizeConfiguredPath(absolutePath: string): string {
  return absolutePath.split(path.sep).join('/')
}

function normalizeRelativeStateRoot(stateRoot: string): string {
  const normalized = stateRoot.split(path.sep).join('/')

  invariant(normalized.length > 0, 'State root must be non-empty.', {
    code: 'INVALID_STATE_ROOT',
  })
  invariant(
    !path.posix.isAbsolute(normalized),
    'State root must be relative or absolute.',
    { code: 'INVALID_STATE_ROOT' },
  )

  const collapsed = path.posix.normalize(normalized)

  invariant(
    collapsed !== '.' &&
      collapsed !== '..' &&
      !collapsed.startsWith('../') &&
      !collapsed.includes('/../'),
    'State root must stay within the workspace root.',
    { code: 'PATH_ESCAPE' },
  )

  return collapsed
}

export function resolveRoots(options: ResolveRootsOptions): ResolvedRoots {
  const installationRoot = canonicalize(options.installation_root)
  const workspaceRootCandidate = path.isAbsolute(options.workspace_root)
    ? options.workspace_root
    : path.resolve(installationRoot, options.workspace_root)

  invariant(
    fileExists(workspaceRootCandidate),
    'Workspace root does not exist.',
    {
      code: 'WORKSPACE_NOT_FOUND',
      details: { workspace_root: options.workspace_root },
    },
  )
  invariant(
    statSync(workspaceRootCandidate).isDirectory(),
    'Workspace root must be a directory.',
    { code: 'WORKSPACE_NOT_FOUND' },
  )

  const workspaceRoot = canonicalize(workspaceRootCandidate)
  const projectConfig = readProjectConfig(installationRoot)
  const configuredStateRoot =
    options.state_root ??
    process.env.PANCREATOR_STATE_ROOT ??
    projectConfig?.state_root ??
    '.pancreator/runtime'
  let relativeStateRoot: string | null = null
  let stateRootCandidate: string

  if (path.isAbsolute(configuredStateRoot)) {
    stateRootCandidate = configuredStateRoot
  } else {
    relativeStateRoot = normalizeRelativeStateRoot(configuredStateRoot)
    stateRootCandidate = path.resolve(installationRoot, relativeStateRoot)
  }

  const stateRoot = fileExists(stateRootCandidate)
    ? canonicalize(stateRootCandidate)
    : path.resolve(stateRootCandidate)

  if (relativeStateRoot !== null) {
    invariant(
      isPathWithinRoot(installationRoot, stateRoot),
      'State root must stay within the installation root.',
      { code: 'PATH_ESCAPE' },
    )
  }

  ensureWritableDirectory(stateRoot)

  const include = projectConfig?.tracking?.include ?? ['**/*']
  const configuredExclude = projectConfig?.tracking?.exclude ?? []
  const autoExclude = new Set<string>(['.git', '.hg', '.svn'])
  const stateRelative = normalizeConfiguredPath(
    path.relative(workspaceRoot, stateRoot),
  )

  if (
    stateRelative.length > 0 &&
    !stateRelative.startsWith('../') &&
    !path.isAbsolute(stateRelative)
  ) {
    autoExclude.add(stateRelative)
  }

  if (isDescendantPath(workspaceRoot, installationRoot)) {
    autoExclude.add(
      normalizeConfiguredPath(path.relative(workspaceRoot, installationRoot)),
    )
  }

  const exclude = [...new Set([...configuredExclude, ...autoExclude])]
    .filter((item) => item.length > 0 && item !== '.')
    .sort()
  const workspaceId =
    projectConfig?.workspace_id && projectConfig.workspace_id.length > 0
      ? projectConfig.workspace_id
      : sha256(workspaceRoot).slice(0, 16)
  const scopeHash = sha256({
    workspace_root: workspaceRoot,
    installation_root: installationRoot,
    state_root: stateRoot,
    include,
    exclude,
  })

  return {
    installation_root: installationRoot,
    workspace_root: workspaceRoot,
    state_root: stateRoot,
    workspace_id: workspaceId,
    include,
    exclude,
    scope_hash: scopeHash,
  }
}

export function normalizeWorkspacePath(relativePath: string): string {
  const normalized = relativePath.split(path.sep).join('/')

  invariant(normalized.length > 0, 'Tracked path must be non-empty.', {
    code: 'INVALID_PATH',
  })
  invariant(
    !path.posix.isAbsolute(normalized),
    'Tracked path must be workspace-relative.',
    { code: 'PATH_ESCAPE' },
  )

  const collapsed = path.posix.normalize(normalized)

  invariant(
    collapsed !== '.' &&
      !collapsed.startsWith('../') &&
      collapsed !== '..' &&
      !collapsed.includes('/../'),
    'Tracked path escapes the workspace root.',
    { code: 'PATH_ESCAPE' },
  )

  return collapsed
}

export function resolveWorkspacePath(
  roots: ResolvedRoots,
  relativePath: string,
): string {
  const normalized = normalizeWorkspacePath(relativePath)
  const absolute = path.resolve(roots.workspace_root, normalized)
  const relative = path.relative(roots.workspace_root, absolute)

  invariant(
    relative.length > 0 &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative),
    'Tracked path escapes the workspace root.',
    { code: 'PATH_ESCAPE' },
  )

  let boundaryPath = absolute

  if (fileExists(absolute)) {
    const metadata = lstatSync(absolute)

    boundaryPath = metadata.isSymbolicLink()
      ? canonicalize(path.dirname(absolute))
      : canonicalize(absolute)
  } else {
    let ancestor = absolute

    while (!fileExists(ancestor)) {
      const parent = path.dirname(ancestor)

      invariant(
        parent !== ancestor,
        'Tracked path escapes the workspace root.',
        {
          code: 'PATH_ESCAPE',
        },
      )
      ancestor = parent
    }

    boundaryPath = canonicalize(ancestor)
  }

  invariant(
    isPathWithinRoot(roots.workspace_root, boundaryPath),
    'Tracked path escapes the workspace root.',
    { code: 'PATH_ESCAPE' },
  )

  return absolute
}

export const NESTED_GENERATED_DIRECTORY_NAMES = [
  'node_modules',
  'dist',
  'coverage',
] as const

function pathSegments(relativePath: string): string[] {
  return relativePath.split('/').filter((segment) => segment.length > 0)
}

export function containsNestedGeneratedDirectory(
  workspaceRelativePath: string,
): boolean {
  const segments = pathSegments(workspaceRelativePath)

  return segments.some((segment) =>
    (NESTED_GENERATED_DIRECTORY_NAMES as readonly string[]).includes(segment),
  )
}

function segmentMatches(patternSegment: string, pathSegment: string): boolean {
  if (patternSegment === '*') {
    return true
  }

  if (!patternSegment.includes('*')) {
    return patternSegment === pathSegment
  }

  const escaped = patternSegment.replace(/[.+?^${}()|[\]\\]/gu, '\\$&')
  const regex = new RegExp(`^${escaped.replaceAll('*', '.*')}$`, 'u')

  return regex.test(pathSegment)
}

function matchGlobSegments(
  patternSegments: string[],
  pathSegmentsList: string[],
  patternIndex: number,
  pathIndex: number,
): boolean {
  if (patternIndex === patternSegments.length) {
    return pathIndex === pathSegmentsList.length
  }

  const patternSegment = patternSegments[patternIndex]

  if (patternSegment === '**') {
    if (patternIndex === patternSegments.length - 1) {
      return true
    }

    for (
      let nextPathIndex = pathIndex;
      nextPathIndex <= pathSegmentsList.length;
      nextPathIndex += 1
    ) {
      if (
        matchGlobSegments(
          patternSegments,
          pathSegmentsList,
          patternIndex + 1,
          nextPathIndex,
        )
      ) {
        return true
      }
    }

    return false
  }

  if (pathIndex >= pathSegmentsList.length) {
    return false
  }

  if (!segmentMatches(patternSegment, pathSegmentsList[pathIndex])) {
    return false
  }

  return matchGlobSegments(
    patternSegments,
    pathSegmentsList,
    patternIndex + 1,
    pathIndex + 1,
  )
}

export function matchWorkspaceGlob(
  pattern: string,
  workspaceRelativePath: string,
): boolean {
  const normalizedPattern = pattern.trim()

  if (normalizedPattern.length === 0) {
    return false
  }

  const normalizedPath = normalizeWorkspacePath(workspaceRelativePath)

  if (normalizedPattern === normalizedPath) {
    return true
  }

  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3)

    if (!prefix.includes('*')) {
      if (prefix.length === 0) {
        return true
      }

      let normalizedPrefix: string

      try {
        normalizedPrefix = normalizeWorkspacePath(prefix)
      } catch {
        return false
      }

      return (
        normalizedPath === normalizedPrefix ||
        normalizedPath.startsWith(`${normalizedPrefix}/`)
      )
    }
  }

  const patternSegments = normalizedPattern.split('/').filter(Boolean)
  const pathSegmentsList = pathSegments(normalizedPath)

  return matchGlobSegments(patternSegments, pathSegmentsList, 0, 0)
}

export function isExcludedPath(
  roots: ResolvedRoots,
  workspaceRelativePath: string,
): boolean {
  const normalized = normalizeWorkspacePath(workspaceRelativePath)

  if (containsNestedGeneratedDirectory(normalized)) {
    return true
  }

  for (const pattern of roots.exclude) {
    if (matchWorkspaceGlob(pattern, normalized)) {
      return true
    }
  }

  return false
}
