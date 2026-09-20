import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { isDirectory, isFile, isRecord, readJson, readText } from '../io.js'
import {
  alwaysReadTargets,
  reachableFrom,
  type ReferenceGraph,
} from './graph.js'
import { isInformationRequest, type IntentClassifier } from './intent.js'
import type { Facility } from './inventory.js'

/**
 * How strong the evidence behind a facility's usage is.
 *
 * `execution` means a harness run record, a standalone session, a Cursor
 * command marker, a slash-command line, an agent's subagent launch, or an
 * agent's `pan` invocation named the facility. `reachable` means no record
 * named it but a facility that did run still depends on it. `direction` means
 * chat or an inbox request directed an agent to run, read, or apply it, or an
 * agent read it while doing work. `none` means the window holds no functional
 * use. A mention that is not a direction is counted and reported, and never
 * lifts a facility above `none`.
 */
export type EvidenceTier = 'execution' | 'reachable' | 'direction' | 'none'

export interface FacilityUsage {
  facility_id: string
  evidence_tier: EvidenceTier
  /** ISO-8601 instant of the most recent direct evidence, or null. */
  last_used_at: string | null
  execution_count: number
  /** Functional directions and agent lookups in chat and inbox text. */
  direction_count: number
  /** Lines that named the facility without using it. Never retains. */
  incidental_mention_count: number
  /** Live facilities and code files that still depend on this one. */
  depended_on_by: string[]
  /**
   * True when every structural reference to this facility comes from a test
   * or from a registration, and something references it at all.
   *
   * A facility in this state is held up only by the tests written to exercise
   * it. Nothing in the harness reaches it, so the tests prove that the code
   * runs rather than that anyone needs it. Removing it takes its tests too,
   * which is why the operator has to see the state rather than infer it.
   */
  test_only_references: boolean
  /** Up to five evidence locations, for the operator to spot-check. */
  samples: string[]
}

export interface UsageScanSources {
  workflow_runs: number
  sessions: number
  command_invocations: number
  transcript_files: number
  operator_request_files: number
  transcripts_root: string | null
  /** Transcripts that ran `/pan-debloat`, excluded from every count. */
  debloat_sessions_excluded: number
  /** Subagent launches and `pan` invocations agents made in transcripts. */
  agent_invocations: number
  /** Facility files agents read while doing work. */
  agent_lookups: number
  /** Lines that named a facility without using it, across chat and inbox. */
  incidental_mentions: number
  /** Every evidence source and the number of files read from it. */
  by_source: Record<string, number>
  /** Files or directories the exhaustive walk could not read. */
  unread: string[]
}

export interface UsageScan {
  usage: FacilityUsage[]
  sources: UsageScanSources
}

export interface UsageScanOptions {
  /** Inclusive lower bound of the window. */
  readonly windowStart: Date
  /** Static reference graph over the same facility set. */
  readonly graph: ReferenceGraph
  /** Separates a functional direction from a mention in chat and inbox text. */
  readonly classifier: IntentClassifier
  /** Overrides the derived Cursor transcript directory. */
  readonly transcriptsRoot?: string | null
}

const MAX_SAMPLES = 5

const MAX_SCAN_FILE_BYTES = 32 * 1024 * 1024
const STREAM_CHUNK_BYTES = 1024 * 1024

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
const COMMAND_MARKER_PATTERN = /---\s*Cursor Command:\s*([A-Za-z0-9-]+)\s*---/gu

/** A line that starts with a projected slash command or agent mention. */
const SLASH_LINE_PATTERN = /^\/pan-([a-z0-9-]+)\b/u

