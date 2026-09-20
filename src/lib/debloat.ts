import path from 'node:path'

import {
  computeClosure,
  previewCandidate,
  type CandidatePreview,
  type ClosureRecord,
} from './debloat/closure.js'
import { buildReferenceGraph, findReferences } from './debloat/graph.js'
import {
  loadIntentClassifier,
  type IntentClassifier,
} from './debloat/intent.js'
import { collectFacilities, type Facility } from './debloat/inventory.js'
import {
  adjudicationAllowsSelection,
  assessCandidate,
  type AgenticAdjudication,
  type AgenticVerdict,
  type CandidateAssessment,
} from './debloat/adjudication.js'
import {
  findOrphans,
  orphanFacilities,
  type OrphanFinding,
} from './debloat/orphans.js'
import { renderScanReport } from './debloat/report.js'
import {
  newSessionId,
  readSessionArtifact,
  sessionPaths,
  type DebloatSessionPaths,
} from './debloat/session.js'
import {
  scanUsage,
  type FacilityUsage,
  type UsageScanSources,
} from './debloat/usage.js'
import {
  buildSymbolIndex,
  sourceSymbolFacilities,
  type SymbolIndex,
} from './debloat/symbols.js'
import { invariant, PanError } from './errors.js'
import {
  fileExists,
  isDirectory,
  readText,
  resolveInside,
  writeJsonAtomic,
  writeTextAtomic,
} from './io.js'
import { isTargetInstallation } from './project-config.js'
import { readWorktreeIndex } from './worktrees.js'

export {
  ADJUDICATION_CATEGORIES,
  previewCandidate,
  type ClosureRecord,
  type EditEntry,
  type RemovalEntry,
  type RetainedEntry,
} from './debloat/closure.js'
export {
  adjudicationAllowsSelection,
  assessCandidate,
  type AgenticAdjudication,
  type CandidateAssessment,
} from './debloat/adjudication.js'
export {
  alwaysReadTargets,
  buildReferenceGraph,
  findReferences,
  reachableFrom,
  type Reference,
  type ReferenceGraph,
  type ReferrerClass,
} from './debloat/graph.js'
export {
  INTENT_CORPUS_PATH,
  intentFeatures,
  isInformationRequest,
  loadIntentClassifier,
  loadIntentCorpus,
  trainIntentClassifier,
  type IntentClassifier,
  type IntentExample,
  type IntentLabel,
  type IntentVerdict,
} from './debloat/intent.js'
export {
  collectFacilities,
  EDIT_ONLY_PATHS,
  PROTECTED_PATHS,
  type Facility,
  type FacilityCategory,
} from './debloat/inventory.js'
export { DEBLOAT_ROOT, sessionPaths } from './debloat/session.js'
export {
  defaultTranscriptsRoot,
  scanUsage,
  type EvidenceTier,
  type FacilityUsage,
} from './debloat/usage.js'
export {
  buildSymbolIndex,
  sourceSymbolFacilities,
  type SymbolIndex,
} from './debloat/symbols.js'
export {
  findOrphans,
  orphanFacilities,
  type OrphanFinding,
} from './debloat/orphans.js'

const DEFAULT_WINDOW_DAYS = 30
const MAX_WINDOW_DAYS = 365
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

export interface DebloatWorkspace {
  /** Absolute path of the tree whose facilities the session inventories. */
  absolute: string
  /** Recorded worktree name, or null when the installation root is used. */
  worktree: string | null
}

export interface DebloatScanRecord {
  schema_version: 1
  session_id: string
  generated_at: string
  window_days: number
  window_start: string
  workspace: { path: string; worktree: string | null }
  sources: UsageScanSources
  facilities: Facility[]
  usage: FacilityUsage[]
  /** Removable facility ids with no evidence in the window, sorted. */
  candidates: string[]
  candidate_assessments: CandidateAssessment[]
  previews: CandidatePreview[]
  orphan_findings: OrphanFinding[]
  /** Unused ids the protected set withholds from removal, sorted. */
  protected_candidates: string[]
}

export interface DebloatAdjudicationRecord {
  schema_version: 1
  session_id: string
  adjudications: AgenticAdjudication[]
}

export interface DebloatSelectionRecord {
  schema_version: 1
  session_id: string
  recorded_at: string
  /** Operator-chosen facility ids, sorted. Never broadened by an agent. */
  selected: string[]
}

