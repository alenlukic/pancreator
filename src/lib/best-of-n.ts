import { copyFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import { createRun } from './engine.js'
import { errorMessage, invariant, PanError } from './errors.js'
import { parsePersonaMapping } from './executors/mapping.js'
import {
  gitHead,
  gitWorktreeAdd,
  gitWorktreeIsDirty,
  gitWorktreePaths,
  gitWorktreeRemove,
  isGitRepository,
} from './git.js'
import {
  ensureDir,
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  sha256,
  toRepoRelative,
  withOperationMutex,
  writeJsonAtomic,
  writeTextAtomic,
} from './io.js'
import {
  loadPipelineConfig,
  loadPipelineConfigSnapshot,
} from './pipeline-config.js'
import { projectPersonaVariants, removePersonaVariants } from './projection.js'
import { runSetupCommands } from './setup-commands.js'
import { loadState, makeRunId, now, statePath } from './state.js'
import type { RunState, RunStatus } from './types.js'
import {
  loadWorkflow,
  loadWorkflowFile,
  workflowPersonaNames,
} from './workflow.js'

const CANDIDATE_WORKFLOW = 'dev-candidate'
const CONSOLIDATION_WORKFLOW = 'metacritic'
const MINIMUM_CANDIDATES = 2
const BEST_OF_N_ID_PATTERN = /^\d+_[A-Z][a-z]{2}-\d{2}-\d{4}_[0-9a-f]{8}$/u
const SLOT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const TERMINAL_STATUSES = new Set<RunStatus>([
  'succeeded',
  'failed',
  'canceled',
])

export interface BestOfNPersonaSet {
  name: string
  personas: Record<string, string>
}

export interface BestOfNConfigsFile {
  schema_version: 1
  candidates: BestOfNPersonaSet[]
  consolidation: BestOfNPersonaSet
  setup: string[]
}

/**
 * `initializing` means initialization did not finish, so the session owns
 * resources but cannot be consolidated.
 */
export type BestOfNSessionStatus = 'initializing' | 'ready'

/**
 * A candidate slot whose worktree and agent variants initialization claimed
 * before it created the run.
 */
export interface BestOfNPendingCandidate {
  slot: string
  worktree_path: string
  agent_suffix: string
}

export interface BestOfNCandidateRecord extends BestOfNPendingCandidate {
  run_id: string
  abandoned?: {
    note: string
    recorded_at: string
  }
}

export interface BestOfNConsolidationRecord {
  slot: string
  run_id: string
  agent_suffix: string
  request_path: string
}

export interface BestOfNState {
  schema_version: 1
  bon_id: string
  status: BestOfNSessionStatus
  created_at: string
  updated_at: string
  candidate_workflow: string
  consolidation_workflow: string
  configs: {
    source_path: string
    sha256: string
  }
  request: {
    source_path: string
    stored_path: string
    sha256: string
  }
  setup: string[]
  candidates: BestOfNCandidateRecord[]
  pending: BestOfNPendingCandidate[]
  consolidation?: BestOfNConsolidationRecord
}

export interface BestOfNCandidateStatus extends BestOfNCandidateRecord {
  status: RunStatus
  current_stage: string | null
  terminal: boolean
  resume_command: string
}

export interface BestOfNStatus {
  bon_id: string
  session_status: BestOfNSessionStatus
  candidates: BestOfNCandidateStatus[]
  successes: number
  unresolved: string[]
  incomplete: BestOfNPendingCandidate[]
  consolidation_ready: boolean
  recovery_command: string | null
  consolidation?: BestOfNConsolidationRecord & { status: RunStatus }
}

function parsePersonaSet(value: unknown, source: string): BestOfNPersonaSet {
  invariant(isRecord(value), `${source} MUST be an object.`, {
    code: 'INVALID_BEST_OF_N_CONFIGS',
  })
  invariant(
    isRecord(value.personas) && Object.keys(value.personas).length > 0,
    `${source}.personas MUST be a non-empty object.`,
    { code: 'INVALID_BEST_OF_N_CONFIGS' },
  )

  const personas: Record<string, string> = {}

  for (const [persona, model] of Object.entries(value.personas)) {
    invariant(
      typeof model === 'string' && model.length > 0,
      `${source}.personas.${persona} MUST be a non-empty model string.`,
      { code: 'INVALID_BEST_OF_N_CONFIGS' },
    )

    // Rejects an unknown executor prefix or malformed options here rather than
    // at the first delegation, when N worktrees already exist.
    parsePersonaMapping(model, `${source}.personas.${persona}`)
    personas[persona] = model
  }

  const name = value.name ?? ''

  invariant(
    typeof name === 'string' && (name === '' || SLOT_PATTERN.test(name)),
    `${source}.name MUST be lowercase alphanumeric with single hyphens.`,
    { code: 'INVALID_BEST_OF_N_CONFIGS' },
  )

  return { name, personas }
}

export function parseBestOfNConfigs(
  value: unknown,
  source: string,
): BestOfNConfigsFile {
  invariant(isRecord(value), `${source} MUST contain an object.`, {
    code: 'INVALID_BEST_OF_N_CONFIGS',
  })
  invariant(value.schema_version === 1, `${source}.schema_version MUST be 1.`, {
    code: 'INVALID_BEST_OF_N_CONFIGS',
  })
  invariant(
    Array.isArray(value.candidates) &&
      value.candidates.length >= MINIMUM_CANDIDATES,
    `${source}.candidates MUST list at least ${MINIMUM_CANDIDATES} entries.`,
    { code: 'INVALID_BEST_OF_N_CONFIGS' },
  )

  const candidates = value.candidates.map((candidate, index) => {
    const parsed = parsePersonaSet(candidate, `${source}.candidates[${index}]`)

    return {
      ...parsed,
      name: parsed.name === '' ? `candidate-${index + 1}` : parsed.name,
    }
  })
  const consolidation = parsePersonaSet(
    value.consolidation,
    `${source}.consolidation`,
  )
  const slots = new Set<string>()

  for (const candidate of candidates) {
    invariant(
      !slots.has(candidate.name),
      `${source} names candidate '${candidate.name}' more than once.`,
      { code: 'INVALID_BEST_OF_N_CONFIGS' },
    )
    slots.add(candidate.name)
  }

  const consolidationName =
    consolidation.name === '' ? 'consolidation' : consolidation.name

  invariant(
    !slots.has(consolidationName),
    `${source}.consolidation reuses candidate name '${consolidationName}'.`,
    { code: 'INVALID_BEST_OF_N_CONFIGS' },
  )

  const setup: string[] = []

  if (value.setup !== undefined) {
    invariant(
      Array.isArray(value.setup),
      `${source}.setup MUST be an array when present.`,
      { code: 'INVALID_BEST_OF_N_CONFIGS' },
    )

    for (const [index, command] of value.setup.entries()) {
      invariant(
        typeof command === 'string' && command.trim().length > 0,
        `${source}.setup[${index}] MUST be a non-empty command string.`,
        { code: 'INVALID_BEST_OF_N_CONFIGS' },
      )
      setup.push(command)
    }
  }

  return {
    schema_version: 1,
    candidates,
    consolidation: { ...consolidation, name: consolidationName },
    setup,
  }
}

export function bestOfNDir(root: string, bonId: string): string {
  invariant(
    BEST_OF_N_ID_PATTERN.test(bonId),
    `Invalid best-of-N session id: ${bonId}`,
    { code: 'INVALID_BEST_OF_N_ID' },
  )

  return path.join(root, 'runtime', 'logs', 'best-of-n', bonId)
}

function bestOfNStatePath(root: string, bonId: string): string {
  return path.join(bestOfNDir(root, bonId), 'state.json')
}

/** Mutex that serializes every mutating command of one session. */
export function bestOfNMutexPath(root: string, bonId: string): string {
  return path.join(bestOfNDir(root, bonId), '.operation-mutex')
}

export function loadBestOfNState(root: string, bonId: string): BestOfNState {
  const filePath = bestOfNStatePath(root, bonId)

  invariant(fileExists(filePath), `Unknown best-of-N session: ${bonId}`, {
    code: 'BEST_OF_N_NOT_FOUND',
  })

  const value = readJson(filePath)

  invariant(
    isRecord(value) && value.schema_version === 1,
    `${bonId} state MUST be a schema version 1 record.`,
    { code: 'INVALID_BEST_OF_N_STATE' },
  )
  invariant(
    value.status === 'initializing' || value.status === 'ready',
    `${bonId} state MUST record status 'initializing' or 'ready'.`,
    { code: 'INVALID_BEST_OF_N_STATE' },
  )

  return value as unknown as BestOfNState
}

/**
 * Run one mutating session operation with exclusive access to its record.
 *
 * The record is read inside the mutex, so a concurrent command can neither base
 * a mutation on a record another command already replaced nor create a second
 * consolidation run. A mutex whose owner died is recovered deterministically.
 */
function withBestOfNSession<T>(
  root: string,
  bonId: string,
  operation: (state: BestOfNState) => T,
): T {
  // Checked before the mutex, so an unknown session id never materializes a
  // session directory.
  invariant(
    fileExists(bestOfNStatePath(root, bonId)),
    `Unknown best-of-N session: ${bonId}`,
    { code: 'BEST_OF_N_NOT_FOUND' },
  )

  return withOperationMutex(bestOfNMutexPath(root, bonId), () => {
    const reconciled = reconcileSessionState(
      root,
      loadBestOfNState(root, bonId),
    )

    return operation(
      reconciled.adopted.length > 0 || reconciled.promoted
        ? persistBestOfNState(root, reconciled.state)
        : reconciled.state,
    )
  })
}

/** A child run this session created, as its own durable state records it. */
interface DiscoveredSessionRun {
  run_id: string
  role: 'candidate' | 'consolidation'
  slot: string
}

/**
 * Find every workflow run whose durable state names this session.
 *
 * `createRun` persists the child run — including its `best_of_n` role — before
 * the session record learns the run id, so the child states are the authority
 * when the two disagree. A state file that cannot be read is skipped: discovery
 * repairs the session record, and a malformed run surfaces through the run's
 * own commands rather than by blocking every session operation.
 */
function discoverSessionRuns(
  root: string,
  bonId: string,
): DiscoveredSessionRun[] {
  const base = path.join(root, 'runtime', 'logs', 'workflows')

  if (!fileExists(base)) {
    return []
  }

  const discovered: DiscoveredSessionRun[] = []

  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }

    const runStatePath = path.join(base, entry.name, 'state.json')

    if (!fileExists(runStatePath)) {
      continue
    }

    let value: unknown

    try {
      value = readJson(runStatePath)
    } catch {
      continue
    }

    if (!isRecord(value) || !isRecord(value.best_of_n)) {
      continue
    }

    const role = value.best_of_n.role

    if (
      value.best_of_n.bon_id !== bonId ||
      typeof value.run_id !== 'string' ||
      typeof value.best_of_n.slot !== 'string' ||
      (role !== 'candidate' && role !== 'consolidation')
    ) {
      continue
    }

    discovered.push({
      run_id: value.run_id,
      role,
      slot: value.best_of_n.slot,
    })
  }

  return discovered
}

