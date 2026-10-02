/**
 * Links a subagent's launch entry to the transcript Cursor writes for it,
 * which carries the child's conversation id and its stop.
 */

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import {
  findAgent,
  linkAlias,
  lockPath,
  newAgentEntry,
  readIndex,
  resolveCanonicalId,
  withLock,
  writeIndex,
  type AgentEntry,
  type AgentIndex,
} from './store.js'
import {
  CHILD_ID_PATTERN,
  subagentTranscriptCandidates,
  subagentTranscriptDirectory,
  transcriptTaskDigest,
} from './transcript.js'

// A subagent transcript created or last written this long before its launch
// registered, or created this long after, cannot be that launch's.
const TRANSCRIPT_LINK_LEAD_MS = 5_000
const TRANSCRIPT_LINK_WINDOW_MS = 30_000
// Cost-backed bound on the transcripts one discovery pass reads.
const TRANSCRIPT_LINK_MAX_FILES = 64

function claimedIds(index: AgentIndex): Set<string> {
  return new Set([
    ...index.agents.map((agent) => agent.agent_id),
    ...Object.keys(index.aliases),
  ])
}

function hasTranscriptFile(agent: AgentEntry): boolean {
  return subagentTranscriptCandidates(agent).some((candidate) => {
    try {
      return statSync(candidate).isFile()
    } catch {
      return false
    }
  })
}

/** Record `alias` for the entry and return the entry as it now reads. */
function recordAlias(
  root: string,
  entry: AgentEntry,
  alias: string,
): AgentEntry {
  let linked: AgentEntry | null = null

  withLock(lockPath(root), () => {
    const index = readIndex(root)
    const canonical = resolveCanonicalId(index, entry.agent_id)

    if (canonical === null || resolveCanonicalId(index, alias) !== null) {
      return
    }

    linkAlias(index, alias, canonical)
    writeIndex(root, index, new Date().toISOString())
    linked = findAgent(index, canonical)
  })

  return (
    linked ?? {
      ...entry,
      aliases: entry.aliases.includes(alias)
        ? entry.aliases
        : [...entry.aliases, alias],
    }
  )
}

interface SubagentTranscript {
  id: string
  file: string
  /** Creation time, or null where the file system keeps none. */
  createdMs: number | null
  mtimeMs: number
}

function subagentTranscript(
  directory: string,
  id: string,
): SubagentTranscript | null {
  const file = path.join(directory, `${id}.jsonl`)

  try {
    const stats = statSync(file)

    return stats.isFile()
      ? {
          id,
          file,
          createdMs: stats.birthtimeMs > 0 ? stats.birthtimeMs : null,
          mtimeMs: stats.mtimeMs,
        }
      : null
  } catch {
    return null
  }
}

/**
 * Whether the transcript can be the one Cursor started for this launch: a
 * child's transcript is created as its launch registers, so it can be
 * neither created long after the registration nor last written before it.
 */
function transcriptFitsLaunch(
  transcript: SubagentTranscript,
  agent: AgentEntry,
): boolean {
  const registeredMs = Date.parse(agent.registered_at)

  if (!Number.isFinite(registeredMs)) {
    return false
  }

  const startedMs = transcript.createdMs ?? transcript.mtimeMs

  return (
    startedMs >= registeredMs - TRANSCRIPT_LINK_LEAD_MS &&
    (transcript.createdMs === null ||
      transcript.createdMs <= registeredMs + TRANSCRIPT_LINK_WINDOW_MS)
  )
}

/** Entries in the directory that still lack a transcript and carry the digest. */
function transcriptlessEntries(
  index: AgentIndex,
  directory: string,
  digest: string,
): AgentEntry[] {
  return index.agents.filter(
    (agent) =>
      agent.prompt_digest === digest &&
      subagentTranscriptDirectory(agent) === directory &&
      !hasTranscriptFile(agent),
  )
}

/**
 * The transcript and entry that belong together, or null unless each is
 * the other's only candidate. Identical prompts launched together cannot be
 * told apart, and a wrong link would report one child's stop as another's.
 */
function uniquePairing(
  index: AgentIndex,
  directory: string,
  transcript: SubagentTranscript,
  entry: AgentEntry,
  unclaimed: readonly SubagentTranscript[],
): boolean {
  const digest = entry.prompt_digest

  if (!digest || transcriptTaskDigest(transcript.file) !== digest) {
    return false
  }

  const entries = transcriptlessEntries(index, directory, digest).filter(
    (agent) => transcriptFitsLaunch(transcript, agent),
  )
  const transcripts = unclaimed.filter(
    (candidate) =>
      transcriptFitsLaunch(candidate, entry) &&
      transcriptTaskDigest(candidate.file) === digest,
  )

  return (
    entries.length === 1 &&
    entries[0]?.agent_id === entry.agent_id &&
    transcripts.length === 1 &&
    transcripts[0]?.id === transcript.id
  )
}

function unclaimedTranscripts(
  index: AgentIndex,
  directory: string,
): SubagentTranscript[] {
  let names: string[]

  try {
    names = readdirSync(directory)
  } catch {
    return []
  }

  const claimed = claimedIds(index)

  return names
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => name.slice(0, -'.jsonl'.length))
    .filter((id) => CHILD_ID_PATTERN.test(id) && !claimed.has(id))
    .flatMap((id) => subagentTranscript(directory, id) ?? [])
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, TRANSCRIPT_LINK_MAX_FILES)
}

/**
 * The entry with its transcript linked as an alias when no transcript
 * candidate names it and exactly one unclaimed transcript pairs with it.
 */
export function linkUnclaimedTranscript(
  root: string,
  index: AgentIndex,
  entry: AgentEntry,
): AgentEntry {
  const directory = subagentTranscriptDirectory(entry)

  if (!directory || !entry.prompt_digest || hasTranscriptFile(entry)) {
    return entry
  }

  const unclaimed = unclaimedTranscripts(index, directory)
  const match = unclaimed.find((transcript) =>
    uniquePairing(index, directory, transcript, entry, unclaimed),
  )

  return match ? recordAlias(root, entry, match.id) : entry
}

/**
 * The entry an unindexed id resolves to through the subagent transcript it
 * names: the uniquely paired entry, now aliased to the id, else an unsaved
 * entry carrying only that transcript. Null when no transcript has the id.
 */
export function entryFromSubagentTranscript(
  root: string,
  index: AgentIndex,
  agentId: string,
): AgentEntry | null {
  if (!CHILD_ID_PATTERN.test(agentId)) {
    return null
  }

  const directories = new Set(
    index.agents.flatMap((agent) => {
      const directory = subagentTranscriptDirectory(agent)

      return directory ? [directory] : []
    }),
  )

  for (const directory of directories) {
    const transcript = subagentTranscript(directory, agentId)

    if (!transcript) {
      continue
    }

    const digest = transcriptTaskDigest(transcript.file)
    const unclaimed = digest ? unclaimedTranscripts(index, directory) : []
    const match = digest
      ? transcriptlessEntries(index, directory, digest).find((agent) =>
          uniquePairing(index, directory, transcript, agent, unclaimed),
        )
      : undefined

    if (match) {
      return recordAlias(root, match, agentId)
    }

    return {
      ...newAgentEntry(
        agentId,
        new Date(transcript.createdMs ?? transcript.mtimeMs).toISOString(),
      ),
      parent_agent_id: path.basename(path.dirname(directory)),
      transcript_path: transcript.file,
    }
  }

  return null
}
