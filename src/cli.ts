#!/usr/bin/env node
import { readdirSync } from 'node:fs'
import path from 'node:path'

import {
  abortRun,
  acceptChange,
  assessStage,
  createRun,
  decideRun,
  getRunStatus,
  getRunState,
  pauseRun,
  prepareInvocation,
  resumeRun,
  setRunStage,
  submitOutput,
  waiveGate,
} from './lib/engine.js'
import { PanError } from './lib/errors.js'
import { isGitRepository } from './lib/git.js'
import {
  loadPipelineConfig,
  syncCursorAgentModels,
} from './lib/pipeline-config.js'
import {
  fileExists,
  findProjectRoot,
  isRecord,
  readJson,
  readText,
  resolveInside,
  writeTextAtomic,
} from './lib/io.js'
import type { RunState } from './lib/types.js'
import { validateRepository } from './lib/validation.js'
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
import {
  beginTrackedModification,
  cancelTrackedModification,
  commitTrackedModification,
} from './lib/workspace/changes.js'
import { snapshotWorkspace } from './lib/workspace/index.js'
import { resolveRoots } from './lib/workspace/roots.js'
import { validateWorkflowChanges } from './lib/workspace/validate-changes.js'

const HELP = `Pancreator v2 prototype

Usage:
  pan init --request <repo-relative-file> [--workflow dev] [--title <title>] [--workspace <dir>] [--gates <file>]
  pan prepare <run-id>
  pan submit <run-id> <output-json>
  pan assess <run-id> <assessment-json>
  pan decide <run-id> <approve|reject> [--note <text>] [--stage <stage-slug>]
  pan pause <run-id> [--note <text>]
  pan resume <run-id> [--stage <stage-slug>] [--note <text>]
  pan set-stage <run-id> --stage <stage-slug> --note <reason>
  pan waive-gate <run-id> --criteria <id[,id...]> --note <reason> [--stage <stage-slug>] [--defer <AC-id[,AC-id...]> --spotfix]
  pan accept-change <run-id> [--note <text>] [--waive]
  pan abort <run-id> [--note <text>]
  pan changes begin <run-id> <path>
  pan changes commit <run-id> <path> --lock <lock-id>
  pan changes cancel <run-id> <path> --lock <lock-id>
  pan workspace reconcile [--workspace <dir>] [--state-root <dir>] [--adopt]
  pan workflow validate-changes <run-id>
  pan status <run-id> [--json]
  pan list [--json]
  pan models [--sync] [--json]
  pan validate [--json]
  pan doctor [--json]
  pan requirements resolve --persona <p> --workflow <w> --stage <s> [--json]
  pan output scaffold <run-id> --invocation <path> --output <path> [--force]
  pan output validate <run-id> --file <path> [--json]
  pan assessment scaffold <run-id> --invocation <path> --output <path> [--force]
  pan governance audit-directives [--json]
  pan validation-map [--json]
  pan spotfix scaffold-escalation --input <path> --output <path>

The harness does not invoke models. Cursor's supervisor reads invocation cards,
delegates to named Cursor subagents, and returns structured output to this CLI.
`

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

function commaSeparatedOption(args: string[], name: string): string[] {
  const value = option(args, name)

  return value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : []
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

function activeModificationContext(root: string, runId: string) {
  const state = getRunState(root, runId)

  if (state.status !== 'running') {
    throw new PanError('Run must be running to modify tracked files.', {
      code: 'RUN_NOT_RUNNING',
    })
  }

  if (!state.current_stage) {
    throw new PanError('Run has no active stage.', {
      code: 'INVALID_RUN_ACTION',
    })
  }

  const stageAttempt = state.attempts[state.current_stage] ?? 1
  const invocationId =
    state.current_invocation?.id ??
    `${state.current_stage}-${stageAttempt}-manual`
  const roots = resolveRoots({
    installation_root: root,
    workspace_root: resolveInside(root, state.workspace_root),
    state_root: state.state_root,
  })

  return {
    state,
    roots,
    context: {
      state_root: roots.state_root,
      roots,
      workflow_id: runId,
      stage: state.current_stage,
      stage_attempt: stageAttempt,
      invocation_id: invocationId,
    },
  }
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
        fileExists(path.join(base, entry.name, 'state.json')),
    )
    .map((entry) => {
      const statePath = path.join(base, entry.name, 'state.json')

      return parseRunState(readJson(statePath), statePath)
    })
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .map((state) => ({
      run_id: state.run_id,
      title: state.title,
      status: state.status,
      stage: state.current_stage,
      pending_action: state.pending_action.type,
      updated_at: state.updated_at,
    }))
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
          catalog,
          persist: true,
        }),
      },
    ]
  })
}