/**
 * Adopt child runs the session record does not know about.
 *
 * The handoff between `createRun` and the session-record write is not atomic:
 * a process killed between the two leaves a run that exists durably while the
 * session still shows a pending slot — or, for consolidation, no record at
 * all, which would let a retry create a second consolidation run against the
 * same workspace. Reconciliation reads the child runs back and repairs the
 * record instead of trusting it, and promotes an `initializing` session to
 * `ready` when every configured candidate slot has an adopted run.
 */
function reconcileSessionState(
  root: string,
  state: BestOfNState,
): { state: BestOfNState; adopted: string[]; promoted: boolean } {
  const discovered = discoverSessionRuns(root, state.bon_id)
  const adopted: string[] = []
  let next = state

  for (const run of discovered) {
    if (run.role === 'consolidation') {
      if (!next.consolidation) {
        next = {
          ...next,
          consolidation: {
            slot: run.slot,
            run_id: run.run_id,
            agent_suffix: agentSuffix(next.bon_id, run.slot),
            request_path: `runtime/logs/best-of-n/${next.bon_id}/consolidation-request.md`,
          },
        }
        adopted.push(run.run_id)
      }

      continue
    }

    if (next.candidates.some((entry) => entry.run_id === run.run_id)) {
      continue
    }

    // A candidate record for the slot with a different run id would be
    // ambiguous, but it cannot occur: a slot creates at most one run, and the
    // record is only ever written from that run's id.
    if (next.candidates.some((entry) => entry.slot === run.slot)) {
      continue
    }

    const pending = next.pending.find((entry) => entry.slot === run.slot)
    const claim: BestOfNPendingCandidate = pending ?? {
      slot: run.slot,
      worktree_path: `runtime/worktrees/${next.bon_id}/${run.slot}`,
      agent_suffix: agentSuffix(next.bon_id, run.slot),
    }

    next = {
      ...next,
      candidates: [...next.candidates, { ...claim, run_id: run.run_id }],
      pending: next.pending.filter((entry) => entry.slot !== run.slot),
    }
    adopted.push(run.run_id)
  }

  const promoted =
    next.status === 'initializing' && everyConfiguredSlotHasRun(root, next)

  if (promoted) {
    next = { ...next, status: 'ready' }
  }

  return { state: next, adopted, promoted }
}

