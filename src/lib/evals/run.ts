import { execFileSync } from 'node:child_process'
import { cpSync, existsSync } from 'node:fs'
import path from 'node:path'

import {
  createRun,
  decideRun,
  delegateEvidenceWorkers,
  delegateInvocation,
  getRunState,
  prepareInvocation,
  submitOutput,
} from '../engine.js'
import { PanError } from '../errors.js'
import { personaExecutorOf } from '../executors/mapping.js'
import { writeRedlineRecord } from '../watch.js'
import {
  attestSupervisorCard,
  redlineCurrent,
  supervisorAttestCommand,
} from '../governance/supervisor-card.js'
import { ensureDir, readJson, writeJsonAtomic, writeTextAtomic } from '../io.js'
import { keywordRunSuffix, makeWorkflowRunId } from '../naming.js'
import { panCommand } from '../project-config.js'
import type { Invocation, RunState } from '../types.js'
import {
  gradeRunRecords,
  writeEvalReport,
  type WrittenEvalReport,
} from './grade.js'
import { fixturePath, loadEvalScenario } from './scenario.js'
import type { EvalReport, LoadedEvalScenario } from './types.js'

export const EVAL_RUNS_DIR = 'runtime/logs/evals'

/** Upper bound on harness transitions one eval run may drive. */
const MAX_DRIVE_STEPS = 40

export interface EvalRunOptions {
  onProgress?: (message: string) => void
  /**
   * Attest the run's supervisor card on the operator's behalf so the driver
   * can advance harness-owned steps. Off by default: the card is a supervisor
   * read contract, so the eval hands off unless the operator opts in.
   */
  attestSupervisorCard?: boolean
  /** Named pipeline config for the run; overrides the scenario's `pipeline_config`. */
  pipelineConfigName?: string
}

export interface EvalRunMetadata {
  schema_version: 1
  eval_id: string
  scenario: string
  scenario_path: string
  run_id: string
  workspace: string
  request_path: string
  created_at: string
  status: 'graded' | 'handoff'
  handoff_reason: string | null
  decisions_applied: { stage: string; decision: string }[]
  /** Set when the eval driver attested the supervisor card under --attest-supervisor-card. */
  supervisor_card_attested_by: 'eval-driver' | null
}

export interface EvalRunResult {
  eval_id: string
  eval_dir: string
  run_id: string
  workspace: string
  status: 'graded' | 'handoff'
  handoff_reason: string | null
  operator_steps: string[]
  report: EvalReport
  report_paths: WrittenEvalReport
}

function toPosix(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/')
}

function uniqueEvalId(root: string, scenarioName: string): string {
  const base = makeWorkflowRunId(
    new Date(),
    keywordRunSuffix(scenarioName) ?? 'eval',
  )
  let candidate = base
  let ordinal = 2

  while (existsSync(path.join(root, EVAL_RUNS_DIR, candidate))) {
    candidate = `${base}-${ordinal}`
    ordinal += 1
  }

  return candidate
}

/** Copy the toy fixture and give it a Git identity so fingerprints work. */
function materializeWorkspace(
  root: string,
  loaded: LoadedEvalScenario,
  workspace: string,
  onProgress?: (message: string) => void,
): void {
  const fixture = fixturePath(root, loaded.scenario.fixture)

  if (!existsSync(fixture)) {
    throw new PanError(
      `Eval fixture '${loaded.scenario.fixture}' is missing at ${toPosix(root, fixture)}.`,
      { code: 'EVAL_FIXTURE_NOT_FOUND' },
    )
  }

  ensureDir(path.dirname(workspace))
  cpSync(fixture, workspace, { recursive: true })

  try {
    const git = (args: string[]): void => {
      execFileSync('git', args, {
        cwd: workspace,
        stdio: 'ignore',
        timeout: 60_000,
      })
    }

    git(['init', '-q'])
    git(['config', 'user.email', 'eval@pancreator.local'])
    git(['config', 'user.name', 'Pancreator eval'])
    git(['add', '.'])
    git(['commit', '-qm', `eval fixture ${loaded.scenario.fixture}`])
  } catch (error) {
    onProgress?.(
      `workspace is not a Git repository (${error instanceof Error ? error.message : String(error)}); continuing without fingerprints`,
    )
  }
}

