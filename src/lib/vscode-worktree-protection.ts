/**
 * VS Code worktree protection: whether a session opened at the repository
 * root could load instruction files, skills, or agents from a checkout under
 * a managed worktree root.
 *
 * VS Code loads a nested `AGENTS.md` only under `chat.useNestedAgentsMdFiles`,
 * and loads instructions, prompts, agents, and skills only from the folders
 * its `chat.*Locations` settings name. Its defaults read the workspace root
 * alone. `.vscode/` belongs to the target, so this check reads the workspace
 * settings and reports a risk rather than write a setting.
 */

import { fileExists, isRecord, readText } from './io.js'
import { projectionTargetPath } from './projection/manifest.js'

const SETTINGS_PATH = '.vscode/settings.json'

const LOCATION_SETTINGS = [
  'chat.instructionsFilesLocations',
  'chat.promptFilesLocations',
  'chat.agentFilesLocations',
  'chat.agentSkillsLocations',
] as const

export interface VscodeWorktreeProtection {
  settings_path: string
  /** `protected` when no setting reaches a worktree checkout. */
  status: 'protected' | 'at_risk' | 'unreadable'
  risks: string[]
  note: string
}

/** Strip comments and trailing commas from VS Code's JSONC settings. */
function stripJsonc(text: string): string {
  let output = ''
  let index = 0

  while (index < text.length) {
    const char = text[index] as string
    const next = text[index + 1]

    if (char === '"') {
      const start = index

      index += 1

      while (index < text.length && text[index] !== '"') {
        index += text[index] === '\\' ? 2 : 1
      }

      output += text.slice(start, index + 1)
      index += 1
    } else if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') {
        index += 1
      }
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', index + 2)

      index = end === -1 ? text.length : end + 2
    } else {
      output += char
      index += 1
    }
  }

  return output.replace(/,(\s*[}\]])/gu, '$1')
}

/** A location reaches a worktree checkout when it names one or globs all. */
function reachesWorktrees(location: string): boolean {
  return location.includes('worktrees') || location.startsWith('**')
}

/** Report whether the workspace settings keep worktree checkouts out. */
export function vscodeWorktreeProtection(
  root: string,
): VscodeWorktreeProtection {
  const absolute = projectionTargetPath(root, SETTINGS_PATH)
  const note =
    'VS Code defaults load instructions, skills, and agents from the ' +
    'workspace root only. Probe PR-8 confirms the full setting set.'

  if (!fileExists(absolute)) {
    return {
      settings_path: SETTINGS_PATH,
      status: 'protected',
      risks: [],
      note,
    }
  }

  let settings: unknown

  try {
    settings = JSON.parse(stripJsonc(readText(absolute)))
  } catch {
    settings = null
  }

  if (!isRecord(settings)) {
    return {
      settings_path: SETTINGS_PATH,
      status: 'unreadable',
      risks: [`${SETTINGS_PATH} is not a readable settings object.`],
      note,
    }
  }

  const risks: string[] = []

  if (settings['chat.useNestedAgentsMdFiles'] === true) {
    risks.push(
      'chat.useNestedAgentsMdFiles is true, so a root session loads each ' +
        'worktree checkout AGENTS.md. Set it to false.',
    )
  }

  for (const key of LOCATION_SETTINGS) {
    const locations = settings[key]

    if (!isRecord(locations)) {
      continue
    }

    for (const [location, enabled] of Object.entries(locations)) {
      if (enabled === true && reachesWorktrees(location)) {
        risks.push(
          `${key} enables '${location}', which reaches worktree checkouts. ` +
            'Remove it or name the root folder only.',
        )
      }
    }
  }

  return {
    settings_path: SETTINGS_PATH,
    status: risks.length === 0 ? 'protected' : 'at_risk',
    risks,
    note,
  }
}
