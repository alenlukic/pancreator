import { spawn } from 'node:child_process'
import {
  closeSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { isNodeError, PanError } from './errors.js'
import { runCursorAgentSession } from './executors/cursor-agent.js'
import { gitWorkspaceSnapshot } from './git.js'
import {
  appendJsonLine,
  ensureDir,
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  withOperationMutex,
  writeJsonAtomic,
} from './io.js'
import { resolveRunLayout } from './run-layout.js'
import type {
  AgentHealth,
  AgentHealthView,
  AgentRecord,
  AgentRecoveryState,
  PersonaExecutorKind,
  RunState,
} from './types.js'

export const HYPERVISOR_INTERVAL_MS = 15 * 60 * 1000

const HYPERVISOR_DIRECTORY = path.join('runtime', 'logs', 'hypervisor')
const REGISTRY_FILE = 'registry.json'
const EVENTS_FILE = 'events.jsonl'
const PID_FILE = 'hypervisor.pid'
const LEDGER_LOCK_FILE = 'registry.lock'
const CURSOR_TRANSCRIPTS_ENV = 'PANCREATOR_CURSOR_TRANSCRIPTS_DIR'
const TRANSCRIPT_PREFIX_BYTES = 256 * 1024

export interface AgentRegistry {
  schema_version: 1
  updated_at: string
  agents: AgentRecord[]
}

export interface AgentObservation {
  agent_id: string
  parent_agent_id?: string | null
  run_id: string
  invocation_id: string
  persona: string
  executor: PersonaExecutorKind
  model?: string | null
  session_id?: string | null
  transcript_path?: string | null
  process_id?: number | null
  process_alive?: boolean | null
  last_transcript_at?: string | null
  terminal?: boolean
}

export interface RecoveryResult {
  ok: boolean
  evidence: string
  failure_signature?: string
  session_id?: string
  supported?: boolean
}

export interface AgentRecoveryRunner {
  nudge?: (agent: AgentRecord) => RecoveryResult
  resume?: (agent: AgentRecord) => RecoveryResult
  redeliver?: (agent: AgentRecord) => RecoveryResult
  reprepare?: (agent: AgentRecord) => RecoveryResult
}

export interface HypervisorTickResult {
  scanned_at: string
  agents: AgentRecord[]
  changed_agent_ids: string[]
  recovery_events: Array<{
    agent_id: string
    step: NonNullable<AgentRecoveryState['step']>
    ok: boolean
    evidence: string
  }>
}

function hypervisorPath(root: string, name: string): string {
  return path.join(root, HYPERVISOR_DIRECTORY, name)
}

export function agentRegistryPath(root: string): string {
  return hypervisorPath(root, REGISTRY_FILE)
}

export function hypervisorEventsPath(root: string): string {
  return hypervisorPath(root, EVENTS_FILE)
}

export function hypervisorPidPath(root: string): string {
  return hypervisorPath(root, PID_FILE)
}

function emptyRegistry(): AgentRegistry {
  return {
    schema_version: 1,
    updated_at: new Date(0).toISOString(),
    agents: [],
  }
}

/** Read the materialized registry. A missing registry means no observed agents. */
export function readAgentRegistry(root: string): AgentRegistry {
  const registryPath = agentRegistryPath(root)

  if (!fileExists(registryPath)) {
    return emptyRegistry()
  }

  const value = readJson(registryPath)

  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    typeof value.updated_at !== 'string' ||
    !Array.isArray(value.agents)
  ) {
    throw new PanError(`Invalid hypervisor registry: ${registryPath}`, {
      code: 'INVALID_HYPERVISOR_REGISTRY',
    })
  }

  return value as unknown as AgentRegistry
}

function initialRecoveryState(): AgentRecoveryState {
  return {
    attempts: 0,
    consecutive_failures: 0,
    quarantined: false,
  }
}

