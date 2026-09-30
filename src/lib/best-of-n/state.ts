/**
 * Best-of-N session constants, types, configs parsing, paths, and the
 * persisted session state.
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { invariant } from '../errors.js'
import { parsePersonaMapping } from '../executors/mapping.js'
import {
  fileExists,
  isRecord,
  readJson,
  sha256,
  writeJsonAtomic,
} from '../io.js'
import { loadState, now, statePath } from '../state.js'
import type { RunState, RunStatus } from '../types.js'

export const CANDIDATE_WORKFLOW = 'delivery-candidate'

export const CONSOLIDATION_WORKFLOW = 'metacritic'

const MINIMUM_CANDIDATES = 2

export const BEST_OF_N_ID_PATTERN =
  /^\d+_[A-Z][a-z]{2}-\d{2}-\d{4}_[a-z0-9](?:[a-z0-9-]{0,10}[a-z0-9])?$/u

const SLOT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

const TIER_ALIAS_PATTERN =
  /^(anthropic|oai|open|cursor):(balanced|advanced|ultra)$/u

export const TERMINAL_STATUSES = new Set<RunStatus>([
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
  operator_artifacts?: boolean
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

    invariant(
      !TIER_ALIAS_PATTERN.test(model),
      `${source}.personas.${persona} names tier alias '${model}'. A best-of-N configs file supports no tier alias. Name an explicit model spec.`,
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

export function bestOfNStatePath(root: string, bonId: string): string {
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

export function persistBestOfNState(
  root: string,
  state: BestOfNState,
): BestOfNState {
  const next = { ...state, updated_at: now() }

  writeJsonAtomic(bestOfNStatePath(root, state.bon_id), next)

  return next
}

/**
 * Suffix shared by one session's run-scoped agent variants. The session id
 * carries characters a Cursor filename should not, so it is reduced to a short
 * stable key that still cannot collide across sessions.
 */
export function sessionKey(bonId: string): string {
  return `bon${sha256(bonId).slice(0, 8)}`
}

export function agentSuffix(bonId: string, slot: string): string {
  return `${sessionKey(bonId)}-${slot}`
}

export function isEmptyDirectory(directory: string): boolean {
  return readdirSync(directory).length === 0
}

export function candidateRunState(
  root: string,
  runId: string,
): RunState | null {
  if (!fileExists(statePath(root, runId))) {
    return null
  }

  return loadState(root, runId)
}
