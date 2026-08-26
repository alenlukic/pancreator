import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { invariant } from './errors.js'
import { findProjectRoot, isRecord, writeJsonAtomic } from './io.js'
import {
  RUN_SUFFIX_MAX_LENGTH,
  keywordRunSuffix,
  keywordRunSuffixFrom,
  makeCompletedStageArtifactId,
  makeStageArtifactId,
  makeWorkflowRunId,
  temporalNamePrefix,
} from './naming.js'
import { resolveRunLayout } from './run-layout.js'
import { loadState } from './state.js'
import type { RunState, RunStatus } from './types.js'

const ARTIFACT_ID_PATTERN =
  /^(?:\d{2,3}_)?([a-zA-Z][a-zA-Z0-9-]*)-(\d+)[_-]([a-zA-Z0-9]+)$/u
const UUID_SUFFIX_PATTERN = /^[0-9a-f]{8}$/u

export type WorkflowArtifactSequenceMode = 'in-flight' | 'completed'

export interface WorkflowArtifactRewriteSummary {
  artifact_files: number
  layout_files: number
  updated_files: number
}

interface ArtifactIdentity {
  stageSlug: string
  stageIteration: number
  uuidSuffix: string
}

interface TimedInvocationId {
  invocationId: string
  timestamp: number
}

interface StageOccurrence {
  oldInvocationId: string
  newInvocationId: string
}

interface FileMove {
  source: string
  target: string
  sourceRelative: string
  targetRelative: string
}

export function artifactJsonPath(
  runId: string,
  artifactId: string,
  root?: string,
): string {
  return root
    ? resolveRunLayout(root, runId).artifactJson(`${artifactId}.json`).relative
    : `runtime/logs/workflows/${runId}/artifacts/json/${artifactId}.json`
}

export function artifactMarkdownPath(
  runId: string,
  artifactId: string,
  root?: string,
): string {
  return root
    ? resolveRunLayout(root, runId).operatorMarkdown(`${artifactId}.md`)
        .relative
    : `runtime/logs/workflows/${runId}/artifacts/markdown/${artifactId}.md`
}

export function artifactHtmlPath(
  runId: string,
  artifactId: string,
  root?: string,
): string {
  return root
    ? resolveRunLayout(root, runId).operatorHtml(artifactId).relative
    : `runtime/logs/workflows/${runId}/artifacts/html/${artifactId}.html`
}

export function isClosedRunStatus(status: RunStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled'
}

// Iterative on purpose: recursion with `push(...listFiles(child))` spreads a
// child subtree's entire file list into one call, and a large tree (a worktree
// with dependencies installed) exceeds the engine's argument limit, which
// surfaces as a call-stack RangeError.
function listFiles(directory: string, exclude?: string): string[] {
  if (!existsSync(directory)) {
    return []
  }

  const files: string[] = []
  const pending: string[] = [directory]

  while (pending.length > 0) {
    const current = pending.pop() as string

    if (current === exclude) {
      continue
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)

      if (entry.isDirectory()) {
        pending.push(absolute)
      } else if (entry.isFile()) {
        files.push(absolute)
      }
    }
  }

  return files
}

function agentDirectory(runDirectory: string): string {
  const candidate = path.join(runDirectory, 'agent')

  return existsSync(path.join(candidate, 'state.json'))
    ? candidate
    : runDirectory
}

function textFileContent(filePath: string): string | null {
  const content = readFileSync(filePath)

  return content.includes(0) ? null : content.toString('utf8')
}

function parseJsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function parseJsonLines(filePath: string): unknown[] {
  if (!existsSync(filePath)) {
    return []
  }

  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown)
}

function workflowStageSlugs(runDirectory: string): Set<string> {
  const stageSlugs = new Set<string>()
  const machineDirectory = agentDirectory(runDirectory)
  const snapshotPath = path.join(machineDirectory, 'workflow.snapshot.json')

  if (existsSync(snapshotPath)) {
    const snapshot = parseJsonFile(snapshotPath)

    if (isRecord(snapshot) && Array.isArray(snapshot.stages)) {
      for (const stage of snapshot.stages) {
        if (isRecord(stage) && typeof stage.slug === 'string') {
          stageSlugs.add(stage.slug)
        }
      }
    }
  }

  const eventsPath = path.join(machineDirectory, 'events.jsonl')

  for (const event of parseJsonLines(eventsPath)) {
    if (isRecord(event) && typeof event.stage === 'string') {
      stageSlugs.add(event.stage)
    }
  }

  const invocationDirectory = path.join(machineDirectory, 'invocations')

  for (const filePath of listFiles(invocationDirectory)) {
    if (!filePath.endsWith('.json')) {
      continue
    }

    const invocation = parseJsonFile(filePath)

    if (
      isRecord(invocation) &&
      isRecord(invocation.stage) &&
      typeof invocation.stage.slug === 'string'
    ) {
      stageSlugs.add(invocation.stage.slug)
    }
  }

  invariant(
    stageSlugs.size > 0,
    `${runDirectory} MUST expose at least one workflow stage slug.`,
    { code: 'INVALID_WORKFLOW_ARTIFACTS' },
  )

  return stageSlugs
}

function artifactIdentity(
  invocationId: string,
  stageSlugs: ReadonlySet<string>,
): ArtifactIdentity | null {
  const match = ARTIFACT_ID_PATTERN.exec(invocationId)

  if (!match || !stageSlugs.has(match[1])) {
    return null
  }

  return {
    stageSlug: match[1],
    stageIteration: Number(match[2]),
    uuidSuffix: match[3],
  }
}

function deterministicUuidSuffix(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8)
}

function normalizedUuidSuffix(identity: ArtifactIdentity): string {
  return UUID_SUFFIX_PATTERN.test(identity.uuidSuffix)
    ? identity.uuidSuffix
    : deterministicUuidSuffix(
        `${identity.stageSlug}-${identity.stageIteration}-${identity.uuidSuffix}`,
      )
}

function latestHistoryInvocationId(event: Record<string, unknown>): unknown {
  const stateAfter = event.state_after

  if (!isRecord(stateAfter) || !Array.isArray(stateAfter.stage_history)) {
    return null
  }

  for (const history of [...stateAfter.stage_history].reverse()) {
    if (isRecord(history) && typeof history.invocation_id === 'string') {
      return history.invocation_id
    }
  }

  return null
}

function eventInvocationIds(
  runDirectory: string,
  stageSlugs: ReadonlySet<string>,
): string[] {
  const invocationIds: string[] = []
  const eventsPath = path.join(agentDirectory(runDirectory), 'events.jsonl')

  for (const event of parseJsonLines(eventsPath)) {
    if (!isRecord(event)) {
      continue
    }

    let candidate: unknown = null

    if (event.type === 'invocation_prepared') {
      candidate = event.invocation_id
    } else if (event.type === 'harness_stage_executed') {
      candidate = event.invocation_id ?? latestHistoryInvocationId(event)
    }

    if (
      typeof candidate === 'string' &&
      artifactIdentity(candidate, stageSlugs)
    ) {
      invocationIds.push(candidate)
    }
  }

  return invocationIds
}

