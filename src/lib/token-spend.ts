import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  fetchCursorDashboardUsageEvents,
  fetchCursorUsageEvents,
  resolveCursorUsageCredential,
  type CursorUsageEvent,
  type CursorUsageEventsResult,
} from './cursor-usage.js'
import { invariant } from './errors.js'
import { fileExists, isDirectory, isRecord, readJson } from './io.js'
import { readProjectConfig, registeredInstallations } from './project-config.js'
import { resolveRunLayout } from './run-layout.js'

const DAY_MS = 24 * 60 * 60 * 1_000
const DEFAULT_REPORT_DAYS = 14
const MAX_REPORT_DAYS = 365
const MAX_SLICE_ROWS = 10
const COMMAND_MARKER_PATTERN = /---\s*Cursor Command:\s*([A-Za-z0-9-]+)\s*---/u
const SLASH_COMMAND_PATTERN = /^\/(pan-[a-z0-9-]+)\b/mu
const TIMESTAMP_PATTERN = /<timestamp>([^<]+)<\/timestamp>/u

export interface SpendMetrics {
  events: number
  request_units: number
  input_tokens: number
  output_tokens: number
  cache_write_tokens: number
  cache_read_tokens: number
  total_tokens: number
  cost_cents: number
}

export interface SpendSliceRow {
  key: string
  metrics: SpendMetrics
}

export interface ToolSpendSliceRow extends SpendSliceRow {
  call_count: number
}

export interface SpendCoverage {
  known_events: number
  total_events: number
  known_tokens: number
  total_tokens: number
  known_token_percent: number | null
}

export interface DailySpendPoint extends SpendMetrics {
  date: string
}

export interface TokenSpendReport {
  schema_version: 2
  generated_at: string
  period: {
    days: number
    start: string
    end: string
    timezone: 'UTC'
    source: CursorUsageEventsResult['source']
    cost_basis: 'charged' | 'model-cost'
    pages_fetched: number
  }
  attribution_sources: {
    workspaces_scanned: number
    embedded_installations_scanned: number
  }
  totals: SpendMetrics
  token_categories: {
    input: number
    output: number
    cache_write: number
    cache_read: number
    cached: number
  }
  daily: DailySpendPoint[]
  slices: {
    commands: SpendSliceRow[]
    persona_models: SpendSliceRow[]
    tools: ToolSpendSliceRow[]
    fast_mode: SpendSliceRow[]
    governance: SpendSliceRow[]
    workflow_role: SpendSliceRow[]
    stages: SpendSliceRow[]
    remediation: SpendSliceRow[]
  }
  coverage: {
    command: SpendCoverage
    persona: SpendCoverage
    tools: SpendCoverage
    fast_mode: SpendCoverage
    governance: SpendCoverage
    workflow_role: SpendCoverage
    stage: SpendCoverage
    remediation: SpendCoverage
  }
  warnings: string[]
}

export interface GenerateTokenSpendReportOptions {
  days?: number
  apiKey?: string
  sessionToken?: string
  now?: Date
  fetchImpl?: typeof fetch
  endpoint?: string
  aggregatesEndpoint?: string
  transcriptsRoot?: string | null
  cursorProjectsRoot?: string
}

/**
 * A privacy-safe attributed spend record keyed by a hashed event identity.
 * No raw Cursor identifier leaves the machine in this form.
 */
export interface SpendRecord {
  /** SHA-256 hex of [source, timestamp_ms, model, kind, max_mode, conv_id, agent_id, auto_id]. */
  key: string
  /** Usage source: 'team' for Admin API events, 'personal' for dashboard events. */
  source: 'team' | 'personal'
  timestamp_ms: number
  model: string
  metrics: SpendMetrics
  attribution: EventAttribution
  /** SHA-256 hex of matched transcript id, or null when no transcript matched. */
  conversation_key: string | null
}

export interface CollectSpendRecordsOptions {
  days?: number
  apiKey?: string
  sessionToken?: string
  now?: Date
  fetchImpl?: typeof fetch
  endpoint?: string
  aggregatesEndpoint?: string
  transcriptsRoot?: string | null
  cursorProjectsRoot?: string
}

export interface CollectSpendRecordsResult {
  records: SpendRecord[]
  /** Per-conversation_key tool counts for matched transcripts. */
  tool_calls: Map<string, Map<string, number>>
  usage: {
    source: CursorUsageEventsResult['source']
    pages_fetched: number
    aggregate_tokens: CursorUsageEventsResult['aggregate_tokens']
  }
  attribution_sources: {
    workspaces_scanned: number
    embedded_installations_scanned: number
  }
}

