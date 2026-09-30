/**
 * Facility evidence in transcripts: tool calls, edits, and scored lines that
 * mention or direct a facility.
 */

import { isInformationRequest, type IntentClassifier } from '../intent.js'
import type { Facility } from '../inventory.js'
import type { Hit } from './model.js'
import {
  ASSISTANT_RECORD_PREFIX,
  COMMAND_MARKER_PATTERN,
  normalizeLine,
  operatorText,
  parseBlocks,
  SLASH_LINE_PATTERN,
  type TranscriptBlock,
  type TranscriptCorpus,
  USER_RECORD_PREFIX,
} from './transcripts.js'

/** A `pan` subcommand inside a shell command an agent ran. */
const PAN_INVOCATION_PATTERN =
  /(?:^|[\s;&|(`'"])(?:\.\/|\.\/\.pancreator\/|\S*\/)?(?:bin\/)?pan\s+([a-z][a-z0-9-]*)/gu

const MODE_OPTION_PATTERN = /--mode\s+([a-z][a-z0-9-]*)/gu

const WORKFLOW_OPTION_PATTERN = /--workflow\s+([a-z][a-z0-9-]*)/gu

/** Shell readers that open one file rather than search a tree. */
const SHELL_READ_PATTERN =
  /(?:^|[\s;&|(])(?:cat|less|more|head|tail|bat)\s+([^\s;&|)]+)/gu

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

interface FacilityLookup {
  ids: ReadonlySet<string>
  commandNames: ReadonlySet<string>
  personaNames: ReadonlySet<string>
  /** Owned path to owning facility, for a file an agent read. */
  pathOwners: ReadonlyMap<string, string>
}

/**
 * Indexes the facility inventory for transcript matching: the facility ids,
 * command and persona names, and the owning facility of each owned path.
 */
export function facilityLookup(
  facilities: readonly Facility[],
): FacilityLookup {
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

export interface LineClassifier {
  pattern: RegExp | null
  tokenOwners: ReadonlyMap<string, string[]>
  classifier: IntentClassifier
}

interface ScoredLines {
  directions: Hit[]
  /** Facility id to the lines that named it without using it. */
  incidental: Map<string, number>
}

/** Adds each count in `from` into the matching key of `into`, in place. */
export function addCounts(
  into: Map<string, number>,
  from: ReadonlyMap<string, number>,
): void {
  for (const [key, count] of from) {
    into.set(key, (into.get(key) ?? 0) + count)
  }
}

/** Sum of every count in the map. */
export function totalCount(counts: ReadonlyMap<string, number>): number {
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
export function scoreLines(
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

/**
 * Reads the transcript corpus into usage evidence: execution hits from command
 * markers, operator slash lines, and agent tool invocations; direction hits
 * from scored operator prose and from agent lookups of facility files during a
 * work turn that the agent did not then edit; incidental mentions; and counts
 * of files, invocations, and unread or excluded transcripts.
 */
export function scanTranscripts(
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