function invocationFileIds(
  runDirectory: string,
  stageSlugs: ReadonlySet<string>,
): TimedInvocationId[] {
  const invocationDirectory = path.join(
    agentDirectory(runDirectory),
    'invocations',
  )
  const candidates: TimedInvocationId[] = []

  for (const filePath of listFiles(invocationDirectory)) {
    if (!filePath.endsWith('.json')) {
      continue
    }

    const value = parseJsonFile(filePath)

    if (
      !isRecord(value) ||
      typeof value.invocation_id !== 'string' ||
      typeof value.created_at !== 'string' ||
      artifactIdentity(value.invocation_id, stageSlugs) === null
    ) {
      continue
    }

    const timestamp = Date.parse(value.created_at)

    if (Number.isFinite(timestamp)) {
      candidates.push({ invocationId: value.invocation_id, timestamp })
    }
  }

  return candidates.sort((left, right) => left.timestamp - right.timestamp)
}

function finalHistoryIds(
  runDirectory: string,
  stageSlugs: ReadonlySet<string>,
): TimedInvocationId[] {
  const statePath = path.join(agentDirectory(runDirectory), 'state.json')

  if (!existsSync(statePath)) {
    return []
  }

  const value = parseJsonFile(statePath)

  if (!isRecord(value) || !Array.isArray(value.stage_history)) {
    return []
  }

  const candidates: TimedInvocationId[] = []

  for (const history of value.stage_history) {
    if (
      !isRecord(history) ||
      typeof history.invocation_id !== 'string' ||
      typeof history.submitted_at !== 'string' ||
      artifactIdentity(history.invocation_id, stageSlugs) === null
    ) {
      continue
    }

    const timestamp = Date.parse(history.submitted_at)

    if (Number.isFinite(timestamp)) {
      candidates.push({ invocationId: history.invocation_id, timestamp })
    }
  }

  return candidates.sort((left, right) => left.timestamp - right.timestamp)
}

function collectInvocationIds(runDirectory: string): string[] {
  const stageSlugs = workflowStageSlugs(runDirectory)
  const ordered = eventInvocationIds(runDirectory, stageSlugs)
  const seen = new Set(ordered)

  const addFallback = (invocationId: string): void => {
    if (seen.has(invocationId)) {
      return
    }

    seen.add(invocationId)
    ordered.push(invocationId)
  }

  for (const candidate of invocationFileIds(runDirectory, stageSlugs)) {
    addFallback(candidate.invocationId)
  }

  for (const candidate of finalHistoryIds(runDirectory, stageSlugs)) {
    addFallback(candidate.invocationId)
  }

  invariant(
    ordered.length <= 100,
    'Workflow artifact sequencing supports at most 100 stage occurrences.',
    {
      code: 'WORKFLOW_ARTIFACT_LIMIT',
      details: { occurrences: ordered.length },
    },
  )

  return ordered
}

function stageOccurrences(
  runDirectory: string,
  mode: WorkflowArtifactSequenceMode,
): StageOccurrence[] {
  const stageSlugs = workflowStageSlugs(runDirectory)
  const invocationIds = collectInvocationIds(runDirectory)
  const totalStages = invocationIds.length

  return invocationIds.map((oldInvocationId, stageSequence) => {
    const identity = artifactIdentity(oldInvocationId, stageSlugs)

    invariant(identity, `Invalid workflow artifact ID: ${oldInvocationId}`, {
      code: 'INVALID_WORKFLOW_ARTIFACTS',
    })

    const uuidSuffix = normalizedUuidSuffix(identity)
    const newInvocationId =
      mode === 'completed'
        ? makeCompletedStageArtifactId(
            stageSequence,
            totalStages,
            identity.stageSlug,
            identity.stageIteration,
            uuidSuffix,
          )
        : makeStageArtifactId(
            stageSequence,
            identity.stageSlug,
            identity.stageIteration,
            uuidSuffix,
          )

    return { oldInvocationId, newInvocationId }
  })
}

function replacementMappings(
  occurrences: StageOccurrence[],
): Map<string, string> {
  const candidates = new Map<string, Set<string>>()

  for (const occurrence of occurrences) {
    const values = candidates.get(occurrence.oldInvocationId) ?? new Set()

    values.add(occurrence.newInvocationId)
    candidates.set(occurrence.oldInvocationId, values)
  }

  const mappings = new Map<string, string>()

  for (const [oldInvocationId, values] of candidates) {
    if (values.size === 1) {
      mappings.set(oldInvocationId, [...values][0])
    }
  }

  return mappings
}

function replaceMappings(
  content: string,
  mappings: ReadonlyMap<string, string>,
): string {
  let updated = content
  const replacements = [...mappings.entries()]
    .filter(([oldValue, newValue]) => oldValue !== newValue)
    .sort(([left], [right]) => right.length - left.length)
  const placeholders = replacements.map(
    (_, index) => `\u0000PANCREATOR_MAPPING_${index}\u0000`,
  )

  replacements.forEach(([oldValue], index) => {
    updated = updated.replaceAll(oldValue, placeholders[index])
  })
  replacements.forEach(([, newValue], index) => {
    updated = updated.replaceAll(placeholders[index], newValue)
  })

  return updated
}

function replaceStringsInValue(
  value: unknown,
  mappings: ReadonlyMap<string, string>,
): unknown {
  if (typeof value === 'string') {
    return replaceMappings(value, mappings)
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceStringsInValue(item, mappings))
  }

  if (!isRecord(value)) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      replaceStringsInValue(item, mappings),
    ]),
  )
}

function occurrenceQueues(
  occurrences: StageOccurrence[],
): Map<string, string[]> {
  const queues = new Map<string, string[]>()

  for (const occurrence of occurrences) {
    const queue = queues.get(occurrence.oldInvocationId) ?? []

    queue.push(occurrence.newInvocationId)
    queues.set(occurrence.oldInvocationId, queue)
  }

  return queues
}

function rewriteRunStateValue(
  value: unknown,
  occurrences: StageOccurrence[],
  mappings: ReadonlyMap<string, string>,
): unknown {
  if (!isRecord(value)) {
    return replaceStringsInValue(value, mappings)
  }

  const clone = structuredClone(value)
  const queues = occurrenceQueues(occurrences)

  if (Array.isArray(clone.stage_history)) {
    for (const history of clone.stage_history) {
      if (!isRecord(history) || typeof history.invocation_id !== 'string') {
        continue
      }

      const oldInvocationId = history.invocation_id
      const queue = queues.get(oldInvocationId)
      const target = queue?.shift()

      if (target) {
        const local = new Map([[oldInvocationId, target]])
        const rewritten = replaceStringsInValue(history, local)

        Object.assign(history, rewritten)
      }
    }
  }

  if (
    isRecord(clone.current_invocation) &&
    typeof clone.current_invocation.id === 'string'
  ) {
    const oldInvocationId = clone.current_invocation.id
    const queue = queues.get(oldInvocationId)
    const target = queue?.at(-1)

    if (target) {
      const rewritten = replaceStringsInValue(
        clone.current_invocation,
        new Map([[oldInvocationId, target]]),
      )

      Object.assign(clone.current_invocation, rewritten)
    }
  }

  return replaceStringsInValue(clone, mappings)
}