export interface AggregateSpendRecordsResult {
  totals: SpendMetrics
  token_categories: TokenSpendReport['token_categories']
  daily: DailySpendPoint[]
  slices: TokenSpendReport['slices']
  coverage: TokenSpendReport['coverage']
  warnings: string[]
}

/** Compute the privacy-safe deduplication key for a Cursor usage event. */
export function spendEventKey(
  event: CursorUsageEvent,
  source: 'team' | 'personal',
): string {
  const input = JSON.stringify([
    source,
    event.timestamp_ms,
    event.model,
    event.kind,
    event.max_mode,
    event.conversation_id ?? '',
    event.cloud_agent_id ?? '',
    event.automation_id ?? '',
  ])

  return createHash('sha256').update(input).digest('hex')
}

/** Compute the SHA-256 hex key for a matched transcript id. */
export function conversationKeyFromId(id: string): string {
  return createHash('sha256').update(id).digest('hex')
}

interface TranscriptEvidence {
  id: string
  parent_id: string | null
  command: string | null
  tools: Map<string, number>
  content: string
  at_ms: number
}

interface AttributionRoot {
  harness_root: string
  workspace_root: string
  embedded: boolean
}

interface WorkflowIdentity {
  run_id: string
  persona: string
  stage: string | null
  role: 'supervisor' | 'stage'
  model_spec: string | null
  remedial: boolean
}

interface RunEvidence {
  run_id: string
  state: Record<string, unknown>
  current_stage: string | null
  supervisor_model: string | null
  timeline: Array<{ at_ms: number; stage: string | null }>
}

interface RunStorage {
  state: string
  events: string
  invocation: (invocationId: string) => string
}

export interface EventAttribution {
  command: string
  persona_model: string
  tools: string[]
  fast_mode: 'fast' | 'non-fast' | 'unknown'
  governance: 'governed' | 'ad hoc' | 'unattributed'
  workflow_role: 'supervisor' | 'stage' | 'unattributed'
  stage: string
  remediation: 'remedial' | 'non-remedial' | 'unattributed'
}

function emptyMetrics(): SpendMetrics {
  return {
    events: 0,
    request_units: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_write_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 0,
    cost_cents: 0,
  }
}

function eventMetrics(event: CursorUsageEvent): SpendMetrics {
  const usage = event.token_usage

  const input = usage?.input_tokens ?? 0
  const output = usage?.output_tokens ?? 0
  const cacheWrite = usage?.cache_write_tokens ?? 0
  const cacheRead = usage?.cache_read_tokens ?? 0

  return {
    events: 1,
    request_units: event.request_units,
    input_tokens: input,
    output_tokens: output,
    cache_write_tokens: cacheWrite,
    cache_read_tokens: cacheRead,
    total_tokens: input + output + cacheWrite + cacheRead,
    cost_cents: event.charged_cents,
  }
}

function addMetrics(target: SpendMetrics, addition: SpendMetrics): void {
  target.events += addition.events
  target.request_units += addition.request_units
  target.input_tokens += addition.input_tokens
  target.output_tokens += addition.output_tokens
  target.cache_write_tokens += addition.cache_write_tokens
  target.cache_read_tokens += addition.cache_read_tokens
  target.total_tokens += addition.total_tokens
  target.cost_cents += addition.cost_cents
}

function metricsMapRow(
  groups: Map<string, SpendMetrics>,
  key: string,
  metrics: SpendMetrics,
): void {
  const aggregate = groups.get(key) ?? emptyMetrics()

  addMetrics(aggregate, metrics)
  groups.set(key, aggregate)
}

function sortedRows(groups: Map<string, SpendMetrics>): SpendSliceRow[] {
  return [...groups.entries()]
    .map(([key, metrics]) => ({ key, metrics }))
    .sort(
      (left, right) =>
        right.metrics.total_tokens - left.metrics.total_tokens ||
        right.metrics.cost_cents - left.metrics.cost_cents ||
        left.key.localeCompare(right.key),
    )
}

function foldedRows(
  groups: Map<string, SpendMetrics>,
  limit = MAX_SLICE_ROWS,
): SpendSliceRow[] {
  const rows = sortedRows(groups)

  if (rows.length <= limit) {
    return rows
  }

  const retained = rows.slice(0, limit - 1)
  const other = emptyMetrics()

  for (const row of rows.slice(limit - 1)) {
    addMetrics(other, row.metrics)
  }

  return [...retained, { key: 'Other', metrics: other }]
}

