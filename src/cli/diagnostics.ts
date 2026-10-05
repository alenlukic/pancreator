/**
 * Diagnostic commands: `validate`, `eval`, `handoff`, and `doctor`.
 */

import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

import { GATE_CACHE_ENV, gateCacheStatus } from '../lib/gate-cache.js'
import { personaExecutorOf } from '../lib/executors/mapping.js'
import { cursorAuthenticationReadiness } from '../lib/executors/cursor-probe.js'
import { claudeCodeVersionPreflight } from '../lib/executors/claude-code.js'
import { openAiExecutorPreflight } from '../lib/executors/openai-auth.js'
import { copilotDiagnostics } from '../lib/executors/copilot-diagnostics.js'
import { vscodeWorktreeProtection } from '../lib/vscode-worktree-protection.js'
import { browserReadiness } from '../lib/browser-readiness.js'
import { errorMessage, PanError } from '../lib/errors.js'
import {
  configuredWorkspaceRoot,
  enabledHosts,
  readProjectConfig,
  resolveHandoffConfig,
} from '../lib/project-config/resolve.js'
import { integrationBranchReadiness, isGitRepository } from '../lib/git.js'
import { loadState as loadRunState } from '../lib/state.js'
import {
  loadPipelineConfig,
  pipelineConfigPersonaMappings,
} from '../lib/pipeline-config.js'
import { cursorCatalogStatus } from '../lib/executors/cursor-catalog.js'
import { resolveInside, writeJsonAtomic } from '../lib/io.js'
import { validateRepository } from '../lib/validation/repository.js'
import { PRIMER_BODY_FRESHNESS_LIMIT } from '../lib/validators/target-repo-primer.js'
import { cursorHandoffReadiness } from '../lib/cursor-handoff/readiness.js'
import {
  checkHandoffEligibility,
  prepareHandoff,
  sendingRecordCallback,
  markHandoffSent,
  markHandoffAborted,
  writeHandoffEvidence,
} from '../lib/supervisor-handoff.js'
import {
  ensureHelper,
  spawnHelperSession,
  type HelperSession,
} from '../lib/cursor-handoff/helper.js'
import {
  runHandoffDriver,
  selfCheck,
  type Bridge,
  type BridgePreflight,
  type BridgeSnapshot,
} from '../lib/cursor-handoff/driver.js'
import { redactSnapshot } from '../lib/cursor-handoff/selectors.js'
import {
  gradeEvalRun,
  listEvalScenarios,
  renderEvalReportMarkdown,
  runEval,
  writeEvalReport,
} from '../lib/evals/index.js'
import { validatePanInvocation } from '../lib/pan-command-grammar.js'
import { loadRepositoryChecks } from '../lib/repository-checks/config.js'

import type { CliContext } from './context.js'
import {
  hasFlag,
  option,
  print,
  requiredArgument,
  requiredPositional,
  sharedWorktreeWorkspace,
} from './args.js'

/**
 * Adapt a `HelperSession` (line-protocol stdio) into the `Bridge` interface
 * the driver expects. Each call sends one JSON request and awaits one reply.
 * The helper protocol returns `{ ok: false, code, error }` on failure; this
 * adapter re-throws as an Error with the code attached.
 */
function helperSessionBridge(session: HelperSession): Bridge {
  async function call(
    request: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const reply = await session.send(request)
    if (reply['ok'] === false) {
      throw new PanError(String(reply['error'] ?? 'Helper error'), {
        code: String(reply['code'] ?? 'HANDOFF_HELPER_PROTOCOL'),
      })
    }
    return reply
  }

  return {
    async preflight(): Promise<BridgePreflight> {
      const r = await call({ op: 'preflight' })
      return {
        accessibility_trusted: Boolean(r['accessibility_trusted']),
        cursor_pid:
          typeof r['cursor_pid'] === 'number' ? r['cursor_pid'] : null,
        agents_window_present: Boolean(r['agents_window_present']),
        frontmost_pid:
          typeof r['frontmost_pid'] === 'number' ? r['frontmost_pid'] : null,
      }
    },

    async snapshot(): Promise<BridgeSnapshot> {
      const r = await call({ op: 'snapshot' })
      return { nodes: r['nodes'] as BridgeSnapshot['nodes'] }
    },

    async press(id: string): Promise<void> {
      await call({ op: 'press', id })
    },

    async setValue(id: string, value: string): Promise<void> {
      await call({ op: 'set_value', id, value })
    },

    async focusInsert(id: string, value: string): Promise<void> {
      await call({ op: 'focus_insert', id, value })
    },

    async frontmost(): Promise<number | null> {
      const r = await call({ op: 'frontmost' })
      return typeof r['frontmost_pid'] === 'number' ? r['frontmost_pid'] : null
    },
  }
}

