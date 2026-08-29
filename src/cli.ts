#!/usr/bin/env node
import { readdirSync } from 'node:fs'
import path from 'node:path'

import {
  abortRun,
  assessStage,
  createRun,
  decideRun,
  decideRunAsAway,
  delegateInvocation,
  getRunStatus,
  getRunState,
  pauseRun,
  prepareInvocation,
  probeRunInvocationModel,
  quarantineRunForAgent,
  recordSupervisorModelEvidence,
  resumeRun,
  resumeRunAsAway,
  setRunStage,
  setRunStageAsAway,
  setRunVerification,
  submitOutput,
  validateOutputForSubmission,
  waiveGate,
} from './lib/engine.js'
import {
  abandonBestOfNCandidate,
  bestOfNStatus,
  cleanBestOfN,
  consolidateBestOfN,
  initBestOfN,
  pruneBestOfN,
  refreshBestOfNAgents,
} from './lib/best-of-n.js'
import { GATE_CACHE_ENV, gateCacheStatus } from './lib/gate-cache.js'
import { personaExecutorOf } from './lib/executors/mapping.js'
import {
  cursorAuthenticationReadiness,
  probeCursorModels,
} from './lib/executors/cursor-probe.js'
import { claudeCodeVersionPreflight } from './lib/executors/claude-code.js'
import { browserReadiness } from './lib/browser-readiness.js'
import { errorMessage, PanError } from './lib/errors.js'
import {
  configuredWorkspaceRoot,
  harnessConfigName,
  localConfigName,
  mergeConfigValues,
  panCommand,
} from './lib/project-config.js'
import { resolvePolicies } from './lib/policies.js'
import { resolvePrDescriptionContext } from './lib/pr-description.js'
import {
  awayDecisionLedgerPath,
  awayModeTrigger,
  countAwayDecisions,
  readAwayDecisionLedger,
  recordAwayApplyResult,
  recordAwayEvaluation,
  recordAwayEvaluationFailure,
  recordDeterministicShipApproval,
  recordHypervisorQuarantine,
  type AwayDecisionRecord,
} from './lib/away-mode.js'
import {
  createAgentRecoveryRunner,
  hypervisorEventsPath,
  hypervisorProcessStatus,
  registryHealthForRun,
  runHypervisorDaemon,
  startHypervisorProcess,
  stopHypervisorProcess,
  tickHypervisor,
} from './lib/hypervisor.js'
import { runCursorAgentJson } from './lib/executors/cursor-agent.js'
import { gitWorkspaceSnapshot, isGitRepository } from './lib/git.js'
import { listInbox, renderInbox } from './lib/inbox.js'
import {
  loadPipelineConfig,
  loadPipelineConfigSnapshot,
  parsePipelineConfig,
} from './lib/pipeline-config.js'
import { migratePipelineOverrides } from './lib/pipeline-config-migration.js'
import { loadOperatorInvolvementFile } from './lib/operator-involvement.js'
import { loadVerificationFile } from './lib/verification.js'
import { syncCursorProjection } from './lib/projection.js'
import {
  fileExists,
  findProjectRoot,
  isRecord,
  readJson,
  readText,
  resolveInside,
  writeJsonAtomic,
  writeTextAtomic,
} from './lib/io.js'
import type { AgentRecord, RunState } from './lib/types.js'
import type { InvocationKind } from './lib/requirements/types.js'
import {
  delegationExecutionPath,
  invocationValidationPath,
  validateRepository,
} from './lib/validation.js'
import { buildValidationMap } from './lib/requirements/map.js'
import { loadRegistry } from './lib/requirements/registry.js'
import { resolveRequirements } from './lib/requirements/resolve.js'
import {
  inferTargetKind,
  isPassingResult,
  registryStageSlug,
  resolveRequirementTargetPath,
  runRequirement,
} from './lib/requirements/run.js'
import type { ResolvedRequirement } from './lib/types.js'
import {
  readInvocationFromPath,
  scaffoldAssessment,
  scaffoldStageOutput,
} from './lib/requirements/scaffold.js'
import { auditDirectives } from './lib/governance/audit-directives.js'
import { STANDALONE_MODES, buildGovernanceCard } from './lib/governance-card.js'
import { conflictsByTier, resolveReviewScope } from './lib/review-scope.js'
import {
  assertRepositoryChecksValid,
  loadRepositoryChecks,
  repositoryChecksSourcePath,
  runRepositoryCheckStreaming,
} from './lib/repository-checks.js'
import { detectWorkspaceTechnologies } from './lib/technologies.js'
import { resolveRunLayout } from './lib/run-layout.js'
import {
  buildBriefSystem,
  renderBrief,
  validateBriefSystem,
} from './lib/briefs.js'
import { generateOperatorArtifacts } from './lib/operator-artifact-generation.js'
import { maintainWorkflowRuntime } from './lib/workflow-artifacts.js'
import {
  createWorktree,
  listWorktrees,
  readWorktreeIndex,
  reconcileWorktrees,
  removeWorktree,
  resolveOrCreateWorktree,
  resolveWorkspacePathOrWorktree,
} from './lib/worktrees.js'

// The help line is generated from the mode registry. A hand-written list
// drifts the moment a mode is added, and the operator reads this to
// discover what `--mode` accepts.
const STANDALONE_MODE_NAMES = Object.keys(STANDALONE_MODES).sort().join('|')

const HELP_BODY = `Usage:
  pan init --request <repo-relative-file> [--workflow delivery|prototype|design] [--title <title>] [--workspace <dir> | --worktree <name>] [--gates <file>] [--involvement <profile>] [--verification <level>] [--operator-artifacts]
  pan prepare <run-id> [--operator-artifacts]
  pan delegate <run-id> [--timeout-ms <milliseconds>]
  pan submit <run-id> <output-json>
  pan assess <run-id> <assessment-json>
  pan decide <run-id> <approve|reject|revise> [--note <text>] [--stage <stage-slug>]
  pan pause <run-id> [--note <text>]
  pan resume <run-id> [--stage <stage-slug>] [--note <text>]
  pan set-stage <run-id> --stage <stage-slug> --note <reason>
  pan waive-gate <run-id> --note <directive> [--stage <stage-slug>] [--to <stage-slug>] [--criteria <id[,id...]>] [--defer <AC-id[,AC-id...]> --spotfix]
  pan abort <run-id> [--note <text>]
  pan hypervisor start|run|tick|status|stop [--json]
  pan away status|evaluate|apply <run-id> [--decision <id>] [--json]
  pan technologies detect [--worktree <name>] --json
  pan repository-check <profile> [--timeout-ms <milliseconds>] [--workspace <dir|worktree> | --worktree <name>] [--json]
      --timeout-ms raises the effective bound only: resolution keeps the maximum of the request, the profile's own bound, and subset-profile timeouts.
  pan repository-check validate [--json]
  pan worktree create <name> [--from <branch|commit|worktree>] [--description <text>] [--json]
  pan worktree resolve <name> [--description <text>] [--json]
  pan worktree list [--json]
  pan worktree remove <name> [--force] [--json]
  pan worktree reconcile (--into <worktree> | --into-branch <branch>) --source <worktree> --source <worktree> [--json]
  pan status <run-id> [--json]
  pan list [--json]
  pan inbox [--json]
  pan archive [--days <positive-integer>] [--json]
  pan models [--sync] [--probe] [--migrate-from <previous-config.json>] [--json]
  pan models evidence --run <run-id> --role supervisor --effective-model <model> --source <source> [--json]
  pan models --probe --run <run-id> --invocation <invocation-id> [--json]
      --probe launches one minimal cursor-agent call per distinct active model spec and records what Cursor resolved and reports match, recorded, mismatch, or unavailable per spec. It never fails the command, so read the result and error fields. Needs the cursor-agent CLI and CURSOR_API_KEY (process environment, installation .env, or workspace-root .env) or a login. Run pan doctor to see which source resolves.
      --migrate-from preserves the previous effective model map across a tracked config.json replacement: every mapping the new file leaves empty is carried into config_overrides.json, and the replacement stops before mutation when any required mapping stays empty.
  pan validate [--json]
  pan doctor [--worktree <name>] [--json]
  pan requirements resolve --persona <p> --workflow <w> --stage <s> [--kind <kind>] [--output-path <path>] [--json]
  pan requirements run --persona <p> --workflow <w> --stage <s> --kind <kind> --registry <id> --target <path> [--worktree <name>] [--json]
  pan pr-description context [--worktree <name>] [--json]
  pan output scaffold <run-id> --invocation <path> --output <path> [--force]
  pan output validate <run-id> --file <path> [--json]
  pan assessment scaffold <run-id> --invocation <path> --output <path> [--force]
  pan governance audit-directives [--json]
  pan governance card --mode <${STANDALONE_MODE_NAMES}> [--request <path>] [--worktree <name>] [--out <path>] [--base <ref> [--target <ref>]] [--json]
      --base (review mode) renders the base-revision text of every conduct policy the target changes, so the session reviews under the rule in force before the change.
  pan governance review-scope --target <ref> [--base <ref>] [--default-branch <branch>] [--json]
  pan best-of-n init --request <path> --configs <path> [--workflow <slug>] [--consolidation-workflow <slug>] [--operator-artifacts] [--json]
  pan best-of-n status <bon-id> [--json]
  pan best-of-n refresh-agents <bon-id> [--json]
  pan best-of-n abandon <bon-id> <run-id> --note <reason> [--json]
  pan best-of-n consolidate <bon-id> [--json]
  pan best-of-n clean <bon-id> [--force] [--json]
  pan best-of-n prune [--force] [--json]
  pan briefs build [--force] [--json]
  pan briefs validate [--json]
  pan briefs render --input <brief-json> --output <brief-html> [--json]
  pan briefs generate --run <run-id> [--stage <stage-slug>] [--force] [--json]
  pan validation-map [--json]
  pan involvement [--json]
  pan verification [<run-id>] [--json]
  pan verification <run-id> set <level> [--note <text>]
  pan spotfix scaffold-escalation --input <path> --output <path>

Cursor's supervisor reads invocation cards, delegates cursor-executor stages to
named Cursor subagents, and returns structured output to this CLI. Stages whose
persona mapping carries an external executor prefix (claude-code:<model>) are
delegated by the harness itself: 'pan delegate' spawns the executor CLI with
the canonical card and authors the delegation evidence.
`