/** Register the agent expected to execute one prepared invocation. */
export function registerPreparedInvocation(
  root: string,
  input: {
    run_id: string
    invocation_id: string
    persona: string
    executor: PersonaExecutorKind
    model: string | null
  },
  registeredAt = new Date().toISOString(),
): AgentRecord {
  return withOperationMutex(
    hypervisorPath(root, LEDGER_LOCK_FILE),
    (): AgentRecord => {
      const registry = readAgentRegistry(root)
      const agentId = `${input.run_id}:${input.invocation_id}`
      const existing = registry.agents.find(
        (agent) => agent.agent_id === agentId,
      )
      const agent: AgentRecord = existing ?? {
        agent_id: agentId,
        parent_agent_id: null,
        run_id: input.run_id,
        invocation_id: input.invocation_id,
        persona: input.persona,
        executor: input.executor,
        model: input.model,
        session_id: null,
        transcript_path: null,
        process_id: null,
        process_alive: null,
        discovered_at: registeredAt,
        last_observed_at: registeredAt,
        last_transcript_at: null,
        consecutive_unchanged_scans: 0,
        health: 'unknown',
        health_evidence: [
          'The invocation is prepared, but execution evidence is not available.',
        ],
        recovery: initialRecoveryState(),
      }
      const agents = existing
        ? registry.agents
        : [...registry.agents, agent].sort((left, right) =>
            left.agent_id.localeCompare(right.agent_id),
          )

      writeJsonAtomic(agentRegistryPath(root), {
        schema_version: 1,
        updated_at: registeredAt,
        agents,
      } satisfies AgentRegistry)

      if (!existing) {
        appendJsonLine(hypervisorEventsPath(root), {
          schema_version: 1,
          type: 'agent_registered',
          timestamp: registeredAt,
          agent_id: agent.agent_id,
          run_id: agent.run_id,
          invocation_id: agent.invocation_id,
        })
      }

      return agent
    },
  )
}

/** Mark a submitted invocation complete without inferring process state. */
export function completeInvocationAgent(
  root: string,
  runId: string,
  invocationId: string,
  completedAt = new Date().toISOString(),
): AgentRecord | null {
  return withOperationMutex(
    hypervisorPath(root, LEDGER_LOCK_FILE),
    (): AgentRecord | null => {
      const registry = readAgentRegistry(root)
      const index = registry.agents.findIndex(
        (agent) =>
          agent.run_id === runId && agent.invocation_id === invocationId,
      )

      if (index < 0) {
        return null
      }

      const previous = registry.agents[index] as AgentRecord
      const completed: AgentRecord = {
        ...previous,
        health: 'completed',
        health_evidence: ['The harness accepted the invocation output.'],
        last_observed_at: completedAt,
      }
      const agents = [...registry.agents]

      agents[index] = completed
      writeJsonAtomic(agentRegistryPath(root), {
        schema_version: 1,
        updated_at: completedAt,
        agents,
      } satisfies AgentRegistry)
      appendJsonLine(hypervisorEventsPath(root), {
        schema_version: 1,
        type: 'health_changed',
        timestamp: completedAt,
        agent_id: completed.agent_id,
        health: completed.health,
        evidence: completed.health_evidence,
      })

      return completed
    },
  )
}

function transcriptTime(observation: AgentObservation): number | null {
  if (!observation.last_transcript_at) {
    return null
  }

  const value = Date.parse(observation.last_transcript_at)

  return Number.isFinite(value) ? value : null
}