function rewriteStructuredFiles(
  runDirectory: string,
  occurrences: StageOccurrence[],
  mappings: ReadonlyMap<string, string>,
  updatedFiles: Set<string>,
): void {
  const machineDirectory = agentDirectory(runDirectory)
  const stateFile = path.join(machineDirectory, 'state.json')

  if (existsSync(stateFile)) {
    const original = readFileSync(stateFile, 'utf8')
    const state = rewriteRunStateValue(
      JSON.parse(original) as unknown,
      occurrences,
      mappings,
    )
    const updated = `${JSON.stringify(state, null, 2)}\n`

    if (updated !== original) {
      writeFileSync(stateFile, updated, 'utf8')
      updatedFiles.add(stateFile)
    }
  }

  const eventsFile = path.join(machineDirectory, 'events.jsonl')

  if (!existsSync(eventsFile)) {
    return
  }

  let occurrenceIndex = 0
  const originalEvents = readFileSync(eventsFile, 'utf8')
  const rewrittenEvents = parseJsonLines(eventsFile).map((value) => {
    if (!isRecord(value)) {
      return replaceStringsInValue(value, mappings)
    }

    const event = structuredClone(value)

    if (
      event.type === 'invocation_prepared' ||
      event.type === 'harness_stage_executed'
    ) {
      const occurrence = occurrences[occurrenceIndex]

      if (occurrence) {
        event.invocation_id = occurrence.newInvocationId
        occurrenceIndex += 1
      }
    }

    if (event.state_after !== undefined) {
      event.state_after = rewriteRunStateValue(
        event.state_after,
        occurrences,
        mappings,
      )
    }

    return replaceStringsInValue(event, mappings)
  })

  const updatedEvents = `${rewrittenEvents.map((event) => JSON.stringify(event)).join('\n')}\n`

  if (updatedEvents !== originalEvents) {
    writeFileSync(eventsFile, updatedEvents, 'utf8')
    updatedFiles.add(eventsFile)
  }
}

function isContentAddressedArtifact(filePath: string): boolean {
  return /(?:^|[/\\])(?:state-revision-\d+-[a-f0-9]{64}|event-payload-[a-f0-9]{64}|repository-check-delta-[a-f0-9]{64})\.json$/u.test(
    filePath,
  )
}

function updateFiles(
  files: string[],
  mappings: ReadonlyMap<string, string>,
  updatedFiles: Set<string>,
): void {
  if (mappings.size === 0) {
    return
  }

  for (const filePath of files) {
    const content = textFileContent(filePath)

    if (content === null) {
      continue
    }

    const updated = replaceMappings(content, mappings)

    if (updated !== content) {
      writeFileSync(filePath, updated, 'utf8')
      updatedFiles.add(filePath)
    }
  }
}

function migratedArtifactName(
  name: string,
  mappings: ReadonlyMap<string, string>,
): string {
  for (const [oldInvocationId, newInvocationId] of mappings) {
    if (name === `assessment-${oldInvocationId}.request.json`) {
      return `${newInvocationId}.assessment-request.json`
    }

    if (name === `assessment-${oldInvocationId}.json`) {
      return `${newInvocationId}.assessment.json`
    }
  }

  return replaceMappings(name, mappings)
}

function applyFileRenames(
  files: string[],
  mappings: ReadonlyMap<string, string>,
): number {
  const plans = files.flatMap((source) => {
    const name = path.basename(source)
    const nextName = migratedArtifactName(name, mappings)

    return nextName === name
      ? []
      : [{ source, target: path.join(path.dirname(source), nextName) }]
  })

  if (plans.length === 0) {
    return 0
  }

  const sources = new Set(plans.map((plan) => plan.source))

  for (const plan of plans) {
    invariant(
      !existsSync(plan.target) || sources.has(plan.target),
      `Artifact rename target already exists: ${plan.target}`,
      { code: 'ARTIFACT_RENAME_COLLISION' },
    )
  }

  const temporary = plans.map((plan) => {
    const temp = `${plan.source}.renaming-${randomUUID()}`

    renameSync(plan.source, temp)

    return { temp, target: plan.target }
  })

  for (const plan of temporary) {
    renameSync(plan.temp, plan.target)
  }

  return plans.length
}

function toRepoRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/')
}

interface FileRemoval {
  source: string
  sourceRelative: string
  targetRelative: string
}

interface ArtifactLayoutPlan {
  moves: FileMove[]
  removals: FileRemoval[]
}

function recordJsonTarget(
  artifactRoot: string,
  relativeMarkdownPath: string,
): string {
  const normalized = relativeMarkdownPath.endsWith('.record.md')
    ? relativeMarkdownPath.slice(0, -'.record.md'.length)
    : relativeMarkdownPath.slice(0, -path.extname(relativeMarkdownPath).length)

  return path.join(artifactRoot, 'json', `${normalized}.json`)
}

function removal(
  root: string,
  artifactRoot: string,
  source: string,
  relativeMarkdownPath: string,
): FileRemoval {
  const target = recordJsonTarget(artifactRoot, relativeMarkdownPath)

  return {
    source,
    sourceRelative: toRepoRelative(root, source),
    targetRelative: toRepoRelative(root, target),
  }
}

function layoutPlan(root: string, runDirectory: string): ArtifactLayoutPlan {
  const artifactRoot = path.join(runDirectory, 'artifacts')
  const recordsRoot = path.join(runDirectory, 'records')
  const moves: FileMove[] = []
  const removals: FileRemoval[] = []

  for (const source of listFiles(recordsRoot)) {
    const relative = path.relative(recordsRoot, source)
    const extension = path.extname(source)

    if (extension === '.json') {
      const target = path.join(artifactRoot, 'json', relative)

      moves.push({
        source,
        target,
        sourceRelative: toRepoRelative(root, source),
        targetRelative: toRepoRelative(root, target),
      })
    } else if (extension === '.md') {
      removals.push(removal(root, artifactRoot, source, relative))
    } else {
      invariant(false, `Unsupported record artifact: ${source}`, {
        code: 'UNSUPPORTED_RECORD_ARTIFACT',
      })
    }
  }

  const markdownRoot = path.join(artifactRoot, 'markdown')

  for (const source of listFiles(markdownRoot)) {
    if (!source.endsWith('.record.md')) {
      continue
    }

    removals.push(
      removal(root, artifactRoot, source, path.relative(markdownRoot, source)),
    )
  }

  if (existsSync(artifactRoot)) {
    for (const entry of readdirSync(artifactRoot, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        (entry.name === 'json' ||
          entry.name === 'html' ||
          entry.name === 'markdown')
      ) {
        continue
      }

      const sourceRoot = path.join(artifactRoot, entry.name)
      const files = entry.isDirectory() ? listFiles(sourceRoot) : [sourceRoot]

      for (const source of files) {
        const relative = path.relative(artifactRoot, source)

        if (source.endsWith('.record.md')) {
          removals.push(removal(root, artifactRoot, source, relative))

          continue
        }

        const targetDirectory = source.endsWith('.json')
          ? 'json'
          : source.endsWith('.html')
            ? 'html'
            : 'markdown'
        const target = path.join(artifactRoot, targetDirectory, relative)

        moves.push({
          source,
          target,
          sourceRelative: toRepoRelative(root, source),
          targetRelative: toRepoRelative(root, target),
        })
      }
    }
  }

  return { moves, removals }
}