/**
 * Whether the session's stored configs are fully covered by adopted candidate
 * runs. The stored configs file is the durable statement of how many slots
 * initialization set out to claim, so it — not the possibly-stale session
 * record — decides when a recovered session is complete.
 */
function everyConfiguredSlotHasRun(root: string, state: BestOfNState): boolean {
  const storedConfigs = path.join(
    bestOfNDir(root, state.bon_id),
    'configs.json',
  )

  if (!fileExists(storedConfigs)) {
    return false
  }

  let configs: BestOfNConfigsFile

  try {
    configs = parseBestOfNConfigs(
      readJson(storedConfigs),
      `runtime/logs/best-of-n/${state.bon_id}/configs.json`,
    )
  } catch {
    return false
  }

  const claimed = new Set(state.candidates.map((entry) => entry.slot))

  return configs.candidates.every((candidate) => claimed.has(candidate.name))
}

function persistBestOfNState(root: string, state: BestOfNState): BestOfNState {
  const next = { ...state, updated_at: now() }

  writeJsonAtomic(bestOfNStatePath(root, state.bon_id), next)

  return next
}

/**
 * Suffix shared by one session's run-scoped agent variants. The session id
 * carries characters a Cursor filename should not, so it is reduced to a short
 * stable key that still cannot collide across sessions.
 */
function sessionKey(bonId: string): string {
  return `bon${sha256(bonId).slice(0, 8)}`
}

