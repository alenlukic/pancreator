import path from 'node:path'

import { invariant } from './errors.js'
import { fileExists } from './io.js'

/** Resolve each changed path to its root-to-file AGENTS.md instruction chain. */
export function resolveTargetInstructionPaths(
  workspaceRoot: string,
  changedPaths: string[],
): string[] {
  const root = path.resolve(workspaceRoot)
  const instructions = new Set<string>()

  for (const changedPath of [...new Set(changedPaths)].sort()) {
    invariant(changedPath.length > 0, 'Changed path MUST be non-empty', {
      code: 'TARGET_INSTRUCTION_PATH_INVALID',
    })

    const absolute = path.resolve(root, changedPath)

    // Declared paths may be absolute or point outside the workspace when the
    // operator or plan says so. A path outside the workspace has no workspace
    // instruction chain, so it contributes nothing instead of failing the
    // whole resolution.
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
      continue
    }

    let directory = path.dirname(absolute)

    while (directory === root || directory.startsWith(`${root}${path.sep}`)) {
      const candidate = path.join(directory, 'AGENTS.md')

      if (fileExists(candidate)) {
        instructions.add(path.relative(root, candidate) || 'AGENTS.md')
      }

      if (directory === root) {
        break
      }

      directory = path.dirname(directory)
    }
  }

  return [...instructions].sort((left, right) => {
    const depthDifference = left.split('/').length - right.split('/').length

    return depthDifference !== 0 ? depthDifference : left.localeCompare(right)
  })
}
