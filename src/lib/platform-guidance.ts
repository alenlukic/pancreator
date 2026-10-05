/**
 * The platform guidance catalog: known platform-authored strings, per host,
 * that can conflict with harness governance. The redline record copies the
 * entries of the declaring host, hooks match tool results against them, and
 * `pan redline scan` matches a VS Code debug log against them.
 */

import path from 'node:path'

import { PanError } from './errors.js'
import { fileExists, isRecord, readJson } from './io.js'

export const PLATFORM_GUIDANCE_CATALOG_PATH =
  'governance/registries/platform_guidance_catalog.json'

/** Hosts a redline declaration can name. */
export const REDLINE_HOSTS = [
  'cursor',
  'vscode-local',
  'vscode-agent-host',
  'copilot-cli',
] as const

export type RedlineHost = (typeof REDLINE_HOSTS)[number]

export const GUIDANCE_SURFACES = [
  'system',
  'tool_description',
  'tool_result',
  'synthetic_user_turn',
  'mode_instructions',
  'instruction_preamble',
  'summarization',
  'tool_config',
  'behaviour',
] as const

export interface PlatformGuidanceEntry {
  id: string
  hosts: RedlineHost[]
  category: string
  surface: (typeof GUIDANCE_SURFACES)[number]
  /** A literal substring to match, or null for guidance no text carries. */
  match: { literal: string | null; regex?: string }
  source: {
    repository: string
    commit: string | null
    path: string
    line: number | null
  }
  harness_authority: string
  default_authority_followed: string
}

export interface PlatformGuidanceCatalog {
  schema_version: 1
  /** `source_pinned` or `partial`, per host. */
  coverage: Record<RedlineHost, 'source_pinned' | 'partial'>
  entries: PlatformGuidanceEntry[]
}

function catalogError(message: string): PanError {
  return new PanError(`${PLATFORM_GUIDANCE_CATALOG_PATH}: ${message}`, {
    code: 'INVALID_PLATFORM_GUIDANCE_CATALOG',
  })
}

function isHost(value: unknown): value is RedlineHost {
  return (REDLINE_HOSTS as readonly unknown[]).includes(value)
}

function parseEntry(value: unknown, index: number): PlatformGuidanceEntry {
  const where = `entries[${index}]`

  if (!isRecord(value)) {
    throw catalogError(`${where} MUST be an object`)
  }

  const text = (key: string): string => {
    const field = value[key]

    if (typeof field !== 'string' || field.trim() === '') {
      throw catalogError(`${where}.${key} MUST be a non-empty string`)
    }

    return field
  }
  const hosts = value.hosts
  const surface = value.surface
  const match = value.match
  const source = value.source

  if (!Array.isArray(hosts) || hosts.length === 0 || !hosts.every(isHost)) {
    throw catalogError(
      `${where}.hosts MUST list hosts from ${REDLINE_HOSTS.join(', ')}`,
    )
  }

  if (!(GUIDANCE_SURFACES as readonly unknown[]).includes(surface)) {
    throw catalogError(
      `${where}.surface MUST be one of ${GUIDANCE_SURFACES.join(', ')}`,
    )
  }

  if (
    !isRecord(match) ||
    !(match.literal === null || typeof match.literal === 'string') ||
    !(match.regex === undefined || typeof match.regex === 'string')
  ) {
    throw catalogError(
      `${where}.match MUST carry a literal string or null and an optional regex`,
    )
  }

  if (typeof match.regex === 'string') {
    try {
      new RegExp(match.regex, 'u')
    } catch {
      throw catalogError(`${where}.match.regex MUST compile`)
    }
  }

  if (
    !isRecord(source) ||
    typeof source.repository !== 'string' ||
    typeof source.path !== 'string' ||
    !(source.commit === null || typeof source.commit === 'string') ||
    !(source.line === null || Number.isInteger(source.line))
  ) {
    throw catalogError(
      `${where}.source MUST carry repository, commit, path, and line`,
    )
  }

  return {
    id: text('id'),
    hosts,
    category: text('category'),
    surface: surface as PlatformGuidanceEntry['surface'],
    match: {
      literal: match.literal,
      ...(typeof match.regex === 'string' ? { regex: match.regex } : {}),
    },
    source: {
      repository: source.repository,
      commit: source.commit,
      path: source.path,
      line: source.line as number | null,
    },
    harness_authority: text('harness_authority'),
    default_authority_followed: text('default_authority_followed'),
  }
}