function agentSuffix(bonId: string, slot: string): string {
  return `${sessionKey(bonId)}-${slot}`
}

export interface InitBestOfNOptions {
  requestPath: string
  configsPath: string
  candidateWorkflow?: string
  consolidationWorkflow?: string
}

/** Inputs every candidate slot of one session shares. */
interface SessionPlan {
  configs: BestOfNConfigsFile
  head: string
  candidateWorkflow: string
  storedRequest: string
  requestLabel: string
  defaults: Record<string, string>
  candidatePersonas: string[]
}

/**
 * Create one best-of-N session: N detached worktrees, their run-scoped agent
 * variants, and N autonomous candidate runs.
 *
 * The session record is published as `initializing` before the first worktree
 * exists and is updated after every resource, so a failed initialization stays
 * visible to `status` and removable by `clean`. A failure leaves the created
 * worktrees in place, because removing them is destructive and operator-owned.
 */
export function initBestOfN(
  root: string,
  options: InitBestOfNOptions,
): BestOfNState {
  invariant(
    isGitRepository(root),
    'Best-of-N requires a Git repository, because each candidate runs in a ' +
      'worktree.',
    { code: 'BEST_OF_N_REQUIRES_GIT' },
  )

  const head = gitHead(root)

  invariant(
    head,
    'Best-of-N requires at least one commit to branch candidate worktrees from.',
    { code: 'BEST_OF_N_REQUIRES_GIT' },
  )

  const configsSource = resolveInside(root, options.configsPath)

  invariant(
    fileExists(configsSource),
    `Configs file does not exist: ${options.configsPath}`,
    { code: 'BEST_OF_N_CONFIGS_NOT_FOUND' },
  )

  const requestSource = resolveInside(root, options.requestPath)

  invariant(
    fileExists(requestSource),
    `Request file does not exist: ${options.requestPath}`,
    { code: 'REQUEST_NOT_FOUND' },
  )

  const configsRaw = readText(configsSource)
  const configs = parseBestOfNConfigs(
    readJson(configsSource),
    options.configsPath,
  )
  const candidateWorkflow = options.candidateWorkflow ?? CANDIDATE_WORKFLOW
  const consolidationWorkflow =
    options.consolidationWorkflow ?? CONSOLIDATION_WORKFLOW

  // Both graphs are loaded before any worktree exists, so a missing or invalid
  // workflow fails while nothing has been created.
  const candidatePersonas = workflowPersonaNames(
    loadWorkflow(root, candidateWorkflow),
  )
  const consolidationPersonas = workflowPersonaNames(
    loadWorkflow(root, consolidationWorkflow),
  )

  const defaults = loadPipelineConfig(root).file.defaults

  for (const candidate of configs.candidates) {
    assertPersonaKeysKnown(
      candidate.personas,
      [...candidatePersonas, ...Object.keys(defaults)],
      `Candidate '${candidate.name}'`,
    )

    for (const persona of candidatePersonas) {
      invariant(
        candidate.personas[persona] ?? defaults[persona],
        `Candidate '${candidate.name}' maps no model for persona ` +
          `'${persona}', and config.json declares no default for it.`,
        { code: 'INVALID_BEST_OF_N_CONFIGS' },
      )
    }
  }

  // The consolidation config is validated with the same rigor as the
  // candidates. Deferring this to consolidation time would burn N completed
  // candidate runs before a bad config surfaces.
  assertPersonaKeysKnown(
    configs.consolidation.personas,
    [...consolidationPersonas, ...Object.keys(defaults)],
    `Consolidation config '${configs.consolidation.name}'`,
  )

  for (const persona of consolidationPersonas) {
    invariant(
      configs.consolidation.personas[persona] ?? defaults[persona],
      `Consolidation config '${configs.consolidation.name}' maps no model ` +
        `for persona '${persona}', and config.json declares no default for it.`,
      { code: 'INVALID_BEST_OF_N_CONFIGS' },
    )
  }

  const bonId = makeRunId()
  const directory = bestOfNDir(root, bonId)

  ensureDir(directory)

  const requestExtension = path.extname(requestSource) || '.md'
  const storedRequest = `runtime/logs/best-of-n/${bonId}/request${requestExtension}`

  copyFileSync(requestSource, resolveInside(root, storedRequest))
  writeTextAtomic(path.join(directory, 'configs.json'), configsRaw)

  const opened: BestOfNState = {
    schema_version: 1,
    bon_id: bonId,
    status: 'initializing',
    created_at: now(),
    updated_at: now(),
    candidate_workflow: candidateWorkflow,
    consolidation_workflow: consolidationWorkflow,
    configs: {
      source_path: toRepoRelative(root, configsSource),
      sha256: sha256(configsRaw),
    },
    request: {
      source_path: toRepoRelative(root, requestSource),
      stored_path: storedRequest,
      sha256: sha256(readText(requestSource)),
    },
    setup: configs.setup,
    candidates: [],
    pending: [],
  }

  const plan: SessionPlan = {
    configs,
    head,
    candidateWorkflow,
    storedRequest,
    requestLabel: path.basename(options.requestPath),
    defaults,
    candidatePersonas,
  }

  // The record does not exist yet, so the mutex is taken directly rather than
  // through withBestOfNSession. It stays held until the session is ready, so no
  // other command can act on a session that is still under construction.
  return withOperationMutex(bestOfNMutexPath(root, bonId), () => {
    try {
      return createSessionCandidates(root, opened, plan)
    } catch (error) {
      throw initializationFailure(bonId, error)
    }
  })
}

