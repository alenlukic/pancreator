/**
 * Run helpers every lifecycle action shares: persisting the run, loading its
 * workflow and pipeline snapshots, resolving its workspace, and reading its
 * invocation and task records.
 */

import path from 'node:path'

import { invariant } from '../errors.js'
import { canonicalPersonaMapping } from '../executors/mapping.js'
import {
  fileExists,
  isRecord,
  readJson,
  resolveInside,
  writeJsonAtomic,
} from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import { panCommand } from '../project-config.js'
import {
  finalizeWorkflowArtifacts,
  isClosedRunStatus,
} from '../workflow-artifacts.js'
import {
  loadPipelineConfig,
  loadPipelineConfigSnapshot,
  makePipelineConfigSnapshot,
} from '../pipeline-config.js'
import { projectPersonaVariants, syncCursorProjection } from '../projection.js'
import { now, persist } from '../state.js'
import type {
  DirtyWorkspaceExit,
  GovernanceArtifactIssue,
  Invocation,
  RunAdvisory,
  RunState,
  StageDefinition,
  SupervisorAssessment,
  TaskRecord,
  WorkflowDefinition,
} from '../types.js'
import { loadWorkflowFile, workflowPersonaNames } from '../workflow.js'
import { gitWorkspaceSnapshot } from '../git.js'
import { resolveRoots } from '../workspace/roots.js'

export function recordGovernanceArtifactIssues(
  root: string,
  state: RunState,
  stage: string,
  invocationId: string,
  source: GovernanceArtifactIssue['source'],
  messages: string[],
  artifactPath?: string,
): string[] {
  if (messages.length === 0) {
    return []
  }

  const recordedAt = now()
  const issues = (state.governance_artifact_issues ??= [])

  for (const message of messages) {
    issues.push({
      issue_id: `GA-${String(issues.length + 1).padStart(4, '0')}`,
      stage,
      invocation_id: invocationId,
      source,
      message,
      ...(artifactPath ? { artifact_path: artifactPath } : {}),
      recorded_at: recordedAt,
    })
  }

  const relativePath = resolveRunLayout(root, state.run_id).artifactJson(
    'governance-artifact-issues.json',
  ).relative
  state.governance_artifact_issues_path = relativePath
  writeJsonAtomic(resolveInside(root, relativePath), {
    schema_version: 1,
    run_id: state.run_id,
    updated_at: recordedAt,
    issues,
  })

  return messages
}

export interface OperationProgressOptions {
  onProgress?: (message: string) => void
}

export function persistRun(
  root: string,
  state: RunState,
  eventType: string,
  payload: Record<string, unknown> = {},
): void {
  persist(root, state, eventType, payload)

  if (!isClosedRunStatus(state.status)) {
    return
  }

  const summary = finalizeWorkflowArtifacts(root, state.run_id, state)

  persist(root, state, 'workflow_artifacts_finalized', { ...summary })
}

export function loadRunWorkflow(
  root: string,
  state: RunState,
): WorkflowDefinition {
  return loadWorkflowFile(
    root,
    resolveInside(root, state.workflow_snapshot.path),
  )
}

export function loadRunPipelineConfig(root: string, state: RunState) {
  if (state.pipeline_config) {
    return loadPipelineConfigSnapshot(root, state.pipeline_config.path)
  }

  return makePipelineConfigSnapshot(loadPipelineConfig(root))
}

/**
 * A run must keep resolving the models it snapshotted, but a mapping it never
 * resolves is not drift. Adding a persona would otherwise strand every run in
 * flight, including the self-development run that introduces that persona.
 */
