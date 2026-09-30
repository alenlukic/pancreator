/**
 * Shell-check resolution, repository-check baseline loading, and the
 * environment-blocked delta judgment.
 */

import path from 'node:path'

import { errorMessage } from '../errors.js'
import { isRecord, resolveInside, fileExists, readJson } from '../io.js'
import {
  repositoryCheckProfileName,
  adoptedBaselineWorkspaceDivergence,
  compareRepositoryCheckToBaseline,
  commandFailureDiagnostics,
} from '../repository-checks.js'
import type {
  RepositoryCheckResult,
  BaselineWorkspaceDivergence,
  RepositoryCheckBaselineArtifact,
} from '../repository-checks.js'
import { FAST_WALL_CRITERION_ID } from '../fast-wall-series.js'
import { panCommand, isTargetInstallation } from '../project-config.js'
import { executingSourceRoot } from '../build-identity.js'
import { repositoryCheckGateCommand } from '../gate-cache.js'
import type { Criterion, RunState, StageDefinition } from '../types.js'

interface ShellCheckResolution {
  command: string
  profile_name: string | null
  removed_reason?: string
}

export function resolveShellCheck(
  root: string,
  criterion: Criterion,
  requestedCommand: string,
  overridden: boolean,
): ShellCheckResolution {
  // Keyed on the criterion id, the same key `runShellCheck` uses to attach
  // this gate's explanation. Resolving one half by literal command text let
  // the two disagree over a re-spelled command or a borrowed one.
  if (!overridden && criterion.id === FAST_WALL_CRITERION_ID) {
    const executingRoot = executingSourceRoot()
    const command = executingRoot
      ? `'${path.join(executingRoot, 'bin/pan').replaceAll("'", "'\"'\"'")}'`
      : panCommand(root)

    return {
      command: `${command} tests wall`,
      profile_name: null,
    }
  }

  if (overridden || !isTargetInstallation(root)) {
    return {
      command: requestedCommand,
      profile_name: overridden
        ? null
        : repositoryCheckProfileName(requestedCommand),
    }
  }

  const legacyProfiles: Record<string, string> = {
    'implement.lint:npm run lint': 'static',
    'implement.unit_tests:npm test': 'fast',
    'test.full_suite:npm test': 'full',
    'ship.validate:npm run validate': 'configuration',
  }
  const legacyKey = `${criterion.id}:${requestedCommand.trim()}`
  const legacyProfile = legacyProfiles[legacyKey]

  if (legacyProfile) {
    return {
      command: repositoryCheckGateCommand(legacyProfile),
      profile_name: legacyProfile,
    }
  }

  if (
    criterion.id === 'test.coverage' &&
    requestedCommand.trim() === 'npm run test:coverage'
  ) {
    return {
      command: requestedCommand,
      profile_name: null,
      removed_reason:
        'Legacy standalone coverage gate removed; coverage belongs inside a target-owned repository profile when applicable.',
    }
  }

  if (
    criterion.id === 'preflight.validate' &&
    requestedCommand.trim() === 'npm run validate'
  ) {
    return {
      command: '"$PANCREATOR_ROOT/bin/pan" validate',
      profile_name: null,
    }
  }

  // An installation ships no harness test suite, so the gate runs the target's
  // own fast profile instead. An unconfigured profile records as not
  // configured rather than executing a guessed command.
  if (criterion.id === 'preflight.tests') {
    return {
      command: repositoryCheckGateCommand('fast'),
      profile_name: 'fast',
    }
  }

  return {
    command: requestedCommand,
    profile_name: repositoryCheckProfileName(requestedCommand),
  }
}

export interface RepositoryCheckBaselineLoad {
  result?: RepositoryCheckResult
  artifact_path?: string
  /** Why the baseline cannot support a gate. Absent when none is expected. */
  reason?: string
  /**
   * Set when this run adopted the baseline from another workspace, which a
   * shared cohort baseline is. The comparison names the two trees instead of
   * attributing a new diagnostic to this change.
   */
  workspace_divergence?: BaselineWorkspaceDivergence
}