/**
 * Create every worktree, agent variant, and candidate run of a published
 * session record, recording each resource as it is claimed.
 *
 * The caller holds the session mutex.
 */
function createSessionCandidates(
  root: string,
  opened: BestOfNState,
  plan: SessionPlan,
): BestOfNState {
  let state = persistBestOfNState(root, opened)

  for (const candidate of plan.configs.candidates) {
    const pending: BestOfNPendingCandidate = {
      slot: candidate.name,
      worktree_path: `runtime/worktrees/${state.bon_id}/${candidate.name}`,
      agent_suffix: agentSuffix(state.bon_id, candidate.name),
    }

    // Claimed before the worktree exists, so a failure can never leave a
    // worktree or an agent variant that the lifecycle commands cannot find.
    state = persistBestOfNState(root, {
      ...state,
      pending: [...state.pending, pending],
    })

    const worktreePath = resolveInside(root, pending.worktree_path)

    gitWorktreeAdd(root, worktreePath, plan.head)
    runSetupCommands(plan.configs.setup, worktreePath, {
      label: `candidate '${pending.slot}'`,
      code: 'BEST_OF_N_SETUP_FAILED',
    })
    projectPersonaVariants(
      root,
      pending.agent_suffix,
      personaMapFor(plan.defaults, candidate.personas, plan.candidatePersonas),
      { write: true },
    )

    const run = createRun(root, {
      workflowSlug: plan.candidateWorkflow,
      requestPath: plan.storedRequest,
      title: `${pending.slot} · ${plan.requestLabel}`,
      workspace: pending.worktree_path,
      pipelineOverride: {
        label: `best-of-n:${state.bon_id}:${pending.slot}`,
        personas: candidate.personas,
        source_path: `runtime/logs/best-of-n/${state.bon_id}/configs.json`,
        source_sha256: state.configs.sha256,
      },
      cursorAgentSuffix: pending.agent_suffix,
      useWorkflowDeclaredGates: true,
      bestOfN: { bon_id: state.bon_id, role: 'candidate', slot: pending.slot },
    })

    state = persistBestOfNState(root, {
      ...state,
      candidates: [...state.candidates, { ...pending, run_id: run.run_id }],
      pending: state.pending.filter((entry) => entry.slot !== pending.slot),
    })
  }

  return persistBestOfNState(root, { ...state, status: 'ready' })
}

/**
 * Name the partial session and its recovery commands, keeping the original
 * cause and error code so the CLI still reports what actually failed.
 */
function initializationFailure(bonId: string, error: unknown): PanError {
  return new PanError(
    `Best-of-N initialization failed for session ${bonId}: ` +
      `${errorMessage(error)}\n` +
      `The partial session is recorded at runtime/logs/best-of-n/${bonId}/` +
      `state.json. Inspect it with './bin/pan best-of-n status ${bonId}' and ` +
      `remove its worktrees with './bin/pan best-of-n clean ${bonId}'.`,
    {
      code: error instanceof PanError ? error.code : 'BEST_OF_N_INIT_FAILED',
      details: { bon_id: bonId, cause: errorMessage(error) },
    },
  )
}

/**
 * Reject persona names no workflow or default declares. A mapped model only
 * takes effect through a known persona, so an unknown key is a typo that would
 * otherwise be dropped silently and leave the default model running a stage
 * the operator meant to override.
 */
function assertPersonaKeysKnown(
  personas: Record<string, string>,
  known: string[],
  source: string,
): void {
  const knownSet = new Set(known)

  for (const persona of Object.keys(personas)) {
    invariant(
      knownSet.has(persona),
      `${source} maps unknown persona '${persona}'. Known personas: ` +
        `${[...knownSet].sort().join(', ')}.`,
      { code: 'INVALID_BEST_OF_N_CONFIGS' },
    )
  }
}

function personaMapFor(
  defaults: Record<string, string>,
  overrides: Record<string, string>,
  personas: string[],
): Record<string, string> {
  const merged: Record<string, string> = {}

  for (const persona of personas) {
    const model = overrides[persona] ?? defaults[persona]

    invariant(model, `No model is mapped for persona '${persona}'.`, {
      code: 'INVALID_PIPELINE_CONFIG',
    })

    merged[persona] = model
  }

  return merged
}

function isEmptyDirectory(directory: string): boolean {
  return readdirSync(directory).length === 0
}

function candidateRunState(root: string, runId: string): RunState | null {
  if (!fileExists(statePath(root, runId))) {
    return null
  }

  return loadState(root, runId)
}

