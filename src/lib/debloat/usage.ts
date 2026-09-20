import { readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { isDirectory, isFile, isRecord, readJson, readText } from '../io.js'
import { reachableFrom, type ReferenceGraph } from './graph.js'
import type { Facility } from './inventory.js'

/**
 * How strong the evidence behind a facility's usage is.
 *
 * `execution` means a harness run record, a standalone session, or a Cursor
 * command marker named the facility. `reachable` means no record named it but
 * a facility that did run still depends on it. `mention` means only operator
 * or agent prose named it. The tiers are reported rather than collapsed,
 * because they do not license the same conclusion: removing something that is
 * merely `reachable` breaks a live dependency, while removing something that
 * is merely `mention` usually does not.
 */
export type EvidenceTier = 'execution' | 'reachable' | 'mention' | 'none'

export interface FacilityUsage {
  facility_id: string
  evidence_tier: EvidenceTier
  /** ISO-8601 instant of the most recent direct evidence, or null. */
  last_used_at: string | null
  execution_count: number
  mention_count: number
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
  /** Overrides the derived Cursor transcript directory. */
  readonly transcriptsRoot?: string | null
}

const MAX_SAMPLES = 5

/** A single file large enough to stall the scan is not worth its evidence. */
const MAX_SCAN_FILE_BYTES = 32 * 1024 * 1024

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

/** Cursor writes this header when an operator invokes a slash command. */
const COMMAND_MARKER_PATTERN = /---\s*Cursor Command:\s*([A-Za-z0-9-]+)\s*---/gu

const USER_RECORD_PREFIX = '{"role":"user"'

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
 * Text tokens whose presence in operator or agent prose means the facility was
 * named deliberately.
 *
 * Each token is a path or a harness identifier. A bare persona name such as
 * `coder` would match ordinary prose, so the tokens are the forms a person
 * types when they mean the facility.
 */
function mentionTokens(entry: Facility): string[] {
  switch (entry.category) {
    case 'command':
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
    case 'validator':
      return [`validators/${entry.name}`]
    case 'handbook':
    case 'template':
      return entry.path ? [entry.path] : []
  }
}

function listFilesInWindow(
  roots: readonly string[],
  windowStartMs: number,
  extensions: ReadonlySet<string>,
): string[] {
  const found: string[] = []

  const walk = (absolute: string): void => {
    let entries

    try {
      entries = readdirSync(absolute, { withFileTypes: true })
    } catch {
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
        continue
      }

      if (stats.mtimeMs < windowStartMs || stats.size > MAX_SCAN_FILE_BYTES) {
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

  return found.sort()
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

/**
 * Operator-authored text of one transcript.
 *
 * Only the user turns carry intent. An assistant turn is full of tool output,
 * so a single directory listing in one agent's terminal would otherwise mark
 * every skill in the repository as mentioned.
 */
function operatorProse(content: string): string {
  const parts: string[] = []

  for (const line of content.split('\n')) {
    if (!line.startsWith(USER_RECORD_PREFIX)) {
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
      if (isRecord(block) && typeof block.text === 'string') {
        parts.push(block.text)
      }
    }
  }

  return parts.join('\n').replace(INJECTED_BLOCK_PATTERN, ' ')
}

interface TranscriptScan {
  mentionHits: Hit[]
  commandHits: Hit[]
  files: number
  invocations: number
}

function scanTranscripts(
  transcriptsRoot: string | null,
  windowStartMs: number,
  pattern: RegExp | null,
  tokenOwners: ReadonlyMap<string, string[]>,
  commandNames: ReadonlySet<string>,
): TranscriptScan {
  const files = transcriptsRoot
    ? listFilesInWindow([transcriptsRoot], windowStartMs, new Set(['.jsonl']))
    : []
  const mentionHits: Hit[] = []
  const commandHits: Hit[] = []
  let invocations = 0

  for (const absolute of files) {
    let content: string

    try {
      content = readText(absolute)
    } catch {
      continue
    }

    const at = safeStatMs(absolute)

    if (at === null) {
      continue
    }

    // The command marker is read from the raw text, because Cursor writes it
    // inside the injected block that the prose extraction removes.
    for (const match of content.matchAll(COMMAND_MARKER_PATTERN)) {
      const name = match[1] as string

      if (commandNames.has(name)) {
        invocations += 1
        commandHits.push({
          facilityId: `command:${name}`,
          at,
          source: absolute,
        })
      }
    }

    if (!pattern) {
      continue
    }

    const prose = operatorProse(content)

    if (prose.length === 0) {
      continue
    }

    const seen = new Set<string>()

    for (const match of prose.matchAll(pattern)) {
      seen.add(match[0])
    }

    for (const token of seen) {
      for (const owner of tokenOwners.get(token) ?? []) {
        mentionHits.push({ facilityId: owner, at, source: absolute })
      }
    }
  }

  return { mentionHits, commandHits, files: files.length, invocations }
}

function summarize(
  facilities: readonly Facility[],
  executionHits: readonly Hit[],
  mentionHits: readonly Hit[],
  graph: ReferenceGraph,
): FacilityUsage[] {
  const buckets = new Map<string, { execution: Hit[]; mention: Hit[] }>()

  for (const entry of facilities) {
    buckets.set(entry.id, { execution: [], mention: [] })
  }

  for (const hit of executionHits) {
    buckets.get(hit.facilityId)?.execution.push(hit)
  }

  for (const hit of mentionHits) {
    buckets.get(hit.facilityId)?.mention.push(hit)
  }

  // Harness code that names a facility wires it into the running system
  // whether or not a run record happens to mention it. A validator the engine
  // imports and a template the installer copies both look idle otherwise.
  const codeReferenced = new Set(
    graph.references
      .filter((reference) => reference.referrer_class === 'code')
      .map((reference) => reference.to),
  )

  // A facility with no record of its own is still live when something that
  // did run depends on it. Anchoring reachability at executed and wired-in
  // facilities, and never at a merely mentioned one, keeps prose noise out.
  const roots = facilities
    .filter(
      (entry) =>
        entry.protected ||
        codeReferenced.has(entry.id) ||
        (buckets.get(entry.id)?.execution.length ?? 0) > 0,
    )
    .map((entry) => entry.id)
  const reachable = reachableFrom(graph, roots)
  const rootSet = new Set(roots)

  return facilities.map((entry) => {
    const bucket = buckets.get(entry.id) ?? { execution: [], mention: [] }
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
              (reference.owner_facility !== null &&
                rootSet.has(reference.owner_facility)),
          )
          .map((reference) => reference.owner_facility ?? reference.from),
      ),
    ].sort()
    const tier: EvidenceTier =
      bucket.execution.length > 0
        ? 'execution'
        : codeReferenced.has(entry.id) || reachable.has(entry.id)
          ? 'reachable'
          : bucket.mention.length > 0
            ? 'mention'
            : 'none'
    const direct =
      bucket.execution.length > 0 ? bucket.execution : bucket.mention
    const latest = direct.reduce((newest, hit) => Math.max(newest, hit.at), 0)

    return {
      facility_id: entry.id,
      evidence_tier: tier,
      last_used_at: latest > 0 ? new Date(latest).toISOString() : null,
      execution_count: bucket.execution.length,
      mention_count: bucket.mention.length,
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

/**
 * Score every facility against the evidence the window contains.
 *
 * Run records answer the question directly for the categories they name, and
 * Cursor command markers do the same for slash commands. Everything else is
 * settled by the reference graph, with operator prose as the last resort.
 */
export function scanUsage(
  root: string,
  facilities: readonly Facility[],
  options: UsageScanOptions,
): UsageScan {
  const windowStartMs = options.windowStart.getTime()
  const knownIds = new Set(facilities.map((entry) => entry.id))
  const executionHits: Hit[] = []
  const record = (facilityId: string, at: number, source: string): void => {
    if (knownIds.has(facilityId)) {
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
  const pattern =
    tokens.length > 0
      ? new RegExp(
          `(?<![A-Za-z0-9_-])(?:${tokens
            .map(escapeRegExp)
            .join('|')})(?![A-Za-z0-9_-])`,
          'gu',
        )
      : null
  const transcriptsRoot =
    options.transcriptsRoot === undefined
      ? defaultTranscriptsRoot(root)
      : options.transcriptsRoot
  const transcripts = scanTranscripts(
    transcriptsRoot,
    windowStartMs,
    pattern,
    tokenOwners,
    new Set(
      facilities
        .filter((entry) => entry.category === 'command')
        .map((entry) => entry.name),
    ),
  )

  for (const hit of transcripts.commandHits) {
    record(hit.facilityId, hit.at, hit.source)
  }

  const mentionHits = [...transcripts.mentionHits]
  const requestFiles = listFilesInWindow(
    [path.join(root, 'runtime', 'inbox')],
    windowStartMs,
    new Set(['.json', '.md', '.txt']),
  )

  if (pattern) {
    for (const absolute of requestFiles) {
      let content: string

      try {
        content = readText(absolute)
      } catch {
        continue
      }

      const at = safeStatMs(absolute)

      if (at === null) {
        continue
      }

      const seen = new Set<string>()

      for (const match of content.matchAll(pattern)) {
        seen.add(match[0])
      }

      for (const token of seen) {
        for (const owner of tokenOwners.get(token) ?? []) {
          mentionHits.push({
            facilityId: owner,
            at,
            source: path.relative(root, absolute),
          })
        }
      }
    }
  }

  return {
    usage: summarize(facilities, executionHits, mentionHits, options.graph),
    sources: {
      workflow_runs: runs.runs,
      sessions: runs.sessions,
      command_invocations: transcripts.invocations,
      transcript_files: transcripts.files,
      operator_request_files: requestFiles.length,
      transcripts_root:
        transcriptsRoot && isDirectory(transcriptsRoot)
          ? transcriptsRoot
          : null,
    },
  }
}