function helpText(root: string): string {
  const versionPath = path.join(root, 'VERSION')
  const version = fileExists(versionPath)
    ? readText(versionPath).trim()
    : 'unknown'

  return `Pancreator v${version}

${HELP_BODY}`
}

function option(
  args: string[],
  name: string,
  fallback: string | null = null,
): string | null {
  const index = args.indexOf(name)

  if (index === -1) {
    return fallback
  }

  const value = args[index + 1]

  if (!value || value.startsWith('--')) {
    throw new PanError(`${name} requires a value.`, {
      code: 'INVALID_ARGUMENT',
    })
  }

  return value
}

function requiredArgument(
  value: string | null | undefined,
  name: string,
): string {
  if (!value) {
    throw new PanError(`${name} is required.`, { code: 'INVALID_ARGUMENT' })
  }

  return value
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name)
}

/**
 * Utility-wide worktree targeting contract.
 *
 * One shared `--worktree <name>` option selects the workspace a command runs
 * against, creating the named worktree when the index does not hold it yet.
 * `acceptsWorktreeOption` declares every command surface that runs against a
 * selectable workspace; every other command rejects the option explicitly so
 * an unsupported use fails loudly instead of being silently ignored.
 * Projected persona and utility commands that delegate outside the CLI bind
 * their workspace through `pan worktree resolve`, which applies the same
 * create-or-resolve behavior to an operator-named worktree.
 */
const WORKTREE_CAPABLE_SURFACES = [
  'init',
  'repository-check <profile>',
  'technologies detect',
  'doctor',
  'governance card',
]

const SUBCOMMAND_STYLE_COMMANDS = new Set([
  'assessment',
  'away',
  'best-of-n',
  'briefs',
  'governance',
  'hypervisor',
  'output',
  'repository-check',
  'requirements',
  'spotfix',
  'technologies',
  'worktree',
])

function acceptsWorktreeOption(command: string, args: string[]): boolean {
  switch (command) {
    case 'init':
    case 'doctor':
      return true
    case 'repository-check':
      return args[0] !== 'validate'
    case 'technologies':
      return args[0] === 'detect'
    case 'governance':
      return args[0] === 'card'
    default:
      return false
  }
}

function assertWorktreeOptionSupported(command: string, args: string[]): void {
  if (!hasFlag(args, '--worktree') || acceptsWorktreeOption(command, args)) {
    return
  }

  const sub = args[0]
  const surface =
    sub && !sub.startsWith('--') && SUBCOMMAND_STYLE_COMMANDS.has(command)
      ? `${command} ${sub}`
      : command

  throw new PanError(
    `'pan ${surface}' does not run against a selected workspace, so it does ` +
      'not accept --worktree. Commands that accept the shared worktree ' +
      `option: ${WORKTREE_CAPABLE_SURFACES.join(', ')}.`,
    { code: 'WORKTREE_OPTION_UNSUPPORTED' },
  )
}

/** Workspace the shared `--worktree <name>` option selects, created on demand. */
function sharedWorktreeWorkspace(
  root: string,
  args: string[],
  description?: string | null,
): { name: string; path: string } | null {
  const name = option(args, '--worktree')

  if (!name) {
    return null
  }

  const record = resolveOrCreateWorktree(
    root,
    name,
    description ?? `Worktree '${name}'`,
  )

  return { name, path: record.path }
}

function commaSeparatedOption(args: string[], name: string): string[] {
  const value = option(args, name)

  return value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

function repeatedOption(args: string[], name: string): string[] {
  const values: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) {
      continue
    }

    const value = args[index + 1]

    if (!value || value.startsWith('--')) {
      throw new PanError(`${name} requires a value.`, {
        code: 'INVALID_ARGUMENT',
      })
    }

    values.push(value)
    index += 1
  }

  return values
}

const INVOCATION_KINDS = new Set<InvocationKind>([
  'workflow',
  'assessment',
  'spotfix',
  'investigation',
  'repair',
  'decomposition',
  'documentation',
  'standalone',
])

function invocationKindOption(
  args: string[],
  required = false,
): InvocationKind | undefined {
  const value = option(args, '--kind')

  if (!value) {
    if (required) {
      throw new PanError('--kind is required.', { code: 'INVALID_ARGUMENT' })
    }

    return undefined
  }

  if (!INVOCATION_KINDS.has(value as InvocationKind)) {
    throw new PanError(`Unknown invocation kind: ${value}`, {
      code: 'INVALID_ARGUMENT',
    })
  }

  return value as InvocationKind
}

function print(value: unknown, asJson = false): void {
  if (asJson || typeof value !== 'string') {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  } else {
    process.stdout.write(value.endsWith('\n') ? value : `${value}\n`)
  }
}

function parseRunState(value: unknown, source: string): RunState {
  if (
    !isRecord(value) ||
    typeof value.run_id !== 'string' ||
    typeof value.status !== 'string'
  ) {
    throw new PanError(`${source} does not contain a valid run state.`, {
      code: 'INVALID_STATE',
    })
  }

  return value as unknown as RunState
}

function listRuns(root: string): Array<Record<string, unknown>> {
  const base = path.join(root, 'runtime', 'logs', 'workflows')

  if (!fileExists(base)) {
    return []
  }

  return readdirSync(base, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fileExists(resolveRunLayout(root, entry.name).state.absolute),
    )
    .map((entry) => {
      const statePath = resolveRunLayout(root, entry.name).state.absolute

      return parseRunState(readJson(statePath), statePath)
    })
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .map((state) => ({
      ...(() => {
        const health = registryHealthForRun(
          root,
          state.run_id,
          state.current_invocation?.id,
        )

        return {
          agent_health: health?.health ?? 'unknown',
          health_evidence_at: health?.evidence_at ?? null,
          recovery_state: health?.recovery.step ?? null,
        }
      })(),
      run_id: state.run_id,
      title: state.title,
      status: state.status,
      stage: state.current_stage,
      pending_action: state.pending_action.type,
      updated_at: state.updated_at,
    }))
}