function classifyObservation(
  observation: AgentObservation,
  previous: AgentRecord | undefined,
): {
  health: AgentHealth
  evidence: string[]
  unchangedScans: number
} {
  if (observation.terminal) {
    return {
      health: 'completed',
      evidence: ['The run records terminal completion.'],
      unchangedScans: 0,
    }
  }

  if (observation.process_alive === false) {
    return {
      health: 'dead',
      evidence: ['Process evidence records that the agent process ended.'],
      unchangedScans: previous?.consecutive_unchanged_scans ?? 0,
    }
  }

  const currentTranscriptTime = transcriptTime(observation)
  const previousTranscriptTime = previous?.last_transcript_at
    ? Date.parse(previous.last_transcript_at)
    : null
  const transcriptAdvanced =
    currentTranscriptTime !== null &&
    (previousTranscriptTime === null ||
      !Number.isFinite(previousTranscriptTime) ||
      currentTranscriptTime > previousTranscriptTime)

  if (transcriptAdvanced || observation.process_alive === true) {
    return {
      health: 'running',
      evidence: [
        transcriptAdvanced
          ? 'The transcript advanced since the prior scan.'
          : 'Process evidence records that the agent process is alive.',
      ],
      unchangedScans: 0,
    }
  }

  if (currentTranscriptTime === null) {
    return {
      health: 'unknown',
      evidence: [
        'No transcript or process evidence can prove the agent state.',
      ],
      unchangedScans: previous?.consecutive_unchanged_scans ?? 0,
    }
  }

  const unchangedScans = (previous?.consecutive_unchanged_scans ?? 0) + 1

  if (unchangedScans >= 2) {
    return {
      health: 'stalled',
      evidence: [
        'Two consecutive scans found no transcript change or terminal evidence.',
      ],
      unchangedScans,
    }
  }

  return {
    health: 'running',
    evidence: ['One quiet scan is not enough evidence of a stall.'],
    unchangedScans,
  }
}

/** Reconcile observations without writing state, for deterministic tests. */
export function reconcileAgentRecords(
  previousAgents: AgentRecord[],
  observations: AgentObservation[],
  observedAt: string,
): AgentRecord[] {
  const previousById = new Map(
    previousAgents.map((agent) => [agent.agent_id, agent]),
  )
  const reconciled: AgentRecord[] = []

  for (const observation of observations) {
    const previous = previousById.get(observation.agent_id)
    const classification = classifyObservation(observation, previous)

    reconciled.push({
      agent_id: observation.agent_id,
      parent_agent_id: observation.parent_agent_id ?? null,
      run_id: observation.run_id,
      invocation_id: observation.invocation_id,
      persona: observation.persona,
      executor: observation.executor,
      model: observation.model ?? null,
      session_id: observation.session_id ?? null,
      transcript_path: observation.transcript_path ?? null,
      process_id: observation.process_id ?? null,
      process_alive: observation.process_alive ?? null,
      discovered_at: previous?.discovered_at ?? observedAt,
      last_observed_at: observedAt,
      last_transcript_at: observation.last_transcript_at ?? null,
      consecutive_unchanged_scans: classification.unchangedScans,
      health: classification.health,
      health_evidence: classification.evidence,
      recovery: previous?.recovery ?? initialRecoveryState(),
    })
  }

  return reconciled.sort((left, right) =>
    left.agent_id.localeCompare(right.agent_id),
  )
}

function processIsAlive(pid: number | null): boolean | null {
  if (pid === null) {
    return null
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return isNodeError(error) && error.code === 'EPERM' ? true : false
  }
}

function transcriptModifiedAt(transcriptPath: string | null): string | null {
  if (!transcriptPath || !fileExists(transcriptPath)) {
    return null
  }

  return statSync(transcriptPath).mtime.toISOString()
}

interface CursorTranscriptEvidence {
  parentAgentId: string | null
  sessionId: string
  transcriptPath: string
  modifiedAt: string
}

function cursorProjectKey(root: string): string {
  return path
    .resolve(root)
    .replace(/^[/\\]+/u, '')
    .replace(/[:/\\]+/gu, '-')
}

function cursorTranscriptsRoot(root: string): string {
  const configured = process.env[CURSOR_TRANSCRIPTS_ENV]?.trim()

  if (configured) {
    return path.resolve(configured)
  }

  return path.join(
    homedir(),
    '.cursor',
    'projects',
    cursorProjectKey(root),
    'agent-transcripts',
  )
}

function transcriptCandidates(root: string): string[] {
  const transcriptsRoot = cursorTranscriptsRoot(root)

  if (!fileExists(transcriptsRoot)) {
    return []
  }

  const candidates: string[] = []

  for (const entry of readdirSync(transcriptsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }

    const sessionDirectory = path.join(transcriptsRoot, entry.name)
    const sessionTranscript = path.join(sessionDirectory, `${entry.name}.jsonl`)

    if (fileExists(sessionTranscript)) {
      candidates.push(sessionTranscript)
    }

    const subagentsDirectory = path.join(sessionDirectory, 'subagents')

    if (!fileExists(subagentsDirectory)) {
      continue
    }

    for (const subagent of readdirSync(subagentsDirectory, {
      withFileTypes: true,
    })) {
      if (subagent.isFile() && subagent.name.endsWith('.jsonl')) {
        candidates.push(path.join(subagentsDirectory, subagent.name))
      }
    }
  }

  return candidates
}

