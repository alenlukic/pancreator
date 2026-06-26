import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { invariant } from './errors.js'
import { isRecord, writeJsonAtomic } from './io.js'
import { makeCompletedStageArtifactId, makeStageArtifactId } from './naming.js'
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

export function artifactJsonPath(runId: string, artifactId: string): string {
  return `runtime/logs/workflows/${runId}/artifacts/json/${artifactId}.json`
}

export function artifactMarkdownPath(
  runId: string,
  artifactId: string,
): string {
  return `runtime/logs/workflows/${runId}/artifacts/markdown/${artifactId}.md`
}

export function artifactRecordMarkdownPath(
  runId: string,
  artifactId: string,
): string {
  return (
    `runtime/logs/workflows/${runId}/artifacts/markdown/` +
    `${artifactId}.record.md`
  )
}

export function isClosedRunStatus(status: RunStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled'
}

function listFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return []
  }

  const files: string[] = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...listFiles(absolute))
    } else if (entry.isFile()) {
      files.push(absolute)
    }
  }

  return files
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
  const snapshotPath = path.join(runDirectory, 'workflow.snapshot.json')

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

  const eventsPath = path.join(runDirectory, 'events.jsonl')

  for (const event of parseJsonLines(eventsPath)) {
    if (isRecord(event) && typeof event.stage === 'string') {
      stageSlugs.add(event.stage)
    }
  }

  const invocationDirectory = path.join(runDirectory, 'invocations')

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
  const eventsPath = path.join(runDirectory, 'events.jsonl')

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
  const invocationDirectory = path.join(runDirectory, 'invocations')
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
  const statePath = path.join(runDirectory, 'state.json')

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
  const stateFile = path.join(runDirectory, 'state.json')

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

  const eventsFile = path.join(runDirectory, 'events.jsonl')

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

function layoutMoves(root: string, runDirectory: string): FileMove[] {
  const artifactRoot = path.join(runDirectory, 'artifacts')
  const recordsRoot = path.join(runDirectory, 'records')
  const moves: FileMove[] = []

  for (const source of listFiles(recordsRoot)) {
    const name = path.basename(source)
    const extension = path.extname(name)
    let target: string

    if (extension === '.json') {
      target = path.join(artifactRoot, 'json', name)
    } else if (extension === '.md') {
      const stem = name.slice(0, -extension.length)

      target = path.join(artifactRoot, 'markdown', `${stem}.record.md`)
    } else {
      invariant(false, `Unsupported record artifact: ${source}`, {
        code: 'UNSUPPORTED_RECORD_ARTIFACT',
      })
    }

    moves.push({
      source,
      target,
      sourceRelative: toRepoRelative(root, source),
      targetRelative: toRepoRelative(root, target),
    })
  }

  if (existsSync(artifactRoot)) {
    for (const entry of readdirSync(artifactRoot, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        (entry.name === 'json' || entry.name === 'markdown')
      ) {
        continue
      }

      const sourceRoot = path.join(artifactRoot, entry.name)
      const files = entry.isDirectory() ? listFiles(sourceRoot) : [sourceRoot]

      for (const source of files) {
        const relative = path.relative(artifactRoot, source)
        const targetDirectory = source.endsWith('.json') ? 'json' : 'markdown'
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

  return moves
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

function consolidateArtifactLayout(
  root: string,
  runDirectory: string,
): { moved: number; mappings: Map<string, string> } {
  const artifactRoot = path.join(runDirectory, 'artifacts')

  mkdirSync(path.join(artifactRoot, 'json'), { recursive: true })
  mkdirSync(path.join(artifactRoot, 'markdown'), { recursive: true })

  const moves = layoutMoves(root, runDirectory)

  applyLayoutMoves(moves)
  rmSync(path.join(runDirectory, 'records'), { recursive: true, force: true })

  for (const entry of readdirSync(artifactRoot, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      entry.name !== 'json' &&
      entry.name !== 'markdown'
    ) {
      rmSync(path.join(artifactRoot, entry.name), {
        recursive: true,
        force: true,
      })
    }
  }

  return {
    moved: moves.length,
    mappings: new Map(
      moves.map((move) => [move.sourceRelative, move.targetRelative]),
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
  updateFiles(listFiles(runDirectory), mappings, updatedFiles)
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
    writeJsonAtomic(path.join(runDirectory, 'state.json'), state)
  }

  return {
    artifact_files: artifactFiles,
    layout_files: layout.moved,
    updated_files: updatedFiles.size,
  }
}