export function runPipelineConfigAdvisories(
  root: string,
  state: RunState,
  snapshot: ReturnType<typeof loadRunPipelineConfig>,
): string[] {
  if (!state.pipeline_config) {
    return []
  }

  const advisories: string[] = []

  // A best-of-N run pins its own persona map, so its run-scoped agent
  // variants are what drift.
  if (state.cursor_agent_suffix) {
    const variantDrift = projectPersonaVariants(
      root,
      state.cursor_agent_suffix,
      personaSubset(snapshot.personas, loadRunWorkflow(root, state)),
    ).filter((entry) => entry.changed)

    if (variantDrift.length > 0) {
      advisories.push(
        `Run-scoped Cursor agent variants no longer match this run's ` +
          `pipeline snapshot: ${variantDrift.map((entry) => entry.path).join(', ')}. ` +
          `Run ${panCommand(root)} models --sync to realign them.`,
      )
    }

    return advisories
  }

  const live = loadPipelineConfig(root)
  const driftedPersonas = Object.entries(snapshot.personas)
    .filter(([persona, model]) => {
      const livePersona = live.config.personas[persona]

      return (
        livePersona === undefined ||
        canonicalPersonaMapping(livePersona) !== canonicalPersonaMapping(model)
      )
    })
    .map(([persona]) => persona)

  if (live.name !== snapshot.name) {
    advisories.push(
      `This run snapshotted pipeline config '${snapshot.name}'; ` +
        `'${live.name}' is now active. The run continues on its snapshot.`,
    )
  }

  if (driftedPersonas.length > 0) {
    advisories.push(
      `The live model mapping changed for ${driftedPersonas.join(', ')} ` +
        `since this run started. The run continues on its snapshot; run ` +
        `${panCommand(root)} models --sync to delegate on the live mapping.`,
    )
  }

  // The advisory reads one projection, so render only that one against the
  // live config.
  const agentModelDrift = syncCursorProjection(root, {
    only: ['cursor-agents'],
    pipeline: live,
  }).filter((entry) => entry.id === 'cursor-agents' && entry.changed)

  if (agentModelDrift.length > 0) {
    advisories.push(
      `Projected Cursor agent models do not match this run's pipeline ` +
        `config: ${agentModelDrift.map((entry) => entry.path).join(', ')}. ` +
        `Run ${panCommand(root)} models --sync to realign them.`,
    )
  }

  return advisories
}

/** Absolute path of the deliverable workspace this run fingerprints and gates. */
export function workspaceDirectory(root: string, state: RunState): string {
  return path.resolve(root, state.workspace_root || '.')
}

function rootsForRun(root: string, state: RunState) {
  return resolveRoots({
    installation_root: root,
    workspace_root: workspaceDirectory(root, state),
    state_root: state.state_root,
  })
}

function initializeRunWorkspaceTracking(root: string, state: RunState) {
  const roots = rootsForRun(root, state)

  state.workspace_id = roots.workspace_id
  state.installation_root = roots.installation_root
  state.state_root = roots.state_root
  state.scope_hash = roots.scope_hash

  return roots
}

export function ensureMutatingWorkflowInitialized(
  root: string,
  state: RunState,
  stage: StageDefinition,
): void {
  if (stage.workspace_policy === 'source_allowed') {
    initializeRunWorkspaceTracking(root, state)
  }
}

export function workspaceSnapshotForRun(root: string, state: RunState) {
  const roots = rootsForRun(root, state)

  state.workspace_id = roots.workspace_id
  state.installation_root = roots.installation_root
  state.state_root = roots.state_root
  state.scope_hash = roots.scope_hash

  return gitWorkspaceSnapshot(roots.workspace_root)
}

/**
 * What a run is leaving uncommitted in its bound workspace, or `null`.
 *
 * A terminal run stops watching its workspace. Anything still dirty then
 * belongs to nobody, and the next run in the same worktree inherits it
 * silently, so the terminal transition says what it is leaving and where.
 */
export function dirtyWorkspaceExit(
  root: string,
  state: RunState,
): DirtyWorkspaceExit | null {
  const snapshot = workspaceSnapshotForRun(root, state)
  const changedPaths = snapshot.entries
    .map((entry) => entry.slice(3))
    .filter((relative) => relative.length > 0)
    .sort()

  return changedPaths.length === 0
    ? null
    : {
        worktree: state.managed_worktree?.name ?? null,
        workspace_root: state.workspace_root || '.',
        changed_paths: changedPaths,
        recorded_at: now(),
      }
}