function transcriptReferencesInvocation(
  transcriptPath: string,
  invocationId: string,
): boolean {
  const descriptor = openSync(transcriptPath, 'r')

  try {
    const buffer = Buffer.alloc(TRANSCRIPT_PREFIX_BYTES)
    const bytesRead = readSync(
      descriptor,
      buffer,
      0,
      TRANSCRIPT_PREFIX_BYTES,
      0,
    )
    const firstLine = buffer
      .subarray(0, bytesRead)
      .toString('utf8')
      .split('\n')[0]

    if (!firstLine) {
      return false
    }

    const record: unknown = JSON.parse(firstLine)

    return JSON.stringify(record).includes(invocationId)
  } catch {
    return false
  } finally {
    closeSync(descriptor)
  }
}

function cursorTranscriptEvidence(
  root: string,
  invocationId: string,
): CursorTranscriptEvidence | null {
  const matches = transcriptCandidates(root)
    .filter((candidate) =>
      transcriptReferencesInvocation(candidate, invocationId),
    )
    .map((transcriptPath) => {
      const parentDirectory = path.dirname(transcriptPath)
      const isSubagent = path.basename(parentDirectory) === 'subagents'

      return {
        parentAgentId: isSubagent
          ? path.basename(path.dirname(parentDirectory))
          : null,
        sessionId: path.basename(transcriptPath, '.jsonl'),
        transcriptPath,
        modifiedAt: statSync(transcriptPath).mtime.toISOString(),
        isSubagent,
      }
    })
    .sort((left, right) => {
      if (left.isSubagent !== right.isSubagent) {
        return left.isSubagent ? -1 : 1
      }

      return right.modifiedAt.localeCompare(left.modifiedAt)
    })
  const match = matches[0]

  if (!match) {
    return null
  }

  return {
    parentAgentId: match.parentAgentId,
    sessionId: match.sessionId,
    transcriptPath: match.transcriptPath,
    modifiedAt: match.modifiedAt,
  }
}

function discoverRunObservations(
  root: string,
  previousAgents: AgentRecord[],
): AgentObservation[] {
  const workflows = path.join(root, 'runtime', 'logs', 'workflows')

  if (!fileExists(workflows)) {
    return []
  }

  const previousByInvocation = new Map(
    previousAgents.map((agent) => [
      `${agent.run_id}:${agent.invocation_id}`,
      agent,
    ]),
  )
  const observations: AgentObservation[] = []

  for (const entry of readdirSync(workflows, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }

    const stateFile = resolveRunLayout(root, entry.name).state.absolute

    if (!fileExists(stateFile)) {
      continue
    }

    const value = readJson(stateFile)

    if (!isRecord(value)) {
      continue
    }

    const state = value as unknown as RunState
    const invocation = state.current_invocation

    if (!invocation) {
      continue
    }

    const key = `${state.run_id}:${invocation.id}`
    const previous = previousByInvocation.get(key)
    const persona =
      state.pending_action.type === 'invoke_agent'
        ? state.pending_action.persona
        : (previous?.persona ?? 'unknown')
    const recordedExternalSession = state.current_stage
      ? state.external_executor_sessions?.[state.current_stage]
      : undefined
    const externalSession =
      recordedExternalSession?.invocation_id === invocation.id
        ? recordedExternalSession
        : undefined
    const cursorTranscript = externalSession
      ? null
      : cursorTranscriptEvidence(root, invocation.id)

    observations.push({
      agent_id: previous?.agent_id ?? key,
      parent_agent_id:
        cursorTranscript?.parentAgentId ?? previous?.parent_agent_id ?? null,
      run_id: state.run_id,
      invocation_id: invocation.id,
      persona,
      executor: externalSession?.executor ?? previous?.executor ?? 'cursor',
      model: previous?.model ?? null,
      session_id:
        externalSession?.session_id ??
        cursorTranscript?.sessionId ??
        previous?.session_id ??
        null,
      transcript_path:
        cursorTranscript?.transcriptPath ?? previous?.transcript_path ?? null,
      process_id: previous?.process_id ?? null,
      process_alive: processIsAlive(previous?.process_id ?? null),
      last_transcript_at:
        cursorTranscript?.modifiedAt ??
        transcriptModifiedAt(previous?.transcript_path ?? null),
      terminal:
        state.status === 'succeeded' ||
        state.status === 'failed' ||
        state.status === 'canceled' ||
        state.pending_action.type !== 'invoke_agent',
    })
  }

  return observations
}