function applyLayoutMoves(moves: FileMove[]): void {
  const sources = new Set(moves.map((move) => move.source))

  for (const move of moves) {
    invariant(
      !existsSync(move.target) || sources.has(move.target),
      `Artifact layout target already exists: ${move.target}`,
      { code: 'ARTIFACT_LAYOUT_COLLISION' },
    )
  }

  const temporary = moves.map((move) => {
    mkdirSync(path.dirname(move.target), { recursive: true })

    const temp = `${move.source}.moving-${randomUUID()}`

    renameSync(move.source, temp)

    return { temp, target: move.target }
  })

  for (const move of temporary) {
    renameSync(move.temp, move.target)
  }
}

function applyLayoutRemovals(removals: FileRemoval[]): void {
  for (const item of removals) {
    rmSync(item.source, { force: true })
  }
}

function consolidateArtifactLayout(
  root: string,
  runDirectory: string,
): { changed: number; mappings: Map<string, string> } {
  if (agentDirectory(runDirectory) !== runDirectory) {
    mkdirSync(path.join(runDirectory, 'agent', 'artifacts', 'json'), {
      recursive: true,
    })
    mkdirSync(path.join(runDirectory, 'operator'), { recursive: true })

    return { changed: 0, mappings: new Map() }
  }

  const artifactRoot = path.join(runDirectory, 'artifacts')

  mkdirSync(path.join(artifactRoot, 'json'), { recursive: true })
  mkdirSync(path.join(artifactRoot, 'html'), { recursive: true })
  mkdirSync(path.join(artifactRoot, 'markdown'), { recursive: true })

  const plan = layoutPlan(root, runDirectory)

  applyLayoutMoves(plan.moves)
  applyLayoutRemovals(plan.removals)
  rmSync(path.join(runDirectory, 'records'), { recursive: true, force: true })

  for (const entry of readdirSync(artifactRoot, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      entry.name !== 'json' &&
      entry.name !== 'html' &&
      entry.name !== 'markdown'
    ) {
      rmSync(path.join(artifactRoot, entry.name), {
        recursive: true,
        force: true,
      })
    }
  }

  const changes = [...plan.moves, ...plan.removals]

  return {
    changed: changes.length,
    mappings: new Map(
      changes.map((item) => [item.sourceRelative, item.targetRelative]),
    ),
  }
}

function replaceRunStateObject(
  state: RunState,
  mappings: ReadonlyMap<string, string>,
): void {
  const rewritten = replaceStringsInValue(state, mappings)

  invariant(isRecord(rewritten), 'Rewritten run state MUST remain an object.', {
    code: 'INVALID_REWRITTEN_STATE',
  })

  for (const key of Object.keys(state)) {
    delete (state as unknown as Record<string, unknown>)[key]
  }

  Object.assign(state, rewritten)
}

export function rewriteWorkflowArtifacts(
  root: string,
  runId: string,
  mode: WorkflowArtifactSequenceMode,
  state?: RunState,
): WorkflowArtifactRewriteSummary {
  const runDirectory = path.join(root, 'runtime', 'logs', 'workflows', runId)

  invariant(existsSync(runDirectory), `Unknown run: ${runId}`, {
    code: 'RUN_NOT_FOUND',
  })

  const stateDirectory = path.join(root, 'runtime', 'workflows', runId)
  const occurrences = stageOccurrences(runDirectory, mode)
  const mappings = replacementMappings(occurrences)
  const updatedFiles = new Set<string>()

  rewriteStructuredFiles(runDirectory, occurrences, mappings, updatedFiles)
  // Content-addressed artifacts are immutable history: their recorded digests
  // cover the written bytes, so rewriting invocation ids inside them would
  // invalidate every state_ref/payload_ref/full_delta_ref that names them and
  // make loadState/loadStateRevision fail their checksums after finalization.
  updateFiles(
    listFiles(runDirectory).filter(
      (filePath) => !isContentAddressedArtifact(filePath),
    ),
    mappings,
    updatedFiles,
  )
  updateFiles(listFiles(stateDirectory), mappings, updatedFiles)

  if (state) {
    const rewritten = rewriteRunStateValue(state, occurrences, mappings)

    invariant(
      isRecord(rewritten),
      'Rewritten run state MUST remain an object.',
      {
        code: 'INVALID_REWRITTEN_STATE',
      },
    )
    Object.assign(state, rewritten)
  }

  const artifactFiles =
    applyFileRenames(listFiles(runDirectory), mappings) +
    applyFileRenames(listFiles(stateDirectory), mappings)
  const layout = consolidateArtifactLayout(root, runDirectory)

  updateFiles(listFiles(runDirectory), layout.mappings, updatedFiles)
  updateFiles(listFiles(stateDirectory), layout.mappings, updatedFiles)

  if (state) {
    replaceRunStateObject(state, layout.mappings)
    writeJsonAtomic(
      path.join(agentDirectory(runDirectory), 'state.json'),
      state,
    )
  }

  return {
    artifact_files: artifactFiles,
    layout_files: layout.changed,
    updated_files: updatedFiles.size,
  }
}

export function finalizeWorkflowArtifacts(
  root: string,
  runId: string,
  activeState?: RunState,
): WorkflowArtifactRewriteSummary {
  const state = activeState ?? loadState(root, runId)

  invariant(isClosedRunStatus(state.status), 'Run is not closed.', {
    code: 'RUN_NOT_TERMINAL',
  })

  return rewriteWorkflowArtifacts(root, runId, 'completed', state)
}

const LEGACY_RUN_ID_PATTERN =
  /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-([0-9a-f]{8})$/u
const DAY_ONLY_RUN_ID_PATTERN = /^(\d+)_([A-Z][a-z]{2})-(\d{2})_([0-9a-f]{8})$/u
// Suffixes are keyword slugs up to 12 characters; legacy 8-hex UUID fragments
// remain valid members of the same character class.
const CURRENT_RUN_ID_PATTERN =
  /^(\d+)_([A-Z][a-z]{2})-(\d{2})-(\d{4})_([a-z0-9](?:[a-z0-9-]{0,10}[a-z0-9])?)$/u
const HASH_RUN_SUFFIX_PATTERN =
  /^(\d+_[A-Z][a-z]{2}-\d{2}-\d{4})_([0-9a-f]{8})$/u
const TEMPORAL_FILE_NAME_PATTERN =
  /^(\d+)_([A-Z][a-z]{2})-(\d{2})-(\d{4})_([a-z0-9][a-z0-9.-]*)$/u
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000
const MILLISECONDS_PER_MINUTE = 60 * 1000
const DATETIME_ANCHOR_MS = Date.parse('2200-01-01T00:00:00.000Z')
const MONTH_INDEX = new Map(
  [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ].map((month, index) => [month, index]),
)

export interface WorkflowNameMigrationSummary {
  run_directories: number
  state_directories: number
  artifact_files: number
  artifact_layout_files: number
  updated_files: number
  removed_invalid_directories: number
}

export interface WorkflowArchiveSummary {
  retention_days: number
  cutoff: string
  run_directories: number
  state_directories: number
  /** Standalone-mode session directories archived under the same retention. */
  session_directories: number
  /** Best-of-N session directories archived under the same retention. */
  best_of_n_directories: number
  updated_files: number
  run_ids: string[]
  session_ids: string[]
  bon_ids: string[]
  /** Archived temporal inbox file names. */
  inbox_files: string[]
  /** Archived PR-description file names. */
  pr_description_files: string[]
}

