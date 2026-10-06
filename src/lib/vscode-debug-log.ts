/**
 * The opt-in VS Code debug log: where the local agent writes its rendered
 * system prompt, tool definitions, and input messages when the operator turns
 * on `chat.agentDebugLog.fileLogging.enabled`. `pan redline scan` matches it
 * against the platform guidance catalog and reports only entry ids, file
 * names, and counts, never the logged content.
 */

import { readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { PanError } from './errors.js'
import { fileExists, isRecord, readText } from './io.js'
import {
  guidanceForHost,
  guidanceMatches,
  loadPlatformGuidanceCatalog,
  type RedlineHost,
} from './platform-guidance.js'
import { projectionTargetPath } from './projection/manifest.js'
import { stripJsonc } from './vscode-worktree-protection.js'

export const DEBUG_LOG_SETTING = 'chat.agentDebugLog.fileLogging.enabled'
const LEGACY_DEBUG_LOG_SETTING = 'chat.chatDebug.fileLogging.enabled'
export const VSCODE_USER_SETTINGS_ENV = 'PANCREATOR_VSCODE_USER_SETTINGS'

export interface DebugLogMatch {
  guidance_id: string
  category: string
  occurrences: number
  /** Paths relative to the scanned directory. */
  files: string[]
}

export interface DebugLogScan {
  directory: string
  host: RedlineHost
  files_scanned: number
  /** Files no reader could parse; a coverage gap, not a clean result. */
  unreadable_files: string[]
  matches: DebugLogMatch[]
  /** Catalog entries for the host that carry no text to match. */
  unmatchable_guidance: string[]
}

export interface DebugLogState {
  setting: string
  status: 'enabled' | 'disabled' | 'unset'
  source: string | null
  note: string
}

function logFiles(directory: string, prefix = ''): string[] {
  return readdirSync(path.join(directory, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const relative = path.join(prefix, entry.name)

      if (entry.isDirectory()) {
        return logFiles(directory, relative)
      }

      return entry.isFile() && /\.jsonl?$/u.test(entry.name) ? [relative] : []
    })
    .sort()
}

function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === 'string') {
    into.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, into)
    }
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) {
      collectStrings(item, into)
    }
  }
}

/** Every string value in a JSON or JSONL file; null when nothing parses. */
function fileStrings(absolute: string): string[] | null {
  const text = readText(absolute)
  const strings: string[] = []

  try {
    collectStrings(JSON.parse(text), strings)
    return strings
  } catch {
    let parsed = 0

    for (const line of text.split('\n')) {
      if (line.trim() === '') {
        continue
      }

      try {
        collectStrings(JSON.parse(line), strings)
        parsed += 1
      } catch {
        // A truncated last line is normal for a live log.
      }
    }

    return parsed > 0 ? strings : null
  }
}

/** Match every JSON and JSONL file under `directory` against the catalog. */
export function scanVscodeDebugLog(
  root: string,
  directory: string,
  host: RedlineHost = 'vscode-local',
): DebugLogScan {
  const absolute = path.resolve(directory)

  if (!fileExists(absolute)) {
    throw new PanError(`--vscode-debug-log ${directory} does not exist.`, {
      code: 'DEBUG_LOG_MISSING',
    })
  }

  const catalog = loadPlatformGuidanceCatalog(root)

  if (catalog === null) {
    throw new PanError('The platform guidance catalog is missing.', {
      code: 'INVALID_PLATFORM_GUIDANCE_CATALOG',
    })
  }

  const entries = guidanceForHost(catalog, host)
  const matchable = entries.filter(
    (entry) => entry.match.literal !== null || entry.match.regex !== undefined,
  )
  const matches = new Map<string, DebugLogMatch>()
  const unreadable: string[] = []
  const files = logFiles(absolute)

  for (const file of files) {
    const strings = fileStrings(path.join(absolute, file))

    if (strings === null) {
      unreadable.push(file)
      continue
    }

    for (const entry of matchable) {
      const occurrences = strings.filter((text) =>
        guidanceMatches(entry, text),
      ).length

      if (occurrences === 0) {
        continue
      }

      const match = matches.get(entry.id) ?? {
        guidance_id: entry.id,
        category: entry.category,
        occurrences: 0,
        files: [],
      }

      match.occurrences += occurrences
      match.files.push(file)
      matches.set(entry.id, match)
    }
  }

  return {
    directory: absolute,
    host,
    files_scanned: files.length,
    unreadable_files: unreadable,
    matches: [...matches.values()],
    unmatchable_guidance: entries
      .filter((entry) => !matchable.includes(entry))
      .map((entry) => entry.id),
  }
}

/** VS Code's user settings file for this platform, stable channel. */
export function vscodeUserSettingsPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env[VSCODE_USER_SETTINGS_ENV]

  if (override) {
    return override
  }

  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library/Application Support/Code/User/settings.json',
    )
  }

  if (process.platform === 'win32') {
    return path.join(env.APPDATA ?? os.homedir(), 'Code/User/settings.json')
  }

  return path.join(os.homedir(), '.config/Code/User/settings.json')
}

function settingValue(absolute: string): boolean | null {
  if (!fileExists(absolute)) {
    return null
  }

  try {
    const settings: unknown = JSON.parse(stripJsonc(readText(absolute)))

    if (!isRecord(settings)) {
      return null
    }

    const value =
      settings[DEBUG_LOG_SETTING] ?? settings[LEGACY_DEBUG_LOG_SETTING]

    return typeof value === 'boolean' ? value : null
  } catch {
    return null
  }
}

/**
 * Whether VS Code writes the debug log. The workspace setting wins over the
 * user setting. An unset value defaults to off, though an experiment can turn
 * it on.
 */
export function vscodeDebugLogState(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): DebugLogState {
  const sources = [
    {
      label: '.vscode/settings.json',
      absolute: projectionTargetPath(root, '.vscode/settings.json'),
    },
    { label: 'VS Code user settings', absolute: vscodeUserSettingsPath(env) },
  ]
  const note =
    'The debug log lets pan redline scan --vscode-debug-log <dir> match ' +
    'platform text against the catalog. It records prompts and messages, so ' +
    'the operator turns it on and off.'

  for (const source of sources) {
    const value = settingValue(source.absolute)

    if (value !== null) {
      return {
        setting: DEBUG_LOG_SETTING,
        status: value ? 'enabled' : 'disabled',
        source: source.label,
        note,
      }
    }
  }

  return { setting: DEBUG_LOG_SETTING, status: 'unset', source: null, note }
}
