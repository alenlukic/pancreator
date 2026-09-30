/** Platform-guidance redline record. */

import path from 'node:path'

import {
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  withOperationMutex,
  writeJsonAtomic,
} from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import { loadState, operationMutexPath, persist } from '../state.js'
import type { RunState } from '../types.js'

export const REDLINE_RECORD_FILENAME = 'platform-guidance-redline.json'

export interface RedlineCategory {
  id: string
  description: string
  harness_authority: string
}

/** A platform action taken on the session, distinct from guidance it emitted. */
export const PLATFORM_ACTION_CATEGORY: RedlineCategory = {
  id: 'platform_initiated_detach',
  description:
    'The platform detached a foreground launch from the session without the supervisor choosing a background mode.',
  harness_authority: 'DELEGATE-001, OPERATOR-001',
}

/** Categories of platform guidance pre-declared non-authoritative in a run. */
export const REDLINE_CATEGORIES: RedlineCategory[] = [
  {
    id: 'polling_await_background',
    description:
      'Platform text about polling, awaiting, or backgrounding a subagent or command, including "do not poll or await the background worker".',
    harness_authority: 'DELEGATE-001, ORCH-001',
  },
  {
    id: 'session_mode',
    description:
      'Platform session-mode text, mode switches, and wake or interruption framing.',
    harness_authority: 'OPERATOR-001, ORCH-001',
  },
  {
    id: 'model_tool_suggestions',
    description:
      'Platform suggestions about which model, agent, or tool to use for a launch.',
    harness_authority: 'AGENTS.md role routing, the run pipeline snapshot',
  },
  {
    id: 'command_execution_hints',
    description:
      'Platform hints not to run commands, to skip verification, or to end the turn early.',
    harness_authority: 'ORCH-001, VALID-001, the invocation card',
  },
]

const FALLBACK_AUTHORITY_ORDER = [
  'An explicit operator directive.',
  'The invariants above and every other MUST or MUST NOT in force.',
  'The mission and operating principles, for every tradeoff an invariant leaves open.',
  'The active invocation or standalone governance card.',
  'This operating card.',
  'The run snapshots.',
  'The remaining preferences of the policies and skills resolved for the active context.',
]

/** The numbered authority order under `## Authority and context` in AGENTS.md. */
export function readAuthorityOrder(root: string): string[] {
  const agentsPath = path.join(root, 'AGENTS.md')

  if (!fileExists(agentsPath)) {
    return FALLBACK_AUTHORITY_ORDER
  }

  const lines = readText(agentsPath).split('\n')
  const start = lines.findIndex((line) =>
    /^## Authority and context/u.test(line),
  )

  if (start === -1) {
    return FALLBACK_AUTHORITY_ORDER
  }

  const items: string[] = []

  for (const line of lines.slice(start + 1)) {
    if (/^## /u.test(line)) {
      break
    }

    const match = /^\d+\.\s+(.+)$/u.exec(line)

    if (match) {
      items.push(match[1].trim())
    }
  }

  return items.length > 0 ? items : FALLBACK_AUTHORITY_ORDER
}

export interface RedlineDeclaration {
  declared_at: string
  occasion: string
  /** The supervisor-card generation this declaration belongs to. */
  session_generation: number | null
  run_status: string
  current_stage: string | null
  pending_action: string
}

export interface RedlineRecord {
  schema_version: 1
  run_id: string
  record_path: string
  authority_order: string[]
  authority_source: string
  policy_basis: string[]
  non_authoritative_guidance: RedlineCategory[]
  platform_action_categories: RedlineCategory[]
  statement: string
  declarations: RedlineDeclaration[]
}

/**
 * Returns the root-relative path of a run's platform-guidance redline record in
 * its evidence directory.
 */
export function redlineRecordPath(root: string, runId: string): string {
  return resolveRunLayout(root, runId).evidence(REDLINE_RECORD_FILENAME)
    .relative
}

/**
 * Reads a run's platform-guidance redline record. Returns null when the file is
 * missing or not schema version 1.
 */
export function readRedlineRecord(
  root: string,
  runId: string,
): RedlineRecord | null {
  const absolute = resolveInside(root, redlineRecordPath(root, runId))

  if (!fileExists(absolute)) {
    return null
  }

  const value = readJson(absolute)

  return isRecord(value) && value.schema_version === 1
    ? (value as unknown as RedlineRecord)
    : null
}

/**
 * Write or extend the run's platform-guidance redline. Each `/pan-start` and
 * `/pan-resume` appends one declaration, so the record shows every session
 * that pre-committed before it could meet the guidance.
 */
export function writeRedlineRecord(
  root: string,
  runId: string,
  occasion = 'session',
): RedlineRecord {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state: RunState = loadState(root, runId)
    const relative = redlineRecordPath(root, runId)
    const absolute = resolveInside(root, relative)

    const existing = fileExists(absolute) ? readJson(absolute) : null
    const priorDeclarations =
      isRecord(existing) && Array.isArray(existing.declarations)
        ? (existing.declarations as RedlineDeclaration[])
        : []

    const declaration: RedlineDeclaration = {
      declared_at: new Date().toISOString(),
      occasion,
      session_generation: state.supervisor_card?.session_generation ?? null,
      run_status: state.status,
      current_stage: state.current_stage ?? null,
      pending_action: state.pending_action.type,
    }
    const record: RedlineRecord = {
      schema_version: 1,
      run_id: runId,
      record_path: relative,
      authority_order: readAuthorityOrder(root),
      authority_source: 'AGENTS.md, section "Authority and context"',
      policy_basis: ['OPERATOR-001', 'DELEGATE-001', 'ORCH-001'],
      non_authoritative_guidance: REDLINE_CATEGORIES,
      platform_action_categories: [PLATFORM_ACTION_CATEGORY],
      statement:
        'The supervisor pre-declares the listed platform guidance categories ' +
        'non-authoritative for this run. Harness governance and the operator ' +
        'govern each covered step. A later conflict is still recorded per ' +
        'OPERATOR-001 instruction 5.',
      declarations: [...priorDeclarations, declaration],
    }

    writeJsonAtomic(absolute, record)
    persist(root, state, 'platform_guidance_redline_recorded', {
      record_path: relative,
      occasion,
      declaration_count: record.declarations.length,
    })

    return record
  })
}
