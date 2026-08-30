import path from 'node:path'

import { fileExists, isRecord, readJson, readText } from '../io.js'
import { loadRepositoryChecks } from '../repository-checks.js'
import type { DeterministicResult, StageHistoryItem } from '../types.js'
import {
  latestHistoryForStage,
  outputForInvocation,
  outputStrings,
  readDotPath,
  type RunRecords,
} from './run-records.js'
import type {
  EvalExpectedState,
  EvalGraderId,
  EvalGraderSpec,
  EvalGraderVerdict,
  EvalScenario,
} from './types.js'

/**
 * Deterministic graders over a finished or paused run's records. Each grader
 * reads records only, names the evidence it used, and states what it cannot
 * observe. A grader never spawns a process or calls a model.
 */

export interface GraderContext {
  records: RunRecords
  scenario: EvalScenario
  spec: EvalGraderSpec
}

type Grader = (
  context: GraderContext,
) => Omit<EvalGraderVerdict, 'id' | 'policy'>

function config<T>(context: GraderContext, key: string, fallback: T): T {
  const value = context.spec.config?.[key]

  return value === undefined ? fallback : (value as T)
}

function relativeEvidence(records: RunRecords, ...segments: string[]): string {
  return path
    .relative(
      records.root,
      path.join(records.layout.agent.absolute, ...segments),
    )
    .split(path.sep)
    .join('/')
}

function historyForInvocation(
  records: RunRecords,
  invocationId: string,
): StageHistoryItem | undefined {
  return records.state.stage_history.find(
    (item) => item.invocation_id === invocationId,
  )
}

// ---------------------------------------------------------------------------
// profile-executions
// ---------------------------------------------------------------------------

export type ProfileExecutionSource = 'baseline' | 'harness' | 'agent'

export interface ProfileExecution {
  profile: string
  stage: string
  attempt: number | null
  source: ProfileExecutionSource
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
      evidence: relative,
    })
  }

  // Harness gates: a shell criterion that actually ran its profile command.
  for (const item of records.state.stage_history) {
    for (const result of item.deterministic ?? []) {
      const gate = result as DeterministicResult

      if (gate.type !== 'shell' || typeof gate.command !== 'string') {
        continue
      }

      const match = /pan repository-check ([a-z][a-z0-9_-]*)/u.exec(
        gate.command,
      )

      if (!match) {
        continue
      }

      if (gate.cached || gate.skipped || gate.disabled || gate.overridden) {
        continue
      }

      executions.push({
        profile: match[1] ?? 'unknown',
        stage: item.stage,
        attempt: item.attempt,
        source: 'harness',
        evidence: gate.evidence_path ?? item.record_path ?? item.output_path,
      })
    }
  }

  // Agent-side: the worker wrote the profile command into its output.
  for (const record of records.outputs) {
    const history = historyForInvocation(records, record.invocation_id)
    const stage =
      history?.stage ??
      (records.state.current_invocation?.id === record.invocation_id
        ? (records.state.current_stage ?? 'unknown')
        : 'unknown')
    const attempt = history?.attempt ?? null

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
        evidence: record.path,
      })
    }
  }

  return { executions, profile_commands: profileCommands }
}

function defaultProfileLimits(records: RunRecords): ProfileExecutionLimit[] {
  const fullGates = Object.values(
    records.state.verification?.gates ?? {},
  ).filter((profile) => profile === 'full').length

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

const profileExecutions: Grader = (context) => {
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

  for (const execution of executions) {
    const key = `${execution.stage}/${execution.profile}/${execution.source}`

    counts[key] = (counts[key] ?? 0) + 1
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
      executions,
      limits,
      violations,
      profile_commands,
    },
    observability:
      'Baselines are the agent/evidence/pre-implementation-<profile>.json files. ' +
      'Harness gates are shell criteria in stage_history whose command is `pan repository-check <profile>` and that were not cached, skipped, disabled, or overridden. ' +
      'Agent-side executions are mentions of `pan repository-check <profile>` or a configured profile command in the strings of a submitted output (summary, criteria, risks, unknowns, data). ' +
      'A profile a worker ran but did not write into its output is not observable; worker transcripts are not run records.',
  }
}

// ---------------------------------------------------------------------------
// delegation-watch-record
// ---------------------------------------------------------------------------

const BACKGROUND_EVENT = /background|watch/iu

