import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

export type RunLayoutVersion = 'v1' | 'v2'

export const CURRENT_RUN_LAYOUT_VERSION: RunLayoutVersion = 'v2'

export interface RunPath {
  absolute: string
  relative: string
}

export interface RunLayout {
  version: RunLayoutVersion
  root: RunPath
  agent: RunPath
  operator: RunPath
  state: RunPath
  events: RunPath
  operationMutex: RunPath
  workflowSnapshot: RunPath
  pipelineConfigSnapshot: RunPath
  request: (extension?: string) => RunPath
  invocation: (invocationId: string, extension: string) => RunPath
  output: (invocationId: string) => RunPath
  assessment: (filename: string) => RunPath
  evidence: (filename: string) => RunPath
  decision: (filename: string) => RunPath
  validation: (filename: string) => RunPath
  artifactJson: (filename: string) => RunPath
  operatorHtml: (artifactId: string) => RunPath
  operatorMarkdown: (filename: string) => RunPath
}

function repoPath(root: string, relative: string): RunPath {
  return {
    absolute: path.join(root, relative),
    relative,
  }
}

function joinRepoPath(root: string, ...segments: string[]): RunPath {
  return repoPath(root, path.posix.join(...segments))
}

export function runRootRelative(runId: string): string {
  return `runtime/logs/workflows/${runId}`
}

/**
 * Declared filename of one attempt at a worker-owned artifact.
 *
 * A relaunched worker used to be handed the name the first worker already
 * wrote, so the second launch destroyed the first report. Every declared path
 * — an evidence report, its brief, and the recorded agent profile-run log —
 * resolves through this one function so the two naming schemes a partial
 * migration would leave cannot appear. Attempt 1 keeps the unstamped name,
 * which is what every existing reader and every recorded reference resolves.
 */
export function attemptStampedName(
  stem: string,
  attempt: number,
  extension: string,
): string {
  return attempt <= 1
    ? `${stem}${extension}`
    : `${stem}.attempt-${attempt}${extension}`
}

/**
 * The first attempt ordinal whose stamped name is free in `directory`.
 *
 * An unreadable directory answers 1: the caller is about to create it.
 */
export function nextAttemptOrdinal(
  directory: string,
  stem: string,
  extension: string,
): number {
  let names: string[]

  try {
    names = readdirSync(directory)
  } catch {
    return 1
  }

  const taken = new Set(names)
  let attempt = 1

  while (taken.has(attemptStampedName(stem, attempt, extension))) {
    attempt += 1
  }

  return attempt
}

/** Stem of the marker one speculative profile prefetch writes. */
function prefetchRecordStem(profile: string): string {
  return `prefetch-${profile}`
}

/**
 * Marker path of one speculative prefetch launch.
 *
 * The marker was keyed to the run and the profile alone, so a second
 * qualifying submission overwrote the first record and the pid of a child
 * still running was lost. Keying it to the launch is what keeps every child
 * reconcilable against the process table.
 */
export function prefetchRecordPath(
  root: string,
  runId: string,
  profile: string,
  attempt = 1,
): RunPath {
  return resolveRunLayout(root, runId).evidence(
    attemptStampedName(prefetchRecordStem(profile), attempt, '.json'),
  )
}

export function nextPrefetchAttempt(
  root: string,
  runId: string,
  profile: string,
): number {
  return nextAttemptOrdinal(
    resolveRunLayout(root, runId).evidence('.').absolute,
    prefetchRecordStem(profile),
    '.json',
  )
}

/** Every prefetch marker a run has written, oldest launch first. */
export function prefetchRecordPaths(root: string, runId: string): string[] {
  const evidence = resolveRunLayout(root, runId).evidence('.')
  let names: string[]

  try {
    names = readdirSync(evidence.absolute)
  } catch {
    return []
  }

  return names
    .filter((name) => name.startsWith('prefetch-') && name.endsWith('.json'))
    .sort()
    .map((name) => path.posix.join(evidence.relative, name))
}

