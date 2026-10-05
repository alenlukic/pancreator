/**
 * Submission preconditions a supervisor owns: the evidence reports and the
 * DELEGATE-001 observation of the stage worker.
 */

import { invariant } from '../errors.js'
import { fileExists, readText, resolveInside } from '../io.js'
import {
  DELEGATION_CADENCE_EXTENDED,
  DELEGATION_FOREGROUND_RETURN,
  DELEGATION_TIMER_UNAWAITED,
  DELEGATION_UNOBSERVED,
  DELEGATION_WATCH_LATE,
  DELEGATION_WATCH_LATE_SECONDS,
  DELEGATION_WATCH_LOW_COVERAGE,
  DEFAULT_WATCH_CADENCE_SECONDS,
  WATCH_LOW_COVERAGE_RATIO,
  delegationUnobservedMessage,
  launchToOutputSeconds,
  summarizeDelegationObservation,
  type DelegationObservation,
} from '../watch.js'
import { panCommand } from '../project-config.js'
import { evidenceWorkerAttempts, readEvidenceReportState } from '../render.js'
import { watchedAgentActivity } from '../watch.js'
import { WORKER_STILL_ACTIVE } from '../watch/types.js'
import {
  executorProcessActivity,
  processBackedExecutor,
} from '../watch/executor-process.js'
import { workerActivityRefusal } from '../watch/liveness.js'
import type {
  Invocation,
  PersonaExecutorKind,
  RunAdvisory,
  StageDefinition,
} from '../types.js'

/**
 * Every incomplete report among the invocation's evidence workers. A missing
 * or empty report rejects the submission instead.
 */
export function incompleteEvidenceReports(
  root: string,
  invocation: Invocation,
): string[] {
  const incompleteReports: string[] = []

  // Parallel evidence reports are supervisor-owned preconditions, so their
  // absence rejects the submission outright instead of consuming an attempt.
  for (const worker of invocation.evidence_workers ?? []) {
    // A relaunched worker wrote its own report beside the first one, so any
    // attempt of the role satisfies the precondition.
    const attempts = evidenceWorkerAttempts(worker)

    invariant(
      attempts.some((attempt) => {
        const absolute = resolveInside(root, attempt.evidence_path)

        return fileExists(absolute) && readText(absolute).trim().length > 0
      }),
      `Evidence report for role '${worker.role}' is missing or empty at ` +
        attempts.map((attempt) => attempt.evidence_path).join(', ') +
        `. Launch the parallel evidence workers ` +
        `from the supervisor procedure and persist their reports before ` +
        `submitting.`,
      { code: 'EVIDENCE_REPORT_MISSING' },
    )

    // A report that stops before its completion marker is the record of an
    // interrupted worker. Its cases are still evidence, so the submission
    // proceeds and says what it is consolidating.
    for (const attempt of attempts) {
      const absolute = resolveInside(root, attempt.evidence_path)

      if (!fileExists(absolute)) {
        continue
      }

      const report = readEvidenceReportState(readText(absolute))

      if (!report.complete) {
        incompleteReports.push(
          `Evidence report ${attempt.evidence_path} for role ` +
            `'${worker.role}' is incomplete: it records ` +
            `${report.cases.length} case` +
            `${report.cases.length === 1 ? '' : 's'} and no completion ` +
            `marker, so its worker stopped before finishing.`,
        )
      }
    }
  }

  return incompleteReports
}

/**
 * The DELEGATE-001 observation of a stage worker, with the supervision
 * advisories it earns. An unobserved worker rejects the submission instead.
 */