function normalizeFailure(result: RecoveryResult): string {
  return result.failure_signature ?? result.evidence.trim().toLowerCase()
}

function cursorRecoveryResult(
  result: ReturnType<typeof runCursorAgentSession>,
): RecoveryResult {
  return result.ok
    ? {
        ok: true,
        evidence: `Cursor agent completed recovery in ${result.duration_ms}ms.`,
        ...(result.session_id ? { session_id: result.session_id } : {}),
      }
    : {
        ok: false,
        failure_signature: [
          result.timed_out ? 'timeout' : 'exit',
          String(result.exit_code),
          result.error ?? 'unknown',
        ].join(':'),
        evidence: result.error ?? 'Cursor agent recovery failed.',
      }
}

type RedeliveryReadiness =
  | {
      ready: true
      invocation: NonNullable<RunState['current_invocation']>
    }
  | {
      ready: false
      result: RecoveryResult
    }

function redeliveryReadiness(
  root: string,
  agent: AgentRecord,
): RedeliveryReadiness {
  const statePath = resolveRunLayout(root, agent.run_id).state.absolute

  if (!fileExists(statePath)) {
    return {
      ready: false,
      result: {
        ok: false,
        supported: false,
        failure_signature: 'run-state-missing',
        evidence: 'The run state for redelivery is unavailable.',
      },
    }
  }

  const stateValue = readJson(statePath)

  if (!isRecord(stateValue)) {
    return {
      ready: false,
      result: {
        ok: false,
        supported: false,
        failure_signature: 'run-state-invalid',
        evidence: 'The run state is not a valid object.',
      },
    }
  }

  const state = stateValue as unknown as RunState
  const invocation = state.current_invocation

  if (!invocation || invocation.id !== agent.invocation_id) {
    return {
      ready: false,
      result: {
        ok: false,
        supported: false,
        failure_signature: 'invocation-changed',
        evidence: 'The run no longer expects this invocation.',
      },
    }
  }

  const invocationValue = readJson(resolveInside(root, invocation.json_path))
  const delegation =
    isRecord(invocationValue) && isRecord(invocationValue.delegation)
      ? invocationValue.delegation
      : null
  const workspaceBefore =
    isRecord(invocationValue) && isRecord(invocationValue.workspace_before)
      ? invocationValue.workspace_before
      : null
  const validationPath =
    delegation && typeof delegation.invocation_validation_path === 'string'
      ? resolveInside(root, delegation.invocation_validation_path)
      : null
  const validation =
    validationPath && fileExists(validationPath)
      ? readJson(validationPath)
      : undefined

  if (!isRecord(validation) || validation.status !== 'pass') {
    return {
      ready: false,
      result: {
        ok: false,
        supported: false,
        failure_signature: 'invocation-validation-failed',
        evidence:
          'The canonical invocation lacks a passing validation artifact.',
      },
    }
  }

  const priorFingerprint =
    workspaceBefore && typeof workspaceBefore.fingerprint === 'string'
      ? workspaceBefore.fingerprint
      : null
  const currentFingerprint = gitWorkspaceSnapshot(
    state.workspace_root,
  ).fingerprint

  if (priorFingerprint === null || priorFingerprint !== currentFingerprint) {
    return {
      ready: false,
      result: {
        ok: false,
        supported: false,
        failure_signature: 'invocation-workspace-stale',
        evidence:
          'The workspace changed after the canonical invocation was prepared.',
      },
    }
  }

  return { ready: true, invocation }
}