/** Parse and check the catalog shape. Throws on the first defect. */
export function parsePlatformGuidanceCatalog(
  value: unknown,
): PlatformGuidanceCatalog {
  if (!isRecord(value) || value.schema_version !== 1) {
    throw catalogError('schema_version MUST be 1')
  }

  const coverage = value.coverage

  if (
    !isRecord(coverage) ||
    !REDLINE_HOSTS.every(
      (host) =>
        coverage[host] === 'source_pinned' || coverage[host] === 'partial',
    )
  ) {
    throw catalogError(
      'coverage MUST name source_pinned or partial for every host',
    )
  }

  if (!Array.isArray(value.entries)) {
    throw catalogError('entries MUST be an array')
  }

  const entries = value.entries.map(parseEntry)
  const ids = new Set<string>()

  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw catalogError(`entry id ${entry.id} is duplicated`)
    }

    ids.add(entry.id)
  }

  return {
    schema_version: 1,
    coverage: coverage as PlatformGuidanceCatalog['coverage'],
    entries,
  }
}

/** The catalog, or null when the installation does not carry it. */
export function loadPlatformGuidanceCatalog(
  root: string,
): PlatformGuidanceCatalog | null {
  const absolute = path.join(root, PLATFORM_GUIDANCE_CATALOG_PATH)

  return fileExists(absolute)
    ? parsePlatformGuidanceCatalog(readJson(absolute))
    : null
}

/** The catalog entries that apply to one host. */
export function guidanceForHost(
  catalog: PlatformGuidanceCatalog,
  host: RedlineHost,
): PlatformGuidanceEntry[] {
  return catalog.entries.filter((entry) => entry.hosts.includes(host))
}

/** Whether `text` carries the entry's literal or matches its regex. */
export function guidanceMatches(
  entry: PlatformGuidanceEntry,
  text: string,
): boolean {
  if (entry.match.literal !== null && text.includes(entry.match.literal)) {
    return true
  }

  return entry.match.regex !== undefined
    ? new RegExp(entry.match.regex, 'u').test(text)
    : false
}

/**
 * The host a redline declaration names. An explicit value wins, then
 * `PAN_HOST` (`vscode` means the local agent), then a Cursor conversation id.
 */
export function redlineHost(
  explicit: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): RedlineHost | null {
  if (explicit !== undefined && explicit !== null) {
    if (!isHost(explicit)) {
      throw new PanError(
        `--host MUST be one of ${REDLINE_HOSTS.join(', ')}; received ${explicit}`,
        { code: 'INVALID_REDLINE_HOST' },
      )
    }

    return explicit
  }

  if (env.PAN_HOST === 'vscode') {
    return 'vscode-local'
  }

  if (isHost(env.PAN_HOST)) {
    return env.PAN_HOST
  }

  return (env.CURSOR_CONVERSATION_ID ?? '') !== '' ? 'cursor' : null
}

/**
 * The editor version, which Cursor and VS Code both export to their
 * integrated terminals as `TERM_PROGRAM_VERSION`.
 */
export function redlineHostVersion(
  explicit: string | null | undefined,
  host: RedlineHost | null,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (explicit !== undefined && explicit !== null) {
    return explicit
  }

  const editor = host === 'cursor' || host?.startsWith('vscode-') === true

  return editor && env.TERM_PROGRAM === 'vscode'
    ? (env.TERM_PROGRAM_VERSION ?? null)
    : null
}