const delegationWatchRecord: Grader = (context) => {
  const { records } = context
  const requireFor = config<'background' | 'all'>(
    context,
    'require_for',
    'background',
  )
  const invocationIds = [
    ...records.state.stage_history.map((item) => item.invocation_id),
    ...(records.state.current_invocation
      ? [records.state.current_invocation.id]
      : []),
  ]
  const unique = [...new Set(invocationIds)]
  const rows: Record<string, unknown>[] = []
  const failures: string[] = []
  const evidence: string[] = []

  for (const invocationId of unique) {
    const watchRelative = relativeEvidence(
      records,
      'evidence',
      `${invocationId}-watch.jsonl`,
    )
    const markerRelative = relativeEvidence(
      records,
      'evidence',
      `${invocationId}-delegation-background.json`,
    )
    const executionRelative = relativeEvidence(
      records,
      'invocations',
      `${invocationId}.delegation-execution.json`,
    )
    const returnRelative = relativeEvidence(
      records,
      'evidence',
      `${invocationId}-foreground-return.json`,
    )
    const watchAbsolute = path.join(records.root, watchRelative)
    let armings = 0
    let wakes = 0
    let entries = 0
    let parseErrors = 0
    let terminalState: string | null = null

    if (fileExists(watchAbsolute)) {
      evidence.push(watchRelative)

      for (const line of readText(watchAbsolute).split('\n')) {
        if (line.trim().length === 0) {
          continue
        }

        try {
          const entry = JSON.parse(line) as unknown

          entries += 1

          if (isRecord(entry)) {
            if (entry.event === 'armed') {
              armings += 1
            }

            if (entry.event === 'wake') {
              wakes += 1

              if (typeof entry.terminal_state === 'string') {
                terminalState = entry.terminal_state
              }
            }
          }
        } catch {
          parseErrors += 1
        }
      }
    }

    const backgroundSources: string[] = []

    if (fileExists(path.join(records.root, markerRelative))) {
      backgroundSources.push(markerRelative)
      evidence.push(markerRelative)
    }

    for (const event of records.events) {
      if (
        event.invocation_id === invocationId &&
        BACKGROUND_EVENT.test(event.type)
      ) {
        backgroundSources.push(`event:${event.type}`)
      }
    }

    // `pan delegate` writes the execution record for an external-executor
    // stage; that record is the harness's own delegation evidence.
    let externalExecution = false

    if (fileExists(path.join(records.root, executionRelative))) {
      try {
        const execution = readJson(path.join(records.root, executionRelative))

        externalExecution = isRecord(execution)
        evidence.push(executionRelative)

        if (
          isRecord(execution) &&
          typeof execution.delegation_kind === 'string' &&
          /background/iu.test(execution.delegation_kind)
        ) {
          backgroundSources.push(executionRelative)
        }
      } catch {
        // An unreadable execution record cannot prove a background delegation.
      }
    }

    // `pan watch --foreground-returned` writes the attestation with both
    // wall-clock times; one without them is not an attestation.
    let foregroundReturn = false

    if (fileExists(path.join(records.root, returnRelative))) {
      try {
        const attestation = readJson(path.join(records.root, returnRelative))

        foregroundReturn =
          isRecord(attestation) &&
          typeof attestation.launched_at === 'string' &&
          typeof attestation.returned_at === 'string'

        if (foregroundReturn) {
          evidence.push(returnRelative)
        }
      } catch {
        // An unreadable attestation proves nothing.
      }
    }

    if (entries > 0) {
      backgroundSources.push(watchRelative)
    }

    const history = historyForInvocation(records, invocationId)
    const backgroundObserved = backgroundSources.length > 0
    const required = requireFor === 'all' || backgroundObserved
    // A submitted stage needs a watch that saw the output land; a still-open
    // invocation only needs the record to exist.
    const needsCompletion = history !== undefined
    const watchSatisfied =
      entries > 0 &&
      parseErrors === 0 &&
      (!needsCompletion || terminalState === 'completed')
    const observedVia = watchSatisfied
      ? 'watch_completed'
      : foregroundReturn
        ? 'foreground_return'
        : externalExecution
          ? 'external_executor'
          : null
    const satisfied = observedVia !== null

    if (required && !satisfied) {
      failures.push(
        `${invocationId}: ${
          entries === 0
            ? `no watch record at ${watchRelative}`
            : parseErrors > 0
              ? `${parseErrors} unreadable watch line(s) in ${watchRelative}`
              : `watch record ${watchRelative} ends without a completed wake (${wakes} wake(s), last state ${terminalState ?? 'none'})`
        } and no foreground-return attestation at ${returnRelative}`,
      )
    }

    rows.push({
      invocation_id: invocationId,
      stage: history?.stage ?? records.state.current_stage,
      background_observed: backgroundObserved,
      background_sources: backgroundSources,
      watch_record: watchRelative,
      watch_entries: entries,
      armings,
      wakes,
      terminal_state: terminalState,
      watch_parse_errors: parseErrors,
      foreground_return_record: returnRelative,
      foreground_return: foregroundReturn,
      external_execution: externalExecution,
      observed_via: observedVia,
      required,
      satisfied,
    })
  }

  const observableBackground = rows.filter(
    (row) => row.background_observed,
  ).length

  return {
    passed: failures.length === 0,
    summary:
      failures.length === 0
        ? requireFor === 'all'
          ? `Every one of ${unique.length} delegation(s) has a completed watch record, a foreground-return attestation, or external-executor evidence.`
          : observableBackground === 0
            ? `No background delegation is observable in ${unique.length} delegation(s); nothing to check.`
            : `Every one of ${observableBackground} background delegation(s) has a completed watch record or a foreground-return attestation.`
        : `${failures.length} delegation(s) without a usable watch record or foreground-return attestation.`,
    evidence: [...new Set(evidence)],
    details: { require_for: requireFor, delegations: rows, failures },
    observability:
      'A watch record is agent/evidence/<invocation-id>-watch.jsonl, written by `pan watch`, one JSON line per arming (`event: armed`) or wake (`event: wake`, with a terminal_state once the output is present). ' +
      'A delegation counts as background when `pan watch --mark-background` wrote agent/evidence/<invocation-id>-delegation-background.json, when a watch record exists, when an events.jsonl entry for the invocation has a type containing background or watch, or when the delegation-execution record names a background delegation_kind. ' +
      'A submitted stage needs a wake with terminal_state completed, or the foreground-return attestation agent/evidence/<invocation-id>-foreground-return.json written by `pan watch --foreground-returned` with launched_at and returned_at, or the delegation-execution record `pan delegate` writes for an external-executor stage. ' +
      '`pan submit` refuses a Cursor worker submission without one of those records (DELEGATION_UNOBSERVED), so a submitted stage without one predates that rule. ' +
      'A launch the platform backgrounded without any harness record is not observable; set require_for to all to demand a record for every delegation.',
  }
}