function hypervisorModelForRun(root: string, state: RunState): string {
  if (state.pipeline_config) {
    const snapshot = loadPipelineConfigSnapshot(
      root,
      state.pipeline_config.path,
    )
    const model = snapshot.personas.hypervisor

    if (model) {
      return model
    }
  }

  const model = loadPipelineConfig(root).config.personas.hypervisor

  if (!model) {
    throw new PanError(
      "Pipeline configuration does not map persona 'hypervisor'.",
      { code: 'INVALID_PIPELINE_CONFIG' },
    )
  }

  return model
}

function awayEvaluatorPrompt(
  root: string,
  state: RunState,
  blocker: NonNullable<ReturnType<typeof awayModeTrigger>>,
): string {
  const allowedActions = state.away_mode?.guardrails.allowed_actions ?? []
  const evidenceReferences = [
    resolveRunLayout(root, state.run_id).state.relative,
    path.relative(root, hypervisorEventsPath(root)).split(path.sep).join('/'),
  ]

  return [
    'Return JSON only.',
    'Rank the supplied actions from safest to least safe.',
    'Each option needs rank, action, feasible, rationale, evidence, and rollback_plan.',
    'Evidence entries must use the supplied repository-relative paths.',
    'rollback_plan needs non-empty steps and verification.',
    'revise needs note. set-stage needs stage.',
    JSON.stringify({
      run_id: state.run_id,
      invocation_id: state.current_invocation?.id ?? null,
      current_stage: state.current_stage,
      status: state.status,
      pending_action: state.pending_action,
      blocker,
      allowed_actions: allowedActions,
      evidence_references: evidenceReferences,
    }),
  ].join('\n')
}

function applyAwayDecision(
  root: string,
  state: RunState,
  decision: AwayDecisionRecord,
): RunState {
  const selected = decision.selected_action

  if (!selected) {
    throw new PanError('The away decision selected no action.', {
      code: 'AWAY_DECISION_NOT_APPLICABLE',
    })
  }

  switch (selected.action) {
    case 'approve':
    case 'reject':
    case 'revise':
      return decideRunAsAway(
        root,
        state.run_id,
        selected.action,
        selected.note ?? selected.rationale,
      )
    case 'resume':
      return resumeRunAsAway(
        root,
        state.run_id,
        selected.stage ?? state.current_stage,
        selected.note ?? selected.rationale,
      )
    case 'set-stage':
      return setRunStageAsAway(
        root,
        state.run_id,
        requiredArgument(selected.stage, 'selected stage'),
        selected.note ?? selected.rationale,
      )
    default:
      throw new PanError(
        `Unsupported away action: ${String(selected.action)}`,
        { code: 'AWAY_DECISION_NOT_APPLICABLE' },
      )
  }
}

function evaluateAwayState(
  root: string,
  state: RunState,
  blocker: NonNullable<ReturnType<typeof awayModeTrigger>>,
): AwayDecisionRecord {
  if (
    blocker.type === 'operator_approval' &&
    blocker.stage === 'ship' &&
    state.pending_action.type === 'operator_approval' &&
    (state.pending_action.outcome ?? 'success') === 'success'
  ) {
    const evidenceReferences = [
      resolveRunLayout(root, state.run_id).state.relative,
      state.stage_history.at(-1)?.output_path,
    ].filter((item): item is string => typeof item === 'string')

    return recordDeterministicShipApproval(root, state, evidenceReferences)
  }

  // The ledger append re-checks the limit under its lock. This pre-check only
  // skips a model evaluation whose record could never be persisted.
  const budget = state.away_mode?.guardrails.max_decisions_per_run ?? 0

  if (countAwayDecisions(root, state.run_id) >= budget) {
    throw new PanError(
      'The away-mode decision limit for this run is exhausted.',
      { code: 'AWAY_DECISION_LIMIT' },
    )
  }

  const evaluation = runCursorAgentJson({
    cwd: root,
    model: hypervisorModelForRun(root, state),
    prompt: awayEvaluatorPrompt(root, state, blocker),
  })

  if (!evaluation.ok || evaluation.value === undefined) {
    return recordAwayEvaluationFailure(
      root,
      state,
      blocker,
      evaluation.error ?? 'The away evaluator returned no decision.',
    )
  }

  return recordAwayEvaluation(root, state, blocker, evaluation.value)
}

function reprepareRecoveredAgent(
  root: string,
  agent: AgentRecord,
): {
  ok: boolean
  evidence: string
  failure_signature?: string
  supported?: boolean
} {
  const state = getRunState(root, agent.run_id)
  const current = state.current_invocation

  if (
    !current ||
    current.id !== agent.invocation_id ||
    state.current_stage === null
  ) {
    return {
      ok: false,
      supported: false,
      failure_signature: 'invocation-changed',
      evidence: 'The run no longer expects this invocation.',
    }
  }

  const invocation = readJson(resolveInside(root, current.json_path))
  const validationPath = resolveInside(
    root,
    invocationValidationPath(agent.run_id, agent.invocation_id, root),
  )
  const validation = fileExists(validationPath)
    ? readJson(validationPath)
    : undefined
  const priorFingerprint =
    isRecord(invocation) &&
    isRecord(invocation.workspace_before) &&
    typeof invocation.workspace_before.fingerprint === 'string'
      ? invocation.workspace_before.fingerprint
      : null
  const currentFingerprint = gitWorkspaceSnapshot(
    state.workspace_root,
  ).fingerprint
  const validationPassed = isRecord(validation) && validation.status === 'pass'

  if (validationPassed && priorFingerprint === currentFingerprint) {
    return {
      ok: false,
      supported: false,
      failure_signature: 'canonical-invocation-still-valid',
      evidence:
        'The canonical invocation still validates against the workspace.',
    }
  }

  setRunStage(
    root,
    state.run_id,
    state.current_stage,
    'Hypervisor re-prepared an invalid or workspace-stale invocation.',
  )
  const prepared = prepareInvocation(root, state.run_id)

  if (!prepared.invocation) {
    return {
      ok: false,
      failure_signature: 'reprepare-produced-no-invocation',
      evidence: 'The harness did not produce a replacement invocation.',
    }
  }

  return {
    ok: true,
    evidence: `Prepared replacement invocation ${prepared.invocation.invocation_id}.`,
  }
}

function runHypervisorCycle(root: string): Record<string, unknown> {
  const recoveryRunner = createAgentRecoveryRunner(root)
  const tick = tickHypervisor(root, {
    recoveryRunner: {
      ...recoveryRunner,
      reprepare: (agent) => reprepareRecoveredAgent(root, agent),
    },
  })
  const quarantinedRuns = new Set<string>()

  for (const event of tick.recovery_events) {
    if (event.step !== 'quarantine') {
      continue
    }

    const agent = tick.agents.find(
      (candidate) => candidate.agent_id === event.agent_id,
    )

    if (
      !agent ||
      (agent.health !== 'stalled' && agent.health !== 'dead') ||
      quarantinedRuns.has(agent.run_id)
    ) {
      continue
    }

    const reason = `Agent '${agent.agent_id}' was quarantined. ${event.evidence}`
    const state = quarantineRunForAgent(
      root,
      agent.run_id,
      agent.agent_id,
      reason,
    )

    recordHypervisorQuarantine(root, state, {
      health: agent.health,
      summary: reason,
      evidence_reference: path
        .relative(root, hypervisorEventsPath(root))
        .split(path.sep)
        .join('/'),
    })
    quarantinedRuns.add(agent.run_id)
  }

  return { tick, away_decisions: [] }
}