function operatorSteps(
  root: string,
  loaded: LoadedEvalScenario,
  state: RunState,
  workspace: string,
  evalDir: string,
  reason: string,
): string[] {
  const pan = panCommand(root)
  const runId = state.run_id
  const decisions = loaded.scenario.operator_decisions ?? []
  const card = state.supervisor_card
  const cardUnattested =
    card !== undefined && card.attested_sha256 !== card.sha256

  return [
    `The eval stopped: ${reason}`,
    `Open Cursor in ${root} and run /pan-resume ${runId} in chat. The run's workspace is ${workspace}.`,
    ...(cardUnattested && card
      ? [
          `The supervisor reads ${card.path} in full, then runs \`${supervisorAttestCommand(root, runId, card.sha256)}\`. Pass --attest-supervisor-card to \`${pan} eval run\` to let the driver attest on your behalf instead.`,
        ]
      : []),
    decisions.length > 0
      ? `When the run stops for the operator, apply the scripted decisions: ${decisions
          .map((item) => `${item.stage} -> ${item.decision}`)
          .join(', ')} (\`${pan} decide ${runId} <decision>\`).`
      : 'The scenario scripts no operator decisions.',
    `When the run reaches status '${loaded.scenario.expected.status}', run \`${pan} eval grade ${runId} --scenario ${loaded.scenario.name} --out ${evalDir}\`.`,
  ]
}

function readInvocation(root: string, state: RunState): Invocation | null {
  const pointer = state.current_invocation

  if (!pointer) {
    return null
  }

  return readJson(path.resolve(root, pointer.json_path)) as Invocation
}

/**
 * Drive one bounded toy run. The harness advances every harness-owned step
 * itself, delegates external-executor stages through the same path as
 * `pan delegate`, applies scripted operator decisions, and stops the moment a
 * step needs a Cursor worker or supervisor judgment. Nothing here calls a model.
 */