// ---------------------------------------------------------------------------
// platform-guidance-conflict-recorded
// ---------------------------------------------------------------------------

const GUIDANCE_MENTION =
  /platform[- ](guidance|instruction|injected)|session[- ]mode|platform-injected/iu
const REDLINE_FILE = 'platform-guidance-redline.json'

const platformGuidanceConflictRecorded: Grader = (context) => {
  const { records } = context
  const minRecorded = config<number>(context, 'min_recorded', 0)
  const redlineRelative = relativeEvidence(records, 'evidence', REDLINE_FILE)
  const redlineExists = fileExists(path.join(records.root, redlineRelative))
  const advisoryInvocations = new Set(
    (records.state.advisories ?? [])
      .filter((advisory) => advisory.kind === 'platform_guidance')
      .map((advisory) => advisory.invocation_id ?? ''),
  )
  const eventInvocations = new Set(
    records.events
      .filter((event) => /platform_guidance/u.test(event.type))
      .map((event) => String(event.invocation_id ?? '')),
  )
  const evidence: string[] = []
  const failures: string[] = []
  let recorded = 0
  const rows: Record<string, unknown>[] = []

  // The redline is a pre-declaration, not a conflict record. OPERATOR-001:
  // a later conflict with redlined guidance MUST still be recorded. It is
  // reported, never counted toward min_recorded, and never excuses a mention.
  if (redlineExists) {
    evidence.push(redlineRelative)
  }

  for (const record of records.outputs) {
    const conflicts = record.output.platform_guidance_conflicts ?? []
    const mentions = outputStrings(record.output).filter((text) =>
      GUIDANCE_MENTION.test(text),
    )
    const recordedHere =
      conflicts.length > 0 ||
      advisoryInvocations.has(record.invocation_id) ||
      eventInvocations.has(record.invocation_id)

    recorded += conflicts.length

    if (conflicts.length > 0) {
      evidence.push(record.path)
    }

    if (mentions.length > 0 && !recordedHere) {
      failures.push(
        `${record.invocation_id}: ${mentions.length} platform guidance mention(s) in ${record.path} without a platform_guidance_conflicts entry or redline record`,
      )
    }

    rows.push({
      invocation_id: record.invocation_id,
      output: record.path,
      mentions: mentions.length,
      conflicts_recorded: conflicts.length,
      recorded: recordedHere,
    })
  }

  for (const relative of records.decision_paths) {
    try {
      const decision = readJson(path.join(records.root, relative))
      const text = JSON.stringify(decision)

      if (GUIDANCE_MENTION.test(text) && recorded === 0) {
        failures.push(
          `${relative} mentions platform guidance but the run has no conflict record`,
        )
      }
    } catch {
      // A decision that cannot be read cannot mention anything.
    }
  }

  if (recorded < minRecorded) {
    failures.push(
      `${recorded} conflict record(s) found, scenario needs at least ${minRecorded}`,
    )
  }

  return {
    passed: failures.length === 0,
    summary:
      failures.length === 0
        ? `${recorded} platform guidance conflict record(s); every mention is recorded.`
        : `${failures.length} platform guidance conflict(s) mentioned without a record.`,
    evidence,
    details: {
      min_recorded: minRecorded,
      recorded,
      redline_record: redlineExists ? redlineRelative : null,
      outputs: rows,
      failures,
    },
    observability:
      'Records are platform_guidance_conflicts[] entries in a submitted output, platform_guidance advisories in state.json, platform_guidance_conflict events, and agent/evidence/platform-guidance-redline.json. ' +
      'Mentions are matched in output strings and decision records by the phrases platform guidance, platform instruction, platform-injected, and session mode. ' +
      'A conflict the supervisor met in chat and never wrote into a run record is not observable.',
  }
}