function runAgentPreSubmitValidators(
  root: string,
  runId: string,
  invocation: Record<string, unknown>,
  requirements: ResolvedRequirement[],
  filePath: string,
  submittedValue: Record<string, unknown>,
): Array<{
  requirement: ResolvedRequirement
  result: ReturnType<typeof runRequirement>
}> {
  const catalog = loadRegistry(root)
  const stageSlug =
    isRecord(invocation.stage) && typeof invocation.stage.slug === 'string'
      ? invocation.stage.slug
      : ''

  return requirements.flatMap((requirement) => {
    const entry = catalog.entries.get(requirement.registry_id)

    if (!entry) {
      return []
    }

    if (requirement.registry_id.includes('ASSESSMENT')) {
      return []
    }

    const requiredStage = registryStageSlug(requirement.registry_id)

    if (requiredStage && requiredStage !== stageSlug) {
      return []
    }

    const targetPath = resolveRequirementTargetPath(
      requirement,
      filePath,
      submittedValue,
    )

    if (!targetPath) {
      return [
        {
          requirement,
          result: {
            schema_version: 1 as const,
            requirement_id: requirement.requirement_id,
            policy_id: requirement.policy_id,
            registry_id: requirement.registry_id,
            registry_version: requirement.registry_version,
            handler: 'unresolved-target',
            command: `pan output validate --registry ${requirement.registry_id}`,
            target_path: requirement.target,
            started_at: new Date().toISOString(),
            finished_at: new Date().toISOString(),
            exit_code: 1,
            status: 'failed' as const,
            executor: 'agent' as const,
            issues: [
              {
                code: 'target.unresolved',
                message: `Could not resolve target ${requirement.target}`,
              },
            ],
            evidence_paths: [],
          },
        },
      ]
    }

    const targetKind = inferTargetKind(targetPath)

    if (!entry.target_types.includes(targetKind)) {
      return []
    }

    return [
      {
        requirement,
        result: runRequirement({
          root,
          runId,
          requirement,
          targetPath,
          executor: 'agent',
          invocation,
          runState: getRunState(root, runId) as unknown as Record<
            string,
            unknown
          >,
          catalog,
          persist: true,
        }),
      },
    ]
  })
}

