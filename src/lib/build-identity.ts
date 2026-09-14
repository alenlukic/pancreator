import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { gitCurrentBranch, gitHead } from './git.js'
import { fileExists, isPancreatorRoot, readText } from './io.js'
import type { BuildCurrencyRecord, SourceTreeIdentity } from './types.js'

/**
 * Source tree the `dist` executing this process was compiled from.
 *
 * `bin/pan` can dispatch a checkout other than the installation that supplies
 * the script, so the executing build is a fact to read rather than a
 * property of the installation root. The module's own resolved location is
 * the only evidence that survives that redirection: `PANCREATOR_ROOT` names
 * where run state lives, the working directory names where the operator
 * stood, and neither says which compiler output is running.
 *
 * Returns `null` when the walk leaves no Pancreator root above the module,
 * which happens when a build is consumed from outside a checkout.
 */
export function executingSourceRoot(): string | null {
  let current = path.dirname(fileURLToPath(import.meta.url))

  while (true) {
    if (isPancreatorRoot(current)) {
      return current
    }

    const parent = path.dirname(current)

    if (parent === current) {
      return null
    }

    current = parent
  }
}

/** Git and version identity of one Pancreator source tree. */
export function sourceTreeIdentity(root: string): SourceTreeIdentity {
  const resolved = path.resolve(root)
  const versionPath = path.join(resolved, 'VERSION')

  return {
    root: resolved,
    head: gitHead(resolved),
    branch: gitCurrentBranch(resolved),
    version: fileExists(versionPath) ? readText(versionPath).trim() : null,
  }
}

/**
 * Whether the build now running came from the tree a stage acted on.
 *
 * Two trees are the same state when they resolve to one directory, or when
 * both report the same commit. An unreadable commit on either side is not
 * agreement: a release lane that cannot prove currency must record that it
 * could not, so the comparison answers `false` and the caller raises its
 * advisory.
 */
export function buildCurrency(workspaceDir: string): BuildCurrencyRecord {
  const executingRoot = executingSourceRoot()
  const workspace = sourceTreeIdentity(workspaceDir)
  const executingBuild: SourceTreeIdentity =
    executingRoot === null
      ? { root: '', head: null, branch: null, version: null }
      : sourceTreeIdentity(executingRoot)
  const current =
    executingBuild.root !== '' &&
    (executingBuild.root === workspace.root ||
      (executingBuild.head !== null && executingBuild.head === workspace.head))

  return { executing_build: executingBuild, workspace, current }
}

/** Operator-facing statement of a build that is not the workspace's own. */
export function buildCurrencyAdvisory(record: BuildCurrencyRecord): string {
  const describe = (identity: SourceTreeIdentity): string =>
    `${identity.root === '' ? 'an unresolved source tree' : identity.root} ` +
    `at ${identity.head ?? 'an unreadable head'}`

  return (
    `The release lane executed the build compiled from ` +
    `${describe(record.executing_build)}, while the workspace under release ` +
    `is ${describe(record.workspace)}. A release-lane repair in the ` +
    `workspace is inactive on this run until its commit reaches the ` +
    `executing build.`
  )
}
