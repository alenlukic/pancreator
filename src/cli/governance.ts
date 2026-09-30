/**
 * Model, brief, and governance commands: `models`, `briefs`,
 * `validation-map`, `author`, and `governance`.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  probeRunInvocationModel,
  startDetachedWorkerModelProbe,
  recordInvocationModelEvidence,
  recordSupervisorModelEvidence,
} from '../lib/engine/model-evidence.js'
import { loadHorizonSession } from '../lib/horizon/session.js'
import { personaExecutorOf } from '../lib/executors/mapping.js'
import { probeCursorModels } from '../lib/executors/cursor-probe.js'
import { PanError } from '../lib/errors.js'
import {
  harnessConfigName,
  localConfigName,
  mergeConfigValues,
} from '../lib/project-config/files.js'
import {
  loadPipelineConfig,
  parsePipelineConfig,
  pipelineConfigPersonaMappings,
} from '../lib/pipeline-config.js'
import { cursorCatalogStatus } from '../lib/executors/cursor-catalog.js'
import { migratePipelineOverrides } from '../lib/pipeline-config-migration.js'
import { syncCursorProjection } from '../lib/projection.js'
import { fileExists, readJson, sha256, writeJsonAtomic } from '../lib/io.js'
import { buildValidationMap } from '../lib/requirements/map.js'
import { auditDirectives } from '../lib/governance/audit-directives.js'
import {
  refreshGovernanceDigests,
  renderRefreshDigestsReport,
} from '../lib/governance/refresh-digests.js'
import { buildGovernanceCard } from '../lib/governance-card/build.js'
import { availableReviewDimensions } from '../lib/review-dimensions.js'
import {
  attestSupervisorCard,
  buildSupervisorCard,
} from '../lib/governance/supervisor-card.js'
import { resolvePromptContext } from '../lib/governance/prompt-context/routing.js'
import { conflictsByTier, resolveReviewScope } from '../lib/review-scope.js'
import {
  buildBriefSystem,
  renderBrief,
  validateBriefSystem,
} from '../lib/briefs.js'
import { generateOperatorArtifacts } from '../lib/operator-artifact-generation.js'
import { workspaceRepositoryRoot } from '../lib/worktrees.js'
import { applyTargetAuthoringDraft } from '../lib/target-authoring/apply.js'
import { readTargetExtensionManifest } from '../lib/target-authoring/manifest.js'
import { validateTargetAuthoring } from '../lib/target-authoring/validate.js'

import type { CliContext } from './context.js'
import {
  commaSeparatedOption,
  hasFlag,
  option,
  print,
  requiredArgument,
  sharedWorktreeWorkspace,
} from './args.js'

/** `pan models`. */
export async function modelsCommand({ root, args }: CliContext): Promise<void> {
  const runId = option(args, '--run')
  const invocationId = option(args, '--invocation')

  if (args[0] === 'evidence') {
    const role = requiredArgument(option(args, '--role'), '--role')
    const effectiveModel = requiredArgument(
      option(args, '--effective-model'),
      '--effective-model',
    )
    const source = requiredArgument(option(args, '--source'), '--source')
    const requiredRunId = requiredArgument(runId, '--run')

    if (role === 'supervisor') {
      const recorded = recordSupervisorModelEvidence(
        root,
        requiredRunId,
        effectiveModel,
        source,
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

    print(
      recordInvocationModelEvidence(
        root,
        requiredRunId,
        requiredArgument(invocationId, '--invocation'),
        role,
        effectiveModel,
        source,
        requiredArgument(option(args, '--launch-handle'), '--launch-handle'),
      ),
      true,
    )
    return
  }

  if (hasFlag(args, '--probe') && (runId || invocationId)) {
    const probeRunId = requiredArgument(runId, '--run')
    const probeInvocationId = requiredArgument(invocationId, '--invocation')

    // The detached child carries `--await-probe` and performs the live
    // call. Without it the command records the in-flight marker, starts
    // the child, and returns: only submission reads the answer, so no
    // worker launch waits for Cursor.
    if (hasFlag(args, '--await-probe')) {
      print(probeRunInvocationModel(root, probeRunId, probeInvocationId), true)
      return
    }

    const started = startDetachedWorkerModelProbe(
      root,
      probeRunId,
      probeInvocationId,
    )

    print({ ...started.evidence, probe_pid: started.probe_pid }, true)
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
    parsePipelineConfig(mergeConfigValues(next, result.overrides), trackedName)

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

  const syncRequested = hasFlag(args, '--sync')
  const force = hasFlag(args, '--force')

  if (force && !syncRequested) {
    throw new PanError('models --force requires --sync.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  // A bare `pan models` is diagnosis, so it reports a stale catalog
  // instead of failing at config load. `--sync` writes projections, so it
  // keeps catalog validation unless `--force` waives it.
  const skipCatalog = force || !syncRequested
  const loaded = loadPipelineConfig(root, undefined, { skipCatalog })
  const modelCatalog = cursorCatalogStatus(
    root,
    pipelineConfigPersonaMappings(loaded.file),
  )
  const changes = syncCursorProjection(root, {
    write: syncRequested,
    skipCatalog,
    pipeline: loaded,
  })

  // Static validation proves each spec is well-formed for the catalog
  // snapshot; --probe proves what it launches today by spending one
  // minimal cursor-agent call per distinct spec and comparing the echoed
  // variant against the catalog's prediction.
  const probes = hasFlag(args, '--probe')
    ? await probeCursorModels(root, loaded.config.personas)
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
      sync_requested: syncRequested,
      force,
      catalog_skipped: skipCatalog,
      cursor_model_catalog: modelCatalog,
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

/** `pan briefs`. */
export function briefsCommand({ root, args }: CliContext): void {
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
    const outputPath = requiredArgument(option(args, '--output'), '--output')

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

/** `pan validation-map`. */
export function validationMapCommand({ root, args }: CliContext): void {
  print(buildValidationMap(root), hasFlag(args, '--json'))
  return
}

/** `pan author`. */
export function authorCommand({ root, args }: CliContext): void {
  const sub = args[0]

  if (sub === 'apply') {
    const worktreeWorkspace = sharedWorktreeWorkspace(root, args)
    const result = applyTargetAuthoringDraft(
      root,
      requiredArgument(option(args, '--input'), '--input'),
      {
        ...(worktreeWorkspace ? { workspace: worktreeWorkspace.path } : {}),
      },
    )

    print(result, hasFlag(args, '--json'))
    return
  }

  if (sub === 'validate') {
    const worktreeWorkspace = sharedWorktreeWorkspace(root, args)
    const extensionId = option(args, '--extension')
    const result = validateTargetAuthoring(root, {
      ...(extensionId ? { extensionId } : {}),
      repair: true,
      ...(worktreeWorkspace ? { workspace: worktreeWorkspace.path } : {}),
    })
    const manifestSha256 = extensionId
      ? sha256(readTargetExtensionManifest(root, extensionId))
      : null

    print(
      {
        ...result,
        manifest_sha256: manifestSha256,
      },
      hasFlag(args, '--json'),
    )

    if (!result.ok) {
      process.exitCode = 1
    }
    return
  }

  throw new PanError(`Unknown author subcommand: ${sub ?? '(missing)'}`, {
    code: 'UNKNOWN_COMMAND',
  })
}

/** `pan governance`. */
export function governanceCommand({ root, pan, args }: CliContext): void {
  const sub = args[0]

  if (sub === 'prompt-context') {
    print(resolvePromptContext(root, readFileSync(0, 'utf8')))
    return
  }

  if (sub === 'audit-directives') {
    print(auditDirectives(root), hasFlag(args, '--json'))
    return
  }

  if (sub === 'refresh-digests') {
    const report = refreshGovernanceDigests(root, {
      check: hasFlag(args, '--check'),
    })

    print(
      hasFlag(args, '--json') ? report : renderRefreshDigestsReport(report),
      hasFlag(args, '--json'),
    )

    if (report.status === 'stale' || report.status === 'refused') {
      process.exitCode = 1
    }
    return
  }

  if (sub === 'card' && option(args, '--mode') === 'supervisor') {
    const card = buildSupervisorCard(
      root,
      requiredArgument(option(args, '--run'), '--run'),
    )

    print({
      status: 'ready',
      mode: 'supervisor',
      run_id: card.run_id,
      card_path: card.path,
      sha256: card.sha256,
      attested: card.attested,
      attest_command: card.attest_command,
      policies: card.policies,
    })
    return
  }

  if (sub === 'attest-supervisor') {
    const runId = requiredArgument(args[1], 'run-id')
    const card = attestSupervisorCard(
      root,
      runId,
      requiredArgument(option(args, '--sha256'), '--sha256'),
    )

    print({
      status: 'attested',
      run_id: runId,
      card_path: card.path,
      sha256: card.sha256,
      attested_at: card.attested_at,
      session_generation: card.session_generation,
      next_command: `${pan} status ${runId} --redline --occasion <pan-start|pan-resume>`,
      then: `${pan} prepare ${runId}`,
    })
    return
  }

  if (sub === 'card') {
    const card = buildGovernanceCard(root, {
      mode: requiredArgument(option(args, '--mode'), '--mode'),
      extensionId: option(args, '--extension'),
      requestPath: option(args, '--request'),
      outputPath: option(args, '--out'),
      worktreeName: option(args, '--worktree'),
      baseRef: option(args, '--base'),
      targetRef: option(args, '--target'),
      closureRevision: option(args, '--closure-revision'),
      dimensions: commaSeparatedOption(
        args,
        '--dimensions',
        availableReviewDimensions(root).map((dimension) => dimension.slug),
      ),
      contracts: option(args, '--horizon')
        ? loadHorizonSession(root, option(args, '--horizon') as string)
            .contracts
        : undefined,
    })

    print({
      status: 'ready',
      mode: card.mode,
      card_path: card.path,
      ...(card.review_dimensions
        ? { review_dimensions: card.review_dimensions }
        : {}),
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
    const scope = resolveReviewScope(root, workspaceRepositoryRoot(root), {
      head: requiredArgument(option(args, '--target'), '--target'),
      base: option(args, '--base'),
      defaultBranch: option(args, '--default-branch'),
      closureRevision: option(args, '--closure-revision'),
    })

    const tiers = conflictsByTier(scope.conflicts)

    print({
      base: scope.base,
      head: scope.head,
      closure_tracking: scope.closure_tracking,
      closure_revision: scope.closure_revision,
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

  throw new PanError(`Unknown governance subcommand: ${sub ?? '(missing)'}`, {
    code: 'UNKNOWN_COMMAND',
  })
}