function safeReadJson(absolute: string): Record<string, unknown> | null {
  try {
    const value = readJson(absolute)

    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function listRecursively(
  directory: string,
  accept: (absolute: string, entry: Dirent) => boolean,
): string[] {
  if (!isDirectory(directory)) {
    return []
  }

  const files: string[] = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...listRecursively(absolute, accept))
    } else if (entry.isFile() && accept(absolute, entry)) {
      files.push(absolute)
    }
  }

  return files
}

function cursorProjectDirectory(
  workspaceRoot: string,
  projectsRoot = path.join(os.homedir(), '.cursor', 'projects'),
): string {
  const slug = path
    .resolve(workspaceRoot)
    .split(path.sep)
    .filter(Boolean)
    .join('-')

  return path.join(projectsRoot, slug)
}

function transcriptCommand(content: string): string | null {
  const marker = COMMAND_MARKER_PATTERN.exec(content)?.[1]

  if (marker !== undefined) {
    return marker
  }

  return SLASH_COMMAND_PATTERN.exec(content)?.[1] ?? null
}

function transcriptTools(content: string): Map<string, number> {
  const tools = new Map<string, number>()

  for (const line of content.split('\n')) {
    if (line.trim().length === 0) {
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
      if (
        !isRecord(block) ||
        block.type !== 'tool_use' ||
        typeof block.name !== 'string'
      ) {
        continue
      }

      tools.set(block.name, (tools.get(block.name) ?? 0) + 1)
    }
  }

  return tools
}

function transcriptTimestamp(content: string, fallback: number): number {
  const declared = TIMESTAMP_PATTERN.exec(content)?.[1]
  const parsed = declared === undefined ? Number.NaN : Date.parse(declared)

  return Number.isFinite(parsed) ? parsed : fallback
}

function attributionRoots(root: string): AttributionRoot[] {
  const roots: AttributionRoot[] = []
  const seen = new Set<string>()
  const add = (harnessRoot: string, embedded: boolean): void => {
    const absoluteHarness = path.resolve(harnessRoot)

    if (seen.has(absoluteHarness)) {
      return
    }

    let config: ReturnType<typeof readProjectConfig>

    try {
      config = readProjectConfig(absoluteHarness)
    } catch {
      return
    }

    if (config === null) {
      return
    }

    const workspaceRoot = path.resolve(
      absoluteHarness,
      config.workspace_root ?? '.',
    )

    roots.push({
      harness_root: absoluteHarness,
      workspace_root: workspaceRoot,
      embedded,
    })
    seen.add(absoluteHarness)
  }

  const current = readProjectConfig(root)

  add(root, current?.installation_mode === 'embedded')

  if (current?.installation_mode === 'self_development') {
    for (const installation of registeredInstallations(root)) {
      let config: ReturnType<typeof readProjectConfig>

      try {
        config = readProjectConfig(installation.path)
      } catch {
        continue
      }

      if (config?.installation_mode === 'embedded') {
        add(installation.path, true)
      }
    }
  }

  return roots
}

function readTranscripts(
  roots: AttributionRoot[],
  windowStartMs: number,
  override: string | null | undefined,
  projectsRoot?: string,
): Map<string, TranscriptEvidence> {
  const transcripts = new Map<string, TranscriptEvidence>()
  const transcriptRoots =
    override === undefined
      ? roots.map((item) =>
          path.join(
            cursorProjectDirectory(item.workspace_root, projectsRoot),
            'agent-transcripts',
          ),
        )
      : override === null
        ? []
        : [override]

  for (const transcriptsRoot of new Set(transcriptRoots)) {
    for (const absolute of listRecursively(transcriptsRoot, (file) =>
      file.endsWith('.jsonl'),
    )) {
      let stat: ReturnType<typeof statSync>

      try {
        stat = statSync(absolute)
      } catch {
        continue
      }

      if (stat.mtimeMs < windowStartMs) {
        continue
      }

      let content: string

      try {
        content = readFileSync(absolute, 'utf8')
      } catch {
        continue
      }

      const id = path.basename(absolute, '.jsonl')
      const relative = path.relative(transcriptsRoot, absolute)
      const segments = relative.split(path.sep)
      const parentId =
        segments.length >= 3 && segments.at(-2) === 'subagents'
          ? (segments.at(-3) ?? null)
          : null

      transcripts.set(id, {
        id,
        parent_id: parentId,
        command: transcriptCommand(content),
        tools: transcriptTools(content),
        content,
        at_ms: transcriptTimestamp(content, stat.mtimeMs),
      })
    }
  }

  for (const transcript of transcripts.values()) {
    if (transcript.command !== null || transcript.parent_id === null) {
      continue
    }

    transcript.command = transcripts.get(transcript.parent_id)?.command ?? null
  }

  return transcripts
}