export interface DebloatVerificationRecord {
  schema_version: 1
  session_id: string
  verified_at: string
  status: 'clean' | 'incomplete'
  /** Removal paths that still exist in the workspace. */
  surviving_paths: string[]
  /** Files that still name a removed facility, with the reference. */
  dangling_references: Array<{ path: string; references: string[] }>
  /** Freed paths or symbols that still survive. */
  surviving_freed: Array<{ path: string; symbol?: string }>
}

export interface DebloatScanOptions {
  readonly windowDays?: number
  readonly worktreeName?: string | null
  readonly transcriptsRoot?: string | null
  readonly now?: Date
  readonly sessionId?: string
}

/**
 * Resolve the tree whose facilities a session inventories.
 *
 * Usage evidence always comes from the installation root, because `runtime/`
 * is untracked and therefore exists in no worktree. Only the facility
 * inventory and the later removals follow the worktree selection.
 */
export function resolveDebloatWorkspace(
  root: string,
  worktreeName: string | null | undefined,
): DebloatWorkspace {
  // An installed payload carries no harness sources to inventory, and its
  // facilities belong to the release rather than to the target repository.
  invariant(
    !isTargetInstallation(root),
    'pan debloat is available only in self-development, because an ' +
      'installed payload owns no harness facilities to remove.',
    { code: 'DEBLOAT_SELF_DEVELOPMENT_ONLY' },
  )

  if (!worktreeName) {
    return { absolute: root, worktree: null }
  }

  const record = readWorktreeIndex(root).worktrees.find(
    (entry) => entry.name === worktreeName,
  )

  invariant(
    record,
    `No worktree named '${worktreeName}' is recorded. Create it with ` +
      `\`pan worktree create ${worktreeName} --from main\`.`,
    { code: 'WORKTREE_NOT_FOUND' },
  )

  return { absolute: resolveInside(root, record.path), worktree: record.name }
}

function resolveWindowDays(value: number | undefined): number {
  const days = value ?? DEFAULT_WINDOW_DAYS

  invariant(
    Number.isInteger(days) && days >= 1 && days <= MAX_WINDOW_DAYS,
    `--days MUST be a whole number between 1 and ${MAX_WINDOW_DAYS}.`,
    { code: 'INVALID_ARGUMENT' },
  )

  return days
}

export interface DebloatScanSummary {
  session_id: string
  report_path: string
  candidates_path: string
  window_days: number
  facility_count: number
  candidate_count: number
  protected_candidate_count: number
  sources: UsageScanSources
}

interface FunctionalGraph {
  facilities: Facility[]
  graph: ReturnType<typeof buildReferenceGraph>
  symbolIndex: SymbolIndex
  orphanFindings: OrphanFinding[]
}

/**
 * Inventory the workspace and build its graph.
 *
 * The intent classifier is trained from the installation root's corpus rather
 * than the workspace's, because the corpus is harness input and the scanned
 * tree may be an older worktree that predates it.
 */
async function buildFunctionalGraph(
  workspaceRoot: string,
  classifier: IntentClassifier,
): Promise<FunctionalGraph> {
  const base = collectFacilities(workspaceRoot)
  const symbolIndex = await buildSymbolIndex(workspaceRoot)
  const symbols = sourceSymbolFacilities(base, symbolIndex)
  const orphanFindings = findOrphans(symbolIndex)
  const facilities = [
    ...base,
    ...symbols,
    ...orphanFacilities(orphanFindings),
  ].sort((left, right) => left.id.localeCompare(right.id))

  return {
    facilities,
    graph: buildReferenceGraph(workspaceRoot, facilities, { classifier }),
    symbolIndex,
    orphanFindings,
  }
}

/**
 * Score every facility in the workspace against the evidence window and write
 * the operator report.
 *
 * The scan never removes anything and never decides anything. It produces the
 * candidate list an operator chooses from, which is why the protected set is
 * reported separately rather than silently filtered out: an operator who
 * expected to see a facility in the list deserves the reason it is absent.
 */