export function observeSubmissionDelegation(
  root: string,
  runId: string,
  stage: StageDefinition,
  invocation: Invocation,
  personaExecutor: PersonaExecutorKind,
  advise: (kind: RunAdvisory['kind'], messages: string[]) => void,
): DelegationObservation | undefined {
  // DELEGATE-001: the harness must have seen the worker reach a terminal
  // state. A completed `pan watch` record or a foreground-return attestation
  // is that evidence for an operator-session worker; `pan delegate` writes
  // its own for a harness-delegated worker. Like a missing evidence report,
  // this is a supervisor-owned precondition and rejects outright without
  // consuming an attempt. The exemption reads the execution record whatever
  // the executor is; only the refusal wording turns on who owns the dispatch
  // in an operator session, which for a Cursor stage is that session itself.
  const delegationObservation: DelegationObservation | undefined =
    stage.persona !== 'orchestrator'
      ? summarizeDelegationObservation(root, runId, invocation.invocation_id, {
          externalExecutor: personaExecutor !== 'cursor',
        })
      : undefined

  if (delegationObservation) {
    invariant(
      delegationObservation.observed,
      delegationUnobservedMessage(
        delegationObservation,
        panCommand(root),
        runId,
        invocation.invocation_id,
      ),
      {
        code: DELEGATION_UNOBSERVED,
        details: {
          watch_record_path: delegationObservation.watch.record_path,
          foreground_return_path:
            delegationObservation.foreground_return.record_path,
        },
      },
    )

    // DELEGATE-001 says a background conversion is watched immediately.
    // A late arming still submits — the work was observed — but the run
    // records how late, so a supervisor that armed at once and one that
    // armed after an operator reprimand stop looking identical. Lateness
    // is measured from the platform's evidenced control return; without
    // that clock the delay is labeled launch-unattributed and never fired.
    if (delegationObservation.watch.background_watch_late) {
      advise('delegation_supervision', [
        `${DELEGATION_WATCH_LATE}: the background watch for ` +
          `${invocation.invocation_id} was armed ` +
          `${delegationObservation.watch.background_mark_delay_seconds?.toFixed(0)}s ` +
          `after the platform returned control, past the ` +
          `${DELEGATION_WATCH_LATE_SECONDS}s DELEGATE-001 allows. ` +
          `Supervision was late, not absent.`,
      ])
    }

    // Every cadence exception is retained on the summary; a session past
    // the 60-second default earns the advisory even when it was directed,
    // so the audit can line authority up against the exception.
    const extendedCadence =
      delegationObservation.watch.cadence_exceptions.filter(
        (exception) =>
          exception.cadence_seconds > DEFAULT_WATCH_CADENCE_SECONDS,
      )

    if (extendedCadence.length > 0) {
      advise('delegation_supervision', [
        `${DELEGATION_CADENCE_EXTENDED}: run ${runId} invocation ` +
          `${invocation.invocation_id} watched at ` +
          `${extendedCadence
            .map(
              (exception) =>
                `${exception.cadence_seconds}s (authority: ${exception.authority ?? 'none recorded'})`,
            )
            .join(', ')}. An operator-directed exception is legitimate and ` +
          `stays visible here; an undirected one is a DELEGATE-001 finding.`,
      ])
    }

    // Coverage below the ratified threshold with a trustworthy launch clock
    // and a lifetime past one cadence is reported, never hidden: five
    // seconds over twenty minutes must stay visible.
    const watchSummary = delegationObservation.watch

    if (
      watchSummary.coverage_basis === 'launch_record' &&
      watchSummary.coverage_ratio !== null &&
      watchSummary.coverage_ratio < WATCH_LOW_COVERAGE_RATIO
    ) {
      const lifetimeSeconds = launchToOutputSeconds(
        root,
        runId,
        invocation.invocation_id,
      )

      if (
        lifetimeSeconds !== null &&
        watchSummary.cadence_seconds !== null &&
        lifetimeSeconds > watchSummary.cadence_seconds
      ) {
        advise('delegation_supervision', [
          `${DELEGATION_WATCH_LOW_COVERAGE}: run ${runId} invocation ` +
            `${invocation.invocation_id} observed ` +
            `${watchSummary.covered_seconds?.toFixed(1)}s of a ` +
            `${lifetimeSeconds.toFixed(1)}s launch-to-output interval ` +
            `(ratio ${watchSummary.coverage_ratio.toFixed(3)}, raw span ` +
            `${watchSummary.raw_span_seconds?.toFixed(1)}s, basis ` +
            `${watchSummary.coverage_basis}). Observation this thin cannot ` +
            `show the worker was watched; legitimate fast workers remain ` +
            `distinguishable by their short lifetime.`,
        ])
      }
    }

    // A background mark made with no attached terminal is a suspicion the
    // run carries, never a proof of abandonment.
    if (delegationObservation.watch.unawaited_timer_suspected) {
      advise('delegation_supervision', [
        `${DELEGATION_TIMER_UNAWAITED}: the background watch for ` +
          `${invocation.invocation_id} was marked from a process with no ` +
          `attached terminal, so the harness cannot show the timer was ` +
          `awaited. Awaitedness stays unknown; platform or harness ` +
          `transport evidence can refine it later.`,
      ])
    }

    // US-005: a submission resting on a foreground-return attestation
    // rather than a completed watch earns a submit advisory so the run
    // record stays honest about what was observed.
    if (delegationObservation.source === 'foreground_return') {
      advise('delegation_supervision', [
        `${DELEGATION_FOREGROUND_RETURN}: invocation ` +
          `${invocation.invocation_id} was observed through a ` +
          `foreground-return attestation rather than a completed watch. ` +
          `DELEGATE-001 requires every new launch to use ` +
          `run_in_background: true and be observed with pan watch.`,
      ])
    }
  }

  return delegationObservation
}

/** Refuse submission while the stage worker's turn or open call is still active. */
export function assertWorkerNotStillActive(
  root: string,
  invocation: Invocation,
  personaExecutor: PersonaExecutorKind,
  stage: StageDefinition,
): void {
  if (stage.persona === 'orchestrator') {
    return
  }

  if (processBackedExecutor(invocation)) {
    invariant(
      executorProcessActivity(root, invocation, Date.now()) !== null,
      `The ${personaExecutor} worker for ${invocation.invocation_id} has no ` +
        `execution record, so its pan delegate process is still open. Wait ` +
        `for that process to exit, then submit.`,
      { code: WORKER_STILL_ACTIVE },
    )
    return
  }

  if (personaExecutor !== 'cursor') {
    return
  }

  const activity = watchedAgentActivity(
    root,
    invocation,
    Date.now(),
    DEFAULT_WATCH_CADENCE_SECONDS,
  )
  const reason = workerActivityRefusal(activity)

  invariant(reason === null, reason ?? 'Worker still active.', {
    code: WORKER_STILL_ACTIVE,
  })
}