function runDirectories(root: string): string[] {
  const roots = [
    path.join(root, 'runtime', 'logs', 'workflows'),
    path.join(root, 'runtime', 'workflows'),
  ]
  const directories: string[] = []

  for (const base of roots) {
    if (!isDirectory(base)) {
      continue
    }

    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }

      if (entry.name === 'archive') {
        directories.push(
          ...readdirSync(path.join(base, entry.name), { withFileTypes: true })
            .filter((child) => child.isDirectory())
            .map((child) => path.join(base, entry.name, child.name)),
        )
      } else {
        directories.push(path.join(base, entry.name))
      }
    }
  }

  return directories
}

function eventTimeline(absolute: string): Array<{
  at_ms: number
  stage: string | null
}> {
  if (!fileExists(absolute)) {
    return []
  }

  const timeline: Array<{ at_ms: number; stage: string | null }> = []
  let content: string

  try {
    content = readFileSync(absolute, 'utf8')
  } catch {
    return []
  }

  for (const line of content.split('\n')) {
    if (line.trim().length === 0) {
      continue
    }

    let value: unknown

    try {
      value = JSON.parse(line)
    } catch {
      continue
    }

    if (!isRecord(value) || typeof value.timestamp !== 'string') {
      continue
    }

    const atMs = Date.parse(value.timestamp)

    if (!Number.isFinite(atMs)) {
      continue
    }

    const stateAfter = isRecord(value.state_after) ? value.state_after : null
    const stage =
      typeof value.stage === 'string'
        ? value.stage
        : typeof stateAfter?.current_stage === 'string'
          ? stateAfter.current_stage
          : null

    timeline.push({ at_ms: atMs, stage })
  }

  return timeline.sort((left, right) => left.at_ms - right.at_ms)
}

function runStorage(
  root: string,
  directory: string,
  runId: string,
): RunStorage {
  const canonical = resolveRunLayout(root, runId)

  if (fileExists(canonical.state.absolute)) {
    return {
      state: canonical.state.absolute,
      events: canonical.events.absolute,
      invocation: (invocationId) =>
        canonical.invocation(invocationId, '.json').absolute,
    }
  }

  const agentDirectory = fileExists(path.join(directory, 'agent', 'state.json'))
    ? path.join(directory, 'agent')
    : directory

  return {
    state: path.join(agentDirectory, 'state.json'),
    events: path.join(agentDirectory, 'events.jsonl'),
    invocation: (invocationId) =>
      path.join(agentDirectory, 'invocations', `${invocationId}.json`),
  }
}

function readWorkflowEvidence(root: string): {
  runs: RunEvidence[]
  workers: Map<string, WorkflowIdentity>
} {
  const runs: RunEvidence[] = []
  const workers = new Map<string, WorkflowIdentity>()

  for (const directory of runDirectories(root)) {
    const runId = path.basename(directory)
    const storage = runStorage(root, directory, runId)
    const state = safeReadJson(storage.state)

    if (state === null) {
      continue
    }

    const modelEvidence = Array.isArray(state.model_evidence)
      ? state.model_evidence
      : []
    const supervisor = modelEvidence.find(
      (item) => isRecord(item) && item.role === 'supervisor',
    )
    const supervisorModel =
      isRecord(supervisor) && typeof supervisor.effective_model === 'string'
        ? supervisor.effective_model
        : null

    runs.push({
      run_id: runId,
      state,
      current_stage:
        typeof state.current_stage === 'string' ? state.current_stage : null,
      supervisor_model: supervisorModel,
      timeline: eventTimeline(storage.events),
    })

    const delegated = Array.isArray(state.delegated_workers)
      ? state.delegated_workers
      : []

    for (const worker of delegated) {
      if (
        !isRecord(worker) ||
        typeof worker.handle !== 'string' ||
        typeof worker.invocation_id !== 'string'
      ) {
        continue
      }

      const invocation = safeReadJson(storage.invocation(worker.invocation_id))

      if (invocation === null || !isRecord(invocation.stage)) {
        continue
      }

      const stage = invocation.stage
      const evidenceWorkers = Array.isArray(invocation.evidence_workers)
        ? invocation.evidence_workers
        : []
      const evidenceWorker = evidenceWorkers.find(
        (item) =>
          isRecord(item) &&
          typeof worker.role === 'string' &&
          item.role === worker.role,
      )

      const persona =
        isRecord(evidenceWorker) && typeof evidenceWorker.persona === 'string'
          ? evidenceWorker.persona
          : typeof stage.persona === 'string'
            ? stage.persona
            : 'unknown'
      const modelSpec =
        isRecord(evidenceWorker) && typeof evidenceWorker.model === 'string'
          ? evidenceWorker.model
          : typeof stage.model === 'string'
            ? stage.model
            : null

      const inputs = isRecord(invocation.inputs) ? invocation.inputs : null
      const stageSlug = typeof stage.slug === 'string' ? stage.slug : 'unknown'

      workers.set(worker.handle, {
        run_id: runId,
        persona,
        stage: stageSlug,
        role: 'stage',
        model_spec: modelSpec,
        remedial:
          stageSlug === 'remediate' ||
          (inputs !== null && isRecord(inputs.remediation_return)),
      })
    }
  }

  return { runs, workers }
}