export function bestOfNStatus(root: string, bonId: string): BestOfNStatus {
  // Status holds no mutex, so the adopted view is reported without being
  // persisted; the next mutating command durably repairs the record.
  const { state } = reconcileSessionState(root, loadBestOfNState(root, bonId))
  const candidates = state.candidates.map((candidate) => {
    const run = candidateRunState(root, candidate.run_id)
    // A run whose state is gone can never be repaired or resumed, so it is
    // reported as a terminal failure rather than as work still in flight.
    const status: RunStatus = run?.status ?? 'failed'

    return {
      ...candidate,
      status,
      current_stage: run?.current_stage ?? null,
      terminal: TERMINAL_STATUSES.has(status),
      resume_command: `/pan-resume ${candidate.run_id}`,
    }
  })
  const unresolved = candidates
    .filter((candidate) => !candidate.terminal && !candidate.abandoned)
    .map((candidate) => candidate.run_id)
  const successes = candidates.filter(
    (candidate) => candidate.status === 'succeeded' && !candidate.abandoned,
  ).length
  const consolidationRun = state.consolidation
    ? candidateRunState(root, state.consolidation.run_id)
    : null

  return {
    bon_id: bonId,
    session_status: state.status,
    candidates,
    successes,
    unresolved,
    incomplete: state.pending,
    consolidation_ready:
      state.status === 'ready' &&
      unresolved.length === 0 &&
      successes > 0 &&
      !state.consolidation,
    recovery_command:
      state.status === 'ready' ? null : `./bin/pan best-of-n clean ${bonId}`,
    ...(state.consolidation
      ? {
          consolidation: {
            ...state.consolidation,
            status: consolidationRun?.status ?? 'failed',
          },
        }
      : {}),
  }
}

export interface RefreshBestOfNAgentsResult {
  bon_id: string
  refreshed_agents: string[]
}

/**
 * Rebuild every run-scoped agent from its run's pinned model snapshot.
 *
 * This refreshes executable agent instructions without changing session state,
 * candidate models, or the runs' immutable workflow contracts.
 */
export function refreshBestOfNAgents(
  root: string,
  bonId: string,
): RefreshBestOfNAgentsResult {
  return withBestOfNSession(root, bonId, (state) => {
    const runAgents = [
      ...state.candidates.map((candidate) => ({
        runId: candidate.run_id,
        suffix: candidate.agent_suffix,
      })),
      ...(state.consolidation
        ? [
            {
              runId: state.consolidation.run_id,
              suffix: state.consolidation.agent_suffix,
            },
          ]
        : []),
    ]
    const refreshed = new Set<string>()

    for (const entry of runAgents) {
      const run = candidateRunState(root, entry.runId)

      invariant(run, `Best-of-N child run '${entry.runId}' does not exist.`, {
        code: 'BEST_OF_N_CHILD_NOT_FOUND',
      })
      invariant(
        run.pipeline_config,
        `Best-of-N child run '${entry.runId}' has no pipeline snapshot.`,
        { code: 'INVALID_PIPELINE_CONFIG' },
      )

      const snapshot = loadPipelineConfigSnapshot(
        root,
        run.pipeline_config.path,
      )
      const workflow = loadWorkflowFile(
        root,
        resolveInside(root, run.workflow_snapshot.path),
      )
      const personas: Record<string, string> = {}

      for (const persona of workflowPersonaNames(workflow)) {
        const model = snapshot.personas[persona]

        invariant(
          model,
          `Run '${entry.runId}' snapshot maps no model for '${persona}'.`,
          { code: 'INVALID_PIPELINE_CONFIG' },
        )
        personas[persona] = model
      }

      for (const change of projectPersonaVariants(
        root,
        entry.suffix,
        personas,
        { write: true },
      )) {
        refreshed.add(change.path)
      }
    }

    return {
      bon_id: bonId,
      refreshed_agents: [...refreshed].sort(),
    }
  })
}

/**
 * Record an operator-directed exclusion of one candidate.
 *
 * Exclusion is operator-owned: a failed candidate stays eligible for repair and
 * resume until the operator says otherwise, so the note is required evidence.
 */
export function abandonBestOfNCandidate(
  root: string,
  bonId: string,
  runId: string,
  note: string,
): BestOfNState {
  invariant(
    note.trim().length > 0,
    '--note is required to abandon a candidate.',
    {
      code: 'INVALID_ARGUMENT',
    },
  )

  return withBestOfNSession(root, bonId, (state) => {
    const candidate = state.candidates.find((entry) => entry.run_id === runId)

    invariant(
      candidate,
      `Best-of-N session ${bonId} has no candidate run '${runId}'.`,
      { code: 'BEST_OF_N_CANDIDATE_NOT_FOUND' },
    )

    return persistBestOfNState(root, {
      ...state,
      candidates: state.candidates.map((entry) =>
        entry.run_id === runId
          ? { ...entry, abandoned: { note, recorded_at: now() } }
          : entry,
      ),
    })
  })
}

