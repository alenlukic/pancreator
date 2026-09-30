/**
 * Run lifecycle commands: `init`, `prepare`, `delegate`, `submit`,
 * `assess`, `decide`, `involvement`, `verification`, `pause`,
 * `attribute`, `resume`, `set-stage`, `waive-gate`, and `abort`.
 */

import { createRun, DEFAULT_WORKFLOW_SLUG } from '../lib/engine/create-run.js'
import { assessStage, decideRun } from '../lib/engine/decide.js'
import { delegateInvocation } from '../lib/engine/delegate.js'
import { delegateEvidenceWorkers } from '../lib/engine/evidence-workers.js'
import { pauseRun, resumeRun } from '../lib/engine/pause-resume.js'
import { assertDelegationAgentName } from '../lib/engine/prepare-helpers.js'
import { prepareInvocation } from '../lib/engine/prepare.js'
import { abortRun, getRunState } from '../lib/engine/run-status.js'
import { setRunStage, setRunVerification } from '../lib/engine/set-stage.js'
import { submitOutput } from '../lib/engine/submit.js'
import { waiveGate } from '../lib/engine/waive-gate.js'
import { recordWorkspaceDirective } from '../lib/engine/workspace-directive.js'
import { maybeStartDelivery } from '../lib/cohorts/delivery.js'
import { maybeAdvanceCohort } from '../lib/cohorts/integration.js'
import { PanError } from '../lib/errors.js'
import { orderedWorkerActions } from '../lib/render/delivery-prompt.js'
import { loadOperatorInvolvementFile } from '../lib/operator-involvement.js'
import { loadVerificationFile } from '../lib/verification.js'
import { delegationExecutionPath } from '../lib/validation/artifacts.js'
import { resolveRunLayout } from '../lib/run-layout.js'
import {
  DEFAULT_WORKSPACE_ATTRIBUTION_DISPOSITION,
  isWorkspaceAttributionDisposition,
  WORKSPACE_ATTRIBUTION_DISPOSITIONS,
} from '../lib/workspace-attribution.js'

import type { CliContext } from './context.js'
import {
  assertRunWorktreeBinding,
  commaSeparatedOption,
  deliveryRouteOptions,
  hasFlag,
  integerOption,
  noteOption,
  option,
  print,
  requiredArgument,
  sharedWorktreeWorkspace,
} from './args.js'