/** A `pan` subcommand inside a shell command an agent ran. */
const PAN_INVOCATION_PATTERN =
  /(?:^|[\s;&|(`'"])(?:\.\/|\.\/\.pancreator\/|\S*\/)?(?:bin\/)?pan\s+([a-z][a-z0-9-]*)/gu

const MODE_OPTION_PATTERN = /--mode\s+([a-z][a-z0-9-]*)/gu

const WORKFLOW_OPTION_PATTERN = /--workflow\s+([a-z][a-z0-9-]*)/gu

/** Shell readers that open one file rather than search a tree. */
const SHELL_READ_PATTERN =
  /(?:^|[\s;&|(])(?:cat|less|more|head|tail|bat)\s+([^\s;&|)]+)/gu

const DEBLOAT_COMMAND = 'pan-debloat'

/** Tools that change a file. A read before one of these is development. */
const EDIT_TOOL_NAMES = new Set([
  'ApplyPatch',
  'Delete',
  'Edit',
  'MultiEdit',
  'StrReplace',
  'Write',
  'edit_file',
  'write_file',
])

const USER_RECORD_PREFIX = '{"role":"user"'
const ASSISTANT_RECORD_PREFIX = '{"role":"assistant"'

interface Hit {
  facilityId: string
  at: number
  source: string
}

function safeStatMs(absolute: string): number | null {
  try {
    return statSync(absolute).mtimeMs
  } catch {
    return null
  }
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null
  }

  const parsed = Date.parse(value)

  return Number.isNaN(parsed) ? null : parsed
}

function readJsonRecord(absolute: string): Record<string, unknown> | null {
  try {
    const value = readJson(absolute)

    return isRecord(value) ? value : null
  } catch {
    // A truncated record from an interrupted run is evidence of nothing.
    return null
  }
}

function listDirectories(absolute: string): string[] {
  if (!isDirectory(absolute)) {
    return []
  }

  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

/**
 * Expand a log root into its run directories, following the archive.
 *
 * `pan archive` moves a run into a sibling `archive/` directory rather than
 * deleting it, so a 30-day window that reads only the active tree reports
 * every facility older than the 7-day retention default as unused.
 */
function withArchive(base: string): string[] {
  const found: string[] = []

  for (const name of listDirectories(base)) {
    if (name === 'archive') {
      const archive = path.join(base, name)

      found.push(
        ...listDirectories(archive).map((child) => path.join(archive, child)),
      )
      continue
    }

    found.push(path.join(base, name))
  }

  return found
}

function runDirectories(root: string): string[] {
  return [
    ...withArchive(path.join(root, 'runtime', 'logs', 'workflows')),
    ...withArchive(path.join(root, 'runtime', 'workflows')),
  ]
}

/**
 * Mode a standalone session ran under.
 *
 * The session writes `<mode>-card.md`, which is exact. The directory name
 * carries the same mode with a `-2` disambiguating suffix when two sessions
 * share a minute, so it is the fallback rather than the primary source.
 */
function sessionMode(absolute: string): string | null {
  if (isDirectory(absolute)) {
    for (const entry of readdirSync(absolute)) {
      if (entry.endsWith('-card.md')) {
        return entry.slice(0, -'-card.md'.length)
      }
    }
  }

  const segments = path.basename(absolute).split('_')
  const suffix = segments.at(-1)

  if (!suffix || segments.length < 2) {
    return null
  }

  return suffix.replace(/-\d+$/u, '')
}

function collectRunHits(
  root: string,
  facilities: readonly Facility[],
  windowStartMs: number,
  record: (facilityId: string, at: number, source: string) => void,
): { runs: number; sessions: number } {
  const guidanceOwners = new Map<string, string>()

  for (const entry of facilities) {
    for (const owned of entry.owned_paths) {
      guidanceOwners.set(owned, entry.id)
    }
  }

  const commandNames = new Set(
    facilities
      .filter((entry) => entry.category === 'command')
      .map((entry) => entry.name),
  )
  let runs = 0
  let sessions = 0

  for (const runDir of runDirectories(root)) {
    const agentDir = path.join(runDir, 'agent')
    const statePath = path.join(agentDir, 'state.json')
    const state = isFile(statePath) ? readJsonRecord(statePath) : null
    const stateAt =
      parseTimestamp(state?.created_at) ??
      parseTimestamp(state?.updated_at) ??
      safeStatMs(statePath) ??
      safeStatMs(runDir)

    if (stateAt === null || stateAt < windowStartMs) {
      continue
    }

    runs += 1

    if (typeof state?.workflow_slug === 'string') {
      record(
        `workflow:${state.workflow_slug}`,
        stateAt,
        path.relative(root, runDir),
      )
    }

    const invocationsDir = path.join(agentDir, 'invocations')

    if (!isDirectory(invocationsDir)) {
      continue
    }

    for (const entry of readdirSync(invocationsDir).sort()) {
      if (!entry.endsWith('.json')) {
        continue
      }

      const invocationPath = path.join(invocationsDir, entry)
      const invocation = readJsonRecord(invocationPath)

      if (!invocation) {
        continue
      }

      const at =
        parseTimestamp(invocation.created_at) ??
        safeStatMs(invocationPath) ??
        stateAt

      if (at < windowStartMs) {
        continue
      }

      const source = path.relative(root, invocationPath)
      const stage = isRecord(invocation.stage) ? invocation.stage : null
      const workflow = isRecord(invocation.workflow)
        ? invocation.workflow
        : null

      if (typeof stage?.persona === 'string') {
        record(`persona:${stage.persona}`, at, source)
      }

      if (typeof workflow?.slug === 'string') {
        record(`workflow:${workflow.slug}`, at, source)
      }

      if (Array.isArray(invocation.policies)) {
        for (const policy of invocation.policies) {
          if (isRecord(policy) && typeof policy.id === 'string') {
            record(`policy:${policy.id}`, at, source)
          }
        }
      }

      // Guidance is the one structured edge that reaches a skill or a
      // handbook, so it is the only direct evidence those categories get.
      const manifest = isRecord(invocation.contract_manifest)
        ? invocation.contract_manifest
        : null

      if (manifest && Array.isArray(manifest.guidance)) {
        for (const guidance of manifest.guidance) {
          if (!isRecord(guidance) || typeof guidance.source_path !== 'string') {
            continue
          }

          const owner = guidanceOwners.get(guidance.source_path)

          if (owner) {
            record(owner, at, source)
          }
        }
      }
    }
  }

  for (const sessionDir of withArchive(
    path.join(root, 'runtime', 'logs', 'sessions'),
  )) {
    const at = safeStatMs(sessionDir)

    if (at === null || at < windowStartMs) {
      continue
    }

    sessions += 1

    const mode = sessionMode(sessionDir)

    if (!mode) {
      continue
    }

    const source = path.relative(root, sessionDir)

    record(`mode:${mode}`, at, source)

    // A standalone session is named for the mode its command resolves, which
    // is the only runtime trace a card-backed slash command leaves.
    if (commandNames.has(`pan-${mode}`)) {
      record(`command:pan-${mode}`, at, source)
    }
  }

  return { runs, sessions }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * Text tokens whose presence in operator or agent prose names the facility.
 *
 * Each token is a path or a harness identifier. A bare persona name such as
 * `coder` would match ordinary prose, so the tokens are the forms a person
 * types when they mean the facility. Whether the line that carries a token
 * uses the facility is a separate question the intent classifier answers.
 */
function mentionTokens(entry: Facility): string[] {
  switch (entry.category) {
    case 'artifact-profile':
      return [`artifact-profile:${entry.name}`]
    case 'cli-subcommand':
      return [`pan ${entry.name}`]
    case 'command':
      return [entry.name]
    case 'criterion':
      return [entry.name]
    case 'persona':
      return [`pan-${entry.name}`, `personas/${entry.name}.md`]
    case 'skill':
      return [`skills/${entry.name}.md`]
    case 'policy':
      return [entry.name]
    case 'workflow':
      return [`workflows/${entry.name}`]
    case 'mode':
      return [`--mode ${entry.name}`]
    case 'invocation':
      return [`invocation_kind: ${entry.name}`]
    case 'requirement':
      return [entry.name]
    case 'source-symbol':
      return entry.source_symbol ? [entry.source_symbol] : []
    case 'orphan':
      return entry.source_symbol ? [entry.source_symbol] : [entry.path ?? '']
    case 'validator':
      return [`validators/${entry.name}`]
    case 'handbook':
    case 'template':
      return entry.path ? [entry.path] : []
  }
}

interface FileEnumeration {
  files: string[]
  unread: string[]
}

function listFilesInWindow(
  roots: readonly string[],
  windowStartMs: number,
  extensions: ReadonlySet<string>,
): FileEnumeration {
  const found: string[] = []
  const unread: string[] = []

  const walk = (absolute: string): void => {
    let entries

    try {
      entries = readdirSync(absolute, { withFileTypes: true })
    } catch {
      unread.push(absolute)
      return
    }

    for (const entry of entries) {
      const child = path.join(absolute, entry.name)

      if (entry.isDirectory()) {
        walk(child)
        continue
      }

      if (!entry.isFile() || !extensions.has(path.extname(entry.name))) {
        continue
      }

      let stats

      try {
        stats = statSync(child)
      } catch {
        unread.push(child)
        continue
      }

      if (stats.mtimeMs < windowStartMs) {
        continue
      }

      found.push(child)
    }
  }

  for (const root of roots) {
    if (isDirectory(root)) {
      walk(root)
    }
  }

  return {
    files: found.sort(),
    unread: [...new Set(unread)].sort(),
  }
}

function readEvidenceText(absolute: string): string | null {
  let size: number

  try {
    size = statSync(absolute).size
  } catch {
    return null
  }

  if (size <= MAX_SCAN_FILE_BYTES) {
    try {
      return readText(absolute)
    } catch {
      return null
    }
  }

  let descriptor: number | null = null

  try {
    descriptor = openSync(absolute, 'r')
    const chunks: Buffer[] = []
    let position = 0

    while (position < size) {
      const chunk = Buffer.allocUnsafe(
        Math.min(STREAM_CHUNK_BYTES, size - position),
      )
      const bytes = readSync(descriptor, chunk, 0, chunk.length, position)

      if (bytes === 0) {
        break
      }

      chunks.push(chunk.subarray(0, bytes))
      position += bytes
    }

    return Buffer.concat(chunks).toString('utf8')
  } catch {
    return null
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor)
    }
  }
}

/**
 * Cursor stores a project's transcripts under a directory named for the
 * workspace path with separators replaced by hyphens.
 */
export function defaultTranscriptsRoot(root: string): string {
  const slug = path.resolve(root).split(path.sep).filter(Boolean).join('-')

  return path.join(
    os.homedir(),
    '.cursor',
    'projects',
    slug,
    'agent-transcripts',
  )
}

/** One content block of a transcript record. */
interface TranscriptBlock {
  type: string
  text?: string
  name?: string
  input?: Record<string, unknown>
}

function parseBlocks(line: string): TranscriptBlock[] {
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

function normalizeLine(line: string): string {
  return line.split(/\s+/u).filter(Boolean).join(' ')
}

/**
 * The operator's own words in one user turn.
 *
 * Cursor wraps the typed prompt in `<user_query>` and surrounds it with
 * injected blocks. An older transcript carries no wrapper, so the fallback
 * strips the known injected blocks and keeps the rest.
 */
function operatorText(text: string): string {
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

interface TranscriptCorpus {
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
function readTranscriptCorpus(
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

interface FacilityLookup {
  ids: ReadonlySet<string>
  commandNames: ReadonlySet<string>
  personaNames: ReadonlySet<string>
  /** Owned path to owning facility, for a file an agent read. */
  pathOwners: ReadonlyMap<string, string>
}

function facilityLookup(facilities: readonly Facility[]): FacilityLookup {
  const pathOwners = new Map<string, string>()

  for (const entry of facilities) {
    for (const owned of entry.owned_paths) {
      pathOwners.set(owned, entry.id)
    }
  }

  return {
    ids: new Set(facilities.map((entry) => entry.id)),
    commandNames: new Set(
      facilities
        .filter((entry) => entry.category === 'command')
        .map((entry) => entry.name),
    ),
    personaNames: new Set(
      facilities
        .filter((entry) => entry.category === 'persona')
        .map((entry) => entry.name),
    ),
    pathOwners,
  }
}

/** The facility that owns an absolute or relative file path an agent read. */
function ownerOfReadPath(
  lookup: FacilityLookup,
  candidate: string,
): string | null {
  const normalized = candidate
    .replace(/\\/gu, '/')
    .replace(/^['"`]|['"`]$/gu, '')

  for (const [owned, owner] of lookup.pathOwners) {
    if (
      normalized === owned ||
      normalized.endsWith(`/${owned}`) ||
      normalized.startsWith(`${owned}/`) ||
      normalized.includes(`/${owned}/`)
    ) {
      return owner
    }
  }

  return null
}

interface LineClassifier {
  pattern: RegExp | null
  tokenOwners: ReadonlyMap<string, string[]>
  classifier: IntentClassifier
}

interface ScoredLines {
  directions: Hit[]
  /** Facility id to the lines that named it without using it. */
  incidental: Map<string, number>
}

function addCounts(
  into: Map<string, number>,
  from: ReadonlyMap<string, number>,
): void {
  for (const [key, count] of from) {
    into.set(key, (into.get(key) ?? 0) + count)
  }
}

function totalCount(counts: ReadonlyMap<string, number>): number {
  let total = 0

  for (const count of counts.values()) {
    total += count
  }

  return total
}

/**
 * Score every token-bearing line of one text.
 *
 * A pasted assistant line is incidental before the classifier runs, because a
 * report the operator copied is the agent's words and not a direction. Every
 * other line is a direction only when the classifier reads it as one.
 */
function scoreLines(
  text: string,
  at: number,
  source: string,
  scorer: LineClassifier,
  pasteIndex: ReadonlySet<string> | null,
): ScoredLines {
  const directions: Hit[] = []
  const incidental = new Map<string, number>()

  if (!scorer.pattern) {
    return { directions, incidental }
  }

  for (const line of text.split('\n')) {
    const owners = new Set<string>()

    for (const match of line.matchAll(scorer.pattern)) {
      for (const owner of scorer.tokenOwners.get(match[0]) ?? []) {
        owners.add(owner)
      }
    }

    if (owners.size === 0) {
      continue
    }

    const pasted = pasteIndex !== null && pasteIndex.has(normalizeLine(line))
    const functional = !pasted && scorer.classifier.classify(line).functional

    for (const owner of owners) {
      if (functional) {
        directions.push({ facilityId: owner, at, source })
      } else {
        incidental.set(owner, (incidental.get(owner) ?? 0) + 1)
      }
    }
  }

  return { directions, incidental }
}

interface TranscriptScan {
  executionHits: Hit[]
  directionHits: Hit[]
  incidental: Map<string, number>
  files: number
  invocations: number
  agentInvocations: number
  agentLookups: number
  debloatExcluded: number
  unread: string[]
}

/**
 * Structured evidence an agent's tool call carries.
 *
 * A subagent launch names a persona. A shell command names the `pan`
 * subcommand, mode, and workflow it invoked. A file read names the facility
 * whose definition the agent opened. Search tools are skipped, because a
 * grep that lists a path is a scan rather than a use.
 */
function toolEvidence(
  block: TranscriptBlock,
  lookup: FacilityLookup,
): { invocations: string[]; lookups: string[] } {
  const invocations: string[] = []
  const lookups: string[] = []
  const input = block.input ?? {}

  if (block.name === 'Task') {
    const subagent = input.subagent_type

    if (typeof subagent === 'string') {
      const name = subagent.replace(/--.*$/u, '')

      if (name.startsWith('pan-')) {
        const persona = name.slice('pan-'.length)

        if (lookup.personaNames.has(persona)) {
          invocations.push(`persona:${persona}`)
        } else if (lookup.commandNames.has(name)) {
          invocations.push(`command:${name}`)
        }
      }
    }
  }

  const command = input.command

  if (typeof command === 'string') {
    for (const match of command.matchAll(PAN_INVOCATION_PATTERN)) {
      const id = `cli-subcommand:${match[1] as string}`

      if (lookup.ids.has(id)) {
        invocations.push(id)
      }
    }

    for (const match of command.matchAll(MODE_OPTION_PATTERN)) {
      const id = `mode:${match[1] as string}`

      if (lookup.ids.has(id)) {
        invocations.push(id)
      }
    }

    for (const match of command.matchAll(WORKFLOW_OPTION_PATTERN)) {
      const id = `workflow:${match[1] as string}`

      if (lookup.ids.has(id)) {
        invocations.push(id)
      }
    }

    for (const match of command.matchAll(SHELL_READ_PATTERN)) {
      const owner = ownerOfReadPath(lookup, match[1] as string)

      if (owner) {
        lookups.push(owner)
      }
    }
  }

  if (block.name === 'Read' || block.name === 'ReadFile') {
    const target = input.path ?? input.target_file

    if (typeof target === 'string') {
      const owner = ownerOfReadPath(lookup, target)

      if (owner) {
        lookups.push(owner)
      }
    }
  }

  return { invocations, lookups }
}

/**
 * Facilities whose files an agent edited somewhere in the transcript.
 *
 * An agent that reads a skill and then rewrites it was developing the skill,
 * not using it, so its read is not a lookup. The edit can come after the read,
 * which is why the set is built before the transcript is scored.
 */
function editedOwners(content: string, lookup: FacilityLookup): Set<string> {
  const owners = new Set<string>()

  for (const line of content.split('\n')) {
    if (!line.startsWith(ASSISTANT_RECORD_PREFIX)) {
      continue
    }

    for (const block of parseBlocks(line)) {
      if (
        block.type !== 'tool_use' ||
        block.name === undefined ||
        !EDIT_TOOL_NAMES.has(block.name)
      ) {
        continue
      }

      const input = block.input ?? {}
      const target = input.path ?? input.target_file ?? input.file_path

      if (typeof target === 'string') {
        const owner = ownerOfReadPath(lookup, target)

        if (owner) {
          owners.add(owner)
        }
      }
    }
  }

  return owners
}

function scanTranscripts(
  corpus: TranscriptCorpus,
  scorer: LineClassifier,
  lookup: FacilityLookup,
): TranscriptScan {
  const executionHits: Hit[] = []
  const directionHits: Hit[] = []
  const incidental = new Map<string, number>()
  let invocations = 0
  let agentInvocations = 0
  let agentLookups = 0

  for (const { absolute, content, at } of corpus.files) {
    // The command marker is read from the raw text, because Cursor writes it
    // inside the injected block that the prose extraction removes.
    for (const match of content.matchAll(COMMAND_MARKER_PATTERN)) {
      const name = match[1] as string

      if (lookup.commandNames.has(name)) {
        invocations += 1
        executionHits.push({
          facilityId: `command:${name}`,
          at,
          source: absolute,
        })
      }
    }

    // A lookup counts only while the operator's latest turn asked for work,
    // and only for a file the agent did not go on to edit. An agent that opens
    // a facility to answer a question, or to change it, is not using it.
    let turnIsWork = true
    const edited = editedOwners(content, lookup)

    for (const line of content.split('\n')) {
      if (line.startsWith(USER_RECORD_PREFIX)) {
        for (const block of parseBlocks(line)) {
          if (block.type !== 'text' || block.text === undefined) {
            continue
          }

          const text = operatorText(block.text)

          if (text.trim().length === 0) {
            continue
          }

          turnIsWork = !isInformationRequest(text)

          for (const prose of text.split('\n')) {
            const slash = SLASH_LINE_PATTERN.exec(prose.trim())

            if (!slash) {
              continue
            }

            const name = `pan-${slash[1] as string}`

            if (lookup.commandNames.has(name)) {
              executionHits.push({
                facilityId: `command:${name}`,
                at,
                source: absolute,
              })
            } else if (lookup.personaNames.has(slash[1] as string)) {
              executionHits.push({
                facilityId: `persona:${slash[1] as string}`,
                at,
                source: absolute,
              })
            }
          }

          const scored = scoreLines(
            text,
            at,
            absolute,
            scorer,
            corpus.assistantLines,
          )

          directionHits.push(...scored.directions)
          addCounts(incidental, scored.incidental)
        }

        continue
      }

      if (!line.startsWith(ASSISTANT_RECORD_PREFIX)) {
        continue
      }

      for (const block of parseBlocks(line)) {
        if (block.type !== 'tool_use') {
          continue
        }

        const evidence = toolEvidence(block, lookup)

        for (const id of evidence.invocations) {
          agentInvocations += 1
          executionHits.push({ facilityId: id, at, source: absolute })
        }

        if (!turnIsWork) {
          continue
        }

        for (const id of evidence.lookups) {
          if (edited.has(id)) {
            continue
          }

          agentLookups += 1
          directionHits.push({ facilityId: id, at, source: absolute })
        }
      }
    }
  }

  return {
    executionHits,
    directionHits,
    incidental,
    files: corpus.files.length + corpus.debloatExcluded,
    invocations,
    agentInvocations,
    agentLookups,
    debloatExcluded: corpus.debloatExcluded,
    unread: corpus.unread,
  }
}

function summarize(
  facilities: readonly Facility[],
  executionHits: readonly Hit[],
  directionHits: readonly Hit[],
  incidentalByFacility: ReadonlyMap<string, number>,
  graph: ReferenceGraph,
): FacilityUsage[] {
  const buckets = new Map<string, { execution: Hit[]; direction: Hit[] }>()

  for (const entry of facilities) {
    buckets.set(entry.id, { execution: [], direction: [] })
  }

  for (const hit of executionHits) {
    buckets.get(hit.facilityId)?.execution.push(hit)
  }

  for (const hit of directionHits) {
    buckets.get(hit.facilityId)?.direction.push(hit)
  }

  // Harness code that names a facility wires it into the running system
  // whether or not a run record happens to mention it. A validator the engine
  // imports and a template the installer copies both look idle otherwise.
  const codeReferenced = new Set(
    graph.references
      .filter((reference) => reference.referrer_class === 'code')
      .map((reference) => reference.to),
  )
  const alwaysRead = alwaysReadTargets(graph)

  // A facility with no record of its own is still live when something that
  // did run depends on it. Reachability is anchored at executed, directed,
  // wired-in, and always-read facilities. A mention is never an anchor.
  const roots = facilities
    .filter(
      (entry) =>
        entry.protected ||
        codeReferenced.has(entry.id) ||
        alwaysRead.has(entry.id) ||
        (buckets.get(entry.id)?.execution.length ?? 0) > 0 ||
        (buckets.get(entry.id)?.direction.length ?? 0) > 0,
    )
    .map((entry) => entry.id)
  const reachable = reachableFrom(graph, roots)
  const rootSet = new Set(roots)

  return facilities.map((entry) => {
    const bucket = buckets.get(entry.id) ?? { execution: [], direction: [] }
    const references = graph.incoming.get(entry.id) ?? []
    const testOnly =
      references.length > 0 &&
      references.some((reference) => reference.referrer_class === 'test') &&
      references.every(
        (reference) =>
          reference.referrer_class === 'test' ||
          reference.referrer_class === 'registry',
      )
    const dependedOnBy = [
      ...new Set(
        references
          .filter(
            (reference) =>
              reference.referrer_class === 'code' ||
              (reference.functional &&
                reference.owner_facility !== null &&
                rootSet.has(reference.owner_facility)),
          )
          .map((reference) => reference.owner_facility ?? reference.from),
      ),
    ].sort()
    const tier: EvidenceTier =
      bucket.execution.length > 0
        ? 'execution'
        : codeReferenced.has(entry.id) ||
            alwaysRead.has(entry.id) ||
            reachable.has(entry.id)
          ? 'reachable'
          : bucket.direction.length > 0
            ? 'direction'
            : 'none'
    const direct =
      bucket.execution.length > 0 ? bucket.execution : bucket.direction
    const latest = direct.reduce((newest, hit) => Math.max(newest, hit.at), 0)

    return {
      facility_id: entry.id,
      evidence_tier: tier,
      last_used_at: latest > 0 ? new Date(latest).toISOString() : null,
      execution_count: bucket.execution.length,
      direction_count: bucket.direction.length,
      incidental_mention_count: incidentalByFacility.get(entry.id) ?? 0,
      depended_on_by: dependedOnBy.slice(0, 5),
      test_only_references: testOnly,
      samples: [
        ...new Set(
          [...direct]
            .sort((left, right) => right.at - left.at)
            .map((hit) => hit.source),
        ),
      ].slice(0, MAX_SAMPLES),
    }
  })
}

interface EvidenceCoverage {
  bySource: Record<string, number>
  unread: string[]
}

function readEvidenceCoverage(
  root: string,
  windowStartMs: number,
): EvidenceCoverage {
  const groups: Record<string, string[]> = {
    workflow_run_records: [
      path.join(root, 'runtime', 'logs', 'workflows'),
      path.join(root, 'runtime', 'workflows'),
    ],
    cohort_records: [path.join(root, 'runtime', 'logs', 'cohorts')],
    best_of_n_records: [path.join(root, 'runtime', 'logs', 'best-of-n')],
    eval_records: [path.join(root, 'runtime', 'logs', 'evals')],
    horizon_records: [
      path.join(root, 'runtime', 'logs', 'horizon'),
      path.join(root, 'runtime', 'horizon'),
    ],
    standalone_session_records: [
      path.join(root, 'runtime', 'logs', 'sessions'),
    ],
  }
  const extensions = new Set(['.json', '.jsonl', '.md', '.txt'])
  const bySource: Record<string, number> = {}
  const unread: string[] = []

  for (const [source, roots] of Object.entries(groups)) {
    const enumeration = listFilesInWindow(roots, windowStartMs, extensions)
    let read = 0

    unread.push(...enumeration.unread)

    for (const absolute of enumeration.files) {
      if (readEvidenceText(absolute) === null) {
        unread.push(absolute)
      } else {
        read += 1
      }
    }

    bySource[source] = read
  }

  return { bySource, unread: [...new Set(unread)].sort() }
}

/**
 * Score every facility against the evidence the window contains.
 *
 * Run records answer the question directly for the categories they name, and
 * Cursor command markers, slash lines, and agent tool calls do the same for
 * commands, personas, subcommands, and modes. Everything else is settled by
 * the reference graph. Chat and inbox prose count only when the intent
 * classifier reads a line as a direction to use the facility, so a question,
 * a pasted report, an index entry, and a debloat session never retain one.
 */
export function scanUsage(
  root: string,
  facilities: readonly Facility[],
  options: UsageScanOptions,
): UsageScan {
  const windowStartMs = options.windowStart.getTime()
  const lookup = facilityLookup(facilities)
  const executionHits: Hit[] = []
  const record = (facilityId: string, at: number, source: string): void => {
    if (lookup.ids.has(facilityId)) {
      executionHits.push({ facilityId, at, source })
    }
  }
  const runs = collectRunHits(root, facilities, windowStartMs, record)
  const tokenOwners = new Map<string, string[]>()

  for (const entry of facilities) {
    for (const token of mentionTokens(entry)) {
      const owners = tokenOwners.get(token)

      if (owners) {
        owners.push(entry.id)
      } else {
        tokenOwners.set(token, [entry.id])
      }
    }
  }

  const tokens = [...tokenOwners.keys()].sort(
    (left, right) => right.length - left.length,
  )
  // The boundaries keep `pan-spotfix` from matching inside `pan-spotfixer`,
  // which would credit a command with its persona's usage.
  const scorer: LineClassifier = {
    pattern:
      tokens.length > 0
        ? new RegExp(
            `(?<![A-Za-z0-9_-])(?:${tokens
              .map(escapeRegExp)
              .join('|')})(?![A-Za-z0-9_-])`,
            'gu',
          )
        : null,
    tokenOwners,
    classifier: options.classifier,
  }
  const transcriptsRoot =
    options.transcriptsRoot === undefined
      ? defaultTranscriptsRoot(root)
      : options.transcriptsRoot
  const corpus = readTranscriptCorpus(transcriptsRoot, windowStartMs)
  const transcripts = scanTranscripts(corpus, scorer, lookup)

  for (const hit of transcripts.executionHits) {
    record(hit.facilityId, hit.at, hit.source)
  }

  const directionHits = [...transcripts.directionHits]
  const incidental = new Map(transcripts.incidental)
  const requestEnumeration = listFilesInWindow(
    [path.join(root, 'runtime', 'inbox')],
    windowStartMs,
    new Set(['.json', '.md', '.txt']),
  )
  let requestFilesRead = 0

  for (const absolute of requestEnumeration.files) {
    const content = readEvidenceText(absolute)

    if (content === null) {
      requestEnumeration.unread.push(absolute)
      continue
    }

    requestFilesRead += 1
    const at = safeStatMs(absolute)

    if (at === null) {
      continue
    }

    const scored = scoreLines(
      content,
      at,
      path.relative(root, absolute),
      scorer,
      corpus.assistantLines,
    )

    directionHits.push(...scored.directions)
    addCounts(incidental, scored.incidental)
  }

  const coverage = readEvidenceCoverage(root, windowStartMs)
  const unread = [
    ...new Set([
      ...coverage.unread,
      ...transcripts.unread,
      ...requestEnumeration.unread,
    ]),
  ].sort()

  return {
    usage: summarize(
      facilities,
      executionHits,
      directionHits,
      incidental,
      options.graph,
    ),
    sources: {
      workflow_runs: runs.runs,
      sessions: runs.sessions,
      command_invocations: transcripts.invocations,
      transcript_files: transcripts.files,
      operator_request_files: requestFilesRead,
      transcripts_root:
        transcriptsRoot && isDirectory(transcriptsRoot)
          ? transcriptsRoot
          : null,
      debloat_sessions_excluded: transcripts.debloatExcluded,
      agent_invocations: transcripts.agentInvocations,
      agent_lookups: transcripts.agentLookups,
      incidental_mentions: totalCount(incidental),
      by_source: {
        ...coverage.bySource,
        transcript_files: transcripts.files - transcripts.unread.length,
        operator_request_files: requestFilesRead,
      },
      unread,
    },
  }
}