export interface WorkflowRuntimeMaintenanceSummary {
  names: RuntimeNameStandardizationSummary
  migration: WorkflowNameMigrationSummary
  suffixes: RunSuffixMigrationSummary
  archive: WorkflowArchiveSummary
}

interface RunMigration {
  sourceRunId: string
  targetRunId: string
}

function legacyRunDate(
  runId: string,
): { date: Date; uuidSuffix: string } | null {
  const match = LEGACY_RUN_ID_PATTERN.exec(runId)

  if (!match) {
    return null
  }

  const date = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
      Number(match[7]),
    ),
  )

  return { date, uuidSuffix: match[8] }
}

function dayOnlyRunDate(runId: string): Date | null {
  const match = DAY_ONLY_RUN_ID_PATTERN.exec(runId)

  if (!match) {
    return null
  }

  const monthIndex = MONTH_INDEX.get(match[2])

  if (monthIndex === undefined) {
    return null
  }

  const day = Number(match[3])
  const boundary = new Date(
    DATETIME_ANCHOR_MS - Number(match[1]) * MILLISECONDS_PER_DAY,
  )
  const candidates = [
    boundary,
    new Date(boundary.getTime() - MILLISECONDS_PER_DAY),
  ]
  const matchingDate = candidates.find(
    (candidate) =>
      candidate.getUTCMonth() === monthIndex && candidate.getUTCDate() === day,
  )

  if (!matchingDate) {
    return null
  }

  return new Date(
    Date.UTC(
      matchingDate.getUTCFullYear(),
      matchingDate.getUTCMonth(),
      matchingDate.getUTCDate(),
      12,
    ),
  )
}

function temporalPrefixDate(
  daysValue: string,
  monthName: string,
  dayValue: string,
  minutesValue: string,
): Date | null {
  const monthIndex = MONTH_INDEX.get(monthName)

  if (monthIndex === undefined) {
    return null
  }

  const day = Number(dayValue)
  const minutesToEnd = Number(minutesValue)

  if (minutesToEnd < 1 || minutesToEnd > 1440) {
    return null
  }

  const boundary = new Date(
    DATETIME_ANCHOR_MS - Number(daysValue) * MILLISECONDS_PER_DAY,
  )
  const candidates = [
    boundary,
    new Date(boundary.getTime() - MILLISECONDS_PER_DAY),
  ]
  const matchingDate = candidates.find(
    (candidate) =>
      candidate.getUTCMonth() === monthIndex && candidate.getUTCDate() === day,
  )

  if (!matchingDate) {
    return null
  }

  const startOfDay = Date.UTC(
    matchingDate.getUTCFullYear(),
    matchingDate.getUTCMonth(),
    matchingDate.getUTCDate(),
  )

  return new Date(startOfDay + (1440 - minutesToEnd) * MILLISECONDS_PER_MINUTE)
}

function currentRunDate(runId: string): Date | null {
  const match = CURRENT_RUN_ID_PATTERN.exec(runId)

  return match
    ? temporalPrefixDate(match[1], match[2], match[3], match[4])
    : null
}

function temporalFileDate(name: string): Date | null {
  const match = TEMPORAL_FILE_NAME_PATTERN.exec(name)

  return match
    ? temporalPrefixDate(match[1], match[2], match[3], match[4])
    : null
}

function validDate(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null
  }

  const date = new Date(value)

  return Number.isFinite(date.getTime()) ? date : null
}

function runCreatedAt(root: string, runId: string): Date | null {
  const layout = resolveRunLayout(root, runId)
  const statePath = layout.state.absolute

  if (existsSync(statePath)) {
    const state = parseJsonFile(statePath)

    if (isRecord(state)) {
      const createdAt = validDate(state.created_at)

      if (createdAt) {
        return createdAt
      }
    }
  }

  const eventsPath = layout.events.absolute

  for (const event of parseJsonLines(eventsPath)) {
    if (isRecord(event)) {
      const timestamp = validDate(event.timestamp)

      if (timestamp) {
        return timestamp
      }
    }
  }

  return (
    legacyRunDate(runId)?.date ?? currentRunDate(runId) ?? dayOnlyRunDate(runId)
  )
}

export function migratedRunId(runId: string, createdAt?: Date): string | null {
  const legacy = legacyRunDate(runId)

  if (legacy) {
    return makeWorkflowRunId(legacy.date, legacy.uuidSuffix)
  }

  const dayOnly = DAY_ONLY_RUN_ID_PATTERN.exec(runId)

  if (!dayOnly) {
    return null
  }

  return makeWorkflowRunId(
    createdAt ?? dayOnlyRunDate(runId) ?? new Date(),
    dayOnly[4],
  )
}

function migrationTargetRunId(root: string, runId: string): string | null {
  const migrated = migratedRunId(runId, runCreatedAt(root, runId) ?? undefined)

  if (migrated) {
    return migrated
  }

  return currentRunDate(runId) ? runId : null
}

function updateFileCount(
  files: string[],
  mappings: ReadonlyMap<string, string>,
): number {
  const updated = new Set<string>()

  updateFiles(files, mappings, updated)

  return updated.size
}

/**
 * Every runtime file that may be rewritten when a temporal name changes.
 *
 * Worktree checkouts are excluded: they are entire target source trees that
 * can carry hundreds of thousands of dependency files and never hold runtime
 * name references.
 */
function mutableRuntimeFiles(runtimeRoot: string): string[] {
  return listFiles(runtimeRoot, path.join(runtimeRoot, 'worktrees')).filter(
    (filePath) => !isContentAddressedArtifact(filePath),
  )
}

function migratableDirectoryNames(root: string, directory: string): string[] {
  if (!existsSync(directory)) {
    return []
  }

  return readdirSync(directory)
    .filter((name) => {
      const absolute = path.join(directory, name)

      return (
        statSync(absolute).isDirectory() &&
        migrationTargetRunId(root, name) !== null
      )
    })
    .sort()
}

function moveDirectory(parent: string, oldName: string, newName: string): void {
  if (oldName === newName) {
    return
  }

  const source = path.join(parent, oldName)
  const target = path.join(parent, newName)

  invariant(!existsSync(target), `Migration target already exists: ${target}`, {
    code: 'MIGRATION_COLLISION',
  })

  renameSync(source, target)
}

function readRunStatus(runDirectory: string): RunStatus {
  const statePath = path.join(agentDirectory(runDirectory), 'state.json')
  const value: unknown = JSON.parse(readFileSync(statePath, 'utf8'))

  invariant(
    isRecord(value) && typeof value.status === 'string',
    `${statePath} MUST contain a run status.`,
    { code: 'INVALID_WORKFLOW_MIGRATION' },
  )

  return value.status as RunStatus
}

function removeEmptyHelpDirectory(logRoot: string): number {
  const helpDirectory = path.join(logRoot, '--help')

  if (!existsSync(helpDirectory)) {
    return 0
  }

  invariant(
    readdirSync(helpDirectory).length === 0,
    `${helpDirectory} is not empty and MUST be reviewed manually.`,
    { code: 'INVALID_RUNTIME_DIRECTORY' },
  )

  rmSync(helpDirectory, { recursive: true })

  return 1
}