/**
 * Whether this run completed repository-check baseline capture.
 *
 * The map is absent before the first source-allowed stage. An empty map is still
 * a completed capture for a workflow with no configured profiles, and it must
 * not let a later stage silently recapture post-implementation state.
 */
export function repositoryCheckBaselinesCaptured(state: RunState): boolean {
  return state.repository_check_baselines !== undefined
}

function isRepositoryCheckBaselineArtifact(
  value: unknown,
  profileName: string,
): value is RepositoryCheckBaselineArtifact {
  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    value.profile !== profileName ||
    !isRecord(value.result)
  ) {
    return false
  }

  return (
    value.result.profile === profileName && Array.isArray(value.result.results)
  )
}

/**
 * State that a failing repository-check gate was judged on its own result, and
 * name the profiles the run did baseline so the reader can tell an unbaselined
 * profile from a missing artifact.
 */
export function absoluteJudgingDisclosure(
  state: RunState,
  profileName: string,
): string {
  const baselined = Object.keys(state.repository_check_baselines ?? {}).sort()

  return (
    `No pre-implementation baseline covers repository-check profile ` +
    `'${profileName}', so this gate judged the profile absolutely rather ` +
    `than against inherited diagnostics: every failure it reports may ` +
    `predate this run. Profiles this run baselined: ` +
    `${baselined.length > 0 ? baselined.join(', ') : 'none'}.`
  )
}

/**
 * Load the pre-implementation baseline a repository-check gate compares against.
 *
 * Once a run captures baselines, a gated profile without a readable, matching
 * baseline is a harness defect rather than a licence to judge the gate on its
 * exit code alone, so the missing artifact is reported and the gate fails closed.
 */
export function loadRepositoryCheckBaseline(
  root: string,
  state: RunState,
  profileName: string,
): RepositoryCheckBaselineLoad {
  if (!repositoryCheckBaselinesCaptured(state)) {
    return {}
  }

  const pointer = state.repository_check_baselines?.[profileName]

  if (!pointer) {
    // Under a verification level, only source-mutating stage profiles are
    // baselined, so an absent pointer is the expected state for a later gate's
    // heavier profile: that gate is judged on its own result. A run created
    // before levels existed baselined every gated profile, so an absent
    // pointer there is a harness defect and the gate fails closed.
    if (state.verification) {
      return {}
    }

    return {
      reason:
        `No pre-implementation baseline was recorded for repository-check ` +
        `profile '${profileName}'.`,
    }
  }

  // Resolved from the pointer rather than from the two results, because only
  // the pointer knows the baseline was adopted. A run that captured its own
  // baseline is compared exactly as it was before, even when the checkout
  // itself has moved since.
  const divergence = adoptedBaselineWorkspaceDivergence(
    pointer,
    state.workspace_root || '.',
  )
  const divergenceField = divergence ? { workspace_divergence: divergence } : {}
  const absolute = resolveInside(root, pointer.artifact_path)

  if (!fileExists(absolute)) {
    return {
      reason:
        `Pre-implementation baseline artifact is missing for profile ` +
        `'${profileName}': ${pointer.artifact_path}.`,
    }
  }

  let artifact: unknown

  try {
    artifact = readJson(absolute)
  } catch (error) {
    return {
      reason:
        `Pre-implementation baseline for profile '${profileName}' is unreadable ` +
        `(${pointer.artifact_path}): ${errorMessage(error)}.`,
    }
  }

  if (!isRepositoryCheckBaselineArtifact(artifact, profileName)) {
    return {
      reason:
        `Pre-implementation baseline for profile '${profileName}' is ` +
        `incompatible with its gate (${pointer.artifact_path}).`,
    }
  }

  if (!artifact.full_result_path) {
    return {
      result: artifact.result,
      artifact_path: pointer.artifact_path,
      ...divergenceField,
    }
  }

  const fullAbsolute = resolveInside(root, artifact.full_result_path)

  if (!fileExists(fullAbsolute)) {
    return {
      reason:
        `Full pre-implementation baseline artifact is missing for profile ` +
        `'${profileName}': ${artifact.full_result_path}.`,
    }
  }

  let fullArtifact: unknown

  try {
    fullArtifact = readJson(fullAbsolute)
  } catch (error) {
    return {
      reason:
        `Full pre-implementation baseline for profile '${profileName}' is ` +
        `unreadable (${artifact.full_result_path}): ${errorMessage(error)}.`,
    }
  }

  if (!isRepositoryCheckBaselineArtifact(fullArtifact, profileName)) {
    return {
      reason:
        `Full pre-implementation baseline for profile '${profileName}' is ` +
        `incompatible with its gate (${artifact.full_result_path}).`,
    }
  }

  return {
    result: fullArtifact.result,
    artifact_path: artifact.full_result_path,
    ...divergenceField,
  }
}