export async function scanDebloat(
  root: string,
  options: DebloatScanOptions = {},
): Promise<DebloatScanSummary> {
  const now = options.now ?? new Date()
  const windowDays = resolveWindowDays(options.windowDays)
  const windowStart = new Date(
    now.getTime() - windowDays * MILLISECONDS_PER_DAY,
  )
  const workspace = resolveDebloatWorkspace(root, options.worktreeName)
  const classifier = loadIntentClassifier(root)
  const functional = await buildFunctionalGraph(workspace.absolute, classifier)
  const { facilities, graph, symbolIndex, orphanFindings } = functional
  const scan = scanUsage(root, facilities, {
    windowStart,
    graph,
    classifier,
    ...(options.transcriptsRoot === undefined
      ? {}
      : { transcriptsRoot: options.transcriptsRoot }),
  })
  const unused = new Set(
    scan.usage
      .filter((entry) => entry.evidence_tier === 'none')
      .map((entry) => entry.facility_id),
  )
  const candidates: string[] = []
  const protectedCandidates: string[] = []

  for (const entry of facilities) {
    if (
      !entry.selectable ||
      (!unused.has(entry.id) && entry.node_kind !== 'orphan')
    ) {
      continue
    }

    if (entry.protected) {
      protectedCandidates.push(entry.id)
    } else {
      candidates.push(entry.id)
    }
  }

  const usageById = new Map(
    scan.usage.map((entry) => [entry.facility_id, entry]),
  )
  const assessments = candidates.map((id) =>
    assessCandidate(
      facilities.find((entry) => entry.id === id) as Facility,
      usageById.get(id),
    ),
  )
  const previews = candidates.map((id) =>
    previewCandidate(facilities, graph, id, {
      sessionId: options.sessionId ?? '00000000-000000-000000',
      now,
      symbolIndex,
      usage: scan.usage,
    }),
  )

  const sessionId = options.sessionId ?? newSessionId(now)
  const paths = sessionPaths(root, sessionId)
  const generatedAt = now.toISOString()
  const record: DebloatScanRecord = {
    schema_version: 1,
    session_id: sessionId,
    generated_at: generatedAt,
    window_days: windowDays,
    window_start: windowStart.toISOString(),
    workspace: {
      path: path.relative(root, workspace.absolute) || '.',
      worktree: workspace.worktree,
    },
    sources: scan.sources,
    facilities,
    usage: scan.usage,
    candidates: candidates.sort(),
    candidate_assessments: assessments.sort((left, right) =>
      left.facility_id.localeCompare(right.facility_id),
    ),
    previews: previews.sort((left, right) =>
      left.facility_id.localeCompare(right.facility_id),
    ),
    orphan_findings: orphanFindings,
    protected_candidates: protectedCandidates.sort(),
  }

  writeJsonAtomic(paths.candidates, record)
  writeTextAtomic(
    paths.report,
    renderScanReport({
      sessionId,
      windowDays,
      windowStart: record.window_start,
      generatedAt,
      worktree: workspace.worktree,
      sources: scan.sources,
      facilities,
      usage: scan.usage,
      candidates: record.candidates,
      assessments: record.candidate_assessments,
      previews: record.previews,
      orphanFindings: record.orphan_findings,
      protectedCandidates: record.protected_candidates,
    }),
  )

  return {
    session_id: sessionId,
    report_path: `${paths.relative}/report.md`,
    candidates_path: `${paths.relative}/candidates.json`,
    window_days: windowDays,
    facility_count: facilities.length,
    candidate_count: record.candidates.length,
    protected_candidate_count: record.protected_candidates.length,
    sources: scan.sources,
  }
}

export function readScanRecord(paths: DebloatSessionPaths): DebloatScanRecord {
  return readSessionArtifact<DebloatScanRecord>(
    paths.candidates,
    `pan debloat scan --days 30`,
  )
}

export interface DebloatSelectSummary {
  session_id: string
  selection_path: string
  selected: string[]
}

export interface DebloatAdjudicationSummary {
  session_id: string
  adjudication_path: string
  adjudications: AgenticAdjudication[]
}

export function readAdjudicationRecord(
  paths: DebloatSessionPaths,
): DebloatAdjudicationRecord {
  if (!fileExists(paths.adjudication)) {
    return {
      schema_version: 1,
      session_id: paths.sessionId,
      adjudications: [],
    }
  }

  return readSessionArtifact<DebloatAdjudicationRecord>(
    paths.adjudication,
    `pan debloat adjudicate --session ${paths.sessionId} --facility <id>`,
  )
}

