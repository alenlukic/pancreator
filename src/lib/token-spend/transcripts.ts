/**
 * Cursor transcript discovery: attribution roots, the transcripts under them,
 * and the command, worker brief, tools, and timestamp each one carries.
 */

import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs'
import path from 'node:path'

import { errorMessage } from '../errors.js'
import { isDirectory, isRecord, readJson } from '../io.js'
import {
  readInstallationIdentity,
  readProjectConfig,
  registeredInstallations,
} from '../project-config.js'
import { cursorProjectDirectory } from '../transcripts/source.js'
import type {
  AttributionRoot,
  TranscriptEvidence,
  WorkerBrief,
} from './model.js'

const COMMAND_MARKER_PATTERN = /---\s*Cursor Command:\s*([A-Za-z0-9-]+)\s*---/u

const SLASH_COMMAND_PATTERN = /^\/(pan-[a-z0-9-]+)\b/mu

const TIMESTAMP_PATTERN = /<timestamp>([^<]+)<\/timestamp>/u

const BRIEF_REFERENCE_PATTERNS = [
  /workflows\/([^/`\s]+)\/(?:agent\/)?invocations\/([^/`\s.]+)/u,
  /\*\*Run\*\* `([^`]+)` · \*\*Invocation\*\* `([^`]+)`/u,
  /\brun `([^`]+)`, invocation `([^`]+)`/u,
]

const BRIEF_ROLE_PATTERNS = [
  /Evidence brief: ([a-z-]+) for stage/u,
  /^Role `([a-z-]+)` for run/mu,
  /invocations\/[^/`\s.]+\.([a-z-]+)-brief\.md/u,
]

/** Reads a JSON object file, returning null when it is missing, unparseable, or not an object. */
export function safeReadJson(absolute: string): Record<string, unknown> | null {
  try {
    const value = readJson(absolute)

    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function listRecursively(
  directory: string,
  accept: (absolute: string, entry: Dirent) => boolean,
): string[] {
  if (!isDirectory(directory)) {
    return []
  }

  const files: string[] = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...listRecursively(absolute, accept))
    } else if (entry.isFile() && accept(absolute, entry)) {
      files.push(absolute)
    }
  }

  return files
}

export { cursorProjectDirectory }

function transcriptCommand(content: string): string | null {
  const marker = COMMAND_MARKER_PATTERN.exec(content)?.[1]

  if (marker !== undefined) {
    return marker
  }

  return SLASH_COMMAND_PATTERN.exec(content)?.[1] ?? null
}

function openingText(content: string): string {
  const newline = content.indexOf('\n')
  const firstLine = newline === -1 ? content : content.slice(0, newline)
  let record: unknown

  try {
    record = JSON.parse(firstLine)
  } catch {
    return ''
  }

  if (!isRecord(record) || !isRecord(record.message)) {
    return ''
  }

  const blocks = record.message.content

  if (typeof blocks === 'string') {
    return blocks
  }

  if (!Array.isArray(blocks)) {
    return ''
  }

  return blocks
    .filter((block) => isRecord(block) && typeof block.text === 'string')
    .map((block) => (block as { text: string }).text)
    .join('\n')
}

/**
 * The run id, invocation id, and role a worker transcript's opening message
 * names through a brief reference, or null when it names none. The role
 * defaults to `worker`.
 */
export function transcriptBrief(content: string): WorkerBrief | null {
  const opening = openingText(content)

  for (const pattern of BRIEF_REFERENCE_PATTERNS) {
    const match = pattern.exec(opening)

    if (match?.[1] === undefined || match[2] === undefined) {
      continue
    }

    const role =
      BRIEF_ROLE_PATTERNS.map(
        (rolePattern) => rolePattern.exec(opening)?.[1],
      ).find((value) => value !== undefined) ?? 'worker'

    return { run_id: match[1], invocation_id: match[2], role }
  }

  return null
}

function transcriptTools(content: string): Map<string, number> {
  const tools = new Map<string, number>()

  for (const line of content.split('\n')) {
    if (line.trim().length === 0) {
      continue
    }

    let record: unknown

    try {
      record = JSON.parse(line)
    } catch {
      continue
    }

    if (!isRecord(record) || !isRecord(record.message)) {
      continue
    }

    const blocks = record.message.content

    if (!Array.isArray(blocks)) {
      continue
    }

    for (const block of blocks) {
      if (
        !isRecord(block) ||
        block.type !== 'tool_use' ||
        typeof block.name !== 'string'
      ) {
        continue
      }

      tools.set(block.name, (tools.get(block.name) ?? 0) + 1)
    }
  }

  return tools
}

function transcriptTimestamp(content: string, fallback: number): number {
  const declared = TIMESTAMP_PATTERN.exec(content)?.[1]
  const parsed = declared === undefined ? Number.NaN : Date.parse(declared)

  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Harness and workspace roots whose records and transcripts spend is
 * attributed to: this installation, plus each registered embedded
 * installation when this is a self-development checkout. An installation
 * whose identity cannot be read is skipped and named in `warnings`.
 */
export function attributionRoots(root: string): {
  roots: AttributionRoot[]
  warnings: string[]
} {
  const roots: AttributionRoot[] = []
  const warnings: string[] = []
  const seen = new Set<string>()

  const add = (
    harnessRoot: string,
    workspaceRoot: string | null,
    embedded: boolean,
  ): void => {
    const absoluteHarness = path.resolve(harnessRoot)

    if (seen.has(absoluteHarness)) {
      return
    }

    roots.push({
      harness_root: absoluteHarness,
      workspace_root: path.resolve(absoluteHarness, workspaceRoot ?? '.'),
      embedded,
    })
    seen.add(absoluteHarness)
  }

  // A registered installation's config.json is read for identity only
  // (installation_mode, workspace_root), never against this checkout's
  // current full schema: an older installation can fail a field this
  // checkout's own schema added since, even though its own harness still
  // accepts it. A skipped installation is named in `warnings` rather than
  // dropped silently, so a spend report's attribution coverage stays
  // explainable.
  const resolveIdentity = (
    harnessRoot: string,
    label: string,
  ): ReturnType<typeof readInstallationIdentity> => {
    try {
      const identity = readInstallationIdentity(harnessRoot)

      if (identity === null) {
        warnings.push(
          `Installation ${label} skipped for spend attribution: no harness configuration found.`,
        )
      }

      return identity
    } catch (error) {
      warnings.push(
        `Installation ${label} skipped for spend attribution: ${errorMessage(error)}`,
      )

      return null
    }
  }

  const current = readProjectConfig(root)

  add(
    root,
    current?.workspace_root ?? null,
    current?.installation_mode === 'embedded',
  )

  if (current?.installation_mode === 'self_development') {
    for (const installation of registeredInstallations(root)) {
      const identity = resolveIdentity(installation.path, installation.id)

      if (identity?.installation_mode === 'embedded') {
        add(installation.path, identity.workspace_root, true)
      }
    }
  }

  return { roots, warnings }
}

/**
 * Reads the Cursor agent transcripts modified since the window start, keyed
 * by transcript id, with each one's command (inherited from the parent for a
 * subagent), worker brief, tool-use counts, content, and timestamp. Reads the
 * roots' project transcript directories, or only `override` when given (none
 * when it is null). Unreadable files are skipped.
 */
export function readTranscripts(
  roots: AttributionRoot[],
  windowStartMs: number,
  override: string | null | undefined,
  projectsRoot?: string,
): Map<string, TranscriptEvidence> {
  const transcripts = new Map<string, TranscriptEvidence>()
  const transcriptRoots =
    override === undefined
      ? roots.map((item) =>
          path.join(
            cursorProjectDirectory(item.workspace_root, projectsRoot),
            'agent-transcripts',
          ),
        )
      : override === null
        ? []
        : [override]

  for (const transcriptsRoot of new Set(transcriptRoots)) {
    for (const absolute of listRecursively(transcriptsRoot, (file) =>
      file.endsWith('.jsonl'),
    )) {
      let stat: ReturnType<typeof statSync>

      try {
        stat = statSync(absolute)
      } catch {
        continue
      }

      if (stat.mtimeMs < windowStartMs) {
        continue
      }

      let content: string

      try {
        content = readFileSync(absolute, 'utf8')
      } catch {
        continue
      }

      const id = path.basename(absolute, '.jsonl')
      const relative = path.relative(transcriptsRoot, absolute)
      const segments = relative.split(path.sep)
      const parentId =
        segments.length >= 3 && segments.at(-2) === 'subagents'
          ? (segments.at(-3) ?? null)
          : null

      const command = transcriptCommand(content)

      transcripts.set(id, {
        id,
        parent_id: parentId,
        command,
        brief: command === null ? transcriptBrief(content) : null,
        tools: transcriptTools(content),
        content,
        at_ms: transcriptTimestamp(content, stat.mtimeMs),
      })
    }
  }

  for (const transcript of transcripts.values()) {
    if (transcript.command !== null || transcript.parent_id === null) {
      continue
    }

    transcript.command = transcripts.get(transcript.parent_id)?.command ?? null
  }

  return transcripts
}
