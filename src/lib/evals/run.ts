import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readdirSync, renameSync } from 'node:fs'
import path from 'node:path'

import { createRun } from '../engine.js'
import type { DeliveryAutostartResult } from '../cohorts.js'
import { driveRun } from '../headless-driver.js'
import { PanError } from '../errors.js'
import {
  gitWorkspaceSnapshot,
  workspaceChangedPathsFromSnapshots,
} from '../git.js'
import { supervisorAttestCommand } from '../governance/supervisor-card.js'
import { ensureDir, writeJsonAtomic, writeTextAtomic } from '../io.js'
import { keywordRunSuffix, makeWorkflowRunId } from '../naming.js'
import { panCommand } from '../project-config.js'
import type {
  PersonaExecutorKind,
  RunState,
  WorkspaceSnapshot,
} from '../types.js'
import {
  gradeRunRecords,
  writeEvalReport,
  type WrittenEvalReport,
} from './grade.js'
import { fixturePath, loadEvalScenario } from './scenario.js'
import type {
  EvalDriverCheck,
  EvalReport,
  LoadedEvalScenario,
} from './types.js'

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

/**
 * Suffix that hides an agent instruction file from Cursor while it sits in
 * the fixture source. Cursor auto-discovers every nested `AGENTS.md` and
 * `CLAUDE.md` in the workspace and merges it into agent context, so the
 * fixture stores `AGENTS.fixture.md` and the copy restores the real name.
 */
const FIXTURE_INSTRUCTION_SUFFIX = '.fixture.md'

/** Rename `<name>.fixture.md` to `<name>.md` at the copied workspace root. */
function restoreFixtureInstructionFiles(workspace: string): void {
  for (const entry of readdirSync(workspace, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(FIXTURE_INSTRUCTION_SUFFIX)) {
      continue
    }

    const restored = `${entry.name.slice(0, -FIXTURE_INSTRUCTION_SUFFIX.length)}.md`

    renameSync(path.join(workspace, entry.name), path.join(workspace, restored))
  }
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
  restoreFixtureInstructionFiles(workspace)

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
  autostart: DeliveryAutostartResult | null,
): string[] {
  const pan = panCommand(root)
  const runId = state.run_id
  const decisions = loaded.scenario.operator_decisions ?? []

  const card = state.supervisor_card
  const cardUnattested =
    card !== undefined && card.attested_sha256 !== card.sha256

  const grade = `${pan} eval grade ${runId} --scenario ${loaded.scenario.name} --out ${evalDir}`

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
    ...deliveryAutostartSteps(pan, grade, autostart),
    ...(autostart === null
      ? [
          `When the run reaches status '${loaded.scenario.expected.status}', run \`${grade}\`.`,
        ]
      : []),
  ]
}

/**
 * Guidance for what the plan approval actually started. The drive loop is the
 * only witness of the route, so the steps describe its result rather than the
 * scenario's request: a single-chunk plan starts one delivery run, a wider
 * plan starts cohort 1, and a failed route names the manual commands.
 */
function deliveryAutostartSteps(
  pan: string,
  grade: string,
  autostart: DeliveryAutostartResult | null,
): string[] {
  if (autostart === null) {
    return []
  }

  if (autostart.status === 'failed') {
    return [
      `Delivery autostart failed${autostart.kind ? ` (${autostart.kind})` : ''}: ${autostart.error}`,
      `Start the route by hand: ${autostart.manual_commands
        .map((command) => `\`${command}\``)
        .join(', then ')}.`,
    ]
  }

  if (autostart.kind === 'delivery') {
    return [
      `Delivery autostart ${autostart.status} (delivery): run ${autostart.run_id} works in ${autostart.worktree}. Supervise it with \`${autostart.resume_command}\`.`,
      `When that run reaches a terminal status, run \`${grade}\`.`,
    ]
  }

  return [
    `Delivery autostart ${autostart.status} (cohort): session ${autostart.cohort_id} started ${autostart.chunks.length} chunk run(s) of cohort ${autostart.cohort_index} with ${autostart.deferred_chunks.length} deferred under a parallelism limit of ${autostart.max_parallel}. Supervise them with \`${autostart.supervise_command}\` and start deferred chunks with \`${pan} cohort start ${autostart.cohort_id}\` as slots free. The harness integrates each finished cohort itself; retry a failed advance with \`${pan} cohort integrate ${autostart.cohort_id}\`.`,
    `When every cohort is satisfied (\`${pan} cohort status ${autostart.cohort_id}\`), run \`${grade}\`.`,
  ]
}