export function createAgentRecoveryRunner(root: string): AgentRecoveryRunner {
  const resume = (agent: AgentRecord): RecoveryResult => {
    if (agent.executor !== 'cursor' || !agent.session_id) {
      return {
        ok: false,
        supported: false,
        failure_signature: 'cursor-session-unavailable',
        evidence: 'No resumable Cursor session is registered for this agent.',
      }
    }

    return cursorRecoveryResult(
      runCursorAgentSession({
        cwd: root,
        model: agent.model ?? undefined,
        sessionId: agent.session_id,
        prompt:
          'Continue the assigned Pancreator invocation from its current state.',
      }),
    )
  }

  return {
    nudge: (agent): RecoveryResult => {
      if (agent.process_alive !== true) {
        return {
          ok: false,
          supported: false,
          failure_signature: 'live-cursor-session-unavailable',
          evidence: 'Process evidence does not show a live session to nudge.',
        }
      }

      return resume(agent)
    },
    resume,
    redeliver: (agent): RecoveryResult => {
      if (agent.executor !== 'cursor') {
        return {
          ok: false,
          supported: false,
          failure_signature: 'cursor-redelivery-unsupported',
          evidence:
            'Automatic redelivery currently requires a Cursor executor.',
        }
      }

      const readiness = redeliveryReadiness(root, agent)

      if (!readiness.ready) {
        return readiness.result
      }

      const invocation = readiness.invocation
      const deliveryPath = invocation.markdown_path.replace(
        /\.md$/u,
        '.delivery.md',
      )
      const deliveryAbsolute = resolveInside(root, deliveryPath)
      const promptPath = fileExists(deliveryAbsolute)
        ? deliveryAbsolute
        : resolveInside(root, invocation.markdown_path)

      return cursorRecoveryResult(
        runCursorAgentSession({
          cwd: root,
          model: agent.model ?? undefined,
          prompt: readText(promptPath),
        }),
      )
    },
    reprepare: (): RecoveryResult => ({
      ok: false,
      supported: false,
      failure_signature: 'reprepare-requires-validation',
      evidence:
        'Automatic re-prepare requires a fresh invocation validation result.',
    }),
  }
}

/** Apply the ordered recovery sequence and quarantine repeated failures. */
export function recoverAgent(
  agent: AgentRecord,
  runner: AgentRecoveryRunner,
  attemptedAt: string,
  maxAttempts = 2,
): {
  agent: AgentRecord
  events: HypervisorTickResult['recovery_events']
} {
  if (
    agent.health !== 'stalled' &&
    agent.health !== 'dead' &&
    !agent.recovery.quarantined
  ) {
    return { agent, events: [] }
  }

  if (agent.recovery.quarantined) {
    return { agent, events: [] }
  }

  const steps = [
    ['nudge', runner.nudge],
    ['resume', runner.resume],
    ['redeliver', runner.redeliver],
    ['reprepare', runner.reprepare],
  ] as const
  const events: HypervisorTickResult['recovery_events'] = []
  let recovery = { ...agent.recovery }

  for (const [step, operation] of steps) {
    if (!operation) {
      continue
    }

    if (recovery.attempts >= maxAttempts) {
      recovery = { ...recovery, step: 'quarantine', quarantined: true }
      events.push({
        agent_id: agent.agent_id,
        step: 'quarantine',
        ok: false,
        evidence: 'The configured recovery-attempt limit was reached.',
      })
      return { agent: { ...agent, recovery }, events }
    }

    const result = operation(agent)
    const signature = result.ok ? undefined : normalizeFailure(result)

    events.push({
      agent_id: agent.agent_id,
      step,
      ok: result.ok,
      evidence: result.evidence,
    })

    if (result.supported === false) {
      continue
    }

    if (result.ok) {
      recovery = {
        ...recovery,
        step,
        attempts: recovery.attempts + 1,
        consecutive_failures: 0,
        last_attempt_at: attemptedAt,
        quarantined: false,
      }

      return {
        agent: {
          ...agent,
          health: 'running',
          recovery,
          ...(result.session_id ? { session_id: result.session_id } : {}),
        },
        events,
      }
    }

    const repeated =
      signature !== undefined &&
      signature === recovery.last_failure_signature &&
      recovery.consecutive_failures >= 1

    recovery = {
      ...recovery,
      step,
      attempts: recovery.attempts + 1,
      consecutive_failures: recovery.consecutive_failures + 1,
      ...(signature ? { last_failure_signature: signature } : {}),
      last_attempt_at: attemptedAt,
      quarantined: repeated,
    }

    if (repeated) {
      events.push({
        agent_id: agent.agent_id,
        step: 'quarantine',
        ok: false,
        evidence:
          'The same recovery signature failed twice. Autonomous retries stopped.',
      })

      return {
        agent: { ...agent, recovery: { ...recovery, step: 'quarantine' } },
        events,
      }
    }
  }

  return { agent: { ...agent, recovery }, events }
}