/**
 * True when a failed QA repository-check delta carries only timeout or
 * collection artifacts on infrastructure that already failed at baseline.
 * Exported so tests can anchor the classification to preserved evidence.
 */
export function isEnvironmentBlockedDelta(
  stage: StageDefinition,
  baseline: RepositoryCheckResult | undefined,
  comparison: ReturnType<typeof compareRepositoryCheckToBaseline> | undefined,
): boolean {
  // The verifier owns suite-gated QA in the delivery workflows; qa-tester
  // remains the executing persona for standalone and evidence-worker QA.
  if (
    (stage.persona !== 'verifier' && stage.persona !== 'qa-tester') ||
    baseline?.status !== 'failed' ||
    !comparison ||
    comparison.passed ||
    comparison.delta.new.length === 0
  ) {
    return false
  }

  // The embedded arrays cap at 100 entries. The classification must inspect
  // every new identity, so it reads the uncapped list and refuses to classify
  // when identities beyond the cap are unavailable.
  const newDiagnostics = comparison.delta.full?.new ?? comparison.delta.new
  const newCount = comparison.delta.counts?.new ?? newDiagnostics.length

  if (newCount > newDiagnostics.length) {
    return false
  }

  const failedBaselineCommands = new Set(
    baseline.results
      .filter(
        (result) =>
          !result.passed &&
          (result.timed_out ||
            commandFailureDiagnostics(result, baseline.workspace_root).some(
              (diagnostic) => isInfrastructureDiagnostic(diagnostic),
            )),
      )
      .map(
        (result) =>
          `${result.kind}:${result.command.trim().replaceAll(/\s+/gu, ' ')}`,
      ),
  )

  return newDiagnostics.every((diagnostic) => {
    const commandWasCarried = failedBaselineCommands.has(
      `${diagnostic.kind}:${diagnostic.command}`,
    )

    return (
      commandWasCarried && isInfrastructureDiagnostic(diagnostic.diagnostic)
    )
  })
}

/** A pytest test-failure record: product evidence, never infrastructure. */
function isTestFailureRecord(diagnostic: string): boolean {
  return /^FAILED\b/u.test(diagnostic) || /^\S+::.*\bFAILED\b/u.test(diagnostic)
}

/**
 * Match infrastructure evidence by artifact *shape*, not keyword substrings.
 * A genuinely new failing test whose node id or assertion message merely
 * mentions a timeout or collection must never classify as environmental: that
 * misclassification invites an operator waiver that ships the regression.
 */
function isInfrastructureDiagnostic(diagnostic: string): boolean {
  if (isTestFailureRecord(diagnostic)) {
    return false
  }

  return (
    /^<status> .*\btimed_out=true\b/u.test(diagnostic) ||
    /\bERROR collecting\b/iu.test(diagnostic) ||
    /^ERROR\b.*\b(?:ImportError|ModuleNotFoundError)\b/u.test(diagnostic) ||
    /^(?:E\s+)?(?:ImportError|ModuleNotFoundError)\b/u.test(diagnostic) ||
    /\bETIMEDOUT\b/u.test(diagnostic) ||
    /\btimed out\b/iu.test(diagnostic) ||
    /\bworker\b.*\b(?:crash|crashed|exit|exited)\b/iu.test(diagnostic)
  )
}
