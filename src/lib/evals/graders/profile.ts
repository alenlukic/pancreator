/** Profile executions a run recorded and the grader that bounds them. */

import path from 'node:path'

import { recordedProfileRuns } from '../../agent-ledger-evidence.js'
import { isRecord, readJson } from '../../io.js'
import { loadRepositoryChecks } from '../../repository-checks/config.js'
import type { DeterministicResult } from '../../types.js'
import { outputStrings, type RunRecords } from '../run-records.js'
import { config, type Grader, historyForInvocation } from './context.js'

// ---------------------------------------------------------------------------
// profile-executions
// ---------------------------------------------------------------------------

export type ProfileExecutionSource = 'baseline' | 'harness' | 'agent'

/** The record an execution was counted from, named in the eval report. */
export type ProfileExecutionBasis =
  | 'baseline_artifact'
  | 'gate_record'
  | 'agent_ledger'
  | 'output_text'

export interface ProfileExecution {
  profile: string
  stage: string
  attempt: number | null
  source: ProfileExecutionSource
  basis: ProfileExecutionBasis
  evidence: string
}

export interface ProfileExecutionLimit {
  profile: string
  source: ProfileExecutionSource | 'any'
  scope: 'attempt' | 'stage' | 'run'
  stage?: string
  max?: number
  /** Enforced only when the run has succeeded, because an open run is not finished. */
  min?: number
}

const PAN_PROFILE_COMMAND = /pan repository-check ([a-z][a-z0-9_-]*)/gu

function commandMentioned(text: string, command: string): boolean {
  let index = text.indexOf(command)

  while (index !== -1) {
    const before = index === 0 ? '' : text[index - 1]
    const after = text[index + command.length] ?? ''
    const boundaryBefore = before === '' || !/[\w./-]/u.test(before)
    const boundaryAfter = after === '' || !/[\w:./-]/u.test(after)

    if (boundaryBefore && boundaryAfter) {
      return true
    }

    index = text.indexOf(command, index + 1)
  }

  return false
}