export function migrateWorkflowNames(
  root = findProjectRoot(),
): WorkflowNameMigrationSummary {
  const runtimeRoot = path.join(root, 'runtime')
  const logRoot = path.join(runtimeRoot, 'logs', 'workflows')
  const stateRoot = path.join(runtimeRoot, 'workflows')
  const migrations = new Map<string, RunMigration>()

  for (const sourceRunId of new Set([
    ...migratableDirectoryNames(root, logRoot),
    ...migratableDirectoryNames(root, stateRoot),
  ])) {
    const targetRunId = migrationTargetRunId(root, sourceRunId)

    invariant(targetRunId, `Invalid workflow directory: ${sourceRunId}`, {
      code: 'INVALID_WORKFLOW_MIGRATION',
    })
    migrations.set(sourceRunId, { sourceRunId, targetRunId })
  }

  const runIdMappings = new Map<string, string>()

  for (const migration of migrations.values()) {
    if (migration.sourceRunId !== migration.targetRunId) {
      runIdMappings.set(migration.sourceRunId, migration.targetRunId)
    }
  }

  // Content-addressed artifacts are excluded for the same digest-integrity
  // reason documented in rewriteWorkflowArtifacts.
  let updatedFiles = updateFileCount(
    mutableRuntimeFiles(runtimeRoot),
    runIdMappings,
  )
  let runDirectories = 0
  let stateDirectories = 0

  for (const migration of migrations.values()) {
    if (
      migration.sourceRunId !== migration.targetRunId &&
      existsSync(path.join(logRoot, migration.sourceRunId))
    ) {
      moveDirectory(logRoot, migration.sourceRunId, migration.targetRunId)
      runDirectories += 1
    }

    if (
      migration.sourceRunId !== migration.targetRunId &&
      existsSync(path.join(stateRoot, migration.sourceRunId))
    ) {
      moveDirectory(stateRoot, migration.sourceRunId, migration.targetRunId)
      stateDirectories += 1
    }
  }

  let artifactFiles = 0
  let artifactLayoutFiles = 0

  for (const targetRunId of new Set(
    [...migrations.values()].map((migration) => migration.targetRunId),
  )) {
    const runDirectory = path.join(logRoot, targetRunId)

    if (!existsSync(runDirectory)) {
      continue
    }

    const status = readRunStatus(runDirectory)
    const summary = rewriteWorkflowArtifacts(
      root,
      targetRunId,
      isClosedRunStatus(status) ? 'completed' : 'in-flight',
    )

    artifactFiles += summary.artifact_files
    artifactLayoutFiles += summary.layout_files
    updatedFiles += summary.updated_files
  }

  return {
    run_directories: runDirectories,
    state_directories: stateDirectories,
    artifact_files: artifactFiles,
    artifact_layout_files: artifactLayoutFiles,
    updated_files: updatedFiles,
    removed_invalid_directories: removeEmptyHelpDirectory(logRoot),
  }
}

// Runtime directories whose loose files are non-durable: their names MUST use
// the temporal prefix scheme so age is legible and archiving can rely on it.
const TEMPORAL_FILE_DIRECTORIES = ['runtime/inbox', 'runtime/pr-descriptions']

const EMBEDDED_TIMESTAMP_NAME_PATTERN =
  /^(?:request-)?(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})?Z-?(.*)$/u
const EMBEDDED_DATE_NAME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})-?(.*)$/u

export interface RuntimeNameStandardizationSummary {
  renamed_files: number
  updated_files: number
  renames: Record<string, string>
}

interface TemporalFileSource {
  date: Date
  slugSeed: string
}

function utcDate(
  year: string,
  month: string,
  day: string,
  hours = '12',
  minutes = '0',
  seconds = '0',
  milliseconds = '0',
): Date | null {
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
      Number(seconds),
      Number(milliseconds),
    ),
  )

  return Number.isFinite(date.getTime()) ? date : null
}

/**
 * Recover a file's temporal identity from its legacy name. Names without any
 * embedded timestamp fall back to the file's modification time: imprecise, but
 * the only signal available, and used exactly once at migration.
 */
function temporalFileSource(filePath: string): TemporalFileSource {
  const name = path.basename(filePath)
  const extension = path.extname(name)
  const base = extension ? name.slice(0, -extension.length) : name
  const timestampMatch = EMBEDDED_TIMESTAMP_NAME_PATTERN.exec(base)

  if (timestampMatch) {
    const date = utcDate(
      timestampMatch[1],
      timestampMatch[2],
      timestampMatch[3],
      timestampMatch[4],
      timestampMatch[5],
      timestampMatch[6],
      timestampMatch[7] ?? '0',
    )

    if (date) {
      return { date, slugSeed: timestampMatch[8] }
    }
  }

  const dateMatch = EMBEDDED_DATE_NAME_PATTERN.exec(base)

  if (dateMatch) {
    const date = utcDate(dateMatch[1], dateMatch[2], dateMatch[3])

    if (date) {
      return { date, slugSeed: dateMatch[4] }
    }
  }

  return { date: statSync(filePath).mtime, slugSeed: base }
}

function standardizedFileSlug(filePath: string, slugSeed: string): string {
  const sanitized = slugSeed
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')

  // An existing keyword slug is operator-chosen and kept verbatim; only slugs
  // that are empty or opaque hex fragments are re-derived from file content.
  if (sanitized.length > 0 && !/^[0-9a-f]{7,}$/u.test(sanitized)) {
    return sanitized
  }

  const derived = keywordRunSuffixFrom(
    sanitized,
    textFileContent(filePath) ?? undefined,
  )

  return (
    derived ??
    (sanitized.length > 0
      ? sanitized
      : deterministicUuidSuffix(path.basename(filePath)))
  )
}

function isCompliantTemporalFileName(name: string): boolean {
  return temporalFileDate(name) !== null
}

/**
 * Rename every non-durable file under the temporal runtime directories to the
 * `<days-to-anchor>_<MMM-DD>-<minutes-to-end-of-UTC-day>_<slug>` scheme used by
 * `runtime/logs/workflows`, then rewrite persisted references to the old names.
 */
export function standardizeRuntimeFileNames(
  root = findProjectRoot(),
): RuntimeNameStandardizationSummary {
  const mappings = new Map<string, string>()

  for (const directoryRelative of TEMPORAL_FILE_DIRECTORIES) {
    for (const parentRelative of [
      directoryRelative,
      `${directoryRelative}/archive`,
    ]) {
      const parent = path.join(root, parentRelative)

      if (!existsSync(parent)) {
        continue
      }

      const taken = new Set(readdirSync(parent))

      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (
          !entry.isFile() ||
          entry.name.startsWith('.') ||
          isCompliantTemporalFileName(entry.name)
        ) {
          continue
        }

        const absolute = path.join(parent, entry.name)
        const { date, slugSeed } = temporalFileSource(absolute)
        const extension = path.extname(entry.name)
        const slug = standardizedFileSlug(absolute, slugSeed)
        const prefix = temporalNamePrefix(date)
        let target = `${prefix}_${slug}${extension}`
        let ordinal = 2

        while (taken.has(target)) {
          target = `${prefix}_${slug}-${ordinal}${extension}`
          ordinal += 1
        }

        taken.add(target)
        renameSync(absolute, path.join(parent, target))
        mappings.set(
          `${parentRelative}/${entry.name}`,
          `${parentRelative}/${target}`,
        )
      }
    }
  }

  const updatedFiles =
    mappings.size > 0
      ? updateFileCount(
          mutableRuntimeFiles(path.join(root, 'runtime')),
          mappings,
        )
      : 0

  return {
    renamed_files: mappings.size,
    updated_files: updatedFiles,
    renames: Object.fromEntries(mappings),
  }
}