export function recordDebloatAdjudication(
  root: string,
  sessionId: string,
  facilityId: string,
  verdict: AgenticVerdict,
  reasoning: string,
  evidence: readonly string[],
  now = new Date(),
): DebloatAdjudicationSummary {
  const paths = sessionPaths(root, sessionId)
  const scan = readScanRecord(paths)
  const assessment = scan.candidate_assessments.find(
    (entry) => entry.facility_id === facilityId,
  )

  invariant(
    assessment?.deterministic_verdict === 'unclear',
    `Only an unclear candidate can be adjudicated: ${facilityId}.`,
    { code: 'DEBLOAT_ADJUDICATION_INVALID' },
  )
  invariant(
    verdict === 'remove' || verdict === 'keep',
    `Invalid adjudication verdict: ${verdict}.`,
    { code: 'DEBLOAT_ADJUDICATION_INVALID' },
  )
  invariant(
    reasoning.trim().length > 0,
    'Adjudication reasoning is required.',
    {
      code: 'INVALID_ARGUMENT',
    },
  )
  invariant(evidence.length > 0, 'At least one --evidence value is required.', {
    code: 'INVALID_ARGUMENT',
  })

  const record = readAdjudicationRecord(paths)
  const adjudication: AgenticAdjudication = {
    facility_id: facilityId,
    verdict,
    reasoning: reasoning.trim(),
    evidence: [...new Set(evidence)].sort(),
    recorded_at: now.toISOString(),
  }
  const updated: DebloatAdjudicationRecord = {
    schema_version: 1,
    session_id: sessionId,
    adjudications: [
      ...record.adjudications.filter(
        (entry) => entry.facility_id !== facilityId,
      ),
      adjudication,
    ].sort((left, right) => left.facility_id.localeCompare(right.facility_id)),
  }

  writeJsonAtomic(paths.adjudication, updated)

  return {
    session_id: sessionId,
    adjudication_path: `${paths.relative}/adjudication.json`,
    adjudications: updated.adjudications,
  }
}

/**
 * Record the operator's chosen subset.
 *
 * Every id must appear in the session's own candidate list. That refusal is
 * the mechanical form of the rule that an agent never broadens an operator
 * selection: a facility the scan reported as used, or one the protected set
 * withholds, cannot enter the selection by being typed into this command.
 */
export function selectDebloatFacilities(
  root: string,
  sessionId: string,
  facilityIds: readonly string[],
  now = new Date(),
  options: { replace?: boolean } = {},
): DebloatSelectSummary {
  const paths = sessionPaths(root, sessionId)
  const record = readScanRecord(paths)

  invariant(facilityIds.length > 0, 'Select at least one --facility.', {
    code: 'INVALID_ARGUMENT',
  })

  const candidates = new Set(record.candidates)
  const known = new Set(record.facilities.map((entry) => entry.id))
  const assessments = new Map(
    record.candidate_assessments.map((entry) => [entry.facility_id, entry]),
  )
  const adjudications = new Map(
    readAdjudicationRecord(paths).adjudications.map((entry) => [
      entry.facility_id,
      entry,
    ]),
  )
  const rejected = facilityIds
    .filter((id) => {
      if (!candidates.has(id)) {
        return true
      }

      const assessment = assessments.get(id)

      return (
        assessment !== undefined &&
        !adjudicationAllowsSelection(assessment, adjudications.get(id))
      )
    })
    .map((id) =>
      !known.has(id)
        ? `${id} (unknown facility)`
        : assessments.get(id)?.deterministic_verdict === 'unclear'
          ? `${id} (unclear candidate needs a remove adjudication)`
          : `${id} (not an unused candidate in this scan)`,
    )

  if (rejected.length > 0) {
    throw new PanError(
      `Selection rejected: ${rejected.join(', ')}. Choose only ids the ` +
        'scan reported under "Unused candidates".',
      { code: 'DEBLOAT_SELECTION_INVALID', details: { rejected } },
    )
  }

  const previous =
    !options.replace && fileExists(paths.selection)
      ? readSelectionRecord(paths).selected
      : []
  const selection: DebloatSelectionRecord = {
    schema_version: 1,
    session_id: sessionId,
    recorded_at: now.toISOString(),
    selected: [...new Set([...previous, ...facilityIds])].sort(),
  }

  writeJsonAtomic(paths.selection, selection)

  return {
    session_id: sessionId,
    selection_path: `${paths.relative}/selection.json`,
    selected: selection.selected,
  }
}

export function readSelectionRecord(
  paths: DebloatSessionPaths,
): DebloatSelectionRecord {
  return readSessionArtifact<DebloatSelectionRecord>(
    paths.selection,
    `pan debloat select --session ${paths.sessionId} --facility <id>`,
  )
}

export interface DebloatImpactSummary {
  session_id: string
  closure_path: string
  selected: string[]
  cascaded: string[]
  remove_count: number
  edit_count: number
  freed_count: number
  retained_count: number
}

/**
 * Compute the exclusive-reference closure of the recorded selection.
 *
 * The graph is rebuilt from the workspace rather than reused from the scan
 * record, because the operator may have taken time to decide and the tree can
 * have moved underneath the session.
 */