/**
 * Detect one run from its own state location.
 *
 * A missing run defaults to the current layout so creation can build the new
 * tree before state.json exists. Existing root-level state always remains v1.
 */
export function detectRunLayout(root: string, runId: string): RunLayoutVersion {
  const runRelative = runRootRelative(runId)
  const agentState = path.join(root, runRelative, 'agent', 'state.json')

  if (existsSync(agentState)) {
    return 'v2'
  }

  const legacyState = path.join(root, runRelative, 'state.json')

  if (existsSync(legacyState)) {
    return 'v1'
  }

  const legacyMarkers = [
    'events.jsonl',
    'workflow.snapshot.json',
    'invocations',
    'outputs',
    'artifacts',
  ]

  if (
    legacyMarkers.some((marker) =>
      existsSync(path.join(root, runRelative, marker)),
    )
  ) {
    return 'v1'
  }

  return CURRENT_RUN_LAYOUT_VERSION
}

/** Declared brief and report paths of one evidence-worker launch. */
export interface EvidenceWorkerAttemptPaths {
  brief_path: string
  evidence_path: string
}

/**
 * The two declared paths one attempt at an evidence role owns.
 *
 * Every producer and every reader resolves them here, so a relaunch cannot
 * end up with one naming scheme for the brief and another for the report.
 */
export function evidenceWorkerAttemptPaths(
  root: string,
  runId: string,
  invocationId: string,
  role: string,
  attempt = 1,
): EvidenceWorkerAttemptPaths {
  const layout = resolveRunLayout(root, runId)

  return {
    brief_path: layout.invocation(
      invocationId,
      `.${attemptStampedName(`${role}-brief`, attempt, '.md')}`,
    ).relative,
    evidence_path: layout.evidence(
      attemptStampedName(`${invocationId}.${role}-evidence`, attempt, '.md'),
    ).relative,
  }
}

export function resolveRunLayout(
  root: string,
  runId: string,
  version: RunLayoutVersion = detectRunLayout(root, runId),
): RunLayout {
  const runRelative = runRootRelative(runId)
  const agentRelative = version === 'v2' ? `${runRelative}/agent` : runRelative
  const operatorRelative =
    version === 'v2' ? `${runRelative}/operator` : runRelative

  const agentPath = (...segments: string[]): RunPath =>
    joinRepoPath(root, agentRelative, ...segments)
  const operatorPath = (...segments: string[]): RunPath =>
    joinRepoPath(root, operatorRelative, ...segments)

  return {
    version,
    root: repoPath(root, runRelative),
    agent: repoPath(root, agentRelative),
    operator: repoPath(root, operatorRelative),
    state: agentPath('state.json'),
    events: agentPath('events.jsonl'),
    operationMutex: agentPath('.operation-mutex'),
    workflowSnapshot: agentPath('workflow.snapshot.json'),
    pipelineConfigSnapshot: agentPath('pipeline-config.snapshot.json'),
    request: (extension = '.md') => operatorPath(`request${extension}`),
    invocation: (invocationId, extension) =>
      agentPath('invocations', `${invocationId}${extension}`),
    output: (invocationId) => agentPath('outputs', `${invocationId}.json`),
    assessment: (filename) => agentPath('assessments', filename),
    evidence: (filename) => agentPath('evidence', filename),
    decision: (filename) => agentPath('decisions', filename),
    validation: (filename) => agentPath('validations', filename),
    artifactJson: (filename) => agentPath('artifacts', 'json', filename),
    operatorHtml: (artifactId) =>
      version === 'v2'
        ? operatorPath(`${artifactId}.html`)
        : joinRepoPath(
            root,
            runRelative,
            'artifacts',
            'html',
            `${artifactId}.html`,
          ),
    operatorMarkdown: (filename) =>
      version === 'v2'
        ? operatorPath(filename)
        : joinRepoPath(root, runRelative, 'artifacts', 'markdown', filename),
  }
}