/**
 * What the run did to the harness checkout that graded it. An eval works in
 * its own workspace, so any tracked harness-root change outside `runtime/` is
 * a write the run had no authority to make. Eval run 63310_Aug-30-1404 edited
 * `VERSION`, `CHANGELOG.md`, and four more files in the real working tree and
 * graded as a pass, because no check looked here.
 */
/**
 * Whether the eval runner delegates a stage itself. Every external executor
 * runs through the same path as `pan delegate`; only a cursor persona needs
 * the operator's own supervisor session, so only cursor is handed back.
 */
export function evalDrivesExecutor(executor: PersonaExecutorKind): boolean {
  return executor !== 'cursor'
}

export function harnessRootUntouched(
  root: string,
  before: WorkspaceSnapshot,
): EvalDriverCheck {
  const changed = workspaceChangedPathsFromSnapshots(
    before,
    gitWorkspaceSnapshot(root, { commitBase: before.head }),
  )
    .filter((relativePath) => !relativePath.startsWith('runtime/'))
    .sort()

  return {
    id: 'harness-root-untouched',
    passed: changed.length === 0,
    summary:
      changed.length === 0
        ? 'The run changed no tracked harness-root file outside runtime/.'
        : `The run changed ${changed.length} tracked harness-root file(s) outside runtime/. An eval run MUST NOT write the checkout it is graded from.`,
    evidence: changed,
  }
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

  // Captured before the run creates anything outside its own directory, so
  // the comparison at the end sees every write the drive loop caused.
  const harnessBefore = gitWorkspaceSnapshot(root)

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
    // A scenario without a cohort block keeps the workflow default: a planning
    // run routes on ratification, every other workflow records nothing.
    autostartDelivery: scenario.cohort?.autostart,
    autostartMaxParallel: scenario.cohort?.autostart
      ? (scenario.cohort.max_parallel ?? null)
      : null,
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

  const driven = driveRun(root, runId, {
    maxSteps: MAX_DRIVE_STEPS,
    onProgress,
    attestSupervisorCard: options.attestSupervisorCard,
    attestedBy: 'eval-driver',
    canDelegateExecutor: evalDrivesExecutor,
    unsupportedExecutorReason: (_state, invocation, executor) =>
      `stage '${invocation.stage.slug}' persona '${invocation.stage.persona}' maps to the ${executor} executor, which a Cursor supervisor drives`,
    resolveDecision: ({ action, stage }) => {
      const index = pendingDecisions.findIndex((item) => item.stage === stage)

      if (index === -1) {
        return {
          reason: `the run needs an operator ${action.type.replace('_', ' ')} at stage '${stage}' that the scenario does not script`,
        }
      }

      const [decision] = pendingDecisions.splice(index, 1)

      return (
        decision ?? {
          reason: `the run needs an operator ${action.type.replace('_', ' ')} at stage '${stage}' that the scenario does not script`,
        }
      )
    },
  })
  const handoffReason = driven.handoff_reason
  const lastAutostart = driven.last_autostart
  const finalState = driven.state

  decisionsApplied.push(...driven.decisions_applied)
  metadata.supervisor_card_attested_by =
    driven.supervisor_card_attested_by === 'eval-driver' ? 'eval-driver' : null

  const report = gradeRunRecords(root, runId, loaded)
  const harnessCheck = harnessRootUntouched(root, harnessBefore)

  report.driver_checks = [harnessCheck]
  report.passed = report.passed && harnessCheck.passed

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
            lastAutostart,
          ),
    report,
    report_paths: reportPaths,
  }
}