/** `pan init`. */
export function initCommand({ root, pan, args }: CliContext): void {
  const workspace = option(args, '--workspace')

  if (workspace && hasFlag(args, '--worktree')) {
    throw new PanError('--workspace and --worktree cannot be used together.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  if (hasFlag(args, '--autostart') && hasFlag(args, '--no-autostart')) {
    throw new PanError(
      '--autostart and --no-autostart cannot be used together.',
      { code: 'INVALID_ARGUMENT' },
    )
  }

  const title = option(args, '--title')
  const worktreeWorkspace = sharedWorktreeWorkspace(root, args, title)
  // Routing on ratification is the planning default. `--autostart` is
  // kept as an explicit spelling of that default; `--no-autostart` is the
  // opt-out that stops the run at the ratified plan.
  const autostartDelivery = hasFlag(args, '--no-autostart')
    ? false
    : hasFlag(args, '--autostart')
      ? true
      : undefined
  const state = createRun(root, {
    workflowSlug:
      option(args, '--workflow', DEFAULT_WORKFLOW_SLUG) ??
      DEFAULT_WORKFLOW_SLUG,
    requestPath: option(args, '--request'),
    title,
    workspace: worktreeWorkspace ? worktreeWorkspace.path : workspace,
    worktree: worktreeWorkspace,
    gatesPath: option(args, '--gates'),
    involvement: option(args, '--involvement'),
    verification: option(args, '--verification'),
    design: hasFlag(args, '--with-design'),
    operatorArtifacts: hasFlag(args, '--operator-artifacts'),
    contextReferencePath: option(args, '--context-reference'),
    autostartDelivery,
    autostartMaxParallel: integerOption(args, '--max-parallel'),
  })

  print({
    status: 'created',
    run_id: state.run_id,
    workflow: state.workflow_slug,
    workspace_root: state.workspace_root,
    managed_worktree: state.managed_worktree ?? null,
    pipeline_config: state.pipeline_config?.name,
    involvement_profile: state.operator_involvement?.profile,
    run_contracts: state.operator_involvement?.contracts ?? [],
    applied_gates: state.operator_involvement?.applied_gates ?? {},
    verification_level: state.verification?.level,
    design_composition: state.design_composition === true,
    operator_artifacts: state.operator_artifacts,
    context_reference: state.request.context_reference ?? null,
    autostart_delivery: state.autostart_delivery ?? false,
    next_command: `${pan} prepare ${state.run_id}`,
    state_path: resolveRunLayout(root, state.run_id).state.relative,
  })
  return
}

/** `pan prepare`. */
export function prepareCommand({ root, args }: CliContext): void {
  const runId = requiredArgument(args[0], 'run-id')
  const agent = option(args, '--agent')

  assertRunWorktreeBinding(root, runId, args)

  // Refuse an unusable label before the run advances, so a prepare either
  // writes delivery-ready evidence or changes nothing.
  if (agent !== null) {
    assertDelegationAgentName(agent)
  }

  const result = prepareInvocation(root, runId, {
    operatorArtifacts: hasFlag(args, '--operator-artifacts'),
    prepareDelegation: true,
    ...(agent !== null ? { agent } : {}),
    onProgress: (message) =>
      process.stderr.write(`[pan next:${runId}] ${message}\n`),
  })

  if (!result.invocation) {
    print({
      status: result.state.status,
      reason: result.state.pause_reason,
      decision_path: result.state.last_decision_path,
      advisories: result.advisories,
    })
    return
  }

  // The ordered launches this stage owes. A verify stage owes its
  // evidence workers before the consolidating worker that reads them.
  const workerActions = orderedWorkerActions(result.invocation)

  print({
    status: 'ready',
    run_id: runId,
    stage: result.invocation.stage.slug,
    persona: result.invocation.stage.persona,
    model: result.invocation.stage.model,
    model_config: result.invocation.stage.model_config,
    invocation_json: result.state.current_invocation?.json_path,
    invocation_markdown: result.state.current_invocation?.markdown_path,
    expected_output: result.state.current_invocation?.output_path,
    ...(workerActions.length > 0 ? { worker_actions: workerActions } : {}),
    ...(result.prepared_delegation
      ? { prepared_delegation: result.prepared_delegation }
      : {}),
    ...(result.prepared_evidence
      ? { prepared_evidence: result.prepared_evidence }
      : {}),
    advisories: result.advisories,
  })
  return
}

/** `pan delegate`. */
export function delegateCommand({ root, pan, args }: CliContext): void {
  const runId = requiredArgument(args[0], 'run-id')
  const timeoutValue = option(args, '--timeout-ms')
  let timeoutMs: number | undefined

  if (timeoutValue !== null) {
    const parsedTimeout = Number(timeoutValue)

    if (!Number.isInteger(parsedTimeout) || parsedTimeout < 1_000) {
      throw new PanError('--timeout-ms MUST be an integer of at least 1000.', {
        code: 'INVALID_ARGUMENT',
      })
    }

    timeoutMs = parsedTimeout
  }

  // --headless lets the operator's own session dispatch a Cursor persona
  // through the harness path when the platform exposes no projected
  // agent to launch: the cursor-agent CLI receives the mapped model
  // explicitly, so the model fidelity INVOCATION-001 protects holds, and
  // the harness authors the delegation evidence itself. As in the
  // headless driver, the stage's evidence workers run first; --evidence-only
  // runs those (optionally one --role) and returns, so a supervisor can
  // dispatch them in parallel processes before the stage worker.
  const headless = hasFlag(args, '--headless')
  const evidenceOnly = hasFlag(args, '--evidence-only')
  const evidenceRole = option(args, '--role')

  if (headless || evidenceOnly) {
    const workers = delegateEvidenceWorkers(root, runId, {
      headless: true,
      ...(evidenceRole ? { roles: [evidenceRole] } : {}),
      onProgress: (message) =>
        process.stderr.write(`[pan delegate:${runId}] ${message}\n`),
    })
    const failed = workers.filter((worker) => !worker.ok)

    if (evidenceOnly || failed.length > 0) {
      print({
        status: failed.length > 0 ? 'evidence_failed' : 'evidence_delegated',
        run_id: runId,
        evidence_workers: workers,
      })

      if (failed.length > 0) {
        process.exitCode = 1
      }

      return
    }
  }

  const result = delegateInvocation(root, runId, {
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(headless ? { headless: true } : {}),
    onProgress: (message) =>
      process.stderr.write(`[pan delegate:${runId}] ${message}\n`),
  })

  if (!result.execution) {
    print({
      status: result.state.status,
      reason: result.state.pause_reason,
      decision_path: result.state.last_decision_path,
    })
    return
  }

  print({
    status: 'delegated',
    run_id: runId,
    stage: result.invocation?.stage.slug,
    persona: result.invocation?.stage.persona,
    executor: result.execution.executor,
    delegation_kind: result.execution.delegation_kind,
    session_id: result.execution.session_id ?? null,
    exit_code: result.execution.exit_code,
    duration_ms: result.execution.duration_ms,
    execution_record: delegationExecutionPath(
      runId,
      result.execution.invocation_id,
      root,
    ),
    expected_output: result.state.current_invocation?.output_path,
    next_command: `${pan} submit ${runId} ${result.state.current_invocation?.output_path ?? '<output-json>'}`,
  })
  return
}

/** `pan submit`. */
export function submitCommand({ root, args }: CliContext): void {
  const runId = requiredArgument(args[0], 'run-id')
  const outputPath = requiredArgument(args[1], 'output-json')

  assertRunWorktreeBinding(root, runId, args)

  process.stderr.write(
    `[pan submit:${runId}] validating stage output, brief, and repository checks...\n`,
  )
  const result = submitOutput(root, runId, outputPath, {
    onProgress: (message) =>
      process.stderr.write(`[pan submit:${runId}] ${message}\n`),
  })
  process.stderr.write(`[pan submit:${runId}] validation complete.\n`)

  // The hook runs after the submission is durable and outside the run
  // mutex, so the integration takes its own mutexes and a failed advance
  // cannot roll back the recorded stage result.
  const advance = maybeAdvanceCohort(root, result.state)

  print({
    status: result.state.status,
    outcome: result.record.outcome,
    stage: result.record.stage.slug,
    operator_brief_html:
      result.record.artifacts.find((artifact) =>
        artifact.path.endsWith('.html'),
      )?.path ?? null,
    next_stage: result.state.current_stage,
    pending_action: result.state.pending_action,
    advisories: result.advisories.map((advisory) => advisory.message),
    ...(advance ? { advance } : {}),
  })
  return
}

/** `pan assess`. */
export function assessCommand({ root, args }: CliContext): void {
  const runId = requiredArgument(args[0], 'run-id')
  const assessmentPath = requiredArgument(args[1], 'assessment-json')
  const result = assessStage(root, runId, assessmentPath)
  const advance = maybeAdvanceCohort(root, result.state)

  print({
    status: result.state.status,
    verdict: result.assessment.verdict,
    next_stage: result.state.current_stage,
    pending_action: result.state.pending_action,
    ...(advance ? { advance } : {}),
  })
  return
}

/** `pan decide`. */
export function decideCommand({ root, args }: CliContext): void {
  const runId = requiredArgument(args[0], 'run-id')
  const decision = requiredArgument(args[1], 'decision')
  const state = decideRun(
    root,
    runId,
    decision,
    noteOption(root, args, '') ?? '',
    option(args, '--stage'),
  )

  // The hook runs after the decision is durable and outside the run mutex,
  // so delivery run creation takes its own mutexes and a routing failure
  // cannot roll back the recorded approval.
  const autostart = maybeStartDelivery(
    root,
    state,
    { actor: 'operator', action: decision },
    deliveryRouteOptions(args),
  )
  // The same shape for the cohort side: a decision that closed the last
  // unit run of a group integrates that group and starts the next one.
  const advance = maybeAdvanceCohort(root, state)

  print({
    status: state.status,
    decision,
    next_stage: state.current_stage,
    operator_revisions: state.operator_revisions ?? {},
    pending_action: state.pending_action,
    ...(autostart ? { autostart } : {}),
    ...(advance ? { advance } : {}),
  })
  return
}

/** `pan involvement`. */
export function involvementCommand({ root }: CliContext): void {
  const file = loadOperatorInvolvementFile(root)

  print(
    {
      active: file.active,
      profiles: Object.fromEntries(
        Object.entries(file.profiles).map(([name, profile]) => [
          name,
          {
            summary: profile.summary,
            gates: profile.gates ?? {},
            contracts: profile.contracts ?? [],
            away_mode: profile.away_mode ?? null,
          },
        ]),
      ),
    },
    true,
  )
  return
}

/** `pan verification`. */
export function verificationCommand({ root, pan, args }: CliContext): void {
  const runId = args[0] && !args[0].startsWith('--') ? args[0] : null

  if (!runId) {
    const file = loadVerificationFile(root)

    print(
      {
        active: file.active,
        levels: Object.fromEntries(
          Object.entries(file.levels).map(([name, level]) => [
            name,
            { summary: level.summary, gates: level.gates },
          ]),
        ),
      },
      true,
    )
    return
  }

  if (args[1] === 'set') {
    const level = requiredArgument(args[2], 'level')
    const state = setRunVerification(
      root,
      runId,
      level,
      option(args, '--note', '') ?? '',
      { confirmed: hasFlag(args, '--confirm') },
    )

    print({
      status: 'updated',
      run_id: runId,
      verification_level: state.verification?.level,
      gates: state.verification?.gates ?? {},
      next_command: `${pan} resume ${runId}`,
    })
    return
  }

  const state = getRunState(root, runId)

  print(
    {
      run_id: runId,
      verification_level: state.verification?.level ?? null,
      summary: state.verification?.summary ?? null,
      gates: state.verification?.gates ?? {},
    },
    true,
  )
  return
}

/** `pan pause`. */
export function pauseCommand({ root, args }: CliContext): void {
  const runId = requiredArgument(args[0], 'run-id')
  const actor = option(args, '--actor', 'operator')

  if (actor !== 'operator' && actor !== 'supervisor') {
    throw new PanError(
      `--actor MUST be 'operator' or 'supervisor', not '${actor}'.`,
      { code: 'INVALID_ARGUMENT' },
    )
  }

  const state = pauseRun(root, runId, noteOption(root, args, '') ?? '', {
    actor,
  })

  print({
    status: state.status,
    current_stage: state.current_stage,
    pause_reason: state.pause_reason,
    pending_action: state.pending_action,
    actor: state.operator_pause?.actor ?? actor,
    decision_path: state.last_decision_path,
  })
  return
}

/** `pan attribute`. */
export function attributeCommand({ root, args }: CliContext): void {
  const runId = requiredArgument(args[0], 'run-id')
  const directive = option(args, '--note')

  if (!directive) {
    throw new PanError('--note is required for attribute.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  const role = option(args, '--role', 'supervisor')

  if (role !== 'supervisor' && role !== 'operator') {
    throw new PanError('--role MUST be supervisor or operator.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  const disposition = option(
    args,
    '--disposition',
    DEFAULT_WORKSPACE_ATTRIBUTION_DISPOSITION,
  )

  if (!isWorkspaceAttributionDisposition(disposition)) {
    throw new PanError(
      `--disposition MUST be one of ${WORKSPACE_ATTRIBUTION_DISPOSITIONS.join(', ')}.`,
      { code: 'INVALID_ARGUMENT' },
    )
  }

  const paths = option(args, '--paths')
  const record = recordWorkspaceDirective(root, runId, {
    directive,
    actingRole: role,
    disposition,
    ...(paths ? { paths: paths.split(',') } : {}),
  })

  print({
    directive_id: record.directive_id,
    acting_role: record.acting_role,
    disposition: record.disposition,
    changed_paths: record.changed_paths,
    artifact_path: record.artifact_path,
  })
  return
}

/** `pan resume`. */
export function resumeCommand({ root, pan, args }: CliContext): void {
  const runId = requiredArgument(args[0], 'run-id')

  assertRunWorktreeBinding(root, runId, args)

  const state = resumeRun(
    root,
    runId,
    option(args, '--stage'),
    noteOption(root, args, '') ?? '',
  )

  print({
    status: state.status,
    current_stage: state.current_stage,
    next_command: `${pan} prepare ${runId}`,
  })
  return
}

/** `pan set-stage`. */
export function setStageCommand({ root, pan, args }: CliContext): void {
  const runId = requiredArgument(args[0], 'run-id')
  const stage = option(args, '--stage')
  const note = noteOption(root, args)

  if (!stage) {
    throw new PanError('--stage is required for set-stage.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  if (!note || note.trim().length === 0) {
    throw new PanError('--note or --note-file is required for set-stage.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  const state = setRunStage(root, runId, stage, note, {
    abandonWorkers: hasFlag(args, '--abandon-workers'),
  })

  print({
    status: state.status,
    current_stage: state.current_stage,
    pending_action: state.pending_action,
    next_command: `${pan} prepare ${runId}`,
  })
  return
}

/** `pan waive-gate`. */
export function waiveGateCommand({ root, args }: CliContext): void {
  const runId = requiredArgument(args[0], 'run-id')
  const criteria = commaSeparatedOption(args, '--criteria') ?? []
  const note = noteOption(root, args)

  if (!note || note.trim().length === 0) {
    throw new PanError('--note or --note-file is required for waive-gate.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  const result = waiveGate(root, runId, {
    stageSlug: option(args, '--stage'),
    targetStage: option(args, '--to'),
    criterionIds: criteria,
    note,
    deferredAcceptanceCriteria: commaSeparatedOption(args, '--defer') ?? [],
    createSpotfixCase: hasFlag(args, '--spotfix'),
    adoptPlanFromRunId: option(args, '--adopt-plan-from'),
  })

  print({
    status: result.state.status,
    current_stage: result.state.current_stage,
    pending_action: result.state.pending_action,
    waiver_id: result.waiver.waiver_id,
    waiver_artifact: result.waiver.artifact_path,
    directive_target: result.waiver.directive_target ?? null,
    spotfix_case: result.waiver.spotfix_case_path ?? null,
    entry_gates_reached: result.entry_gates_reached,
    worktree_claim_transfer: result.claimTransfer ?? null,
  })
  return
}

/** `pan abort`. */
export function abortCommand({ root, args }: CliContext): void {
  const runId = requiredArgument(args[0], 'run-id')
  const state = abortRun(root, runId, option(args, '--note', '') ?? '')

  print({
    status: state.status,
    run_id: runId,
    // Work the run is leaving uncommitted belongs to nobody once the run
    // is terminal, so the command that ends it says what it left.
    ...(state.dirty_exit ? { dirty_exit: state.dirty_exit } : {}),
  })
  return
}