function candidateOutputPaths(root: string, runId: string): string[] {
  const run = candidateRunState(root, runId)

  if (!run) {
    return []
  }

  return [...new Set(run.stage_history.map((item) => item.output_path))].sort()
}

function renderConsolidationRequest(
  root: string,
  state: BestOfNState,
  status: BestOfNStatus,
): string {
  const lines = [
    '# Best-of-N consolidation request',
    '',
    `Session \`${state.bon_id}\` produced ${status.candidates.length} candidate ` +
      'implementations of one task. Evaluate every candidate below, then write ' +
      'one consolidated implementation into the main workspace.',
    '',
    '## Original task',
    '',
    `- Preserved request: \`${state.request.stored_path}\``,
    `- Operator source: \`${state.request.source_path}\``,
    '',
    '## Candidates',
    '',
  ]

  for (const candidate of status.candidates) {
    lines.push(
      `### ${candidate.slot}`,
      '',
      `- Run: \`${candidate.run_id}\``,
      `- Worktree: \`${candidate.worktree_path}\``,
      `- Final status: \`${candidate.status}\``,
      `- Operator exclusion: ${
        candidate.abandoned ? `yes — ${candidate.abandoned.note}` : 'no'
      }`,
      '- Outputs:',
      ...candidateOutputPaths(root, candidate.run_id).map(
        (outputPath) => `  - \`${outputPath}\``,
      ),
      '',
    )
  }

  lines.push(
    '## Required work',
    '',
    '1. Read each candidate diff in its worktree and each run output above.',
    '2. Record correctness, strengths, and weaknesses for every candidate.',
    '3. Choose a consolidation strategy and state the reason for it.',
    '4. Implement the consolidated change in the main workspace.',
    '5. Derive consolidated acceptance criteria and map evidence to each one.',
    '',
    'An excluded candidate MUST still be evaluated. Do not edit a worktree.',
    '',
  )

  return `${lines.join('\n')}\n`
}

/**
 * Start the consolidation run for a session whose candidates are all resolved.
 */
export function consolidateBestOfN(root: string, bonId: string): BestOfNState {
  return withBestOfNSession(root, bonId, (state) =>
    startConsolidationRun(root, state),
  )
}

/** The caller holds the session mutex. */
function startConsolidationRun(
  root: string,
  state: BestOfNState,
): BestOfNState {
  const bonId = state.bon_id

  invariant(
    state.status === 'ready',
    `Best-of-N session ${bonId} did not finish initialization, so its ` +
      `candidate set is incomplete. Remove its worktrees with 'pan best-of-n ` +
      `clean ${bonId}' and start a new session.`,
    { code: 'BEST_OF_N_INCOMPLETE' },
  )
  invariant(
    !state.consolidation,
    `Best-of-N session ${bonId} already started consolidation run ` +
      `'${state.consolidation?.run_id}'.`,
    { code: 'BEST_OF_N_ALREADY_CONSOLIDATED' },
  )

  const storedConfigsPath = `runtime/logs/best-of-n/${bonId}/configs.json`
  const configsRaw = readText(
    path.join(bestOfNDir(root, bonId), 'configs.json'),
  )

  // The candidates ran against the configs recorded at initialization, so the
  // consolidation run must come from the same bytes. An edited stored copy
  // would silently re-model the consolidation half of the session.
  invariant(
    sha256(configsRaw) === state.configs.sha256,
    `Stored configs at ${storedConfigsPath} no longer match the digest ` +
      `recorded at initialization (${state.configs.sha256}). Restore the ` +
      'stored file before consolidating.',
    { code: 'BEST_OF_N_CONFIGS_DRIFTED' },
  )

  const status = bestOfNStatus(root, bonId)

  invariant(
    status.unresolved.length === 0,
    `Best-of-N session ${bonId} has unresolved candidates: ` +
      `${status.unresolved.join(', ')}. Repair and resume each one, or record ` +
      'an operator-directed abandonment.',
    { code: 'BEST_OF_N_CANDIDATES_UNRESOLVED' },
  )
  invariant(
    status.successes > 0,
    `Best-of-N session ${bonId} has no successful candidate, so there is ` +
      'nothing to consolidate.',
    { code: 'BEST_OF_N_NO_SUCCESS' },
  )

  const configs = parseBestOfNConfigs(JSON.parse(configsRaw), storedConfigsPath)
  const slot = configs.consolidation.name
  const suffix = agentSuffix(bonId, slot)
  const requestPath = `runtime/logs/best-of-n/${bonId}/consolidation-request.md`

  writeTextAtomic(
    resolveInside(root, requestPath),
    renderConsolidationRequest(root, state, status),
  )

  const workflow = loadWorkflow(root, state.consolidation_workflow)

  projectPersonaVariants(
    root,
    suffix,
    personaMapFor(
      loadPipelineConfig(root).file.defaults,
      configs.consolidation.personas,
      workflowPersonaNames(workflow),
    ),
    { write: true },
  )

  const run = createRun(root, {
    workflowSlug: state.consolidation_workflow,
    requestPath,
    title: `consolidation · ${bonId}`,
    pipelineOverride: {
      label: `best-of-n:${bonId}:${slot}`,
      personas: configs.consolidation.personas,
      source_path: storedConfigsPath,
      source_sha256: state.configs.sha256,
    },
    cursorAgentSuffix: suffix,
    useWorkflowDeclaredGates: true,
    bestOfN: { bon_id: bonId, role: 'consolidation', slot },
  })

  return persistBestOfNState(root, {
    ...state,
    consolidation: {
      slot,
      run_id: run.run_id,
      agent_suffix: suffix,
      request_path: requestPath,
    },
  })
}