/** Collect every observable repository-check profile execution in the run. */
export function collectProfileExecutions(records: RunRecords): {
  executions: ProfileExecution[]
  profile_commands: Record<string, string[]>
} {
  const executions: ProfileExecution[] = []
  let profileCommands: Record<string, string[]> = {}

  try {
    profileCommands = Object.fromEntries(
      Object.entries(loadRepositoryChecks(records.root).profiles).map(
        ([name, profile]) => [name, profile.commands],
      ),
    )
  } catch {
    profileCommands = {}
  }

  // Baselines: agent/evidence/pre-implementation-<profile>.json, one run each.
  for (const relative of records.evidence_paths) {
    const match = /pre-implementation-([a-z][a-z0-9_-]*)\.json$/u.exec(relative)

    if (!match) {
      continue
    }

    let stage = 'implement'

    try {
      const evidence = readJson(path.join(records.root, relative))

      if (isRecord(evidence) && typeof evidence.stage === 'string') {
        stage = evidence.stage
      }
    } catch {
      // The file name alone proves the baseline ran.
    }

    executions.push({
      profile: match[1] ?? 'unknown',
      stage,
      attempt: null,
      source: 'baseline',
      basis: 'baseline_artifact',
      evidence: relative,
    })
  }

  // Harness gates: a shell criterion that actually ran its profile command.
  // An entry gate runs once when the run enters the stage and its recorded
  // result is carried into the stage's submission, so the same execution can
  // appear both on the entry-gate record and in stage_history; the evidence
  // path identifies the execution.
  const harnessEvidence = new Set<string>()
  const pushHarnessGate = (
    gate: DeterministicResult,
    stage: string,
    attempt: number | null,
    fallbackEvidence: string,
  ): void => {
    if (gate.type !== 'shell' || typeof gate.command !== 'string') {
      return
    }

    const match = /pan repository-check ([a-z][a-z0-9_-]*)/u.exec(gate.command)

    if (!match) {
      return
    }

    if (gate.cached || gate.skipped || gate.disabled || gate.overridden) {
      return
    }

    const evidence = gate.evidence_path ?? fallbackEvidence

    if (gate.evidence_path && harnessEvidence.has(gate.evidence_path)) {
      return
    }

    if (gate.evidence_path) {
      harnessEvidence.add(gate.evidence_path)
    }

    executions.push({
      profile: match[1] ?? 'unknown',
      stage,
      attempt,
      source: 'harness',
      basis: 'gate_record',
      evidence,
    })
  }

  for (const item of records.state.stage_history) {
    for (const result of item.deterministic ?? []) {
      pushHarnessGate(
        result as DeterministicResult,
        item.stage,
        item.attempt,
        item.record_path ?? item.output_path,
      )
    }
  }

  for (const [stage, record] of Object.entries(
    records.state.entry_gates ?? {},
  )) {
    pushHarnessGate(
      record.last_result,
      stage,
      null,
      records.layout.state.relative,
    )
  }

  const stageOfInvocation = (
    invocationId: string | null,
  ): { stage: string; attempt: number | null } => {
    const history = invocationId
      ? historyForInvocation(records, invocationId)
      : undefined

    if (history) {
      return { stage: history.stage, attempt: history.attempt }
    }

    const current =
      invocationId !== null &&
      records.state.current_invocation?.id === invocationId
        ? (records.state.current_stage ?? 'unknown')
        : 'unknown'

    return { stage: current, attempt: null }
  }

  // Agent-side: `pan repository-check --run` appends one ledger line per
  // execution, so the ledger counts what happened. The output-text scan below
  // is a declared fallback for a target whose profile commands bypass `pan`,
  // and it applies only when the run holds no ledger at all. A worker that
  // cites a command has not run it, and a run whose ledger exists needs no
  // inference from prose.
  const ledger = recordedProfileRuns(records.root, records.run_id)

  if (ledger) {
    for (const entry of ledger) {
      if (entry.invokedBy !== 'agent') {
        continue
      }

      const { stage, attempt } = stageOfInvocation(entry.invocationId)

      executions.push({
        profile: entry.profile,
        stage,
        attempt,
        source: 'agent',
        basis: 'agent_ledger',
        evidence: entry.evidencePath ?? entry.ledgerPath,
      })
    }

    return { executions, profile_commands: profileCommands }
  }

  for (const record of records.outputs) {
    const { stage, attempt } = stageOfInvocation(record.invocation_id)

    // One output is one execution claim per profile. A worker that names the
    // same run in its notes, criteria, and evidence still ran it once; the
    // count of mentions is not the count of executions.
    const seen = new Set<string>()

    for (const text of outputStrings(record.output)) {
      for (const match of text.matchAll(PAN_PROFILE_COMMAND)) {
        seen.add(match[1] ?? 'unknown')
      }

      for (const [profile, commands] of Object.entries(profileCommands)) {
        if (commands.some((command) => commandMentioned(text, command))) {
          seen.add(profile)
        }
      }
    }

    for (const profile of seen) {
      executions.push({
        profile,
        stage,
        attempt,
        source: 'agent',
        basis: 'output_text',
        evidence: record.path,
      })
    }
  }

  return { executions, profile_commands: profileCommands }
}

function defaultProfileLimits(records: RunRecords): ProfileExecutionLimit[] {
  // The full profile runs only as the ship release gate, once per visit of
  // ship, so a run that reached ship under a level that does not disable the
  // gate owes exactly one harness execution; every other run owes none.
  const reachedShip = records.state.stage_history.some(
    (item) => item.stage === 'ship',
  )
  const releaseGateDisabled =
    records.state.verification?.gates['ship.full_suite'] === false
  const fullGates = reachedShip && !releaseGateDisabled ? 1 : 0

  return [
    { profile: 'fast', source: 'agent', scope: 'attempt', max: 1 },
    { profile: 'static', source: 'agent', scope: 'attempt', max: 1 },
    { profile: 'full', source: 'agent', scope: 'run', max: 0 },
    { profile: 'full', source: 'baseline', scope: 'run', max: 0 },
    {
      profile: 'full',
      source: 'harness',
      scope: 'run',
      max: fullGates,
      min: fullGates,
    },
  ]
}

