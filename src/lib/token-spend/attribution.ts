/**
 * Workflow evidence read from run records and the attribution of one usage
 * event to a workflow, stage, role, and command.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { CursorUsageEvent } from '../cursor-usage.js'
import { COMMAND_GOVERNANCE_REGISTRY_PATH } from '../governance/command-coverage.js'
import { fileExists, isDirectory, isRecord } from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import { safeReadJson } from './transcripts.js'
import type {
  AttributionRoot,
  EventAttribution,
  RunEvidence,
  RunStorage,
  TranscriptEvidence,
  WorkflowEvidence,
  WorkflowIdentity,
} from './model.js'

const REVIEW_STAGE = 'review'

const REVIEW_EVIDENCE_ROLE = 'review'

const REVIEW_COMMANDS = new Set(['pan-review', 'pan-shepherd'])

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

  let content: string

  try {
    content = readFileSync(absolute, 'utf8')
  } catch {
    return []
  }

  const timeline: Array<{ at_ms: number; stage: string | null }> = []

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

function workerIdentity(
  runId: string,
  storage: RunStorage,
  invocationId: string,
  role: string | null,
): WorkflowIdentity | null {
  const invocation = safeReadJson(storage.invocation(invocationId))

  if (invocation === null || !isRecord(invocation.stage)) {
    return null
  }

  const stage = invocation.stage
  const evidenceWorkers = Array.isArray(invocation.evidence_workers)
    ? invocation.evidence_workers
    : []
  const evidenceWorker = evidenceWorkers.find(
    (item) => isRecord(item) && role !== null && item.role === role,
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

  return {
    run_id: runId,
    persona,
    stage: role === REVIEW_EVIDENCE_ROLE ? REVIEW_STAGE : stageSlug,
    role: 'stage',
    model_spec: modelSpec,
    remedial:
      stageSlug === 'remediate' ||
      (inputs !== null && isRecord(inputs.remediation_return)),
  }
}

function readWorkflowEvidence(root: string): WorkflowEvidence {
  const runs: RunEvidence[] = []
  const workers = new Map<string, WorkflowIdentity>()
  const storages = new Map<string, RunStorage>()

  for (const directory of runDirectories(root)) {
    const runId = path.basename(directory)
    const storage = runStorage(root, directory, runId)
    const state = safeReadJson(storage.state)

    if (state === null) {
      continue
    }

    storages.set(runId, storage)

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

      const identity = workerIdentity(
        runId,
        storage,
        worker.invocation_id,
        typeof worker.role === 'string' ? worker.role : null,
      )

      if (identity !== null) {
        workers.set(worker.handle, identity)
      }
    }
  }

  return { runs, workers, storages }
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

export function readSupervisorCommands(root: string): Set<string> | null {
  const registry = safeReadJson(
    path.join(root, COMMAND_GOVERNANCE_REGISTRY_PATH),
  )
  const commands = registry?.supervisor_commands

  return Array.isArray(commands) &&
    commands.every((item) => typeof item === 'string')
    ? new Set(commands)
    : null
}

function mayBeSupervisor(
  transcript: TranscriptEvidence,
  supervisorCommands: Set<string> | null,
): boolean {
  return (
    transcript.command === null ||
    supervisorCommands === null ||
    supervisorCommands.has(transcript.command)
  )
}

export function attributionForEvent(
  event: CursorUsageEvent,
  transcripts: Map<string, TranscriptEvidence>,
  runs: RunEvidence[],
  workers: Map<string, WorkflowIdentity>,
  supervisorCommands: Set<string> | null,
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
    (transcript === undefined ||
    !mayBeSupervisor(transcript, supervisorCommands)
      ? null
      : supervisorIdentity(transcript, runs, event.timestamp_ms))

  const command = transcript?.command ?? 'Unattributed'
  const stage =
    identity?.stage ??
    (REVIEW_COMMANDS.has(command) ? REVIEW_STAGE : 'Unattributed')
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
    stage,
    remediation:
      identity === null
        ? 'unattributed'
        : identity.remedial
          ? 'remedial'
          : 'non-remedial',
  }
}

/**
 * Workflow records of every attribution root, with each worker transcript
 * mapped to the run identity its recorded handle or opening brief names.
 * A transcript override reads only this checkout's records, because the
 * override replaces every root's transcripts with one directory.
 */
export function resolveTranscriptWorkflow(
  root: string,
  roots: AttributionRoot[],
  transcripts: Map<string, TranscriptEvidence>,
  transcriptsOverride: string | null | undefined,
): WorkflowEvidence {
  const workflowRoots =
    transcriptsOverride === undefined
      ? roots.map((item) => item.harness_root)
      : [root]
  const workflow = workflowRoots.reduce(
    (aggregate, harnessRoot) => {
      const evidence = readWorkflowEvidence(harnessRoot)

      aggregate.runs.push(...evidence.runs)

      for (const [handle, identity] of evidence.workers) {
        aggregate.workers.set(handle, identity)
      }

      for (const [runId, storage] of evidence.storages) {
        aggregate.storages.set(runId, storage)
      }

      return aggregate
    },
    {
      runs: [] as RunEvidence[],
      workers: new Map<string, WorkflowIdentity>(),
      storages: new Map<string, RunStorage>(),
    },
  )

  for (const transcript of transcripts.values()) {
    const brief = transcript.brief
    const storage =
      brief === null ? undefined : workflow.storages.get(brief.run_id)

    if (
      brief === null ||
      storage === undefined ||
      workflow.workers.has(transcript.id)
    ) {
      continue
    }

    const identity = workerIdentity(
      brief.run_id,
      storage,
      brief.invocation_id,
      brief.role,
    )

    if (identity !== null) {
      workflow.workers.set(transcript.id, identity)
    }
  }

  return workflow
}
