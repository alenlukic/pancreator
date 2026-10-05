/**
 * Transcript blocks, operator text, and the transcript corpus of the evidence
 * window.
 */

import path from 'node:path'

import { isRecord } from '../../io.js'
import { cursorProjectDirectory } from '../../transcripts/source.js'
import { listFilesInWindow, readEvidenceText, safeStatMs } from './files.js'

/** Shortest assistant line that can identify a pasted report. */
const MIN_PASTE_LINE_LENGTH = 24

/**
 * Wrappers the platform injects into an operator turn. Their contents are not
 * evidence that anyone used anything: an always-applied rule block names the
 * policies it projects on every single turn, and an attached command block
 * inlines the full prose of the command. Leaving them in would mark most of
 * the harness as mentioned by the act of opening a chat.
 */
const INJECTED_BLOCK_TAGS = [
  'additional_data',
  'agent_skills',
  'agent_transcripts',
  'attached_files',
  'available_subagent_models',
  'available_subagent_types',
  'code_selection',
  'cursor_commands',
  'custom_instructions',
  'dynamic_tool_catalog',
  'environment_details',
  'function_results',
  'git_status',
  'rules',
  'system_reminder',
  'terminal_files_information',
  'user_info',
  'user_rules',
]

const INJECTED_BLOCK_PATTERN = new RegExp(
  `<(${INJECTED_BLOCK_TAGS.join('|')})(?:\\s[^>]*)?>[\\s\\S]*?</\\1>`,
  'gu',
)

/** The operator's own words inside a platform-wrapped turn. */
const USER_QUERY_PATTERN = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/gu

/** Cursor writes this header when an operator invokes a slash command. */
export const COMMAND_MARKER_PATTERN =
  /---\s*Cursor Command:\s*([A-Za-z0-9-]+)\s*---/gu

/** A line that starts with a projected slash command or agent mention. */
export const SLASH_LINE_PATTERN = /^\/pan-([a-z0-9-]+)\b/u

const DEBLOAT_COMMAND = 'pan-debloat'

export const USER_RECORD_PREFIX = '{"role":"user"'

export const ASSISTANT_RECORD_PREFIX = '{"role":"assistant"'

/**
 * Cursor stores a project's transcripts under a directory named for the
 * workspace path with separators replaced by hyphens.
 */
export function defaultTranscriptsRoot(root: string): string {
  return path.join(cursorProjectDirectory(root), 'agent-transcripts')
}

/** One content block of a transcript record. */
export interface TranscriptBlock {
  type: string
  text?: string
  name?: string
  input?: Record<string, unknown>
}

/**
 * Content blocks of one JSONL transcript line's message, keeping only the
 * type, text, tool name, and tool input. Returns an empty list for a line
 * that does not parse or carries no message content array.
 */
export function parseBlocks(line: string): TranscriptBlock[] {
  let record: unknown

  try {
    record = JSON.parse(line)
  } catch {
    return []
  }

  if (!isRecord(record) || !isRecord(record.message)) {
    return []
  }

  const content = record.message.content

  if (!Array.isArray(content)) {
    return []
  }

  const blocks: TranscriptBlock[] = []

  for (const block of content) {
    if (!isRecord(block) || typeof block.type !== 'string') {
      continue
    }

    blocks.push({
      type: block.type,
      ...(typeof block.text === 'string' ? { text: block.text } : {}),
      ...(typeof block.name === 'string' ? { name: block.name } : {}),
      ...(isRecord(block.input) ? { input: block.input } : {}),
    })
  }

  return blocks
}

/** Collapses every whitespace run to one space and trims both ends. */
export function normalizeLine(line: string): string {
  return line.split(/\s+/u).filter(Boolean).join(' ')
}

/**
 * The operator's own words in one user turn.
 *
 * Cursor wraps the typed prompt in `<user_query>` and surrounds it with
 * injected blocks. An older transcript carries no wrapper, so the fallback
 * strips the known injected blocks and keeps the rest.
 */
export function operatorText(text: string): string {
  const parts: string[] = []

  for (const match of text.matchAll(USER_QUERY_PATTERN)) {
    parts.push(match[1] as string)
  }

  if (parts.length > 0) {
    return parts.join('\n')
  }

  return text.replace(INJECTED_BLOCK_PATTERN, ' ')
}

/**
 * Whether a transcript belongs to a `/pan-debloat` session.
 *
 * A debloat session names candidates, reads their definitions, and runs the
 * scan itself, so every appearance inside it is caused by the removal work
 * rather than by use. The whole transcript leaves the evidence set.
 */
function isDebloatTranscript(content: string): boolean {
  for (const match of content.matchAll(COMMAND_MARKER_PATTERN)) {
    if (match[1] === DEBLOAT_COMMAND) {
      return true
    }
  }

  for (const line of content.split('\n')) {
    if (line.startsWith(USER_RECORD_PREFIX)) {
      for (const block of parseBlocks(line)) {
        if (
          block.text !== undefined &&
          /^\s*\/pan-debloat\b/mu.test(operatorText(block.text))
        ) {
          return true
        }
      }
    } else if (line.startsWith(ASSISTANT_RECORD_PREFIX)) {
      for (const block of parseBlocks(line)) {
        const command = block.input?.command

        if (
          block.type === 'tool_use' &&
          typeof command === 'string' &&
          /\bpan\s+debloat\b/u.test(command)
        ) {
          return true
        }
      }
    }
  }

  return false
}

export interface TranscriptCorpus {
  /** Readable, non-debloat transcripts with their text and timestamp. */
  files: Array<{ absolute: string; content: string; at: number }>
  /** Normalized assistant lines, for recognizing a pasted report. */
  assistantLines: Set<string>
  debloatExcluded: number
  unread: string[]
}

/**
 * Read every transcript in the window once.
 *
 * Two things need the whole set before any file is scored. A pasted report
 * can come from a different chat than the one it lands in, so the paste index
 * spans every transcript. And a debloat session is excluded whole, which needs
 * its full text.
 */
export function readTranscriptCorpus(
  transcriptsRoot: string | null,
  windowStartMs: number,
): TranscriptCorpus {
  const enumeration = transcriptsRoot
    ? listFilesInWindow([transcriptsRoot], windowStartMs, new Set(['.jsonl']))
    : { files: [], unread: [] }
  const files: TranscriptCorpus['files'] = []
  const assistantLines = new Set<string>()
  let debloatExcluded = 0

  for (const absolute of enumeration.files) {
    const content = readEvidenceText(absolute)

    if (content === null) {
      enumeration.unread.push(absolute)
      continue
    }

    if (isDebloatTranscript(content)) {
      debloatExcluded += 1
      continue
    }

    const at = safeStatMs(absolute)

    if (at === null) {
      continue
    }

    files.push({ absolute, content, at })

    for (const line of content.split('\n')) {
      if (!line.startsWith(ASSISTANT_RECORD_PREFIX)) {
        continue
      }

      for (const block of parseBlocks(line)) {
        if (block.type !== 'text' || block.text === undefined) {
          continue
        }

        for (const textLine of block.text.split('\n')) {
          const normalized = normalizeLine(textLine)

          if (normalized.length >= MIN_PASTE_LINE_LENGTH) {
            assistantLines.add(normalized)
          }
        }
      }
    }
  }

  return {
    files,
    assistantLines,
    debloatExcluded,
    unread: [...new Set(enumeration.unread)].sort(),
  }
}