export interface RunSuffixMigrationSummary {
  run_directories: number
  best_of_n_directories: number
  session_directories: number
  updated_files: number
  skipped_directories: string[]
}

function workflowKeywordSuffix(runDirectory: string): string | null {
  const statePath = path.join(agentDirectory(runDirectory), 'state.json')

  if (!existsSync(statePath)) {
    return null
  }

  const state = parseJsonFile(statePath)

  if (!isRecord(state)) {
    return null
  }

  const candidates = [
    typeof state.title === 'string' ? state.title : null,
    isRecord(state.request) && typeof state.request.source_path === 'string'
      ? path.basename(state.request.source_path)
      : null,
    typeof state.workflow_slug === 'string' ? state.workflow_slug : null,
  ]

  for (const candidate of candidates) {
    const suffix = candidate === null ? null : keywordRunSuffix(candidate)

    if (suffix) {
      return suffix
    }
  }

  return null
}

function bestOfNKeywordSuffix(directory: string): string | null {
  const statePath = path.join(directory, 'state.json')

  if (existsSync(statePath)) {
    const state = parseJsonFile(statePath)

    if (
      isRecord(state) &&
      isRecord(state.request) &&
      typeof state.request.source_path === 'string'
    ) {
      const suffix = keywordRunSuffix(path.basename(state.request.source_path))

      if (suffix) {
        return suffix
      }
    }
  }

  const requestPath = path.join(directory, 'request.md')

  return existsSync(requestPath)
    ? keywordRunSuffixFrom(
        'request.md',
        textFileContent(requestPath) ?? undefined,
      )
    : null
}

function sessionKeywordSuffix(directory: string): string | null {
  for (const entry of readdirSync(directory)) {
    if (entry.endsWith('-card.md')) {
      const suffix = keywordRunSuffix(entry.slice(0, -'-card.md'.length))

      if (suffix) {
        return suffix
      }
    }
  }

  return null
}

function dedupedRunId(
  prefix: string,
  suffix: string,
  taken: (candidate: string) => boolean,
): string | null {
  const stem = suffix.slice(0, RUN_SUFFIX_MAX_LENGTH - 2).replace(/-+$/u, '')
  const candidates = [
    suffix,
    ...Array.from({ length: 8 }, (_, index) => `${stem}-${index + 2}`),
  ]

  for (const candidate of candidates) {
    const id = `${prefix}_${candidate}`

    if (!taken(id)) {
      return id
    }
  }

  return null
}

interface SuffixMigrationGroup {
  kind: 'workflow' | 'best-of-n' | 'session'
  /** Parent directories scanned for hash-suffixed children, archive included. */
  parents: string[]
  /** Same-index twins that must be renamed in lockstep (state mirrors). */
  twins: (string | null)[]
}

const SUFFIX_MIGRATION_GROUPS: SuffixMigrationGroup[] = [
  {
    kind: 'workflow',
    parents: ['runtime/logs/workflows', 'runtime/logs/workflows/archive'],
    twins: ['runtime/workflows', 'runtime/workflows/archive'],
  },
  {
    kind: 'best-of-n',
    parents: ['runtime/logs/best-of-n', 'runtime/logs/best-of-n/archive'],
    twins: [null, null],
  },
  {
    kind: 'session',
    parents: ['runtime/logs/sessions', 'runtime/logs/sessions/archive'],
    twins: [null, null],
  },
]

/**
 * Replace opaque 8-hex run directory suffixes with high-signal keyword
 * suffixes derived from what the run was about, rewriting every persisted
 * reference to the old IDs. Directories without a derivable seed, and
 * best-of-N sessions whose worktrees still exist on disk (git records their
 * absolute paths), keep their hash suffix and are reported as skipped.
 */
export function migrateRunSuffixes(
  root = findProjectRoot(),
): RunSuffixMigrationSummary {
  const runtimeRoot = path.join(root, 'runtime')
  const mappings = new Map<string, string>()
  const moves: Array<{ parent: string; source: string; target: string }> = []
  const skipped: string[] = []
  const counts = { workflow: 0, 'best-of-n': 0, session: 0 }

  for (const group of SUFFIX_MIGRATION_GROUPS) {
    const taken = (candidate: string): boolean =>
      group.parents.some((relative) =>
        existsSync(path.join(root, relative, candidate)),
      ) ||
      group.twins.some(
        (relative) =>
          relative !== null && existsSync(path.join(root, relative, candidate)),
      ) ||
      [...mappings.values()].includes(candidate)

    group.parents.forEach((parentRelative, parentIndex) => {
      const parent = path.join(root, parentRelative)

      if (!existsSync(parent)) {
        return
      }

      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        const match = HASH_RUN_SUFFIX_PATTERN.exec(entry.name)

        if (!entry.isDirectory() || !match) {
          continue
        }

        const directory = path.join(parent, entry.name)
        const suffix =
          group.kind === 'workflow'
            ? workflowKeywordSuffix(directory)
            : group.kind === 'best-of-n'
              ? bestOfNKeywordSuffix(directory)
              : sessionKeywordSuffix(directory)

        if (!suffix) {
          skipped.push(`${parentRelative}/${entry.name}`)
          continue
        }

        if (
          group.kind === 'best-of-n' &&
          (existsSync(path.join(root, 'worktrees', entry.name)) ||
            existsSync(path.join(runtimeRoot, 'worktrees', entry.name)))
        ) {
          skipped.push(`${parentRelative}/${entry.name}`)
          continue
        }

        const target = dedupedRunId(match[1], suffix, taken)

        if (!target) {
          skipped.push(`${parentRelative}/${entry.name}`)
          continue
        }

        if (target === entry.name) {
          continue
        }

        mappings.set(entry.name, target)
        moves.push({ parent, source: entry.name, target })

        const twinRelative = group.twins[parentIndex]

        if (twinRelative !== null && twinRelative !== undefined) {
          const twinParent = path.join(root, twinRelative)

          if (existsSync(path.join(twinParent, entry.name))) {
            moves.push({ parent: twinParent, source: entry.name, target })
          }
        }

        counts[group.kind] += 1
      }
    })
  }

  const updatedFiles =
    mappings.size > 0
      ? updateFileCount(mutableRuntimeFiles(runtimeRoot), mappings)
      : 0

  for (const move of moves) {
    moveDirectory(move.parent, move.source, move.target)
  }

  return {
    run_directories: counts.workflow,
    best_of_n_directories: counts['best-of-n'],
    session_directories: counts.session,
    updated_files: updatedFiles,
    skipped_directories: skipped.sort(),
  }
}

function activeWorkflowDirectoryNames(directory: string): string[] {
  if (!existsSync(directory)) {
    return []
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== 'archive' &&
        currentRunDate(entry.name) !== null,
    )
    .map((entry) => entry.name)
    .sort()
}