function stageAt(run: RunEvidence, atMs: number): string | null {
  let stage = run.current_stage

  for (const point of run.timeline) {
    if (point.at_ms > atMs) {
      break
    }

    if (point.stage !== null) {
      stage = point.stage
    }
  }

  return stage
}

function supervisorIdentity(
  transcript: TranscriptEvidence,
  runs: RunEvidence[],
  atMs: number,
): WorkflowIdentity | null {
  const matched = runs.filter((run) => transcript.content.includes(run.run_id))

  if (matched.length === 0) {
    return null
  }

  const run = matched.at(-1) as RunEvidence
  const stage = stageAt(run, atMs)

  return {
    run_id: run.run_id,
    persona: 'orchestrator',
    stage,
    role: 'supervisor',
    model_spec: run.supervisor_model,
    remedial: stage === 'remediate',
  }
}

function fastMode(modelSpec: string | null): EventAttribution['fast_mode'] {
  if (modelSpec === null) {
    return 'unknown'
  }

  if (/\bfast=true\b/u.test(modelSpec)) {
    return 'fast'
  }

  if (/\bfast=false\b/u.test(modelSpec)) {
    return 'non-fast'
  }

  return 'unknown'
}

function attributionForEvent(
  event: CursorUsageEvent,
  transcripts: Map<string, TranscriptEvidence>,
  runs: RunEvidence[],
  workers: Map<string, WorkflowIdentity>,
): EventAttribution {
  const transcript =
    (event.conversation_id === null
      ? undefined
      : transcripts.get(event.conversation_id)) ??
    (event.cloud_agent_id === null
      ? undefined
      : transcripts.get(event.cloud_agent_id))
  const worker =
    (event.conversation_id === null
      ? undefined
      : workers.get(event.conversation_id)) ??
    (event.cloud_agent_id === null
      ? undefined
      : workers.get(event.cloud_agent_id))
  const identity =
    worker ??
    (transcript === undefined
      ? null
      : supervisorIdentity(transcript, runs, event.timestamp_ms))

  const command = transcript?.command ?? 'Unattributed'
  const persona = identity?.persona ?? 'Unattributed'

  return {
    command,
    persona_model:
      identity === null
        ? `Unattributed · ${event.model}`
        : `${persona} · ${event.model}`,
    tools: transcript === undefined ? [] : [...transcript.tools.keys()],
    fast_mode: fastMode(identity?.model_spec ?? null),
    governance:
      identity !== null || transcript?.command !== null
        ? 'governed'
        : transcript === undefined
          ? 'unattributed'
          : 'ad hoc',
    workflow_role: identity?.role ?? 'unattributed',
    stage: identity?.stage ?? 'Unattributed',
    remediation:
      identity === null
        ? 'unattributed'
        : identity.remedial
          ? 'remedial'
          : 'non-remedial',
  }
}

function coverage(
  events: CursorUsageEvent[],
  known: (attribution: EventAttribution) => boolean,
  attributions: EventAttribution[],
): SpendCoverage {
  const totalTokens = events.reduce(
    (total, event) => total + eventMetrics(event).total_tokens,
    0,
  )
  let knownEvents = 0
  let knownTokens = 0

  attributions.forEach((attribution, index) => {
    if (!known(attribution)) {
      return
    }

    knownEvents += 1
    knownTokens += eventMetrics(events[index] as CursorUsageEvent).total_tokens
  })

  return {
    known_events: knownEvents,
    total_events: events.length,
    known_tokens: knownTokens,
    total_tokens: totalTokens,
    known_token_percent:
      totalTokens === 0 ? null : (knownTokens / totalTokens) * 100,
  }
}