function recoveryAttemptLimit(root: string, agent: AgentRecord): number {
  const statePath = resolveRunLayout(root, agent.run_id).state.absolute

  if (!fileExists(statePath)) {
    return 2
  }

  const value = readJson(statePath)

  if (!isRecord(value)) {
    return 2
  }

  const state = value as unknown as RunState

  return state.away_mode?.guardrails.max_remediation_attempts_per_agent ?? 2
}

/** Run one registry scan and optional recovery pass. */
export function tickHypervisor(
  root: string,
  options: {
    observations?: AgentObservation[]
    recoveryRunner?: AgentRecoveryRunner
    now?: string
  } = {},
): HypervisorTickResult {
  const scannedAt = options.now ?? new Date().toISOString()
  const registry = readAgentRegistry(root)
  const observations =
    options.observations ?? discoverRunObservations(root, registry.agents)
  let agents = reconcileAgentRecords(registry.agents, observations, scannedAt)
  const recoveryEvents: HypervisorTickResult['recovery_events'] = []

  const recoveryRunner =
    options.recoveryRunner ?? createAgentRecoveryRunner(root)

  agents = agents.map((agent) => {
    const recovered = recoverAgent(
      agent,
      recoveryRunner,
      scannedAt,
      recoveryAttemptLimit(root, agent),
    )

    recoveryEvents.push(...recovered.events)

    return recovered.agent
  })

  const priorHealth = new Map(
    registry.agents.map((agent) => [agent.agent_id, agent.health]),
  )
  const changedAgentIds = agents
    .filter((agent) => priorHealth.get(agent.agent_id) !== agent.health)
    .map((agent) => agent.agent_id)
  withOperationMutex(hypervisorPath(root, LEDGER_LOCK_FILE), () => {
    const latest = readAgentRegistry(root)
    const currentIds = new Set(agents.map((agent) => agent.agent_id))
    const registeredDuringRecovery = latest.agents.filter(
      (agent) => !currentIds.has(agent.agent_id),
    )

    agents = [...agents, ...registeredDuringRecovery].sort((left, right) =>
      left.agent_id.localeCompare(right.agent_id),
    )
    writeJsonAtomic(agentRegistryPath(root), {
      schema_version: 1,
      updated_at: scannedAt,
      agents,
    } satisfies AgentRegistry)

    for (const agentId of changedAgentIds) {
      const agent = agents.find((candidate) => candidate.agent_id === agentId)

      appendJsonLine(hypervisorEventsPath(root), {
        schema_version: 1,
        type: 'health_changed',
        timestamp: scannedAt,
        agent_id: agentId,
        health: agent?.health,
        evidence: agent?.health_evidence ?? [],
      })
    }

    for (const event of recoveryEvents) {
      appendJsonLine(hypervisorEventsPath(root), {
        schema_version: 1,
        type: 'recovery',
        timestamp: scannedAt,
        ...event,
      })
    }
  })

  return {
    scanned_at: scannedAt,
    agents,
    changed_agent_ids: changedAgentIds,
    recovery_events: recoveryEvents,
  }
}