/**
 * Resolve a `--capture-tree` path. The fixture is harness evidence, so it may
 * land only under `runtime/`; any other path, including tracked source, is
 * refused before the helper runs. An existing file is refused too, so a typo
 * cannot replace run state such as a run's `state.json`.
 */
function handoffCapturePath(root: string, captureTree: string): string {
  const absolute = resolveInside(root, captureTree)
  const relative = path.relative(path.join(root, 'runtime'), absolute)

  if (
    relative.length === 0 ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new PanError(
      `--capture-tree must name a file under runtime/, not '${captureTree}'.`,
      { code: 'INVALID_ARGUMENT' },
    )
  }

  if (existsSync(absolute)) {
    throw new PanError(
      `--capture-tree must name a new file; '${captureTree}' already exists.`,
      { code: 'INVALID_ARGUMENT' },
    )
  }

  return absolute
}

/** `pan validate`. */
export function validateCommand({ root }: CliContext): void {
  const result = validateRepository(root)
  print(result, true)

  if (!result.ok) {
    process.exitCode = 1
  }
  return
}

/** `pan eval`. */
export function evalCommand({ root, args }: CliContext): void {
  const sub = args[0]
  const asJson = hasFlag(args, '--json')

  if (sub === 'list') {
    const scenarios = listEvalScenarios(root).map(
      ({ scenario, path: file }) => ({
        name: scenario.name,
        workflow: scenario.workflow,
        verification: scenario.verification,
        fixture: scenario.fixture,
        policy_instructions: scenario.policy_instructions.map(
          (item) => `${item.policy_id}#${item.instruction}`,
        ),
        graders: scenario.graders.map((grader) => grader.id),
        description: scenario.description,
        path: file,
      }),
    )

    print(
      asJson
        ? scenarios
        : scenarios.length === 0
          ? 'No eval scenarios under evals/scenarios/.'
          : scenarios
              .map(
                (item) =>
                  `${item.name}  [${item.workflow}/${item.verification}, fixture ${item.fixture}]\n` +
                  `    ${item.description}\n` +
                  `    policies: ${item.policy_instructions.join(', ')}\n` +
                  `    graders: ${item.graders.join(', ')}`,
              )
              .join('\n'),
      asJson,
    )
    return
  }

  if (sub === 'grade') {
    const runId = requiredArgument(args[1], 'run-id')
    const scenarioName = requiredArgument(
      option(args, '--scenario'),
      '--scenario',
    )

    const report = gradeEvalRun(root, runId, scenarioName)
    const outDir = option(args, '--out')
    const written = outDir ? writeEvalReport(root, outDir, report) : null

    print(
      asJson
        ? { ...report, ...(written ? { report_paths: written } : {}) }
        : renderEvalReportMarkdown(report) +
            (written
              ? `\nReport written to ${written.json_path} and ${written.markdown_path}.\n`
              : ''),
      asJson,
    )

    if (!report.passed) {
      process.exitCode = 1
    }

    return
  }

  if (sub === 'run') {
    const scenarioName = requiredArgument(args[1], 'scenario')
    const result = runEval(root, scenarioName, {
      attestSupervisorCard: hasFlag(args, '--attest-supervisor-card'),
      ...(typeof option(args, '--pipeline-config') === 'string'
        ? {
            pipelineConfigName: option(args, '--pipeline-config') as string,
          }
        : {}),
      onProgress: (message) =>
        process.stderr.write(`[pan eval:${scenarioName}] ${message}\n`),
    })

    print(
      asJson
        ? { ...result, report: result.report }
        : [
            `Eval ${result.eval_id} (${result.status}) for run ${result.run_id}.`,
            `Workspace: ${result.workspace}`,
            `Report: ${result.report_paths.markdown_path}`,
            ...(result.operator_steps.length > 0
              ? [
                  '',
                  'Operator steps:',
                  ...result.operator_steps.map(
                    (step, index) => `${index + 1}. ${step}`,
                  ),
                ]
              : ['', `Graders: ${result.report.passed ? 'PASS' : 'FAIL'}`]),
          ].join('\n'),
      asJson,
    )

    if (result.status === 'graded' && !result.report.passed) {
      process.exitCode = 1
    }

    return
  }

  throw new PanError(`Unknown eval subcommand: ${sub ?? '(missing)'}`, {
    code: 'UNKNOWN_COMMAND',
  })
}

