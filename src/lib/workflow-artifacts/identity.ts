import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { invariant } from '../errors.js'
import { isRecord } from '../io.js'
import { makeCompletedStageArtifactId, makeStageArtifactId } from '../naming.js'
import { resolveRunLayout } from '../run-layout.js'
import type { RunStatus } from '../types.js'

const ARTIFACT_ID_PATTERN =
  /^(?:\d{2,3}_)?([a-zA-Z][a-zA-Z0-9-]*)-(\d+)[_-]([a-zA-Z0-9]+)$/u

export const ARTIFACT_REFERENCE_PATTERN =
  /\b(?:\d{2,3}_)?[a-zA-Z][a-zA-Z0-9-]*-\d+[_-][a-zA-Z0-9]+\b/gu

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

export interface StageOccurrence {
  oldInvocationId: string
  newInvocationId: string
}

export interface FileMove {
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
export function listFiles(directory: string, exclude?: string): string[] {
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

export function agentDirectory(runDirectory: string): string {
  const candidate = path.join(runDirectory, 'agent')

  return existsSync(path.join(candidate, 'state.json'))
    ? candidate
    : runDirectory
}

export function textFileContent(filePath: string): string | null {
  const content = readFileSync(filePath)

  return content.includes(0) ? null : content.toString('utf8')
}

export function parseJsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

export function parseJsonLines(filePath: string): unknown[] {
  if (!existsSync(filePath)) {
    return []
  }

  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown)
}

export function workflowStageSlugs(runDirectory: string): Set<string> {
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

export function artifactIdentity(
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

export function deterministicUuidSuffix(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8)
}

export function normalizedUuidSuffix(identity: ArtifactIdentity): string {
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

export function collectInvocationIds(runDirectory: string): string[] {
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

export function stageOccurrences(
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

export function replacementMappings(
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

  for (const [oldInvocationId, newInvocationId] of [...mappings]) {
    mappings.set(
      `assessment-${oldInvocationId}.request.json`,
      `${newInvocationId}.assessment-request.json`,
    )
    mappings.set(
      `assessment-${oldInvocationId}.json`,
      `${newInvocationId}.assessment.json`,
    )
  }

  return mappings
}

export function replaceMappings(
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

export function replaceStringsInValue(
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

export function rewriteRunStateValue(
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

export function rewriteStructuredFiles(
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

export function toRepoRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/')
}