// ---------------------------------------------------------------------------
// attempts-not-spent-on-mechanics
// ---------------------------------------------------------------------------

const HARNESS_VALIDATOR_ERROR = /harness validator ([A-Z0-9-]+) failed/u

function validationRecordsFor(
  records: RunRecords,
  registryId: string,
): string[] {
  const handlerSlug = registryId.replace(/-\d{3}$/u, '').toLowerCase()

  return records.validation_paths.filter((relative) =>
    relative.toLowerCase().includes(handlerSlug),
  )
}

const attemptsNotSpentOnMechanics: Grader = (context) => {
  const { records } = context
  const maxMechanical = config<number>(context, 'max_mechanical_attempts', 0)
  const mechanical: Record<string, unknown>[] = []
  const evidence: string[] = []

  for (const item of records.state.stage_history) {
    if (item.outcome !== 'failure') {
      continue
    }

    const output = outputForInvocation(records, item.invocation_id)
    const workerClaimedSuccess = output?.output.result === 'success'
    const gates = (item.deterministic ?? []) as DeterministicResult[]
    const gateFailed = gates.some((gate) => gate.hard && !gate.passed)
    const selfCriteria = (item.self_criteria ?? []) as { result?: string }[]
    const selfFailed = selfCriteria.some(
      (criterion) => criterion.result === 'fail',
    )
    const validationErrors = item.validation_errors ?? []

    if (
      !workerClaimedSuccess ||
      gateFailed ||
      selfFailed ||
      validationErrors.length === 0
    ) {
      continue
    }

    const validators = [
      ...new Set(
        validationErrors
          .map((message) => HARNESS_VALIDATOR_ERROR.exec(message)?.[1])
          .filter((value): value is string => typeof value === 'string'),
      ),
    ]
    const validationRecords = validators.flatMap((registryId) =>
      validationRecordsFor(records, registryId),
    )
    const rowEvidence = [
      ...(item.record_path ? [item.record_path] : []),
      ...(output ? [output.path] : []),
      ...validationRecords,
      ...records.artifact_json_paths.filter((relative) =>
        relative.endsWith('governance-artifact-issues.json'),
      ),
    ]

    evidence.push(...rowEvidence)
    mechanical.push({
      stage: item.stage,
      attempt: item.attempt,
      invocation_id: item.invocation_id,
      validators,
      validation_errors: validationErrors,
      evidence: rowEvidence,
    })
  }

  return {
    passed: mechanical.length <= maxMechanical,
    summary:
      mechanical.length === 0
        ? 'No stage attempt was consumed by a pre-submit validator alone.'
        : `${mechanical.length} stage attempt(s) consumed by a pre-submit validator that \`pan output validate\` could have run first.`,
    evidence: [...new Set(evidence)],
    details: {
      max_mechanical_attempts: maxMechanical,
      mechanical_attempts: mechanical,
    },
    observability:
      'A mechanical attempt is a stage_history entry with outcome failure whose worker output declared success, whose hard deterministic gates all passed, whose self-criteria did not fail, and whose validation_errors are non-empty. ' +
      'Every such error comes from the submission mirror or a pre-submit policy validator, which `pan output validate` runs before submission. ' +
      'Validation records under agent/validations/ are per policy requirement, so a later attempt overwrites the failing record; the stage_history entry keeps the error text.',
  }
}

