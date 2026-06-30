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

function patternPrefix(pattern: string): string {
  if (pattern.endsWith('/**')) {
    return pattern.slice(0, -3)
  }

  const wildcardIndex = pattern.indexOf('*')

  if (wildcardIndex === -1) {
    return pattern
  }

  return pattern.slice(0, wildcardIndex)
}

export function isExcludedPath(
  roots: ResolvedRoots,
  workspaceRelativePath: string,
): boolean {
  const normalized = normalizeWorkspacePath(workspaceRelativePath)

  for (const pattern of roots.exclude) {
    const rawPrefix = patternPrefix(pattern).trim()

    if (rawPrefix.length === 0) {
      continue
    }

    let prefix: string

    try {
      prefix = normalizeWorkspacePath(rawPrefix)
    } catch {
      continue
    }

    if (
      normalized === prefix ||
      normalized.startsWith(`${prefix}/`) ||
      pattern === normalized
    ) {
      return true
    }
  }

  return false
}