export function readInvocation(root: string, relativePath: string): Invocation {
  const value = readJson(resolveInside(root, relativePath))

  invariant(isRecord(value), `${relativePath} MUST contain an object.`, {
    code: 'INVALID_INVOCATION',
  })
  invariant(
    value.schema_version === 1 && typeof value.invocation_id === 'string',
    `${relativePath} MUST contain a valid invocation.`,
    { code: 'INVALID_INVOCATION' },
  )

  return value as unknown as Invocation
}

export function recordRunAdvisories(
  state: RunState,
  context: Omit<RunAdvisory, 'message' | 'recorded_at'>,
  messages: string[],
): RunAdvisory[] {
  const recordedAt = now()
  const added = messages.map((message) => ({
    ...context,
    message,
    recorded_at: recordedAt,
  }))

  state.advisories = [...(state.advisories ?? []), ...added]

  return added
}

export function readTaskRecord(root: string, relativePath: string): TaskRecord {
  const value = readJson(resolveInside(root, relativePath))

  invariant(isRecord(value), `${relativePath} MUST contain a task record.`, {
    code: 'INVALID_TASK_RECORD',
  })

  return value as unknown as TaskRecord
}

export function parseSupervisorAssessment(
  value: unknown,
  source: string,
): SupervisorAssessment {
  invariant(isRecord(value), `${source} MUST contain an object.`, {
    code: 'INVALID_ASSESSMENT',
  })
  invariant(
    value.schema_version === 1,
    'Assessment schema_version MUST be 1.',
    {
      code: 'INVALID_ASSESSMENT',
    },
  )
  invariant(
    typeof value.assessment_id === 'string' && value.assessment_id.length > 0,
    'Assessment assessment_id MUST be a non-empty string.',
    { code: 'INVALID_ASSESSMENT' },
  )
  invariant(
    typeof value.invocation_id === 'string' && value.invocation_id.length > 0,
    'Assessment invocation_id MUST be a non-empty string.',
    { code: 'INVALID_ASSESSMENT' },
  )
  invariant(
    value.verdict === 'pass' ||
      value.verdict === 'fail' ||
      value.verdict === 'escalate',
    'Assessment verdict MUST be pass, fail, or escalate.',
    { code: 'INVALID_ASSESSMENT' },
  )
  invariant(
    Array.isArray(value.criteria),
    'Assessment criteria MUST be an array.',
    { code: 'INVALID_ASSESSMENT' },
  )
  invariant(
    typeof value.summary === 'string' && value.summary.length > 0,
    'Assessment summary MUST be a non-empty string.',
    { code: 'INVALID_ASSESSMENT' },
  )

  return value as unknown as SupervisorAssessment
}

export function personaSubset(
  personas: Record<string, string>,
  workflow: WorkflowDefinition,
): Record<string, string> {
  const subset: Record<string, string> = {}

  for (const persona of workflowPersonaNames(workflow)) {
    const model = personas[persona]

    invariant(
      typeof model === 'string' && model.length > 0,
      `Pipeline config does not map persona '${persona}' to a model.`,
      { code: 'INVALID_PIPELINE_CONFIG' },
    )

    subset[persona] = model
  }

  return subset
}

export function readInvocationRecord(
  root: string,
  state: RunState,
  invocationId: string,
): {
  invocation: Invocation
  json_path: string
} {
  const jsonPath = resolveRunLayout(root, state.run_id).invocation(
    invocationId,
    '.json',
  ).relative

  invariant(
    fileExists(resolveInside(root, jsonPath)),
    `Invocation record not found: ${jsonPath}`,
    { code: 'INVOCATION_NOT_FOUND' },
  )

  return { invocation: readInvocation(root, jsonPath), json_path: jsonPath }
}