async function main(): Promise<void> {
  const root = findProjectRoot()
  const [command = 'help', ...args] = process.argv.slice(2)
  const json = hasFlag(args, '--json')

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      print(HELP)
      return
    case 'init': {
      const state = createRun(root, {
        workflowSlug: option(args, '--workflow', 'dev') ?? 'dev',
        requestPath: option(args, '--request'),
        title: option(args, '--title'),
        workspace: option(args, '--workspace'),
        gatesPath: option(args, '--gates'),
      })

      print({
        status: 'created',
        run_id: state.run_id,
        workspace_root: state.workspace_root,
        pipeline_config: state.pipeline_config?.name,
        next_command: `./bin/pan prepare ${state.run_id}`,
        state_path: `runtime/logs/workflows/${state.run_id}/state.json`,
      })
      return
    }
    case 'prepare': {
      const runId = requiredArgument(args[0], 'run-id')
      const result = prepareInvocation(root, runId)

      if (!result.invocation) {
        print({
          status: result.state.status,
          reason: result.state.pause_reason,
          decision_path: result.state.last_decision_path,
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
      })
      return
    }
    case 'submit': {
      const runId = requiredArgument(args[0], 'run-id')
      const outputPath = requiredArgument(args[1], 'output-json')
      const result = submitOutput(root, runId, outputPath)

      print({
        status: result.state.status,
        outcome: result.record.outcome,
        stage: result.record.stage.slug,
        next_stage: result.state.current_stage,
        pending_action: result.state.pending_action,
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
        next_stage: state.current_stage,
        pending_action: state.pending_action,
      })
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
        next_command: `./bin/pan prepare ${runId}`,
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
        next_command: `./bin/pan prepare ${runId}`,
      })
      return
    }
    case 'accept-change': {
      const runId = requiredArgument(args[0], 'run-id')
      const state = acceptChange(
        root,
        runId,
        option(args, '--note', '') ?? '',
        hasFlag(args, '--waive'),
      )

      print({
        status: state.status,
        current_stage: state.current_stage,
        accepted_workspace_fingerprint: state.accepted_workspace_fingerprint,
        latest_ledger_validation: state.latest_ledger_validation,
        next_command: `./bin/pan prepare ${runId}`,
      })
      return
    }
    case 'waive-gate': {
      const runId = requiredArgument(args[0], 'run-id')
      const criteria = commaSeparatedOption(args, '--criteria')
      const note = option(args, '--note')

      if (criteria.length === 0) {
        throw new PanError('--criteria is required for waive-gate.', {
          code: 'INVALID_ARGUMENT',
        })
      }

      if (!note || note.trim().length === 0) {
        throw new PanError('--note is required for waive-gate.', {
          code: 'INVALID_ARGUMENT',
        })
      }

      const result = waiveGate(root, runId, {
        stageSlug: option(args, '--stage'),
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
    case 'changes': {
      const subcommand = requiredArgument(args[0], 'changes-subcommand')
      const runId = requiredArgument(args[1], 'run-id')
      const trackedPath = requiredArgument(args[2], 'path')
      const active = activeModificationContext(root, runId)

      if (subcommand === 'begin') {
        const result = beginTrackedModification(active.context, trackedPath)

        print({
          status: 'locked',
          run_id: runId,
          path: trackedPath,
          lock_id: result.lock.lock_id,
          expected_checksum: result.expected_checksum,
        })
        return
      }

      const lockId = option(args, '--lock')

      if (!lockId) {
        throw new PanError('--lock is required for commit and cancel.', {
          code: 'INVALID_ARGUMENT',
        })
      }

      if (subcommand === 'commit') {
        const result = commitTrackedModification(
          active.context,
          trackedPath,
          lockId,
        )

        print({
          status: 'committed',
          run_id: runId,
          path: trackedPath,
          lock_id: lockId,
          operation: result.operation,
          sequence: result.entry?.sequence ?? null,
        })
        return
      }

      if (subcommand === 'cancel') {
        const lock = cancelTrackedModification(
          active.context,
          trackedPath,
          lockId,
        )

        print({
          status: 'cancelled',
          run_id: runId,
          path: trackedPath,
          lock_id: lock.lock_id,
        })
        return
      }

      throw new PanError(`Unknown changes subcommand: ${subcommand}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'workspace': {
      const subcommand = requiredArgument(args[0], 'workspace-subcommand')

      if (subcommand !== 'reconcile') {
        throw new PanError(`Unknown workspace subcommand: ${subcommand}`, {
          code: 'UNKNOWN_COMMAND',
        })
      }

      const workspaceRoot = option(args, '--workspace', '.') ?? '.'
      const roots = resolveRoots({
        installation_root: root,
        workspace_root: resolveInside(root, workspaceRoot),
        state_root: option(args, '--state-root'),
      })
      const result = snapshotWorkspace(roots, hasFlag(args, '--adopt'))

      print({
        status: hasFlag(args, '--adopt') ? 'adopted' : 'observed',
        workspace_root: roots.workspace_root,
        state_root: roots.state_root,
        scope_hash: roots.scope_hash,
        fingerprint: result.snapshot.fingerprint,
        changed_paths: result.changed_paths,
        deleted_paths: result.deleted_paths,
      })
      return
    }
    case 'workflow': {
      const subcommand = requiredArgument(args[0], 'workflow-subcommand')

      if (subcommand !== 'validate-changes') {
        throw new PanError(`Unknown workflow subcommand: ${subcommand}`, {
          code: 'UNKNOWN_COMMAND',
        })
      }

      const runId = requiredArgument(args[1], 'run-id')
      const state = getRunState(root, runId)
      const roots = resolveRoots({
        installation_root: root,
        workspace_root: resolveInside(root, state.workspace_root),
        state_root: state.state_root,
      })
      const result = validateWorkflowChanges({
        run_id: runId,
        state_root: roots.state_root,
        roots,
      })

      print({
        run_id: runId,
        status: result.status,
        anomalies: result.anomalies.length,
      })
      return
    }
    case 'status': {
      const runId = requiredArgument(args[0], 'run-id')
      print(getRunStatus(root, runId, { json }), json)
      return
    }
    case 'list':
      print(listRuns(root), true)
      return
    case 'models': {
      const loaded = loadPipelineConfig(root)
      const changes = syncCursorAgentModels(root, loaded, {
        write: hasFlag(args, '--sync'),
      })

      print(
        {
          active_config: loaded.name,
          summary: loaded.config.summary,
          personas: loaded.config.personas,
          sync_requested: hasFlag(args, '--sync'),
          changed_agents: changes.filter((entry) => entry.changed),
        },
        true,
      )
      return
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

      throw new PanError(
        `Unknown governance subcommand: ${sub ?? '(missing)'}`,
        {
          code: 'UNKNOWN_COMMAND',
        },
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

        print(
          resolveRequirements(root, {
            persona,
            workflow,
            stage,
            ...(outputPath ? { invocation: { output_path: outputPath } } : {}),
          }),
          hasFlag(args, '--json'),
        )
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

        if (agentRequirements.length === 0) {
          throw new PanError(
            'No agent-owned pre-submit requirements resolved.',
            {
              code: 'INVALID_ARGUMENT',
            },
          )
        }

        const results = runAgentPreSubmitValidators(
          root,
          runId,
          invocation as unknown as Record<string, unknown>,
          agentRequirements,
          filePath,
          submittedValue,
        )
        const passed = results.every((item) => isPassingResult(item.result))

        print(
          hasFlag(args, '--json')
            ? { passed, results }
            : results
                .map(
                  (item) =>
                    `${item.requirement.registry_id}: ${item.result.status}`,
                )
                .join('\n'),
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
      const validation = validateRepository(root)
      const pipelineConfig = loadPipelineConfig(root)
      const nodeMajor = Number(process.versions.node.split('.')[0])
      const result = {
        ok: validation.ok && nodeMajor >= 22,
        node: {
          version: process.versions.node,
          supported: nodeMajor >= 22,
        },
        git: { available_repository: isGitRepository(root) },
        pipeline_config: {
          active: pipelineConfig.name,
          personas: pipelineConfig.config.personas,
        },
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
      throw new PanError(`Unknown command: ${command}\n\n${HELP}`, {
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