export async function computeDebloatImpact(
  root: string,
  sessionId: string,
  now = new Date(),
): Promise<DebloatImpactSummary> {
  const paths = sessionPaths(root, sessionId)
  const scan = readScanRecord(paths)
  const selection = readSelectionRecord(paths)
  const workspace = resolveDebloatWorkspace(root, scan.workspace.worktree)
  const functional = await buildFunctionalGraph(
    workspace.absolute,
    loadIntentClassifier(root),
  )
  const { facilities, graph, symbolIndex } = functional
  // The scan's usage records travel with the session. The graph is rebuilt
  // from the workspace, but nothing re-measures use here, so the closure reads
  // the same evidence the candidate list was decided on.
  const closure = computeClosure(facilities, graph, selection.selected, {
    sessionId,
    now,
    symbolIndex,
    usage: scan.usage,
  })

  writeJsonAtomic(paths.closure, closure)

  return {
    session_id: sessionId,
    closure_path: `${paths.relative}/closure.json`,
    selected: closure.selected,
    cascaded: closure.cascaded,
    remove_count: closure.remove.length,
    edit_count: closure.edit.length,
    freed_count: closure.freed.length,
    retained_count: closure.retained_because.length,
  }
}

export function readClosureRecord(paths: DebloatSessionPaths): ClosureRecord {
  return readSessionArtifact<ClosureRecord>(
    paths.closure,
    `pan debloat impact --session ${paths.sessionId}`,
  )
}

export interface DebloatVerifySummary {
  session_id: string
  verification_path: string
  status: 'clean' | 'incomplete'
  surviving_path_count: number
  surviving_freed_count: number
  dangling_reference_count: number
}

/**
 * Confirm the workspace matches the closure after the removal ran.
 *
 * Two things can go wrong and neither shows up in a type check. A path the
 * closure listed can still be present, and a file the closure left in place
 * can still name a facility that is gone. This reports both against the
 * rebuilt graph rather than trusting the agent's account of what it did.
 */
export async function verifyDebloat(
  root: string,
  sessionId: string,
  now = new Date(),
): Promise<DebloatVerifySummary> {
  const paths = sessionPaths(root, sessionId)
  const scan = readScanRecord(paths)
  const closure = readClosureRecord(paths)
  const workspace = resolveDebloatWorkspace(root, scan.workspace.worktree)
  const removed = new Set(closure.removed_facilities)
  const surviving = closure.remove
    .map((entry) => entry.path)
    .filter((relative) => {
      const absolute = path.join(workspace.absolute, relative)

      return fileExists(absolute) || isDirectory(absolute)
    })
    .sort()
  // The facility records come from the session rather than from the tree. A
  // removed facility no longer has a definition to inventory, so rebuilding
  // the graph would drop its node and report every leftover reference clean.
  const removedFacilities = scan.facilities.filter((entry) =>
    removed.has(entry.id),
  )
  // The session artifacts live under `runtime/`, which the scan never reads,
  // so nothing the session wrote can report itself as a dangling reference.
  const danglingReferences = [
    ...findReferences(workspace.absolute, removedFacilities).entries(),
  ]
    .map(([file, references]) => ({
      path: file,
      references: [...references].sort(),
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
  const symbolIndex = await buildSymbolIndex(workspace.absolute)
  const survivingFreed = closure.freed
    .filter((entry) =>
      entry.kind === 'path'
        ? fileExists(path.join(workspace.absolute, entry.path))
        : symbolIndex.declarations.some(
            (declaration) =>
              declaration.file === entry.path &&
              declaration.name === entry.symbol,
          ),
    )
    .map((entry) => ({
      path: entry.path,
      ...(entry.symbol ? { symbol: entry.symbol } : {}),
    }))
  const status =
    surviving.length === 0 &&
    survivingFreed.length === 0 &&
    danglingReferences.length === 0
      ? 'clean'
      : 'incomplete'
  const record: DebloatVerificationRecord = {
    schema_version: 1,
    session_id: sessionId,
    verified_at: now.toISOString(),
    status,
    surviving_paths: surviving,
    dangling_references: danglingReferences,
    surviving_freed: survivingFreed,
  }

  writeJsonAtomic(paths.verification, record)

  return {
    session_id: sessionId,
    verification_path: `${paths.relative}/verification.json`,
    status,
    surviving_path_count: surviving.length,
    surviving_freed_count: survivingFreed.length,
    dangling_reference_count: danglingReferences.length,
  }
}

/** Markdown body of the session report, for a caller that prints it. */
export function readDebloatReport(root: string, sessionId: string): string {
  const paths = sessionPaths(root, sessionId)

  invariant(
    fileExists(paths.report),
    `No debloat report at ${paths.relative}/report.md.`,
    { code: 'DEBLOAT_SESSION_INCOMPLETE' },
  )

  return readText(paths.report)
}