async function main(): Promise<void> {
  const root = findProjectRoot()
  const help = helpText(root)
  const pan = panCommand(root)
  const [command = 'help', ...args] = process.argv.slice(2)
  const json = hasFlag(args, '--json')

  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    print(help)
    return
  }

  assertWorktreeOptionSupported(command, args)

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      print(help)
      return
    case 'init': {
      const workspace = option(args, '--workspace')

      if (workspace && hasFlag(args, '--worktree')) {
        throw new PanError(
          '--workspace and --worktree cannot be used together.',
          { code: 'INVALID_ARGUMENT' },
        )
      }

      const title = option(args, '--title')
      const worktreeWorkspace = sharedWorktreeWorkspace(root, args, title)
      const state = createRun(root, {
        workflowSlug: option(args, '--workflow', 'delivery') ?? 'delivery',
        requestPath: option(args, '--request'),
        title,
        workspace: worktreeWorkspace ? worktreeWorkspace.path : workspace,
        gatesPath: option(args, '--gates'),
        involvement: option(args, '--involvement'),
        verification: option(args, '--verification'),
        operatorArtifacts: hasFlag(args, '--operator-artifacts'),
      })

      print({
        status: 'created',
        run_id: state.run_id,
        workflow: state.workflow_slug,
        workspace_root: state.workspace_root,
        pipeline_config: state.pipeline_config?.name,
        involvement_profile: state.operator_involvement?.profile,
        run_contracts: state.operator_involvement?.contracts ?? [],
        applied_gates: state.operator_involvement?.applied_gates ?? {},
        verification_level: state.verification?.level,
        operator_artifacts: state.operator_artifacts,
        next_command: `${pan} prepare ${state.run_id}`,
        state_path: resolveRunLayout(root, state.run_id).state.relative,
      })
      return
    }
    case 'prepare': {
      const runId = requiredArgument(args[0], 'run-id')
      const result = prepareInvocation(root, runId, {
        operatorArtifacts: hasFlag(args, '--operator-artifacts'),
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
        advisories: result.advisories,
      })
      return
    }
    case 'delegate': {
      const runId = requiredArgument(args[0], 'run-id')
      const timeoutValue = option(args, '--timeout-ms')
      let timeoutMs: number | undefined

      if (timeoutValue !== null) {
        const parsedTimeout = Number(timeoutValue)

        if (!Number.isInteger(parsedTimeout) || parsedTimeout < 1_000) {
          throw new PanError(
            '--timeout-ms MUST be an integer of at least 1000.',
            { code: 'INVALID_ARGUMENT' },
          )
        }

        timeoutMs = parsedTimeout
      }

      const result = delegateInvocation(root, runId, {
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
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
    case 'submit': {
      const runId = requiredArgument(args[0], 'run-id')
      const outputPath = requiredArgument(args[1], 'output-json')
      process.stderr.write(
        `[pan submit:${runId}] validating stage output, brief, and repository checks...\n`,
      )
      const result = submitOutput(root, runId, outputPath, {
        onProgress: (message) =>
          process.stderr.write(`[pan submit:${runId}] ${message}\n`),
      })
      process.stderr.write(`[pan submit:${runId}] validation complete.\n`)

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
      })
      return
    }
    case 'assess': {
      const runId = requiredArgument(args[0], 'run-id')
      const assessmentPath = requiredArgument(args[1], 'assessment-json')
      const result = assessStage(root, runId, assessmentPath)

      print({
        status: result.state.status,
        verdict: result.assessment.verdict,
        next_stage: result.state.current_stage,
        pending_action: result.state.pending_action,
      })
      return
    }
    case 'decide': {
      const runId = requiredArgument(args[0], 'run-id')
      const decision = requiredArgument(args[1], 'decision')
      const state = decideRun(
        root,
        runId,
        decision,
        option(args, '--note', '') ?? '',
        option(args, '--stage'),
      )

      print({
        status: state.status,
        decision,
        next_stage: state.current_stage,
        operator_revisions: state.operator_revisions ?? {},
        pending_action: state.pending_action,
      })
      return
    }
    case 'involvement': {
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
              },
            ]),
          ),
        },
        true,
      )
      return
    }
    case 'verification': {
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
    case 'pause': {
      const runId = requiredArgument(args[0], 'run-id')
      const state = pauseRun(root, runId, option(args, '--note', '') ?? '')

      print({
        status: state.status,
        current_stage: state.current_stage,
        pause_reason: state.pause_reason,
        pending_action: state.pending_action,
        decision_path: state.last_decision_path,
      })
      return
    }
    case 'resume': {
      const runId = requiredArgument(args[0], 'run-id')
      const state = resumeRun(
        root,
        runId,
        option(args, '--stage'),
        option(args, '--note', '') ?? '',
      )

      print({
        status: state.status,
        current_stage: state.current_stage,
        next_command: `${pan} prepare ${runId}`,
      })
      return
    }
    case 'set-stage': {
      const runId = requiredArgument(args[0], 'run-id')
      const stage = option(args, '--stage')
      const note = option(args, '--note')

      if (!stage) {
        throw new PanError('--stage is required for set-stage.', {
          code: 'INVALID_ARGUMENT',
        })
      }

      if (!note || note.trim().length === 0) {
        throw new PanError('--note is required for set-stage.', {
          code: 'INVALID_ARGUMENT',
        })
      }

      const state = setRunStage(root, runId, stage, note)

      print({
        status: state.status,
        current_stage: state.current_stage,
        pending_action: state.pending_action,
        next_command: `${pan} prepare ${runId}`,
      })
      return
    }
    case 'waive-gate': {
      const runId = requiredArgument(args[0], 'run-id')
      const criteria = commaSeparatedOption(args, '--criteria')
      const note = option(args, '--note')

      if (!note || note.trim().length === 0) {
        throw new PanError('--note is required for waive-gate.', {
          code: 'INVALID_ARGUMENT',
        })
      }

      const result = waiveGate(root, runId, {
        stageSlug: option(args, '--stage'),
        targetStage: option(args, '--to'),
        criterionIds: criteria,
        note,
        deferredAcceptanceCriteria: commaSeparatedOption(args, '--defer'),
        createSpotfixCase: hasFlag(args, '--spotfix'),
      })

      print({
        status: result.state.status,
        current_stage: result.state.current_stage,
        pending_action: result.state.pending_action,
        waiver_id: result.waiver.waiver_id,
        waiver_artifact: result.waiver.artifact_path,
        directive_target: result.waiver.directive_target ?? null,
        spotfix_case: result.waiver.spotfix_case_path ?? null,
      })
      return
    }
    case 'abort': {
      const runId = requiredArgument(args[0], 'run-id')
      const state = abortRun(root, runId, option(args, '--note', '') ?? '')

      print({ status: state.status, run_id: runId })
      return
    }
    case 'hypervisor': {
      const subcommand = requiredArgument(args[0], 'hypervisor subcommand')

      if (subcommand === 'start') {
        print(
          startHypervisorProcess(
            root,
            requiredArgument(process.argv[1], 'CLI path'),
          ),
          json,
        )
        return
      }

      if (subcommand === 'run') {
        await runHypervisorDaemon(root, () => {
          runHypervisorCycle(root)
        })
        return
      }

      if (subcommand === 'tick') {
        print(runHypervisorCycle(root), json)
        return
      }

      if (subcommand === 'status') {
        print(hypervisorProcessStatus(root), json)
        return
      }

      if (subcommand === 'stop') {
        print(stopHypervisorProcess(root), json)
        return
      }

      throw new PanError(`Unknown hypervisor subcommand: ${subcommand}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'away': {
      const subcommand = requiredArgument(args[0], 'away subcommand')
      const runId = requiredArgument(args[1], 'run-id')
      const state = getRunState(root, runId)
      const blocker = awayModeTrigger(state)

      if (subcommand === 'status') {
        const runDecisions = readAwayDecisionLedger(root).filter(
          (record) => record.run_id === runId,
        )
        const appliedIds = new Set(
          runDecisions
            .map((record) => record.linked_decision_id)
            .filter((value): value is string => typeof value === 'string'),
        )

        print(
          {
            run_id: runId,
            enabled: state.away_mode?.enabled ?? false,
            blocker,
            decisions: runDecisions.length,
            // The exact ids `pan away apply --decision` accepts, so the
            // supervisor never has to guess between the ledger id and a
            // mirrored run-local decision packet id.
            apply_ready_decision_ids: runDecisions
              .filter(
                (record) =>
                  record.result === 'accepted' &&
                  !appliedIds.has(record.decision_id),
              )
              .map((record) => record.decision_id),
          },
          json,
        )
        return
      }

      if (subcommand === 'evaluate') {
        if (!blocker) {
          throw new PanError(
            'The run has no blocker that away mode can evaluate.',
            { code: 'AWAY_TRIGGER_UNAVAILABLE' },
          )
        }

        print(evaluateAwayState(root, state, blocker), json)
        return
      }

      if (subcommand === 'apply') {
        const decisionId = requiredArgument(
          option(args, '--decision'),
          '--decision',
        )
        const ledger = readAwayDecisionLedger(root)
        const decision = ledger.find(
          (record) =>
            record.run_id === runId &&
            record.decision_id === decisionId &&
            record.result === 'accepted',
        )

        if (!decision) {
          const applied = new Set(
            ledger
              .filter((record) => record.run_id === runId)
              .map((record) => record.linked_decision_id)
              .filter((value): value is string => typeof value === 'string'),
          )
          const applyReady = ledger
            .filter(
              (record) =>
                record.run_id === runId &&
                record.result === 'accepted' &&
                !applied.has(record.decision_id),
            )
            .map((record) => record.decision_id)
          const inLedger = ledger.find(
            (record) => record.decision_id === decisionId,
          )
          // A wrong id is almost always the mirrored run-local decision
          // packet under agent/decisions/. Name the canonical namespace and
          // the ids it would accept, so the caller needs no source dive.
          const detail = inLedger
            ? `The id exists in the ledger but is not an accepted decision for run ${runId} (result: ${inLedger.result}, run: ${inLedger.run_id}).`
            : `The id is not in the away decision ledger at ${awayDecisionLedgerPath(root)}; run-local agent/decisions/ packet ids are not apply ids.`

          throw new PanError(
            `Accepted away decision not found: ${decisionId}. ${detail}` +
              (applyReady.length
                ? ` Apply-ready decision ids for this run: ${applyReady.join(', ')}.`
                : ` No accepted, unapplied decisions exist for this run; run 'pan away evaluate' first.`),
            { code: 'AWAY_DECISION_NOT_FOUND' },
          )
        }

        if (
          ledger.some(
            (record) =>
              record.run_id === runId &&
              record.linked_decision_id === decisionId,
          )
        ) {
          throw new PanError(
            `Away decision was already applied: ${decisionId}`,
            { code: 'AWAY_DECISION_ALREADY_APPLIED' },
          )
        }

        try {
          const next = applyAwayDecision(root, state, decision)
          const record = recordAwayApplyResult(root, decision, 'applied')

          print({ state: next, decision: record }, json)
        } catch (error) {
          recordAwayApplyResult(root, decision, 'failed', errorMessage(error))
          throw error
        }
        return
      }

      throw new PanError(`Unknown away subcommand: ${subcommand}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'technologies': {
      const subcommand = requiredArgument(args[0], 'technologies subcommand')

      if (subcommand !== 'detect') {
        throw new PanError(`Unknown technologies subcommand: ${subcommand}`, {
          code: 'UNKNOWN_COMMAND',
        })
      }

      const worktreeWorkspace = sharedWorktreeWorkspace(root, args)

      print(
        detectWorkspaceTechnologies(
          root,
          worktreeWorkspace ? { workspace: worktreeWorkspace.path } : {},
        ),
        true,
      )
      return
    }
    case 'repository-check': {
      const profile = requiredArgument(args[0], 'profile')

      if (profile === 'validate') {
        const config = assertRepositoryChecksValid(root)

        print(
          {
            status: 'valid',
            config_path: path
              .relative(root, repositoryChecksSourcePath(root))
              .split(path.sep)
              .join('/'),
            profiles: Object.keys(config.profiles).sort(),
          },
          hasFlag(args, '--json'),
        )
        return
      }

      const timeoutValue = option(args, '--timeout-ms')
      let timeoutMs: number | undefined

      if (timeoutValue !== null) {
        const parsedTimeout = Number(timeoutValue)

        if (!Number.isInteger(parsedTimeout) || parsedTimeout < 1_000) {
          throw new PanError(
            '--timeout-ms MUST be an integer of at least 1000.',
            { code: 'INVALID_ARGUMENT' },
          )
        }

        timeoutMs = parsedTimeout
      }

      const workspaceOption = option(args, '--workspace')

      if (workspaceOption && hasFlag(args, '--worktree')) {
        throw new PanError(
          '--workspace and --worktree cannot be used together.',
          { code: 'INVALID_ARGUMENT' },
        )
      }

      const worktreeWorkspace = sharedWorktreeWorkspace(root, args)
      const checkWorkspace = worktreeWorkspace
        ? worktreeWorkspace.path
        : workspaceOption
          ? resolveWorkspacePathOrWorktree(root, workspaceOption)
          : null
      const result = await runRepositoryCheckStreaming(root, profile, {
        ...(timeoutMs !== undefined ? { timeout_ms: timeoutMs } : {}),
        ...(checkWorkspace ? { workspace: checkWorkspace } : {}),
        on_start: (kind, commandText) => {
          process.stderr.write(
            `[repository-check:${profile}] ${kind}: ${commandText}\n`,
          )
        },
        on_stdout: (chunk) => process.stderr.write(chunk),
        on_stderr: (chunk) => process.stderr.write(chunk),
      })

      if (result.status === 'not_configured') {
        process.stderr.write('PANCREATOR_CHECK_SKIPPED=1\n')
      }

      print(result, hasFlag(args, '--json'))

      if (result.status === 'failed') {
        process.exitCode = 1
      }
      return
    }
    case 'worktree': {
      const sub = args[0]
      const rest = args.slice(1)
      const asJson = hasFlag(args, '--json')

      if (sub === 'create') {
        const worktree = createWorktree(
          root,
          requiredArgument(rest[0], 'worktree-name'),
          {
            from: option(args, '--from'),
            description: option(args, '--description'),
          },
        )

        print({ status: 'created', worktree }, asJson)
        return
      }

      if (sub === 'resolve') {
        const name = requiredArgument(rest[0], 'worktree-name')
        const created = !readWorktreeIndex(root).worktrees.some(
          (entry) => entry.name === name,
        )
        const worktree = resolveOrCreateWorktree(
          root,
          name,
          option(args, '--description') ?? `Worktree '${name}'`,
        )

        print({ status: 'resolved', created, worktree }, asJson)
        return
      }

      if (sub === 'list') {
        print({ status: 'listed', worktrees: listWorktrees(root) }, asJson)
        return
      }

      if (sub === 'remove') {
        const removed = removeWorktree(
          root,
          requiredArgument(rest[0], 'worktree-name'),
          { force: hasFlag(args, '--force') },
        )

        print({ status: 'removed', worktree: removed }, asJson)
        return
      }

      if (sub === 'reconcile') {
        const result = reconcileWorktrees(
          root,
          {
            into: option(args, '--into'),
            into_branch: option(args, '--into-branch'),
          },
          repeatedOption(args, '--source'),
        )

        print(result, asJson)

        if (result.status === 'conflict') {
          process.exitCode = 1
        }
        return
      }

      throw new PanError(`Unknown worktree subcommand: ${sub ?? '(missing)'}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'status': {
      const runId = requiredArgument(args[0], 'run-id')
      print(getRunStatus(root, runId, { json }), json)
      return
    }
    case 'list':
      print(listRuns(root), true)
      return
    case 'inbox': {
      const items = listInbox(root)

      if (json) {
        print(items, true)
      } else {
        print(renderInbox(items))
      }

      return
    }
    case 'archive': {
      const daysValue = option(args, '--days')
      const retentionDays = daysValue === null ? 7 : Number(daysValue)

      print(
        maintainWorkflowRuntime(root, { retentionDays }),
        hasFlag(args, '--json'),
      )
      return
    }
    case 'models': {
      const runId = option(args, '--run')
      const invocationId = option(args, '--invocation')

      if (args[0] === 'evidence') {
        const role = requiredArgument(option(args, '--role'), '--role')

        if (role !== 'supervisor') {
          throw new PanError(
            `models evidence supports only role 'supervisor'; got '${role}'.`,
            { code: 'INVALID_ARGUMENT' },
          )
        }

        const recorded = recordSupervisorModelEvidence(
          root,
          requiredArgument(runId, '--run'),
          requiredArgument(
            option(args, '--effective-model'),
            '--effective-model',
          ),
          requiredArgument(option(args, '--source'), '--source'),
        )

        print(
          {
            ...recorded.evidence,
            advisories: recorded.advisories.map((advisory) => advisory.message),
          },
          true,
        )
        return
      }

      if (hasFlag(args, '--probe') && (runId || invocationId)) {
        print(
          probeRunInvocationModel(
            root,
            requiredArgument(runId, '--run'),
            requiredArgument(invocationId, '--invocation'),
          ),
          true,
        )
        return
      }

      // A tracked config.json replacement runs before loadPipelineConfig:
      // the point of the migration is to repair an effective map the normal
      // load would reject. Preservation is validated on the merged result
      // before any file mutation, so a failed migration changes nothing.
      const migrateFrom = option(args, '--migrate-from')
      let migration = null

      if (migrateFrom) {
        const previousPath = path.isAbsolute(migrateFrom)
          ? migrateFrom
          : path.join(root, migrateFrom)
        const trackedName = harnessConfigName(root)

        if (!trackedName) {
          throw new PanError('No config.json exists to migrate.', {
            code: 'INVALID_PIPELINE_CONFIG',
          })
        }

        const next = readJson(path.join(root, trackedName))
        const overridesName = localConfigName(root)
        const overridesPath = path.join(root, overridesName)
        const result = migratePipelineOverrides({
          previous: readJson(previousPath),
          next,
          overrides: fileExists(overridesPath) ? readJson(overridesPath) : null,
        })

        if (result.missing.length > 0) {
          throw new PanError(
            'Configuration replacement stopped before mutation: the ' +
              'effective model map still has empty mappings that the ' +
              `previous configuration cannot fill: ${result.missing.join(', ')}. ` +
              `Add them to ${overridesName} and rerun.`,
            { code: 'INVALID_PIPELINE_CONFIG' },
          )
        }

        // Grammar-validate the merged result before touching the overrides
        // file, so a malformed preservation never lands on disk.
        parsePipelineConfig(
          mergeConfigValues(next, result.overrides),
          trackedName,
        )

        if (result.changed) {
          writeJsonAtomic(overridesPath, result.overrides)
        }

        migration = {
          previous_path: migrateFrom,
          overrides_path: overridesName,
          preserved: result.preserved,
          overrides_written: result.changed,
        }
      }

      const loaded = loadPipelineConfig(root)
      const changes = syncCursorProjection(root, {
        write: hasFlag(args, '--sync'),
      })
      // Static validation proves each spec is well-formed for the catalog
      // snapshot; --probe proves what it launches today by spending one
      // minimal cursor-agent call per distinct spec and comparing the echoed
      // variant against the catalog's prediction.
      const probes = hasFlag(args, '--probe')
        ? probeCursorModels(root, loaded.config.personas)
        : null

      print(
        {
          active_config: loaded.name,
          summary: loaded.config.summary,
          personas: loaded.config.personas,
          persona_executors: Object.fromEntries(
            Object.entries(loaded.config.personas).map(([persona, model]) => [
              persona,
              personaExecutorOf(model),
            ]),
          ),
          sync_requested: hasFlag(args, '--sync'),
          changed_projections: changes.filter((entry) => entry.changed),
          ...(migration ? { migration } : {}),
          ...(probes ? { probes } : {}),
        },
        true,
      )

      if (probes) {
        const failed = probes.filter((probe) => !probe.ok)

        if (failed.length > 0) {
          throw new PanError(
            `${failed.length} model spec(s) did not resolve to the ` +
              `expected variant on live Cursor: ` +
              failed
                .map(
                  (probe) =>
                    `'${probe.spec}' (${probe.personas.join(', ')}) → ` +
                    `${probe.resolved ?? `unresolvable: ${probe.error ?? 'unknown error'}`}` +
                    (probe.expected ? ` (expected '${probe.expected}')` : ''),
                )
                .join('; ') +
              `. Cursor silently falls back to the model's default variant ` +
              `on an unusable spec, so fix these before delegating.`,
            { code: 'UNRESOLVED_CURSOR_MODEL' },
          )
        }
      }
      return
    }
    case 'briefs': {
      const subcommand = requiredArgument(args[0], 'briefs-subcommand')

      if (subcommand === 'build') {
        const result = buildBriefSystem(root, {
          force: hasFlag(args, '--force'),
        })

        print(result, hasFlag(args, '--json'))
        return
      }

      if (subcommand === 'validate') {
        const result = validateBriefSystem(root)

        print(result, hasFlag(args, '--json'))

        if (result.status === 'failed') {
          process.exitCode = 1
        }
        return
      }

      if (subcommand === 'render') {
        const inputPath = requiredArgument(option(args, '--input'), '--input')
        const outputPath = requiredArgument(
          option(args, '--output'),
          '--output',
        )

        print(renderBrief(root, inputPath, outputPath), hasFlag(args, '--json'))
        return
      }

      if (subcommand === 'generate') {
        const runId = requiredArgument(option(args, '--run'), '--run')
        const result = generateOperatorArtifacts(root, {
          runId,
          stage: option(args, '--stage'),
          force: hasFlag(args, '--force'),
        })

        print(result, hasFlag(args, '--json'))
        return
      }

      throw new PanError(`Unknown briefs subcommand: ${subcommand}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'validation-map': {
      print(buildValidationMap(root), hasFlag(args, '--json'))
      return
    }
    case 'governance': {
      const sub = args[0]

      if (sub === 'audit-directives') {
        print(auditDirectives(root), hasFlag(args, '--json'))
        return
      }

      if (sub === 'card') {
        const card = buildGovernanceCard(root, {
          mode: requiredArgument(option(args, '--mode'), '--mode'),
          requestPath: option(args, '--request'),
          outputPath: option(args, '--out'),
          worktreeName: option(args, '--worktree'),
          baseRef: option(args, '--base'),
          targetRef: option(args, '--target'),
        })

        print({
          status: 'ready',
          mode: card.mode,
          card_path: card.path,
          ...(card.worktree
            ? {
                worktree: card.worktree.name,
                workspace_root: card.worktree.path,
              }
            : {}),
          policies: card.policies.map((policy) => policy.id),
          agent_requirements: [
            ...card.requirements.automation_requirements,
            ...card.requirements.validation_requirements,
          ]
            .filter((requirement) => requirement.executor !== 'harness')
            .map((requirement) => requirement.registry_id),
        })
        return
      }

      if (sub === 'review-scope') {
        const scope = resolveReviewScope(root, {
          head: requiredArgument(option(args, '--target'), '--target'),
          base: option(args, '--base'),
          defaultBranch: option(args, '--default-branch'),
        })

        const tiers = conflictsByTier(scope.conflicts)

        print({
          base: scope.base,
          head: scope.head,
          changed_path_count: scope.changed_paths.length,
          independent: scope.independent,
          clean: scope.clean,
          conflicts: {
            instrument: tiers.instrument,
            conduct: tiers.conduct,
            substrate: tiers.substrate,
          },
          standards_delta: scope.standards_delta,
        })
        return
      }

      throw new PanError(
        `Unknown governance subcommand: ${sub ?? '(missing)'}`,
        {
          code: 'UNKNOWN_COMMAND',
        },
      )
    }
    case 'best-of-n': {
      const sub = args[0]
      const rest = args.slice(1)
      const asJson = hasFlag(args, '--json')

      if (sub === 'init') {
        const state = initBestOfN(root, {
          requestPath: requiredArgument(option(args, '--request'), '--request'),
          configsPath: requiredArgument(option(args, '--configs'), '--configs'),
          ...(option(args, '--workflow')
            ? { candidateWorkflow: option(args, '--workflow') as string }
            : {}),
          ...(option(args, '--consolidation-workflow')
            ? {
                consolidationWorkflow: option(
                  args,
                  '--consolidation-workflow',
                ) as string,
              }
            : {}),
          operatorArtifacts: hasFlag(args, '--operator-artifacts'),
        })

        print(
          {
            status: 'created',
            bon_id: state.bon_id,
            candidate_workflow: state.candidate_workflow,
            candidates: state.candidates.map((candidate) => ({
              slot: candidate.slot,
              run_id: candidate.run_id,
              worktree_path: candidate.worktree_path,
            })),
            state_path: `runtime/logs/best-of-n/${state.bon_id}/state.json`,
          },
          asJson,
        )
        return
      }

      if (sub === 'status') {
        print(bestOfNStatus(root, requiredArgument(rest[0], 'bon-id')), asJson)
        return
      }

      if (sub === 'refresh-agents') {
        print(
          refreshBestOfNAgents(root, requiredArgument(rest[0], 'bon-id')),
          asJson,
        )
        return
      }

      if (sub === 'abandon') {
        const state = abandonBestOfNCandidate(
          root,
          requiredArgument(rest[0], 'bon-id'),
          requiredArgument(rest[1], 'run-id'),
          requiredArgument(option(args, '--note'), '--note'),
        )

        print({ status: 'abandoned', candidates: state.candidates }, asJson)
        return
      }

      if (sub === 'consolidate') {
        const state = consolidateBestOfN(
          root,
          requiredArgument(rest[0], 'bon-id'),
        )

        print(
          {
            status: 'created',
            bon_id: state.bon_id,
            consolidation: state.consolidation,
            next_command: `${pan} status ${state.consolidation?.run_id}`,
          },
          asJson,
        )
        return
      }

      if (sub === 'clean') {
        print(
          cleanBestOfN(root, requiredArgument(rest[0], 'bon-id'), {
            force: hasFlag(args, '--force'),
          }),
          asJson,
        )
        return
      }

      if (sub === 'prune') {
        print(pruneBestOfN(root, { force: hasFlag(args, '--force') }), asJson)
        return
      }

      throw new PanError(
        `Unknown best-of-n subcommand: ${sub ?? '(missing)'}`,
        {
          code: 'UNKNOWN_COMMAND',
        },
      )
    }
    case 'pr-description': {
      const sub = args[0]

      if (sub === 'context') {
        const worktreeWorkspace = sharedWorktreeWorkspace(root, args)
        const workspaceRoot = path.resolve(
          root,
          worktreeWorkspace?.path ?? configuredWorkspaceRoot(root),
        )
        const policies = resolvePolicies(root, {
          persona: 'release-steward',
          workflow: 'standalone',
          stage: 'write-pr',
          operator_artifacts: 'requested',
        })

        print(
          resolvePrDescriptionContext(workspaceRoot, policies),
          hasFlag(args, '--json'),
        )
        return
      }

      throw new PanError(
        `Unknown pr-description subcommand: ${sub ?? '(missing)'}`,
        { code: 'UNKNOWN_COMMAND' },
      )
    }
    case 'requirements': {
      const sub = args[0]

      if (sub === 'resolve') {
        const persona = requiredArgument(option(args, '--persona'), '--persona')
        const workflow = requiredArgument(
          option(args, '--workflow'),
          '--workflow',
        )
        const stage = requiredArgument(option(args, '--stage'), '--stage')
        const outputPath = option(args, '--output-path') ?? undefined
        const invocationKind = invocationKindOption(args)

        print(
          resolveRequirements(root, {
            persona,
            workflow,
            stage,
            ...(invocationKind ? { invocation_kind: invocationKind } : {}),
            ...(outputPath
              ? {
                  invocation: {
                    output_path: outputPath,
                    artifact_paths: [outputPath],
                  },
                }
              : {}),
          }),
          hasFlag(args, '--json'),
        )
        return
      }

      if (sub === 'run') {
        const persona = requiredArgument(option(args, '--persona'), '--persona')
        const workflow = requiredArgument(
          option(args, '--workflow'),
          '--workflow',
        )
        const stage = requiredArgument(option(args, '--stage'), '--stage')
        const invocationKind = invocationKindOption(args, true)
        const registryId = requiredArgument(
          option(args, '--registry'),
          '--registry',
        )
        const targetPath = requiredArgument(
          option(args, '--target'),
          '--target',
        )
        let validatorInvocation: Record<string, unknown> | undefined

        if (registryId === 'PR-DESCRIPTION-VALIDATE-001') {
          const worktreeWorkspace = sharedWorktreeWorkspace(root, args)
          const workspaceRoot = path.resolve(
            root,
            worktreeWorkspace?.path ?? configuredWorkspaceRoot(root),
          )
          const policies = resolvePolicies(root, {
            persona,
            workflow,
            stage,
            operator_artifacts: 'requested',
          })

          validatorInvocation = {
            inputs: {
              pr_description: resolvePrDescriptionContext(
                workspaceRoot,
                policies,
              ),
            },
          }
        }

        const manifest = resolveRequirements(root, {
          persona,
          workflow,
          stage,
          invocation_kind: invocationKind,
          invocation: {
            output_path: targetPath,
            artifact_paths: [targetPath],
          },
        })
        const requirements = [
          ...manifest.automation_requirements,
          ...manifest.validation_requirements,
        ].filter((item) => item.registry_id === registryId)
        let selected = requirements

        if (requirements.length > 1) {
          const required = requirements.filter(
            (item) => item.enforcement === 'required',
          )

          if (required.length === 1) {
            selected = required
          }
        }

        if (selected.length !== 1) {
          throw new PanError(
            requirements.length === 0
              ? `Registry ${registryId} did not resolve for this context.`
              : `Registry ${registryId} resolved more than once for this context.`,
            { code: 'INVALID_ARGUMENT' },
          )
        }

        const catalog = loadRegistry(root)
        const entry = catalog.entries.get(registryId)
        const targetKind = inferTargetKind(targetPath)

        if (entry?.kind !== 'validator') {
          throw new PanError(
            `Registry ${registryId} is not a standalone validator.`,
            { code: 'INVALID_ARGUMENT' },
          )
        }

        if (!entry.target_types.includes(targetKind)) {
          throw new PanError(
            `Registry ${registryId} does not accept target kind ${targetKind}.`,
            { code: 'INVALID_ARGUMENT' },
          )
        }

        const result = runRequirement({
          root,
          requirement: selected[0],
          targetPath,
          executor: 'agent',
          ...(validatorInvocation ? { invocation: validatorInvocation } : {}),
          catalog,
          persist: false,
        })

        print(result, hasFlag(args, '--json'))

        if (!isPassingResult(result)) {
          process.exitCode = 1
        }

        return
      }

      throw new PanError(
        `Unknown requirements subcommand: ${sub ?? '(missing)'}`,
        {
          code: 'UNKNOWN_COMMAND',
        },
      )
    }
    case 'output': {
      const sub = args[0]

      if (sub === 'scaffold') {
        requiredArgument(args[1], 'run-id')
        const invocationPath = requiredArgument(
          option(args, '--invocation'),
          '--invocation',
        )
        const outputPath = requiredArgument(
          option(args, '--output'),
          '--output',
        )
        const invocation = readInvocationFromPath(root, invocationPath)
        print(
          scaffoldStageOutput(
            root,
            invocation,
            outputPath,
            hasFlag(args, '--force'),
          ),
          true,
        )
        return
      }

      if (sub === 'validate') {
        const runId = requiredArgument(args[1], 'run-id')
        const filePath = requiredArgument(option(args, '--file'), '--file')
        const invocationPath = requiredArgument(
          option(args, '--invocation'),
          '--invocation',
        )
        const invocation = readInvocationFromPath(root, invocationPath)
        const submittedValue = readJson(
          resolveInside(root, filePath),
        ) as Record<string, unknown>
        const agentRequirements = [
          ...(invocation.requirements?.validation_requirements ?? []),
          ...(invocation.requirements?.automation_requirements ?? []),
        ].filter(
          (item) =>
            (item.phase === 'pre_submit' ||
              item.phase === 'before_operation') &&
            (item.executor === 'agent' || item.executor === 'both') &&
            item.enforcement !== 'advisory',
        )

        // The deterministic submission mirror always runs: a mechanical defect
        // in evidence presence, the read attestation, or the structural output
        // contract consumes a stage attempt at submit time, so it must be
        // catchable for free here first.
        const submission = validateOutputForSubmission(
          root,
          runId,
          invocation,
          submittedValue,
        )
        const results =
          agentRequirements.length === 0
            ? []
            : runAgentPreSubmitValidators(
                root,
                runId,
                invocation as unknown as Record<string, unknown>,
                agentRequirements,
                filePath,
                submittedValue,
              )
        const passed =
          submission.passed &&
          results.every((item) => isPassingResult(item.result))

        print(
          hasFlag(args, '--json')
            ? { passed, submission_checks: submission.checks, results }
            : [
                ...submission.checks
                  .filter((check) => !check.passed)
                  .map((check) => `${check.id}: FAIL ${check.message}`),
                `submission checks: ${
                  submission.passed
                    ? `pass (${submission.checks.length} checks)`
                    : 'fail'
                }`,
                ...results.map(
                  (item) =>
                    `${item.requirement.registry_id}: ${item.result.status}`,
                ),
              ].join('\n'),
          hasFlag(args, '--json'),
        )

        if (!passed) {
          process.exitCode = 1
        }

        return
      }

      throw new PanError(`Unknown output subcommand: ${sub ?? '(missing)'}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'assessment': {
      const sub = args[0]

      if (sub === 'scaffold') {
        const invocationPath = requiredArgument(
          option(args, '--invocation'),
          '--invocation',
        )
        const outputPath = requiredArgument(
          option(args, '--output'),
          '--output',
        )
        const invocation = readInvocationFromPath(root, invocationPath)

        print(
          scaffoldAssessment(
            root,
            invocation.invocation_id,
            outputPath,
            invocation.rubric.map((item) => item.id),
            hasFlag(args, '--force'),
          ),
          true,
        )
        return
      }

      throw new PanError(
        `Unknown assessment subcommand: ${sub ?? '(missing)'}`,
        {
          code: 'UNKNOWN_COMMAND',
        },
      )
    }
    case 'spotfix': {
      const sub = args[0]

      if (sub === 'scaffold-escalation') {
        const inputPath = requiredArgument(option(args, '--input'), '--input')
        const outputPath = requiredArgument(
          option(args, '--output'),
          '--output',
        )
        const content = readText(resolveInside(root, inputPath))
        writeTextAtomic(
          resolveInside(root, outputPath),
          `# Escalation\n\n${content}\n`,
        )
        print({ path: outputPath, status: 'scaffolded' }, true)
        return
      }

      throw new PanError(`Unknown spotfix subcommand: ${sub ?? '(missing)'}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'validate': {
      const result = validateRepository(root)
      print(result, true)

      if (!result.ok) {
        process.exitCode = 1
      }
      return
    }
    case 'doctor': {
      const worktreeWorkspace = sharedWorktreeWorkspace(root, args)
      const validation = validateRepository(root)
      const pipelineConfig = loadPipelineConfig(root)
      // Doctor's report must survive a malformed repository-checks file:
      // validateRepository already records the same defect, and aborting here
      // would replace the full diagnostic report with one error.
      let repositoryChecks: ReturnType<typeof loadRepositoryChecks> = {
        schema_version: 1,
        profiles: {},
      }
      let repositoryChecksError: string | null = null

      try {
        repositoryChecks = loadRepositoryChecks(root)
      } catch (error) {
        repositoryChecksError =
          error instanceof Error ? error.message : String(error)
      }
      const nodeMajor = Number(process.versions.node.split('.')[0])
      const workspaceRoot = path.resolve(
        root,
        worktreeWorkspace?.path ?? configuredWorkspaceRoot(root),
      )
      const result = {
        ok: validation.ok && nodeMajor >= 22,
        node: {
          version: process.versions.node,
          supported: nodeMajor >= 22,
        },
        workspace: {
          root:
            path.relative(root, workspaceRoot).split(path.sep).join('/') || '.',
          worktree: worktreeWorkspace?.name ?? null,
        },
        // Advisory: a repository without a web UI needs no browser, so an
        // unready browser stack MUST NOT fail doctor. BROWSER-001 turns the gap
        // into an environment-blocked case at the point a verdict is owed.
        browser_automation: browserReadiness([root, workspaceRoot]),
        // Advisory: an interactive `cursor-agent login` authenticates the CLI
        // with no environment key, and an installation may route no persona to
        // the cursor executor, so a missing credential MUST NOT fail doctor. It
        // is reported here so the gap is visible before a probe fails mid-run.
        cursor_authentication: cursorAuthenticationReadiness(root),
        // Git availability is a property of the deliverable workspace, not the
        // installation. These coincide only when the harness sits inside the
        // target, which a detached installation does not.
        git: {
          available_repository: isGitRepository(workspaceRoot),
        },
        pipeline_config: {
          active: pipelineConfig.name,
          personas: pipelineConfig.config.personas,
        },
        // A cached gate pass is a harness decision the operator may want to
        // revoke; the report names the switch and the file so neither has to
        // be found by reading source.
        gate_cache: {
          ...gateCacheStatus(root),
          disable_with: `${GATE_CACHE_ENV}=0`,
        },
        repository_check_environment: {
          profiles_without_probes: Object.entries(repositoryChecks.profiles)
            .filter(
              ([, profile]) => (profile.environment_probes ?? []).length === 0,
            )
            .map(([name]) => name),
          advisory:
            'Profiles without environment_probes rely on their ordinary probes.',
          ...(repositoryChecksError === null
            ? {}
            : { error: repositoryChecksError }),
        },
        // Reported only when the active mapping routes a persona to the
        // claude-code executor; a pure-Cursor installation owes no binary.
        ...(Object.values(pipelineConfig.config.personas).some(
          (model) => personaExecutorOf(model) === 'claude-code',
        )
          ? { claude_code: claudeCodeVersionPreflight() }
          : {}),
        validation,
        constraints: {
          runtime_dependencies: 0,
          development_tools: ['TypeScript', 'Prettier'],
          orchestration_runtime: 'Cursor supervisor + repository state machine',
          supported_integrations: [
            'Cursor subagents',
            'Cursor commands',
            'Cursor rules',
            'MCP tools available to Cursor',
            'Claude Code CLI (external stage executor)',
          ],
        },
      }

      print(result, true)

      if (!result.ok) {
        process.exitCode = 1
      }
      return
    }
    default:
      throw new PanError(`Unknown command: ${command}\n\n${help}`, {
        code: 'UNKNOWN_COMMAND',
      })
  }
}

main().catch((error: unknown) => {
  const known = error instanceof PanError
  const message = error instanceof Error ? error.message : String(error)
  const payload = {
    error: known ? error.code : 'UNEXPECTED_ERROR',
    message,
    ...(known && error.details !== undefined ? { details: error.details } : {}),
  }

  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`)
  process.exitCode = known ? error.exitCode : 1
})