/** Registry health for one run, preferring its current invocation. */
export function registryHealthForRun(
  root: string,
  runId: string,
  invocationId?: string,
): AgentHealthView | null {
  const registry = readAgentRegistry(root)
  const candidates = registry.agents.filter(
    (agent) =>
      agent.run_id === runId &&
      (invocationId === undefined || agent.invocation_id === invocationId),
  )
  const agent = candidates.sort((left, right) =>
    right.last_observed_at.localeCompare(left.last_observed_at),
  )[0]

  if (!agent) {
    return null
  }

  return {
    agent_id: agent.agent_id,
    health: agent.health,
    evidence_at: agent.last_observed_at,
    recovery: agent.recovery,
  }
}

export interface HypervisorLoopClock {
  sleep: (milliseconds: number) => Promise<void>
}

/** Run fixed-cadence ticks. maxTicks exists only for bounded tests. */
export async function runHypervisorLoop(
  tick: () => void | Promise<void>,
  options: {
    clock?: HypervisorLoopClock
    intervalMs?: number
    maxTicks?: number
    shouldStop?: () => boolean
  } = {},
): Promise<void> {
  const clock = options.clock ?? {
    sleep: (milliseconds: number) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  }
  const intervalMs = options.intervalMs ?? HYPERVISOR_INTERVAL_MS
  const maxTicks = options.maxTicks ?? Number.POSITIVE_INFINITY

  for (let count = 0; count < maxTicks; count += 1) {
    if (options.shouldStop?.()) {
      return
    }

    await tick()

    if (count + 1 < maxTicks && !options.shouldStop?.()) {
      await clock.sleep(intervalMs)
    }
  }
}

function pidFromFile(root: string): number | null {
  const pidPath = hypervisorPidPath(root)

  if (!fileExists(pidPath)) {
    return null
  }

  const value = Number(readFileSync(pidPath, 'utf8').trim())

  return Number.isInteger(value) && value > 0 ? value : null
}

export function hypervisorProcessStatus(root: string): {
  running: boolean
  pid: number | null
} {
  const pid = pidFromFile(root)

  return { running: processIsAlive(pid) === true, pid }
}

/** Start one detached hypervisor process and recover a stale PID file. */
export function startHypervisorProcess(
  root: string,
  cliPath: string,
): { started: boolean; pid: number } {
  return withOperationMutex(
    hypervisorPath(root, 'process.lock'),
    (): { started: boolean; pid: number } => {
      const current = hypervisorProcessStatus(root)

      if (current.running && current.pid !== null) {
        return { started: false, pid: current.pid }
      }

      rmSync(hypervisorPidPath(root), { force: true })
      const child = spawn(process.execPath, [cliPath, 'hypervisor', 'run'], {
        cwd: root,
        detached: true,
        stdio: 'ignore',
      })

      if (!child.pid) {
        throw new PanError('The hypervisor process did not return a PID.', {
          code: 'HYPERVISOR_START_FAILED',
        })
      }

      ensureDir(path.dirname(hypervisorPidPath(root)))
      const descriptor = openSync(hypervisorPidPath(root), 'wx')

      try {
        writeFileSync(descriptor, `${child.pid}\n`, 'utf8')
      } finally {
        closeSync(descriptor)
      }

      child.unref()

      return { started: true, pid: child.pid }
    },
  )
}

export function stopHypervisorProcess(root: string): {
  stopped: boolean
  pid: number | null
} {
  const status = hypervisorProcessStatus(root)

  if (!status.running || status.pid === null) {
    rmSync(hypervisorPidPath(root), { force: true })
    return { stopped: false, pid: status.pid }
  }

  process.kill(status.pid, 'SIGTERM')
  rmSync(hypervisorPidPath(root), { force: true })

  return { stopped: true, pid: status.pid }
}

/** Run the daemon loop in the process a start command created. */
export async function runHypervisorDaemon(
  root: string,
  tick: () => void | Promise<void> = () => {
    tickHypervisor(root)
  },
): Promise<void> {
  try {
    await runHypervisorLoop(tick)
  } finally {
    const recordedPid = pidFromFile(root)

    if (recordedPid === process.pid) {
      rmSync(hypervisorPidPath(root), { force: true })
    }
  }
}