function reportDays(value: number | undefined): number {
  const days = value ?? DEFAULT_REPORT_DAYS

  invariant(
    Number.isInteger(days) && days >= 1 && days <= MAX_REPORT_DAYS,
    `--days MUST be an integer from 1 to ${MAX_REPORT_DAYS}.`,
    { code: 'INVALID_ARGUMENT' },
  )

  return days
}

function roundedMetrics(metrics: SpendMetrics): SpendMetrics {
  return {
    ...metrics,
    request_units: Number(metrics.request_units.toFixed(4)),
    cost_cents: Number(metrics.cost_cents.toFixed(6)),
  }
}

function roundRows(rows: SpendSliceRow[]): SpendSliceRow[] {
  return rows.map((row) => ({
    ...row,
    metrics: roundedMetrics(row.metrics),
  }))
}

/**
 * Fetch, correlate, and return attributed spend records without aggregating.
 * The records are privacy-safe: all identifiers are replaced with SHA-256 hex keys.
 */
export async function collectSpendRecords(
  root: string,
  options: CollectSpendRecordsOptions = {},
): Promise<CollectSpendRecordsResult> {
  const days = reportDays(options.days)
  const now = options.now ?? new Date()
  const endDateMs = now.getTime()
  const startDateMs = endDateMs - days * DAY_MS

  const requestOptions = {
    startDateMs,
    endDateMs,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  }
  let usage: CursorUsageEventsResult

  if (options.sessionToken !== undefined) {
    usage = await fetchCursorDashboardUsageEvents({
      ...requestOptions,
      sessionToken: options.sessionToken,
      ...(options.endpoint ? { eventsEndpoint: options.endpoint } : {}),
      ...(options.aggregatesEndpoint
        ? { aggregatesEndpoint: options.aggregatesEndpoint }
        : {}),
    })
  } else if (options.apiKey !== undefined) {
    usage = await fetchCursorUsageEvents({
      ...requestOptions,
      apiKey: options.apiKey,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    })
  } else {
    const credential = resolveCursorUsageCredential(root)

    usage =
      credential.kind === 'dashboard-session'
        ? await fetchCursorDashboardUsageEvents({
            ...requestOptions,
            sessionToken: credential.value,
          })
        : await fetchCursorUsageEvents({
            ...requestOptions,
            apiKey: credential.value,
          })
  }

  const source: 'team' | 'personal' =
    usage.source === 'Cursor Admin API /teams/filtered-usage-events'
      ? 'team'
      : 'personal'

  const roots = attributionRoots(root)
  const transcripts = readTranscripts(
    roots,
    startDateMs,
    options.transcriptsRoot,
    options.cursorProjectsRoot,
  )
  const workflowRoots =
    options.transcriptsRoot === undefined
      ? roots.map((item) => item.harness_root)
      : [root]
  const workflow = workflowRoots.reduce(
    (aggregate, harnessRoot) => {
      const evidence = readWorkflowEvidence(harnessRoot)

      aggregate.runs.push(...evidence.runs)

      for (const [handle, identity] of evidence.workers) {
        aggregate.workers.set(handle, identity)
      }

      return aggregate
    },
    {
      runs: [] as RunEvidence[],
      workers: new Map<string, WorkflowIdentity>(),
    },
  )

  const records: SpendRecord[] = []
  const tool_calls = new Map<string, Map<string, number>>()

  for (const event of usage.events) {
    const attribution = attributionForEvent(
      event,
      transcripts,
      workflow.runs,
      workflow.workers,
    )
    const key = spendEventKey(event, source)

    const rawTranscriptId =
      event.conversation_id !== null && transcripts.has(event.conversation_id)
        ? event.conversation_id
        : event.cloud_agent_id !== null && transcripts.has(event.cloud_agent_id)
          ? event.cloud_agent_id
          : null

    const conversation_key =
      rawTranscriptId === null ? null : conversationKeyFromId(rawTranscriptId)

    records.push({
      key,
      source,
      timestamp_ms: event.timestamp_ms,
      model: event.model,
      metrics: eventMetrics(event),
      attribution,
      conversation_key,
    })

    if (rawTranscriptId !== null && conversation_key !== null) {
      const transcriptTools =
        transcripts.get(rawTranscriptId)?.tools ?? new Map<string, number>()

      const existing =
        tool_calls.get(conversation_key) ?? new Map<string, number>()

      for (const [tool, count] of transcriptTools) {
        existing.set(tool, (existing.get(tool) ?? 0) + count)
      }

      tool_calls.set(conversation_key, existing)
    }
  }

  return {
    records,
    tool_calls,
    usage: {
      source: usage.source,
      pages_fetched: usage.pages_fetched,
      aggregate_tokens: usage.aggregate_tokens,
    },
    attribution_sources: {
      workspaces_scanned: roots.length,
      embedded_installations_scanned: roots.filter((item) => item.embedded)
        .length,
    },
  }
}

