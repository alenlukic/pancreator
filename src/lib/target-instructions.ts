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
    invariant(
      changedPath.length > 0 && !path.isAbsolute(changedPath),
      `Changed path MUST be workspace-relative: ${changedPath}`,
      { code: 'TARGET_INSTRUCTION_PATH_INVALID' },
    )

    const absolute = path.resolve(root, changedPath)

    invariant(
      absolute === root || absolute.startsWith(`${root}${path.sep}`),
      `Changed path escapes the workspace: ${changedPath}`,
      { code: 'TARGET_INSTRUCTION_PATH_INVALID' },
    )

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