function isProfileLimit(value: unknown): value is ProfileExecutionLimit {
  return (
    isRecord(value) &&
    typeof value.profile === 'string' &&
    ['baseline', 'harness', 'agent', 'any'].includes(String(value.source)) &&
    ['attempt', 'stage', 'run'].includes(String(value.scope))
  )
}

export const profileExecutions: Grader = (context) => {
  const { records } = context
  const { executions, profile_commands } = collectProfileExecutions(records)
  const configured = config<unknown>(context, 'limits', null)
  const limits = Array.isArray(configured)
    ? configured.filter(isProfileLimit)
    : defaultProfileLimits(records)

  const violations: string[] = []
  const succeeded = records.state.status === 'succeeded'

  for (const limit of limits) {
    const relevant = executions.filter(
      (execution) =>
        execution.profile === limit.profile &&
        (limit.source === 'any' || execution.source === limit.source) &&
        (limit.stage === undefined || execution.stage === limit.stage),
    )
    const groups = new Map<string, ProfileExecution[]>()

    for (const execution of relevant) {
      const key =
        limit.scope === 'run'
          ? 'run'
          : limit.scope === 'stage'
            ? execution.stage
            : `${execution.stage}#${execution.attempt ?? 'baseline'}`

      groups.set(key, [...(groups.get(key) ?? []), execution])
    }

    if (limit.scope === 'run' && groups.size === 0) {
      groups.set('run', [])
    }

    for (const [key, group] of groups) {
      const label = `${limit.profile}/${limit.source}/${limit.scope}${
        key === 'run' ? '' : `:${key}`
      }`

      if (limit.max !== undefined && group.length > limit.max) {
        violations.push(
          `${label}: ${group.length} execution(s), max ${limit.max} (${group
            .map((execution) => execution.evidence)
            .join(', ')})`,
        )
      }

      if (succeeded && limit.min !== undefined && group.length < limit.min) {
        violations.push(
          `${label}: ${group.length} execution(s), min ${limit.min} on a succeeded run`,
        )
      }
    }
  }

  const counts: Record<string, number> = {}
  const countsByBasis: Record<string, number> = {}

  for (const execution of executions) {
    const key = `${execution.stage}/${execution.profile}/${execution.source}`

    counts[key] = (counts[key] ?? 0) + 1
    countsByBasis[execution.basis] = (countsByBasis[execution.basis] ?? 0) + 1
  }

  return {
    passed: violations.length === 0,
    summary:
      violations.length === 0
        ? `${executions.length} profile execution(s) observed; every limit holds.`
        : `${violations.length} profile limit violation(s).`,
    evidence: [...new Set(executions.map((execution) => execution.evidence))],
    details: {
      counts_by_stage_profile_source: counts,
      counts_by_basis: countsByBasis,
      executions,
      limits,
      violations,
      profile_commands,
    },
    observability:
      'Every execution names the record it was counted from in its `basis`. ' +
      'Baselines are the agent/evidence/pre-implementation-<profile>.json files. ' +
      'Harness gates are shell criteria in stage_history or on state.entry_gates whose command is `pan repository-check <profile>` and that were not cached, skipped, disabled, or overridden; one evidence path is one execution. ' +
      'Agent-side executions come from the run ledger agent/evidence/repository-check-runs.jsonl, where one agent-initiated line is one execution. ' +
      'Only a run with no ledger falls back to scanning the strings of a submitted output for `pan repository-check <profile>` or a configured profile command; that fallback covers a target whose profile commands bypass `pan`, and it counts a citation as an execution.',
  }
}
