/**
 * Copilot CLI worker workspaces: the projected hook file and persona agent a
 * worker launched in a worktree needs beside it.
 */

import path from 'node:path'

import { fileExists, isRecord, readText, writeTextAtomic } from '../io.js'
import { harnessPathPrefix, isTargetInstallation } from '../project-config.js'
import { projectionTargetPath } from '../projection/manifest.js'

export const COPILOT_HOOKS_TARGET = '.github/hooks/pan-hooks.json'

export function copilotAgentTarget(persona: string): string {
  return `.github/agents/pan-${persona}.agent.md`
}

function shellPath(value: string): string {
  return /^[\w./-]+$/u.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * Rewrite each projected hook command that reaches the harness through a
 * workspace-relative prefix so it runs from any working directory.
 */
export function absoluteHookCommands(root: string, content: string): string {
  const prefix = `${
    isTargetInstallation(root) ? `${harnessPathPrefix(root)}/` : ''
  }bin/`
  const absolute = `${shellPath(path.resolve(root))}/bin/`
  const parsed: unknown = JSON.parse(content)
  const hooks = isRecord(parsed) && isRecord(parsed.hooks) ? parsed.hooks : {}

  for (const entries of Object.values(hooks)) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      for (const key of ['bash', 'command']) {
        if (
          isRecord(entry) &&
          typeof entry[key] === 'string' &&
          entry[key].startsWith(prefix)
        ) {
          entry[key] = absolute + entry[key].slice(prefix.length)
        }
      }
    }
  }

  return `${JSON.stringify(parsed, null, 2)}\n`
}

/**
 * Copy the projected hook file and persona agent into a worker workspace
 * other than the projection home. The CLI loads both from its working
 * directory, and a worktree carries neither because the projections are
 * git-excluded. Returns the workspace-relative paths it wrote.
 */
export function provisionCopilotWorkspace(
  root: string,
  workspaceDir: string,
  persona: string,
): string[] {
  const home = path.resolve(projectionTargetPath(root, '.'))

  if (path.resolve(workspaceDir) === home) {
    return []
  }

  const written: string[] = []
  const surfaces = [
    {
      target: COPILOT_HOOKS_TARGET,
      render: (content: string) => absoluteHookCommands(root, content),
    },
    {
      target: copilotAgentTarget(persona),
      render: (content: string) => content,
    },
  ]

  for (const surface of surfaces) {
    const source = projectionTargetPath(root, surface.target)

    if (!fileExists(source)) {
      continue
    }

    const destination = path.join(workspaceDir, surface.target)
    const content = surface.render(readText(source))

    if (!fileExists(destination) || readText(destination) !== content) {
      writeTextAtomic(destination, content)
      written.push(surface.target)
    }
  }

  return written
}
