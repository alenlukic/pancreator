/** Deterministic gate-criterion evaluation. */

import path from 'node:path'

import { isRecord } from '../io.js'
import { repositoryCheckProfileName } from '../repository-checks.js'
import {
  isSelfDevelopmentInstallation,
  isTargetInstallation,
} from '../project-config.js'
import {
  gitWorkspaceSnapshot,
  workspaceChangedPathsFromSnapshots,
  workspaceAbsorbedPathsFromSnapshots,
  gitIsAncestor,
} from '../git.js'
import {
  isReleaseMetadataPath,
  validateReleaseMetadata,
} from '../versioning.js'
import type {
  RunState,
  StageDefinition,
  WorkspaceSnapshot,
  StageOutput,
  DeterministicResult,
} from '../types.js'
import { releaseSourceFingerprint } from '../release-source.js'
import { runShellCheck } from './shell-check.js'
import { classifyControllerChanges } from './scope-custody.js'
import {
  absorbedPathOwners,
  absorbedRunAttributionNote,
  boundedPathList,
  boundedWorkspaceDelta,
  evaluateStateCriterion,
  harnessRootWrites,
  resolveShipPriorGatesEvidenceFingerprint,
  shipHeadMatchesRelease,
  workspaceDelta,
} from './state-criteria.js'

/**
 * Evaluate a stage's deterministic criteria at submission and return the
 * results, the after workspace snapshot, and advisories. Adds
 * `scope.no_unapproved_changes` for a stage that is not source-allowed: it
 * fails on unattributed workspace changes, commit-absorbed paths no live run
 * owns, and any write to the harness root outside `runtime/`. Runs each shell
 * gate unless an override, the verification level, or `gateSkipReason` disables
 * it or an entry gate result is reused, and evaluates each state criterion.
 * Shell gates execute commands and write evidence logs to the run directory.
 */