/** `pan handoff`. */
export async function handoffCommand({
  root,
  args,
}: CliContext): Promise<void> {
  const grammar = validatePanInvocation(['handoff', ...args])

  if (!grammar.valid) {
    throw new PanError(grammar.error ?? 'Invalid pan handoff options.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  const asJson = hasFlag(args, '--json')
  const selfCheckMode = hasFlag(args, '--self-check')
  const captureTree = option(args, '--capture-tree')

  if (selfCheckMode) {
    const capturePath =
      captureTree === null ? null : handoffCapturePath(root, captureTree)
    const { binaryPath } = ensureHelper(root)
    const session = spawnHelperSession(binaryPath)
    let selfCheckResult: Awaited<ReturnType<typeof selfCheck>>

    try {
      const bridge = helperSessionBridge(session)
      selfCheckResult = await selfCheck(bridge)

      if (capturePath !== null) {
        const snap = await bridge.snapshot()
        mkdirSync(path.dirname(capturePath), { recursive: true })
        writeJsonAtomic(capturePath, redactSnapshot(snap.nodes))
      }
    } finally {
      await session.close()
    }

    print(selfCheckResult, asJson)
    return
  }

  if (captureTree !== null) {
    throw new PanError('--capture-tree requires --self-check.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  const runId = requiredPositional(args[0], 'run-id')
  const dryRun = hasFlag(args, '--dry-run')
  const noteInline = option(args, '--note')
  const noteFile = option(args, '--note-file')
  const modelFlag = option(args, '--model') ?? undefined
  const effortFlag = option(args, '--effort') ?? undefined

  if (noteInline !== null && noteFile !== null) {
    throw new PanError('--note and --note-file cannot be used together.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  const config = readProjectConfig(root)
  const handoffConfig = resolveHandoffConfig(config, {
    model: modelFlag,
    effort: effortFlag,
  })

  const prompt = `/pan-resume ${runId}`

  // Refuse before the helper build, which can take a minute on first use.
  // prepareHandoff repeats both checks under the run operation mutex.
  {
    const state = loadRunState(root, runId)
    const eligibility = checkHandoffEligibility(root, state)
    if (!eligibility.ok) {
      throw new PanError(eligibility.message ?? 'Handoff refused.', {
        code: eligibility.code ?? 'HANDOFF_RUN_TERMINAL',
      })
    }

    if (!dryRun && noteInline === null && noteFile === null) {
      throw new PanError(
        'A handoff note is required: pass --note <text> or --note-file <path>.',
        { code: 'HANDOFF_NOTE_MISSING' },
      )
    }
  }

  const { binaryPath } = ensureHelper(root)

  const { handoffId, notePath, evidencePath, fromSessionGeneration } =
    prepareHandoff(root, {
      runId,
      prompt,
      model: handoffConfig.model,
      effort: handoffConfig.effort,
      note: noteInline ?? undefined,
      noteFile: noteFile ?? undefined,
      dryRun,
    })

  const session = spawnHelperSession(binaryPath)
  let driverResult: Awaited<ReturnType<typeof runHandoffDriver>>

  try {
    driverResult = await runHandoffDriver({
      bridge: helperSessionBridge(session),
      prompt,
      model: handoffConfig.model,
      effort: handoffConfig.effort,
      dryRun,
      preSendCallback: dryRun
        ? undefined
        : sendingRecordCallback(root, runId, {
            handoffId,
            fromSessionGeneration,
            evidencePath,
            notePath,
            prompt,
            model: handoffConfig.model,
            effort: handoffConfig.effort,
          }),
    })
  } catch (error) {
    const code =
      error instanceof PanError ? error.code : 'HANDOFF_HELPER_PROTOCOL'
    writeHandoffEvidence(root, runId, handoffId, {
      status: 'aborted',
      code,
      error: errorMessage(error),
    })
    markHandoffAborted(root, runId, handoffId, code)
    throw error
  } finally {
    await session.close()
  }

  writeHandoffEvidence(root, runId, handoffId, driverResult)

  if (driverResult.status === 'sent') {
    markHandoffSent(root, runId, handoffId, driverResult.verified_label ?? '')
  } else if (driverResult.status === 'aborted') {
    markHandoffAborted(
      root,
      runId,
      handoffId,
      driverResult.code ?? 'HANDOFF_PRESS_FAILED',
    )
  }

  const output = {
    ...driverResult,
    handoff_id: handoffId,
    run_id: runId,
    ...(notePath !== null ? { note_path: notePath } : {}),
    evidence_path: evidencePath,
    next_action:
      driverResult.status === 'sent'
        ? 'End your turn now. The new session will resume the run.'
        : driverResult.status === 'drafted'
          ? 'Draft is in place. Re-run without --dry-run to send.'
          : `Handoff aborted (${driverResult.code ?? 'unknown'}). See error for details.`,
  }

  print(output, asJson)

  if (driverResult.status === 'aborted') {
    process.exitCode = 1
  }

  return
}

/** `pan doctor`. */
export function doctorCommand({ root, args }: CliContext): void {
  const worktreeWorkspace = sharedWorktreeWorkspace(root, args)
  const validation = validateRepository(root)
  // Doctor is the command an operator reaches for when a command fails,
  // so it is exempt from the catalog validation that runs at config load.
  // It reports the catalog state instead of dying with the rest.
  const pipelineConfig = loadPipelineConfig(root, undefined, {
    skipCatalog: true,
  })
  const modelCatalog = cursorCatalogStatus(
    root,
    pipelineConfigPersonaMappings(pipelineConfig.file),
  )

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
      root: path.relative(root, workspaceRoot).split(path.sep).join('/') || '.',
      worktree: worktreeWorkspace?.name ?? null,
    },
    // Advisory: a repository without a web UI needs no browser, so an
    // unready browser stack MUST NOT fail doctor. BROWSER-001 turns the gap
    // into an environment-blocked case at the point a verdict is owed.
    browser_automation: browserReadiness([root, workspaceRoot]),
    // Advisory: a missing credential MUST NOT fail doctor. An interactive
    // `cursor-agent login` authenticates the CLI with no environment key.
    cursor_authentication: cursorAuthenticationReadiness(root),
    // Git availability is a property of the deliverable workspace, not the
    // installation. These coincide only when the harness sits inside the
    // target, which a detached installation does not.
    git: {
      available_repository: isGitRepository(workspaceRoot),
      // Advisory: ACTION-001 lands agent work on the integration branch,
      // so its absence is a readiness gap rather than a failure. The
      // installer creates it on the next fresh install or refresh.
      integration_branch: integrationBranchReadiness(workspaceRoot),
    },
    pipeline_config: {
      active: pipelineConfig.name,
      personas: pipelineConfig.config.personas,
    },
    // Advisory: the catalog is account-local and optional, so a stale one
    // MUST NOT fail doctor. It fails the lifecycle commands, which is
    // exactly why this report has to survive it.
    cursor_model_catalog: modelCatalog,
    gate_cache: {
      ...gateCacheStatus(root),
      disable_with: `${GATE_CACHE_ENV}=0`,
    },
    // Advisory: pan handoff needs macOS, swiftc/built helper, Cursor running,
    // the Agents window, and Accessibility permission. None of these MUST fail
    // doctor; they are readiness gaps reported here.
    cursor_handoff: cursorHandoffReadiness(root),
    // Advisory: `PRIMER-001` makes the primer mandatory reading in every
    // installation, so doctor states its freshness even where repository
    // validation stays silent. A drifted primer is a readiness gap the
    // librarian closes with `/pan-build-docs`, not a doctor failure.
    target_repo_primer: {
      ...(validation.target_repo_primer ?? {
        source_head: null,
        current_head: null,
        generated_at: null,
        drifted: false,
        stamp_predates_source: false,
        body_freshness: 'unverified' as const,
        message: 'no target repository primer is present',
      }),
      limit: PRIMER_BODY_FRESHNESS_LIMIT,
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
    // Each external executor is reported only when the active mapping
    // routes a persona to it; a pure-Cursor installation owes neither.
    ...(Object.values(pipelineConfig.config.personas).some(
      (model) => personaExecutorOf(model) === 'claude-code',
    )
      ? { claude_code: claudeCodeVersionPreflight() }
      : {}),
    ...(Object.values(pipelineConfig.config.personas).some(
      (model) => personaExecutorOf(model) === 'openai',
    )
      ? { openai: openAiExecutorPreflight(root) }
      : {}),
    ...(enabledHosts(root).includes('vscode') ||
    Object.values(pipelineConfig.config.personas).some(
      (model) => personaExecutorOf(model) === 'copilot',
    )
      ? { copilot: copilotDiagnostics(root, pipelineConfig.config.personas) }
      : {}),
    ...(enabledHosts(root).includes('vscode')
      ? { vscode_worktree_protection: vscodeWorktreeProtection(root) }
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
        'OpenAI Responses API (external stage executor)',
        'GitHub Copilot CLI (external stage executor)',
      ],
    },
  }

  print(result, true)

  if (!result.ok) {
    process.exitCode = 1
  }
  return
}
