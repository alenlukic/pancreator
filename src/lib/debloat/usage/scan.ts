/** The usage scan: every evidence source summarized per facility. */

import path from 'node:path'

import { isDirectory } from '../../io.js'
import { alwaysReadTargets, reachableFrom } from '../graph/build.js'
import type { ReferenceGraph } from '../graph/model.js'
import type { Facility } from '../inventory.js'
import type {
  EvidenceTier,
  FacilityUsage,
  Hit,
  UsageScan,
  UsageScanOptions,
} from './model.js'
import { listFilesInWindow, readEvidenceText, safeStatMs } from './files.js'
import { defaultTranscriptsRoot, readTranscriptCorpus } from './transcripts.js'
import {
  addCounts,
  facilityLookup,
  type LineClassifier,
  scanTranscripts,
  scoreLines,
  totalCount,
} from './evidence.js'
import { collectRunHits } from './runs.js'

const MAX_SAMPLES = 5

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
  // style: allow style.switch_default Every facility category returns, so a default would hide the compiler error that a new category must produce here.
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