export function evaluateDeterministicCriteria(
  root: string,
  runDirectory: string,
  state: RunState,
  stage: StageDefinition,
  beforeSnapshot: WorkspaceSnapshot,
  workspaceDir: string,
  gateOverrides: Record<string, string | false> = {},
  artifactId = stage.slug,
  stageOutput?: StageOutput,
  onProgress?: (message: string) => void,
  gateSkipReason: string | null = null,
  afterSnapshot: WorkspaceSnapshot = gitWorkspaceSnapshot(workspaceDir, {
    commitBase: beforeSnapshot.head,
  }),
  entryGateResults: Record<string, DeterministicResult> = {},
  harnessBefore?: WorkspaceSnapshot,
): {
  results: DeterministicResult[]
  workspace: WorkspaceSnapshot
  advisories: string[]
} {
  const results: DeterministicResult[] = []
  const advisories: string[] = []

  let scopePassed = true

  const harnessPaths = harnessRootWrites(root, workspaceDir, harnessBefore)
  const custody = classifyControllerChanges(
    root,
    workspaceDir,
    state,
    stage,
    harnessPaths,
  )
  const custodyBlocked =
    custody.invalid || custody.own.length > 0 || custody.unverified.length > 0
  const custodyNote = [
    custody.own.length > 0
      ? ` Own unauthorized writes or attempts: ${boundedPathList(custody.own)}.`
      : '',
    custody.foreign.length > 0
      ? ` External controller observations excluded by enforced process boundaries: ${boundedPathList(custody.foreign)}.`
      : '',
    custody.unverified.length > 0
      ? ` Unverified attribution in harness root '${root}': ${boundedPathList(custody.unverified)}.`
      : '',
    custody.missing.length > 0
      ? ` Custody fallback: ${custody.missing.join(' ')} Collect complete launch identities and enforced write boundaries for this invocation; rerun with enforcement or collect independent actor evidence for each write.`
      : '',
    custody.evidence.length > 0
      ? ` Custody evidence: ${boundedPathList(custody.evidence)}.`
      : '',
  ].join('')
  if (custody.missing.length > 0) {
    advisories.push(custodyNote.trim())
  }

  if (stage.workspace_policy !== 'source_allowed' || custodyBlocked) {
    const changedPaths = workspaceChangedPathsFromSnapshots(
      beforeSnapshot,
      afterSnapshot,
    )
    const releaseMetadataAllowed =
      stage.workspace_policy === 'release_metadata_only' &&
      isSelfDevelopmentInstallation(root)
    const blocksUnderPolicy = (relativePath: string): boolean =>
      !releaseMetadataAllowed || !isReleaseMetadataPath(relativePath)

    // A commit of already-present content is not a workspace change, but it is
    // still this stage's action, so each absorbed path owes an author. The
    // ones a live run in this worktree claims pass and are named; the rest
    // join the blocking set.
    const absorbedPaths = workspaceAbsorbedPathsFromSnapshots(
      beforeSnapshot,
      afterSnapshot,
    ).filter(blocksUnderPolicy)
    const absorbedOwners = absorbedPathOwners(root, state, absorbedPaths)
    const unownedAbsorbedPaths = absorbedPaths.filter(
      (relativePath) => !absorbedOwners.has(relativePath),
    )

    const blockingPaths = [
      ...changedPaths.filter(blocksUnderPolicy),
      ...unownedAbsorbedPaths,
    ].sort()
    const allowedPaths = releaseMetadataAllowed
      ? changedPaths.filter((relativePath) =>
          isReleaseMetadataPath(relativePath),
        )
      : []

    const attribution = stageOutput?.workspace_changes
    const normalizeDeclaredPath = (relativePath: string): string =>
      path.posix
        .normalize(relativePath.replaceAll('\\', '/'))
        .replace(/^\.\//u, '')
    const declaredInternalPaths = new Set(
      attribution?.attribution === 'internal'
        ? attribution.paths.map(normalizeDeclaredPath)
        : [],
    )
    const internallyAttributed =
      blockingPaths.length > 0 &&
      attribution?.attribution === 'internal' &&
      attribution.explanation.trim().length > 0 &&
      blockingPaths.every((relativePath) =>
        declaredInternalPaths.has(normalizeDeclaredPath(relativePath)),
      )

    const unattributedPaths = blockingPaths.filter(
      (relativePath) => !declaredInternalPaths.has(relativePath),
    )
    const changed =
      custodyBlocked || (blockingPaths.length > 0 && !internallyAttributed)
    // Naming the remedy where the failure is read: the Phase 3 release spent
    // an operator waiver on a landing the contract now sequences later.
    const harnessRootRemedy =
      stage.slug === 'ship'
        ? ' A release landing is an operator step after submit: complete the' +
          ' ship stage first, then fast-forward the local default branch to' +
          " this run's release or index commit."
        : ''

    scopePassed = !changed
    const absorbedNote = absorbedRunAttributionNote(absorbedOwners, state)
    results.push({
      id: 'scope.no_unapproved_changes',
      type: 'state',
      hard: true,
      passed: !changed,
      explanation:
        (custodyBlocked
          ? `Scope custody could not authorize the stage.${harnessRootRemedy}`
          : changed
            ? `Workspace contamination is external or unattributed for the '${stage.workspace_policy}' stage: ${boundedPathList(unattributedPaths.length > 0 ? unattributedPaths : blockingPaths)}.`
            : internallyAttributed
              ? `All workspace changes were traced to the active worker; no external contamination was detected: ${boundedPathList(blockingPaths)}.`
              : allowedPaths.length > 0
                ? `Only permitted release metadata changed: ${boundedPathList(allowedPaths)}.`
                : 'Workspace fingerprint is unchanged.') +
        absorbedNote +
        custodyNote,
      delta:
        changedPaths.length > 0
          ? boundedWorkspaceDelta(workspaceDelta(beforeSnapshot, afterSnapshot))
          : { added: [], removed: [] },
      workspace_fingerprint: afterSnapshot.fingerprint,
    })
  }

  if (stage.persona === 'release-steward') {
    return { results, workspace: afterSnapshot, advisories }
  }

  for (const criterion of stage.criteria) {
    if (criterion.type === 'shell') {
      const override = Object.prototype.hasOwnProperty.call(
        gateOverrides,
        criterion.id,
      )
        ? gateOverrides[criterion.id]
        : undefined

      const verificationSkip =
        override === undefined &&
        state.verification !== undefined &&
        state.verification.gates[criterion.id] === false &&
        repositoryCheckProfileName(criterion.command ?? '') !== null

      // A shell gate can only confirm a success. When the submission has
      // already decided a non-success outcome, executing the command spends
      // its runtime proving nothing, so the gate is recorded as skipped
      // instead of run. State criteria below still evaluate: scope and
      // currency checks detect contamination regardless of the outcome.
      const finalCheck =
        criterion.id === 'ship.full_suite' ||
        criterion.id === 'verify.final_fast' ||
        criterion.id === 'verify.fast_wall_ceiling'
      const skipReason =
        gateSkipReason ??
        (finalCheck &&
        results.some(
          (result) => result.hard && !result.passed && !result.disabled,
        )
          ? 'an earlier required check failed'
          : null)

      if (skipReason !== null) {
        results.push({
          id: criterion.id,
          type: 'shell',
          hard: Boolean(criterion.hard),
          passed: true,
          skipped: true,
          explanation:
            `Gate not executed: ${skipReason}, so the outcome was ` +
            'already decided as non-success before any deterministic gate ' +
            'ran. A shell gate runs only when its result can decide the stage.',
          command: criterion.command,
          workspace_fingerprint: afterSnapshot.fingerprint,
        })
      } else if (entryGateResults[criterion.id]) {
        // The harness ran this gate when the run entered the stage, before the
        // worker started. The recorded result decides the submission: running
        // the command again here would execute the profile a second time on
        // the same visit.
        const recorded = entryGateResults[criterion.id]

        results.push({
          ...recorded,
          entry_gate: true,
          explanation:
            `Recorded at stage entry, before the worker was delegated. ` +
            recorded.explanation,
        })
      } else if (override === false) {
        results.push({
          id: criterion.id,
          type: 'shell',
          hard: Boolean(criterion.hard),
          passed: true,
          disabled: true,
          explanation: 'Gate disabled by run configuration.',
          command: criterion.command,
          workspace_fingerprint: afterSnapshot.fingerprint,
        })
      } else if (verificationSkip) {
        results.push({
          id: criterion.id,
          type: 'shell',
          hard: Boolean(criterion.hard),
          passed: true,
          disabled: true,
          verification_level: state.verification?.level,
          explanation:
            `Gate skipped by verification level ` +
            `'${state.verification?.level}'.`,
          command: criterion.command,
          workspace_fingerprint: afterSnapshot.fingerprint,
        })
      } else {
        const sourceBefore =
          criterion.id === 'ship.full_suite' ||
          criterion.id === 'verify.final_fast'
            ? releaseSourceFingerprint(workspaceDir)
            : null
        const checked = runShellCheck(
          root,
          runDirectory,
          state,
          stage,
          criterion,
          afterSnapshot,
          workspaceDir,
          typeof override === 'string' ? override : undefined,
          artifactId,
          onProgress,
          { beforeSnapshot },
        )
        if (
          (criterion.id === 'ship.full_suite' ||
            criterion.id === 'verify.final_fast') &&
          checked.passed &&
          !checked.disabled &&
          !checked.skipped
        ) {
          const profile = repositoryCheckProfileName(checked.command ?? '')
          const fingerprint = releaseSourceFingerprint(workspaceDir)
          if (profile && fingerprint && fingerprint === sourceBefore) {
            checked.verified_source = { fingerprint, profile }
          } else {
            checked.passed = false
            checked.explanation =
              'The source changed during the final verify check; its result cannot authorize a release.'
          }
        }
        results.push(checked)
      }
    } else if (criterion.type === 'state') {
      if (criterion.id === 'ship.local_release_complete') {
        const release = isRecord(stageOutput?.data.release)
          ? stageOutput.data.release
          : null
        const local =
          release && isRecord(release.local_release)
            ? release.local_release
            : null

        const releaseCommit =
          local && typeof local.release_commit === 'string'
            ? local.release_commit
            : ''
        const indexCommit =
          local && typeof local.index_commit === 'string'
            ? local.index_commit
            : ''
        const fetchedMain =
          local && typeof local.fetched_main === 'string'
            ? local.fetched_main
            : ''

        const legacyUnboundRelease =
          isSelfDevelopmentInstallation(root) && !state.managed_worktree

        // The operator kept this compatibility path, because removing it
        // changes the behavior of an installation that predates managed
        // worktrees. A hard criterion that passes without being satisfied
        // must still say so, so the record carries the reason.
        if (legacyUnboundRelease) {
          advisories.push(
            `The hard criterion '${criterion.id}' passed through the legacy ` +
              `compatibility path: this self-development run carries no ` +
              `managed worktree, so local release commit topology was not ` +
              `evaluated.`,
          )
        }

        const passed =
          isTargetInstallation(root) || legacyUnboundRelease
            ? true
            : /^[0-9a-f]{40}$/u.test(releaseCommit) &&
              /^[0-9a-f]{40}$/u.test(indexCommit) &&
              /^[0-9a-f]{40}$/u.test(fetchedMain) &&
              shipHeadMatchesRelease(
                workspaceDir,
                indexCommit,
                release?.ship_repair,
              ) &&
              gitIsAncestor(workspaceDir, releaseCommit, indexCommit) &&
              gitIsAncestor(workspaceDir, fetchedMain, releaseCommit) &&
              afterSnapshot.entries.length === 0

        results.push({
          id: criterion.id,
          type: 'state',
          hard: Boolean(criterion.hard),
          passed,
          explanation: isTargetInstallation(root)
            ? 'Embedded ship creates no Pancreator local release commits.'
            : legacyUnboundRelease
              ? 'This legacy run has no managed worktree binding, so local release commits do not apply.'
              : passed
                ? 'Fetched main, release commit, index commit, and clean worktree topology are complete.'
                : 'Local release commit topology or worktree cleanliness is incomplete.',
          workspace_fingerprint: afterSnapshot.fingerprint,
        })
        continue
      }

      if (criterion.id === 'ship.release_metadata_updated') {
        const metadataErrors = isSelfDevelopmentInstallation(root)
          ? validateReleaseMetadata(workspaceDir).errors
          : []

        results.push({
          id: criterion.id,
          type: 'state',
          hard: Boolean(criterion.hard),
          passed: metadataErrors.length === 0,
          explanation: isTargetInstallation(root)
            ? 'Pancreator release metadata is not owned by embedded target workflows.'
            : metadataErrors.length === 0
              ? 'Release metadata and version-bearing documentation are synchronized.'
              : `Release metadata is not synchronized: ${metadataErrors.join('; ')}`,
          workspace_fingerprint: afterSnapshot.fingerprint,
        })
        continue
      }

      const evidence = resolveShipPriorGatesEvidenceFingerprint({
        state,
        stage,
        beforeSnapshot,
        afterSnapshot,
        scopePassed,
      })
      const result = evaluateStateCriterion(
        state,
        criterion,
        evidence.fingerprint,
      )
      const releaseMetadataNormalized =
        stage.workspace_policy === 'release_metadata_only' &&
        criterion.id === 'ship.prior_gates_current' &&
        evidence.fingerprint !== afterSnapshot.fingerprint
      const chainBasis =
        evidence.attribution_links > 0
          ? `Every ship attempt and ${evidence.attribution_links} same-run release-metadata attribution record${evidence.attribution_links === 1 ? '' : 's'} since QA chains back to the QA fingerprint with an adjudicated window, so release-metadata edits do not invalidate the reviewed implementation fingerprint.`
          : 'Every ship attempt since QA chains back to the QA fingerprint with an adjudicated scope window, so ship-stage edits do not invalidate the reviewed implementation fingerprint.'

      results.push(
        releaseMetadataNormalized
          ? {
              ...result,
              explanation: `${result.explanation ?? ''} ${chainBasis}`.trim(),
              workspace_fingerprint: afterSnapshot.fingerprint,
            }
          : result,
      )
    }
  }

  return { results, workspace: afterSnapshot, advisories }
}