export function runEval(
  root: string,
  scenarioName: string,
  options: EvalRunOptions = {},
): EvalRunResult {
  const onProgress = options.onProgress
  const loaded = loadEvalScenario(root, scenarioName)
  const { scenario } = loaded
  const evalId = uniqueEvalId(root, scenario.name)
  const evalDirRelative = `${EVAL_RUNS_DIR}/${evalId}`
  const evalDir = path.join(root, evalDirRelative)
  const workspace = path.join(evalDir, 'workspace')
  const requestRelative = `${evalDirRelative}/request.md`

  ensureDir(evalDir)
  materializeWorkspace(root, loaded, workspace, onProgress)
  writeTextAtomic(
    path.join(root, requestRelative),
    scenario.request.endsWith('\n')
      ? scenario.request
      : `${scenario.request}\n`,
  )
  onProgress?.(`workspace ready at ${toPosix(root, workspace)}`)

  const created = createRun(root, {
    workflowSlug: scenario.workflow,
    requestPath: requestRelative,
    title: `eval:${scenario.name}`,
    workspace: `${evalDirRelative}/workspace`,
    verification: scenario.verification,
    involvement: scenario.involvement ?? null,
    pipelineConfigName:
      options.pipelineConfigName ?? scenario.pipeline_config ?? null,
  })
  const runId = created.run_id
  const decisionsApplied: { stage: string; decision: string }[] = []
  const pendingDecisions = [...(scenario.operator_decisions ?? [])]
  const metadata: EvalRunMetadata = {
    schema_version: 1,
    eval_id: evalId,
    scenario: scenario.name,
    scenario_path: loaded.path,
    run_id: runId,
    workspace: toPosix(root, workspace),
    request_path: requestRelative,
    created_at: new Date().toISOString(),
    status: 'handoff',
    handoff_reason: null,
    decisions_applied: decisionsApplied,
    supervisor_card_attested_by: null,
  }

  writeJsonAtomic(path.join(evalDir, 'eval.json'), metadata)
  onProgress?.(`run ${runId} created for workflow ${scenario.workflow}`)

  let handoffReason: string | null = null

  for (let step = 0; step < MAX_DRIVE_STEPS; step += 1) {
    const state = getRunState(root, runId)
    const action = state.pending_action

    if (['succeeded', 'failed', 'canceled'].includes(state.status)) {
      break
    }

    if (
      action.type === 'operator_approval' ||
      action.type === 'operator_decision'
    ) {
      const stage =
        'stage' in action && typeof action.stage === 'string'
          ? action.stage
          : (state.current_stage ?? '')
      const index = pendingDecisions.findIndex((item) => item.stage === stage)

      if (index === -1) {
        handoffReason = `the run needs an operator ${action.type.replace('_', ' ')} at stage '${stage}' that the scenario does not script`
        break
      }

      const [decision] = pendingDecisions.splice(index, 1)

      if (!decision) {
        break
      }

      onProgress?.(
        `applying scripted decision ${decision.decision} at ${stage}`,
      )
      decideRun(root, runId, decision.decision, decision.note ?? '')
      decisionsApplied.push({ stage, decision: decision.decision })
      continue
    }

    if (state.status !== 'running') {
      handoffReason = `the run is '${state.status}' with pending action '${action.type}'`
      break
    }

    const card = state.supervisor_card

    if (card && card.attested_sha256 !== card.sha256) {
      if (!options.attestSupervisorCard) {
        handoffReason = `the supervisor card ${card.path} is not attested at its current digest; a supervisor must read it and attest before the harness prepares an invocation`
        break
      }

      onProgress?.(
        `attesting the supervisor card ${card.path} on the operator's behalf`,
      )
      attestSupervisorCard(root, runId, card.sha256)
      writeRedlineRecord(root, runId, 'pan-start')
      metadata.supervisor_card_attested_by = 'eval-driver'
      continue
    }

    if (card && !redlineCurrent(root, state).current) {
      if (!options.attestSupervisorCard) {
        handoffReason = `supervisor session ${card.session_generation} has written no platform-guidance redline; a supervisor must run pan status --redline before the harness prepares an invocation`
        break
      }

      onProgress?.(
        "writing the platform-guidance redline on the operator's behalf",
      )
      writeRedlineRecord(root, runId, 'pan-start')
      continue
    }

    if (action.type === 'prepare_invocation') {
      onProgress?.('preparing the next invocation')
      prepareInvocation(root, runId, { onProgress })
      continue
    }

    if (action.type === 'invoke_agent') {
      const invocation = readInvocation(root, state)

      if (!invocation) {
        handoffReason = 'the run has no current invocation to delegate'
        break
      }

      // The prepared invocation records the executor the mapping resolved;
      // `stage.model` carries the spec without its executor prefix.
      const executor =
        invocation.stage.persona_executor ??
        personaExecutorOf(invocation.stage.model)

      if (executor !== 'claude-code') {
        handoffReason = `stage '${invocation.stage.slug}' persona '${invocation.stage.persona}' maps to the ${executor} executor, which a Cursor supervisor drives`
        break
      }

      if ((invocation.evidence_workers ?? []).length > 0) {
        const workers = delegateEvidenceWorkers(root, runId, { onProgress })
        const failed = workers.filter((worker) => !worker.ok)

        if (failed.length > 0) {
          handoffReason = `evidence worker(s) did not produce a report: ${failed
            .map(
              (worker) =>
                `${worker.role} (${worker.skipped ?? worker.error ?? 'failed'})`,
            )
            .join(', ')}`
          break
        }
      }

      onProgress?.(`delegating ${invocation.stage.slug} to ${executor}`)

      const delegated = delegateInvocation(root, runId, { onProgress })

      if (!delegated.execution) {
        handoffReason = `delegation paused the run: ${delegated.state.pause_reason ?? 'unknown reason'}`
        break
      }

      const outputPath = delegated.state.current_invocation?.output_path

      if (!outputPath || !existsSync(path.resolve(root, outputPath))) {
        handoffReason = `the external executor left no output at ${outputPath ?? '(unknown)'}`
        break
      }

      onProgress?.(`submitting ${outputPath}`)
      submitOutput(root, runId, outputPath, { onProgress })
      continue
    }

    handoffReason = `pending action '${action.type}' needs the Cursor supervisor`
    break
  }

  const finalState = getRunState(root, runId)

  if (
    handoffReason === null &&
    !['succeeded', 'failed', 'canceled'].includes(finalState.status)
  ) {
    handoffReason = `the drive loop reached its ${MAX_DRIVE_STEPS}-step bound`
  }

  const report = gradeRunRecords(root, runId, loaded)
  const reportPaths = writeEvalReport(root, evalDirRelative, report)
  const status: EvalRunMetadata['status'] =
    handoffReason === null ? 'graded' : 'handoff'

  metadata.status = status
  metadata.handoff_reason = handoffReason
  writeJsonAtomic(path.join(evalDir, 'eval.json'), metadata)

  return {
    eval_id: evalId,
    eval_dir: evalDirRelative,
    run_id: runId,
    workspace: toPosix(root, workspace),
    status,
    handoff_reason: handoffReason,
    operator_steps:
      handoffReason === null
        ? []
        : operatorSteps(
            root,
            loaded,
            finalState,
            toPosix(root, workspace),
            evalDirRelative,
            handoffReason,
          ),
    report,
    report_paths: reportPaths,
  }
}