function bestOfNCreatedAt(directory: string): Date | null {
  const statePath = path.join(directory, 'state.json')

  if (!existsSync(statePath)) {
    return null
  }

  const state = parseJsonFile(statePath)

  return isRecord(state) ? validDate(state.created_at) : null
}

function archiveDirectory(parent: string, runId: string): void {
  const source = path.join(parent, runId)

  if (!existsSync(source)) {
    return
  }

  const archiveRoot = path.join(parent, 'archive')
  const target = path.join(archiveRoot, runId)

  invariant(!existsSync(target), `Archive target already exists: ${target}`, {
    code: 'ARCHIVE_COLLISION',
  })
  mkdirSync(archiveRoot, { recursive: true })
  renameSync(source, target)
}

export function archiveWorkflowDirectories(
  root = findProjectRoot(),
  options: { retentionDays?: number; now?: Date } = {},
): WorkflowArchiveSummary {
  const retentionDays = options.retentionDays ?? 7
  const now = options.now ?? new Date()

  invariant(
    Number.isInteger(retentionDays) && retentionDays >= 1,
    'Workflow retention days MUST be a positive integer.',
    { code: 'INVALID_RETENTION_DAYS' },
  )
  invariant(Number.isFinite(now.getTime()), 'Archive time MUST be valid.', {
    code: 'INVALID_ARCHIVE_TIME',
  })

  const cutoff = new Date(now.getTime() - retentionDays * MILLISECONDS_PER_DAY)
  const logRoot = path.join(root, 'runtime', 'logs', 'workflows')
  const stateRoot = path.join(root, 'runtime', 'workflows')
  const runIds = [
    ...new Set([
      ...activeWorkflowDirectoryNames(logRoot),
      ...activeWorkflowDirectoryNames(stateRoot),
    ]),
  ].filter((runId) => {
    const createdAt = runCreatedAt(root, runId) ?? currentRunDate(runId)

    invariant(
      createdAt,
      `Could not determine workflow creation time: ${runId}`,
      {
        code: 'INVALID_WORKFLOW_ARCHIVE',
      },
    )

    return createdAt.getTime() < cutoff.getTime()
  })

  let updatedFiles = 0
  let runDirectories = 0
  let stateDirectories = 0

  for (const runId of runIds) {
    const logDirectory = path.join(logRoot, runId)
    const stateDirectory = path.join(stateRoot, runId)
    const mappings = new Map<string, string>([
      [
        `runtime/logs/workflows/${runId}`,
        `runtime/logs/workflows/archive/${runId}`,
      ],
      [`runtime/workflows/${runId}`, `runtime/workflows/archive/${runId}`],
    ])

    updatedFiles += updateFileCount(
      [...listFiles(logDirectory), ...listFiles(stateDirectory)],
      mappings,
    )

    if (existsSync(logDirectory)) {
      archiveDirectory(logRoot, runId)
      runDirectories += 1
    }

    if (existsSync(stateDirectory)) {
      archiveDirectory(stateRoot, runId)
      stateDirectories += 1
    }
  }

  // Standalone-mode governance cards live outside the workflow tree but are
  // just as disposable, so RUNTIME-001 retention has to reach them too or they
  // accumulate for the life of the installation.
  const sessionRoot = path.join(root, 'runtime', 'logs', 'sessions')
  const sessionIds = activeWorkflowDirectoryNames(sessionRoot).filter(
    (sessionId) => {
      const createdAt = currentRunDate(sessionId)

      return createdAt !== null && createdAt.getTime() < cutoff.getTime()
    },
  )
  let sessionDirectories = 0

  for (const sessionId of sessionIds) {
    const sessionDirectory = path.join(sessionRoot, sessionId)

    updatedFiles += updateFileCount(
      listFiles(sessionDirectory),
      new Map([
        [
          `runtime/logs/sessions/${sessionId}`,
          `runtime/logs/sessions/archive/${sessionId}`,
        ],
      ]),
    )
    archiveDirectory(sessionRoot, sessionId)
    sessionDirectories += 1
  }

  // Best-of-N sessions age out like workflow runs; their creation time comes
  // from session state, falling back to the temporal prefix.
  const bonRoot = path.join(root, 'runtime', 'logs', 'best-of-n')
  const bonIds = activeWorkflowDirectoryNames(bonRoot).filter((bonId) => {
    const createdAt =
      bestOfNCreatedAt(path.join(bonRoot, bonId)) ?? currentRunDate(bonId)

    invariant(
      createdAt,
      `Could not determine best-of-N creation time: ${bonId}`,
      { code: 'INVALID_WORKFLOW_ARCHIVE' },
    )

    return createdAt.getTime() < cutoff.getTime()
  })
  let bonDirectories = 0

  for (const bonId of bonIds) {
    updatedFiles += updateFileCount(
      listFiles(path.join(bonRoot, bonId)),
      new Map([
        [
          `runtime/logs/best-of-n/${bonId}`,
          `runtime/logs/best-of-n/archive/${bonId}`,
        ],
      ]),
    )
    archiveDirectory(bonRoot, bonId)
    bonDirectories += 1
  }

  // Inbox requests and PR descriptions are copied into run directories when
  // consumed, so the originals age out on the same retention window. Their
  // standardized temporal prefix is the age authority.
  const archivedFiles = new Map<string, string[]>()
  const fileMappings = new Map<string, string>()

  for (const parentRelative of TEMPORAL_FILE_DIRECTORIES) {
    const parent = path.join(root, parentRelative)
    const names: string[] = []

    archivedFiles.set(parentRelative, names)

    if (!existsSync(parent)) {
      continue
    }

    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue
      }

      const createdAt = temporalFileDate(entry.name)

      if (!createdAt || createdAt.getTime() >= cutoff.getTime()) {
        continue
      }

      const archiveRoot = path.join(parent, 'archive')
      const target = path.join(archiveRoot, entry.name)

      invariant(
        !existsSync(target),
        `Archive target already exists: ${target}`,
        { code: 'ARCHIVE_COLLISION' },
      )
      mkdirSync(archiveRoot, { recursive: true })
      renameSync(path.join(parent, entry.name), target)
      fileMappings.set(
        `${parentRelative}/${entry.name}`,
        `${parentRelative}/archive/${entry.name}`,
      )
      names.push(entry.name)
    }
  }

  if (fileMappings.size > 0) {
    updatedFiles += updateFileCount(
      mutableRuntimeFiles(path.join(root, 'runtime')),
      fileMappings,
    )
  }

  return {
    retention_days: retentionDays,
    cutoff: cutoff.toISOString(),
    run_directories: runDirectories,
    state_directories: stateDirectories,
    session_directories: sessionDirectories,
    best_of_n_directories: bonDirectories,
    updated_files: updatedFiles,
    run_ids: runIds,
    session_ids: sessionIds,
    bon_ids: bonIds,
    inbox_files: archivedFiles.get('runtime/inbox') ?? [],
    pr_description_files: archivedFiles.get('runtime/pr-descriptions') ?? [],
  }
}

export function maintainWorkflowRuntime(
  root = findProjectRoot(),
  options: { retentionDays?: number; now?: Date } = {},
): WorkflowRuntimeMaintenanceSummary {
  return {
    names: standardizeRuntimeFileNames(root),
    migration: migrateWorkflowNames(root),
    suffixes: migrateRunSuffixes(root),
    archive: archiveWorkflowDirectories(root, options),
  }
}