// ---------------------------------------------------------------------------
// stage-order-and-terminal-state
// ---------------------------------------------------------------------------

const stageOrderAndTerminalState: Grader = (context) => {
  const { records, scenario } = context
  const expected: EvalExpectedState = {
    ...scenario.expected,
    ...(isRecord(context.spec.config)
      ? (context.spec.config as Partial<EvalExpectedState>)
      : {}),
  }
  const failures: string[] = []
  const state = records.state
  const statePath = path
    .relative(records.root, records.layout.state.absolute)
    .split(path.sep)
    .join('/')

  if (state.status !== expected.status) {
    failures.push(`status is '${state.status}', expected '${expected.status}'`)
  }

  if (
    expected.current_stage !== undefined &&
    state.current_stage !== expected.current_stage
  ) {
    failures.push(
      `current_stage is '${String(state.current_stage)}', expected '${String(expected.current_stage)}'`,
    )
  }

  if (
    expected.pending_action !== undefined &&
    state.pending_action.type !== expected.pending_action
  ) {
    failures.push(
      `pending_action is '${state.pending_action.type}', expected '${expected.pending_action}'`,
    )
  }

  const sequence = expected.stage_sequence ?? []

  sequence.forEach((entry, index) => {
    const wanted = typeof entry === 'string' ? { stage: entry } : entry
    const actual = state.stage_history[index]

    if (!actual) {
      failures.push(
        `stage_history[${index}] is missing, expected '${wanted.stage}'`,
      )
      return
    }

    if (actual.stage !== wanted.stage) {
      failures.push(
        `stage_history[${index}] is '${actual.stage}', expected '${wanted.stage}'`,
      )
    }

    if (wanted.outcome !== undefined && actual.outcome !== wanted.outcome) {
      failures.push(
        `stage_history[${index}] outcome is '${actual.outcome}', expected '${wanted.outcome}'`,
      )
    }
  })

  const evidence = [statePath]

  for (const assertion of expected.output_assertions ?? []) {
    const history = latestHistoryForStage(records, assertion.stage)
    const output = history
      ? outputForInvocation(records, history.invocation_id)
      : undefined

    if (!output) {
      failures.push(`no submitted output for stage '${assertion.stage}'`)
      continue
    }

    evidence.push(output.path)

    const actual = readDotPath(output.output.data, assertion.path)

    if (JSON.stringify(actual) !== JSON.stringify(assertion.equals)) {
      failures.push(
        `${assertion.stage} output data.${assertion.path} is ${JSON.stringify(actual)}, expected ${JSON.stringify(assertion.equals)}`,
      )
    }
  }

  return {
    passed: failures.length === 0,
    summary:
      failures.length === 0
        ? `Run is '${state.status}' at '${String(state.current_stage)}' with the expected stage order.`
        : failures.join('; '),
    evidence,
    details: {
      expected,
      actual: {
        status: state.status,
        current_stage: state.current_stage,
        pending_action: state.pending_action.type,
        stage_sequence: state.stage_history.map((item) => ({
          stage: item.stage,
          outcome: item.outcome,
        })),
      },
      failures,
    },
    observability:
      'Compares state.json status, current_stage, pending_action.type, and the stage_history prefix with the scenario expectation, and dot-path assertions with the latest submitted output of a stage.',
  }
}

// ---------------------------------------------------------------------------

export const GRADERS: Record<EvalGraderId, Grader> = {
  'profile-executions': profileExecutions,
  'delegation-watch-record': delegationWatchRecord,
  'platform-guidance-conflict-recorded': platformGuidanceConflictRecorded,
  'attempts-not-spent-on-mechanics': attemptsNotSpentOnMechanics,
  'stage-order-and-terminal-state': stageOrderAndTerminalState,
}

export function runGrader(context: GraderContext): EvalGraderVerdict {
  const grader = GRADERS[context.spec.id]
  const verdict = grader(context)

  return {
    id: context.spec.id,
    policy: context.spec.policy ?? null,
    ...verdict,
  }
}