export interface CleanBestOfNResult {
  bon_id: string
  removed_worktrees: string[]
  removed_agents: string[]
}

/**
 * Remove a session's worktrees and run-scoped agent variants.
 *
 * Candidate work is never committed, so removing a dirty worktree discards it.
 * That makes this operator-owned and refused by default.
 */
export function cleanBestOfN(
  root: string,
  bonId: string,
  options: { force?: boolean } = {},
): CleanBestOfNResult {
  return withBestOfNSession(root, bonId, (state) =>
    removeSessionResources(root, state, options),
  )
}

/** The caller holds the session mutex. */
function removeSessionResources(
  root: string,
  state: BestOfNState,
  options: { force?: boolean },
): CleanBestOfNResult {
  const bonId = state.bon_id
  // A slot a failed initialization claimed owns the same resources as a
  // candidate run, so cleanup covers both.
  const claimed: BestOfNPendingCandidate[] = [
    ...state.candidates,
    ...state.pending,
  ]
  const registered = new Set(gitWorktreePaths(root))
  const removedWorktrees: string[] = []
  const removedAgents: string[] = []

  // Liveness is checked before dirtiness: a run at intake or plan has a clean
  // worktree, so a dirtiness-only preflight would remove the workspace from
  // under it. The consolidation run blocks every removal, because the
  // candidate worktrees are its declared evaluation inputs and its agent
  // variants are what the engine's pipeline-drift check verifies on every
  // subsequent operation — removing either strands the run unrecoverably.
  const consolidationRun = state.consolidation
    ? candidateRunState(root, state.consolidation.run_id)
    : null

  invariant(
    options.force ||
      !consolidationRun ||
      TERMINAL_STATUSES.has(consolidationRun.status),
    `WARNING: consolidation run '${state.consolidation?.run_id}' is still ` +
      `'${consolidationRun?.status}'. Cleaning now removes its inputs and its ` +
      'agent variants and the run cannot proceed. Finish or abort the run ' +
      'first, or pass --force to discard it.',
    { code: 'BEST_OF_N_RUN_ACTIVE' },
  )

  for (const candidate of state.candidates) {
    if (candidate.abandoned) {
      continue
    }

    const run = candidateRunState(root, candidate.run_id)

    invariant(
      options.force || !run || TERMINAL_STATUSES.has(run.status),
      `WARNING: candidate '${candidate.slot}' run '${candidate.run_id}' is ` +
        `still '${run?.status}'. Cleaning now removes its workspace mid-run. ` +
        'Finish or abort the run first, or pass --force to discard it.',
      { code: 'BEST_OF_N_RUN_ACTIVE' },
    )
  }

  for (const candidate of claimed) {
    const worktreePath = resolveInside(root, candidate.worktree_path)

    if (!registered.has(worktreePath)) {
      continue
    }

    invariant(
      options.force || !gitWorktreeIsDirty(worktreePath),
      `WARNING: candidate '${candidate.slot}' has uncommitted work in ` +
        `${candidate.worktree_path}. Removing it discards that work. Pass ` +
        '--force to remove it anyway.',
      { code: 'BEST_OF_N_WORKTREE_DIRTY' },
    )
  }

  for (const candidate of claimed) {
    const worktreePath = resolveInside(root, candidate.worktree_path)

    if (registered.has(worktreePath)) {
      gitWorktreeRemove(root, worktreePath, options.force ?? false)
      removedWorktrees.push(candidate.worktree_path)
    }

    removedAgents.push(...removePersonaVariants(root, candidate.agent_suffix))
  }

  if (state.consolidation) {
    removedAgents.push(
      ...removePersonaVariants(root, state.consolidation.agent_suffix),
    )
  }

  const sessionWorktreeRoot = resolveInside(root, `runtime/worktrees/${bonId}`)

  // Only the now-empty session directory is removed here. Anything still inside
  // it is work Git no longer tracks as a worktree, and discarding it silently
  // would bypass the dirty-worktree refusal above.
  if (
    fileExists(sessionWorktreeRoot) &&
    isEmptyDirectory(sessionWorktreeRoot)
  ) {
    rmSync(sessionWorktreeRoot, { recursive: true, force: true })
  }

  return {
    bon_id: bonId,
    removed_worktrees: removedWorktrees.sort(),
    removed_agents: removedAgents.sort(),
  }
}