/**
 * Aggregate spend records into totals, daily series, slices, and coverage.
 * Does not apply the `aggregate_tokens` override; `generateTokenSpendReport`
 * applies that after collecting records.
 */
export function aggregateSpendRecords(
  records: SpendRecord[],
  tool_calls: Map<string, Map<string, number>>,
): AggregateSpendRecordsResult {
  const totals = emptyMetrics()
  const daily = new Map<string, SpendMetrics>()
  const commands = new Map<string, SpendMetrics>()
  const personaModels = new Map<string, SpendMetrics>()
  const toolMetrics = new Map<string, SpendMetrics>()
  const fastModes = new Map<string, SpendMetrics>()
  const governance = new Map<string, SpendMetrics>()
  const roles = new Map<string, SpendMetrics>()
  const stages = new Map<string, SpendMetrics>()
  const remediation = new Map<string, SpendMetrics>()

  const syntheticEvents: CursorUsageEvent[] = []
  const syntheticAttributions: EventAttribution[] = []

  for (const record of records) {
    const { metrics, attribution } = record
    const date = new Date(record.timestamp_ms).toISOString().slice(0, 10)

    addMetrics(totals, metrics)
    metricsMapRow(daily, date, metrics)
    metricsMapRow(commands, attribution.command, metrics)
    metricsMapRow(personaModels, attribution.persona_model, metrics)
    metricsMapRow(fastModes, attribution.fast_mode, metrics)
    metricsMapRow(governance, attribution.governance, metrics)
    metricsMapRow(roles, attribution.workflow_role, metrics)
    metricsMapRow(stages, attribution.stage, metrics)
    metricsMapRow(remediation, attribution.remediation, metrics)

    for (const tool of attribution.tools) {
      metricsMapRow(toolMetrics, tool, metrics)
    }

    // Build synthetic event/attribution arrays for coverage computation.
    syntheticEvents.push({
      timestamp_ms: record.timestamp_ms,
      model: record.model,
      kind: 'unknown',
      max_mode: false,
      request_units: metrics.request_units,
      token_based: true,
      chargeable: true,
      headless: false,
      conversation_id: null,
      cloud_agent_id: null,
      automation_id: null,
      token_usage: {
        input_tokens: metrics.input_tokens,
        output_tokens: metrics.output_tokens,
        cache_write_tokens: metrics.cache_write_tokens,
        cache_read_tokens: metrics.cache_read_tokens,
        model_cost_cents: metrics.cost_cents,
      },
      charged_cents: metrics.cost_cents,
      cursor_token_fee_cents: 0,
    })
    syntheticAttributions.push(attribution)
  }

  // Build per-conversation_key tool call counts.
  const flatToolCalls = new Map<string, number>()

  for (const [, toolMap] of tool_calls) {
    for (const [tool, count] of toolMap) {
      flatToolCalls.set(tool, (flatToolCalls.get(tool) ?? 0) + count)
    }
  }

  const sortedToolRows = sortedRows(toolMetrics)
  const visibleToolRows =
    sortedToolRows.length <= MAX_SLICE_ROWS
      ? sortedToolRows
      : [
          ...sortedToolRows.slice(0, MAX_SLICE_ROWS - 1),
          {
            key: 'Other',
            metrics: sortedToolRows
              .slice(MAX_SLICE_ROWS - 1)
              .reduce((m, row) => {
                addMetrics(m, row.metrics)

                return m
              }, emptyMetrics()),
          },
        ]
  const retainedTools = new Set(
    visibleToolRows.filter((row) => row.key !== 'Other').map((row) => row.key),
  )
  const tools = visibleToolRows.map((row) => ({
    ...row,
    metrics: roundedMetrics(row.metrics),
    call_count:
      row.key === 'Other'
        ? [...flatToolCalls.entries()]
            .filter(([tool]) => !retainedTools.has(tool))
            .reduce((total, [, count]) => total + count, 0)
        : (flatToolCalls.get(row.key) ?? 0),
  }))

  const dailyPoints = [...daily.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, metrics]) => ({ date, ...roundedMetrics(metrics) }))

  return {
    totals: roundedMetrics(totals),
    token_categories: {
      input: totals.input_tokens,
      output: totals.output_tokens,
      cache_write: totals.cache_write_tokens,
      cache_read: totals.cache_read_tokens,
      cached: totals.cache_write_tokens + totals.cache_read_tokens,
    },
    daily: dailyPoints,
    slices: {
      commands: roundRows(foldedRows(commands)),
      persona_models: roundRows(foldedRows(personaModels)),
      tools,
      fast_mode: roundRows(foldedRows(fastModes)),
      governance: roundRows(foldedRows(governance)),
      workflow_role: roundRows(foldedRows(roles)),
      stages: roundRows(foldedRows(stages)),
      remediation: roundRows(foldedRows(remediation)),
    },
    coverage: {
      command: coverage(
        syntheticEvents,
        (item) => item.command !== 'Unattributed',
        syntheticAttributions,
      ),
      persona: coverage(
        syntheticEvents,
        (item) => !item.persona_model.startsWith('Unattributed ·'),
        syntheticAttributions,
      ),
      tools: coverage(
        syntheticEvents,
        (item) => item.tools.length > 0,
        syntheticAttributions,
      ),
      fast_mode: coverage(
        syntheticEvents,
        (item) => item.fast_mode !== 'unknown',
        syntheticAttributions,
      ),
      governance: coverage(
        syntheticEvents,
        (item) => item.governance !== 'unattributed',
        syntheticAttributions,
      ),
      workflow_role: coverage(
        syntheticEvents,
        (item) => item.workflow_role !== 'unattributed',
        syntheticAttributions,
      ),
      stage: coverage(
        syntheticEvents,
        (item) => item.stage !== 'Unattributed',
        syntheticAttributions,
      ),
      remediation: coverage(
        syntheticEvents,
        (item) => item.remediation !== 'unattributed',
        syntheticAttributions,
      ),
    },
    warnings: [
      'Cursor does not meter tokens per tool. Tool token totals overlap when a conversation used more than one tool.',
      'Cursor usage events do not expose Fast mode. Fast attribution uses exact fast=true or fast=false model declarations and leaves all other events unknown.',
    ],
  }
}

