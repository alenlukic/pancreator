import { statSync } from 'node:fs'
import path from 'node:path'
import { fileExists } from '../io.js'
import { isSelfDevelopmentInstallation } from '../project-config.js'

export function repositoryChecksPath(root: string): string {
  return path.join(root, 'runtime', 'repository-checks.json')
}

/** A linked Git worktree carries a `.git` file that names its gitdir. */
function isLinkedWorktree(root: string): boolean {
  try {
    return statSync(path.join(root, '.git')).isFile()
  } catch {
    return false
  }
}

/** `<installation>/worktrees/...` and legacy paths resolve to the installation root. */
function owningInstallationRoot(root: string): string | null {
  // The path alone is not enough: a test fixture under a worktree's
  // runtime/tmp/tests.noindex/ also has a `worktrees` segment, and must not read the
  // installation's configuration in place of its own.
  if (!isLinkedWorktree(root)) {
    return null
  }

  const segments = path.resolve(root).split(path.sep)
  const index = segments.lastIndexOf('worktrees')

  if (index <= 0) {
    return null
  }

  if (segments[index - 1] === 'runtime') {
    return segments.slice(0, index - 1).join(path.sep) || path.sep
  }

  return segments.slice(0, index).join(path.sep) || path.sep
}

export function repositoryChecksSourcePath(root: string): string {
  const runtimePath = repositoryChecksPath(root)

  if (fileExists(runtimePath)) {
    return runtimePath
  }

  // The runtime configuration is untracked per-installation state, so a git
  // worktree never carries it. A harness-managed worktree resolves the owning
  // installation's file instead of silently weakening the suite through the
  // template fallback.
  const installationRoot = owningInstallationRoot(root)

  if (installationRoot) {
    const installationPath = repositoryChecksPath(installationRoot)

    if (fileExists(installationPath)) {
      return installationPath
    }
  }

  if (!isSelfDevelopmentInstallation(root)) {
    return runtimePath
  }

  return path.join(
    root,
    'library',
    'templates',
    'repository-checks.self-development.json',
  )
}