/** Fetch, correlate, and aggregate a compact token spend report. */
export async function generateTokenSpendReport(
  root: string,
  options: GenerateTokenSpendReportOptions = {},
): Promise<TokenSpendReport> {
  const days = reportDays(options.days)
  const now = options.now ?? new Date()

  const collected = await collectSpendRecords(root, { ...options, days, now })
  const aggregated = aggregateSpendRecords(
    collected.records,
    collected.tool_calls,
  )

  // Apply the aggregate_tokens override for personal spend (C-1: keep existing behavior).
  if (collected.usage.aggregate_tokens !== null) {
    const agg = collected.usage.aggregate_tokens

    aggregated.totals.input_tokens = agg.input_tokens
    aggregated.totals.output_tokens = agg.output_tokens
    aggregated.totals.cache_write_tokens = agg.cache_write_tokens
    aggregated.totals.cache_read_tokens = agg.cache_read_tokens
    aggregated.totals.cost_cents = agg.cost_cents
    aggregated.totals.total_tokens =
      agg.input_tokens +
      agg.output_tokens +
      agg.cache_write_tokens +
      agg.cache_read_tokens
    aggregated.token_categories = {
      input: agg.input_tokens,
      output: agg.output_tokens,
      cache_write: agg.cache_write_tokens,
      cache_read: agg.cache_read_tokens,
      cached: agg.cache_write_tokens + agg.cache_read_tokens,
    }
  }

  const endDateMs = now.getTime()
  const startDateMs = endDateMs - days * DAY_MS

  return {
    schema_version: 2,
    generated_at: now.toISOString(),
    period: {
      days,
      start: new Date(startDateMs).toISOString(),
      end: now.toISOString(),
      timezone: 'UTC',
      source: collected.usage.source,
      cost_basis:
        collected.usage.aggregate_tokens === null ? 'charged' : 'model-cost',
      pages_fetched: collected.usage.pages_fetched,
    },
    attribution_sources: collected.attribution_sources,
    totals: aggregated.totals,
    token_categories: aggregated.token_categories,
    daily: aggregated.daily,
    slices: aggregated.slices,
    coverage: aggregated.coverage,
    warnings: [
      ...aggregated.warnings,
      ...(collected.usage.aggregate_tokens === null
        ? []
        : [
            'Personal event tokens and model cost use model aggregates, then reconcile to exact overall totals before time and attribution slices. These event allocations are inferred, and authoritative billed charges remain unavailable.',
          ]),
      'Unmatched usage remains unattributed; no email, conversation identifier, or raw event is included in this report.',
    ],
  }
}
