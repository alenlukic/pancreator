/**
 * Delivery routing after a ratified plan: the single-run handoff, the cohort
 * fan-out, retry, and the continuation after integration.
 */

import path from 'node:path'

import { createRun } from '../engine/create-run.js'
import { invariant, errorMessage, PanError } from '../errors.js'
import { isGitRepository, gitCurrentBranch } from '../git.js'
import {
  fileExists,
  readText,
  isRecord,
  sha256,
  withOperationMutex,
  resolveInside,
} from '../io.js'
import { panCommand } from '../project-config.js'
import {
  loadState,
  eventPath,
  now,
  operationMutexPath,
  persist,
  statePath,
  listRunStatesWhere,
  runIsLive,
} from '../state.js'
import type { CohortSessionState, RunState, DeliveryHandoff } from '../types.js'
import {
  resolveRepositoryRoot,
  readWorktreeIndex,
  createWorktree,
} from '../worktrees.js'
import {
  workspaceCleanliness,
  cleanTreeRefusal,
} from '../workspace-attribution.js'
import {
  COHORT_PLAN_WORKFLOW_SLUG,
  DELIVERY_WORKFLOW_SLUG,
  loadCohortState,
  type CohortContinuationResult,
  type DeliveryAutostartResult,
  type DeliveryRouteOptions,
} from './state.js'
import { chunkIdSlug, firstUnsatisfiedIndex } from './chunks.js'
import { readRatifiedCohortPlan, type ParsedCohortPlan } from './plan.js'
import { initCohortSession, startCohort } from './start.js'
import { cohortSessionIds } from './abandon.js'
import { startReleaseRun, startedChunksOfFirstCohort } from './release-run.js'

/** Cohort session a planning run already opened, when one exists. */
export function cohortSessionForPlanRun(
  root: string,
  planRunId: string,
): CohortSessionState | null {
  for (const cohortId of cohortSessionIds(root)) {
    try {
      const state = loadCohortState(root, cohortId)

      if (state.plan_run_id === planRunId) {
        return state
      }
    } catch {
      continue
    }
  }

  return null
}

/**
 * Route a ratified plan into delivery when its gate is approved.
 *
 * The plan gate is the routing point and the harness owns the route: exactly
 * one chunk starts one `delivery` run bound to a fresh worktree, and two or
 * more chunks open a cohort session and start cohort 1. The approval that
 * triggers it may come from the operator or from away mode acting on the
 * operator's behalf, because the routing is a recorded property of the run,
 * not a judgment made at approval time.
 *
 * `autostart_delivery` is recorded on every planning run since routing became
 * the default; `autostart_cohort` is the flag older runs recorded when only
 * the cohort fan-out was automatic. `false` on either is the operator's
 * opt-out and starts nothing. A run that recorded neither predates routing:
 * silence there would leave the operator believing something started, so the
 * hook reports a failed route whose one manual command is the retry, which
 * reads the operator's invocation as the opt-in.
 *
 * The hook runs after the decision is durable and never rewrites it. A second
 * approval finds the handoff already recorded and reports `already_started`,
 * because nothing failed. A failure reports the concrete error with the
 * manual command, because the approval and the ratified plan remain valid
 * whatever happened to the route. Every path here adds only worktrees,
 * branches, and run records, the actions `AWAY-001` and `COHORT-001` permit
 * for an autostart.
 */
export function maybeStartDelivery(
  root: string,
  state: RunState,
  decision: { actor: 'operator' | 'away'; action: string },
  options: DeliveryRouteOptions = {},
): DeliveryAutostartResult | null {
  if (
    decision.action !== 'approve' ||
    state.workflow_slug !== COHORT_PLAN_WORKFLOW_SLUG ||
    state.status !== 'succeeded'
  ) {
    return null
  }

  const requested = state.autostart_delivery ?? state.autostart_cohort

  if (requested === false) {
    return null
  }

  if (requested === undefined) {
    const failed = {
      status: 'failed' as const,
      error:
        'This planning run predates routing and recorded no opt-in or opt-out.',
      manual_commands: [routeRetryCommand(root, state.run_id)],
    }

    recordFailedDeliveryRoute(root, state, failed)

    return failed
  }

  return routeDelivery(root, state, options)
}

/**
 * Route the approved plan of a succeeded planning run again, by operator
 * command.
 *
 * The approval hook fires once, from the gate decision, so a route that
 * failed there has no second trigger: the decision is durable and cannot be
 * repeated. This is that trigger. It takes the same path the hook takes, so a
 * run or session an earlier attempt already created is adopted rather than
 * duplicated, and a successful route replaces the `failed` handoff record.
 * The operator's invocation stands in for the opt-in a run created before
 * routing never recorded.
 */
export function retryDeliveryRoute(
  root: string,
  planRunId: string,
  options: DeliveryRouteOptions = {},
): DeliveryAutostartResult {
  const state = loadState(root, planRunId)

  invariant(
    state.workflow_slug === COHORT_PLAN_WORKFLOW_SLUG,
    `Run ${planRunId} runs workflow '${state.workflow_slug}', not ` +
      `'${COHORT_PLAN_WORKFLOW_SLUG}', so it holds no plan to route.`,
    { code: 'COHORT_PLAN_RUN_INVALID' },
  )
  invariant(
    state.status === 'succeeded',
    `Run ${planRunId} is '${state.status}', not 'succeeded', so its plan ` +
      'gate has not approved a plan to route.',
    { code: 'COHORT_PLAN_RUN_NOT_SUCCEEDED' },
  )

  const decision = planGateDecision(root, planRunId)

  // A succeeded planning run whose plan gate recorded a decision reached that
  // status through an approval. A run with no decision event closed through a
  // waived or disabled gate, and its ratified plan stage is the record then.
  invariant(
    decision === null || decision === 'approve',
    `The recorded decision on the plan gate of run ${planRunId} is ` +
      `'${decision}', not 'approve', so its plan is not routed.`,
    { code: 'COHORT_PLAN_REJECTED' },
  )

  return routeDelivery(root, state, options)
}

/**
 * The last gate decision recorded on the `plan` stage of a run, read from the
 * decision events its log carries. Null when the log holds none.
 */
function planGateDecision(root: string, runId: string): string | null {
  const eventsFile = eventPath(root, runId)

  if (!fileExists(eventsFile)) {
    return null
  }

  let decision: string | null = null

  for (const line of readText(eventsFile).split('\n')) {
    if (line.trim().length === 0) {
      continue
    }

    let event: unknown

    try {
      event = JSON.parse(line)
    } catch {
      continue
    }

    if (
      isRecord(event) &&
      (event.type === 'operator_decision_recorded' ||
        event.type === 'away_decision_applied') &&
      event.stage === 'plan' &&
      typeof event.decision === 'string'
    ) {
      decision = event.decision
    }
  }

  return decision
}

/**
 * The route itself: one `delivery` run for a single chunk, cohort 1 of a
 * cohort session for a wider plan. Shared by the approval hook and the
 * operator retry, so both adopt what an earlier attempt created.
 */
function routeDelivery(
  root: string,
  state: RunState,
  options: DeliveryRouteOptions = {},
): DeliveryAutostartResult {
  let kind: 'cohort' | 'delivery' | undefined

  try {
    const plan = readRatifiedCohortPlan(root, state.run_id)

    if (plan.chunks.length === 1) {
      kind = 'delivery'

      return startSingleDeliveryRun(root, state, plan, options)
    }

    kind = 'cohort'

    // A cohort session derives one worktree per chunk, so there is no single
    // worktree an operator could name for it.
    invariant(
      options.worktreeName === undefined,
      `--worktree applies only to a single-chunk plan route. This plan has ` +
        `${plan.chunks.length} chunks, and a cohort session derives one ` +
        'worktree per chunk.',
      { code: 'COHORT_WORKTREE_NOT_APPLICABLE' },
    )

    const existing = cohortSessionForPlanRun(root, state.run_id)

    if (existing) {
      recordDeliveryHandoff(root, state, {
        kind: 'cohort',
        cohort_id: existing.cohort_id,
        recorded_at: now(),
      })

      const started = startedChunksOfFirstCohort(root, existing)

      if (started) {
        return { status: 'already_started', kind, ...started }
      }
    }

    if (!existing) {
      assertPlanningWorktreeCommitted(root, state)
    }

    // Init records the cohort handoff on the plan run itself.
    const session =
      existing ??
      initCohortSession(root, {
        planRunId: state.run_id,
        maxParallel: state.autostart_max_parallel ?? null,
      })

    return { status: 'started', kind, ...startCohort(root, session.cohort_id) }
  } catch (error) {
    const failed = {
      status: 'failed' as const,
      ...(kind ? { kind } : {}),
      error: errorMessage(error),
      // The retry adopts whatever exists at failure time: a session init
      // already opened is continued, a run already created is adopted.
      manual_commands: [routeRetryCommand(root, state.run_id)],
    }

    recordFailedDeliveryRoute(root, state, failed)

    return failed
  }
}

/** The one command that completes a failed route by hand. */
function routeRetryCommand(root: string, planRunId: string): string {
  return `${panCommand(root)} cohort route --plan-run ${planRunId}`
}

/**
 * Refuse a cohort fan-out while the planning worktree holds uncommitted work.
 *
 * A single-chunk route inherits the planning worktree and carries that work
 * forward in place. A cohort cannot: every chunk worktree branches from the
 * committed head of the base branch, so anything uncommitted in the planning
 * tree stays behind, and an unattended approval is exactly when nobody
 * compares the two trees. The route stops and names the commit the operator
 * owes; the recorded retry command routes once the tree is clean. An
 * attributed read-only input is exempt, as at every other clean-tree gate.
 */
function assertPlanningWorktreeCommitted(
  root: string,
  planState: RunState,
): void {
  const worktree = planState.managed_worktree

  if (!worktree) {
    return
  }

  const worktreePath = path.resolve(root, worktree.path)

  // A planning worktree the operator already removed holds nothing to carry.
  if (!isGitRepository(worktreePath)) {
    return
  }

  const cleanliness = workspaceCleanliness(root, worktreePath)

  if (cleanliness.clean) {
    return
  }

  invariant(
    false,
    cleanTreeRefusal(cleanliness, {
      action:
        `Plan run ${planState.run_id} cannot fan out into a cohort from ` +
        `planning worktree '${worktree.name}'`,
      remedy:
        'Every chunk worktree branches from the committed head, so this ' +
        `work would be left behind. Commit it on branch '${worktree.branch}' ` +
        `in ${worktree.path}, then run '${routeRetryCommand(root, planState.run_id)}'.`,
    }),
    {
      code: 'COHORT_PLANNING_WORKTREE_DIRTY',
      details: {
        worktree: worktree.name,
        blocking_paths: cleanliness.blocking.map((entry) => entry.path),
      },
    },
  )
}

function deliveryWorktreeName(planRunId: string, chunkId: string): string {
  return `delivery-${sha256(planRunId).slice(0, 6)}-${chunkIdSlug(chunkId)}`
}

/**
 * Record on the planning run where its ratified plan went, so `pan status`
 * on the plan run names the handoff. The plan run is closed, so this is a
 * bookkeeping event on a finished run rather than a workflow transition, and
 * it is skipped when the same handoff is already recorded.
 */
export function recordDeliveryHandoff(
  root: string,
  planState: RunState,
  handoff: DeliveryHandoff,
  eventType = 'delivery_handoff_recorded',
): void {
  withOperationMutex(operationMutexPath(root, planState.run_id), () => {
    const current = loadState(root, planState.run_id)
    const recorded = current.delivery_handoff

    if (recorded && handoffKey(recorded) === handoffKey(handoff)) {
      planState.delivery_handoff = recorded

      return
    }

    current.delivery_handoff = handoff
    persist(root, current, eventType, { handoff })
    planState.delivery_handoff = handoff
  })
}

/**
 * Persist a failed route on the plan run so `pan status` on it names the
 * failure and the manual commands after the approval's own output is gone.
 * The failure is reported whatever happens here: a plan run whose record
 * does not exist (the route failed reading it) has nowhere to write, and a
 * write failure must not hide the routing error it would annotate.
 */
function recordFailedDeliveryRoute(
  root: string,
  planState: RunState,
  failed: {
    kind?: 'cohort' | 'delivery'
    error: string
    manual_commands: string[]
  },
): void {
  if (!fileExists(statePath(root, planState.run_id))) {
    return
  }

  try {
    recordDeliveryHandoff(
      root,
      planState,
      {
        kind: 'failed',
        ...(failed.kind ? { route: failed.kind } : {}),
        error: failed.error,
        manual_commands: failed.manual_commands,
        recorded_at: now(),
      },
      'delivery_route_failed',
    )
  } catch {
    // The routing failure is the report; the missing annotation is not.
  }
}

function handoffKey(handoff: DeliveryHandoff): string {
  switch (handoff.kind) {
    case 'delivery':
      return `delivery:${handoff.run_id}`
    case 'cohort':
      return `cohort:${handoff.cohort_id}`
    case 'failed':
      return `failed:${handoff.route ?? ''}:${handoff.error}`
    default: {
      const exhaustive: never = handoff

      throw new PanError(
        `Unhandled delivery handoff: ${JSON.stringify(exhaustive)}`,
        { code: 'INVALID_DELIVERY_HANDOFF' },
      )
    }
  }
}

/**
 * Start the one `delivery` run a single-chunk plan hands off to.
 *
 * The run is bound to a fresh worktree exactly as a cohort chunk is, reads the
 * child specification as its request, and reaches the parent specification by
 * reference. The worktree name derives from the plan run and the chunk, so a
 * retry after a failure between worktree creation and run creation finds the
 * worktree it already made instead of refusing a second one, and a retry after
 * a failure between run creation and the handoff record adopts the run it
 * already made instead of binding a second run to the same worktree.
 */
function startSingleDeliveryRun(
  root: string,
  planState: RunState,
  plan: ParsedCohortPlan,
  options: DeliveryRouteOptions = {},
): DeliveryAutostartResult {
  const recorded = planState.delivery_handoff

  if (recorded?.kind === 'delivery') {
    return {
      status: 'already_started',
      kind: 'delivery',
      run_id: recorded.run_id,
      worktree: recorded.worktree,
      resume_command: `/pan-resume ${recorded.run_id}`,
    }
  }

  const planWorkspace = path.resolve(root, planState.workspace_root || '.')

  invariant(
    isGitRepository(planWorkspace),
    `Delivery handoff requires a Git repository workspace; the plan run's ` +
      `workspace ${planWorkspace} is not one, because the delivery run works ` +
      'in a worktree.',
    { code: 'COHORT_REQUIRES_GIT' },
  )

  const repositoryRoot = resolveRepositoryRoot(planWorkspace)
  const baseBranch = gitCurrentBranch(repositoryRoot)

  invariant(
    baseBranch,
    'Delivery handoff requires a named base branch. The workspace is on a ' +
      'detached HEAD.',
    { code: 'COHORT_BASE_BRANCH_REQUIRED' },
  )

  const [chunk] = plan.chunks

  invariant(
    fileExists(resolveInside(root, plan.parent_spec_path)),
    `Parent specification does not exist: ${plan.parent_spec_path}`,
    { code: 'COHORT_PARENT_SPEC_NOT_FOUND' },
  )
  invariant(
    fileExists(resolveInside(root, chunk.child_spec_path)),
    `Child specification for chunk '${chunk.id}' does not exist: ` +
      chunk.child_spec_path,
    { code: 'COHORT_CHILD_SPEC_NOT_FOUND' },
  )

  // The planning run's managed worktree is the operator's selected delivery
  // workspace too. Reusing it carries any attributed or uncommitted plan-time
  // work forward in place instead of silently branching from its committed
  // head. An explicit route option still overrides the inherited choice.
  const selectedWorktreeName =
    options.worktreeName ?? planState.managed_worktree?.name
  const worktreeName =
    selectedWorktreeName ?? deliveryWorktreeName(planState.run_id, chunk.id)
  const existingWorktree = readWorktreeIndex(root).worktrees.find(
    (entry) => entry.name === worktreeName,
  )

  invariant(
    selectedWorktreeName === undefined || existingWorktree !== undefined,
    `Worktree '${worktreeName}' does not exist. Create it with ` +
      `${panCommand(root)} worktree create ${worktreeName}, or omit ` +
      '--worktree on an unbound planning run to let the route derive and create one.',
    { code: 'WORKTREE_NOT_FOUND', details: { worktree: worktreeName } },
  )

  const record =
    existingWorktree ??
    createWorktree(root, worktreeName, {
      from: baseBranch,
      description: `Delivery of plan ${planState.run_id} chunk '${chunk.id}'`,
      repositoryRoot,
    })
  const adopted = existingDeliveryRun(root, chunk.child_spec_path, record.path)
  const run =
    adopted ??
    createRun(root, {
      workflowSlug: DELIVERY_WORKFLOW_SLUG,
      requestPath: chunk.child_spec_path,
      title: `${chunk.id} · ${chunk.title}`,
      workspace: record.path,
      worktree: {
        name: record.name,
        path: record.path,
        branch: record.branch,
      },
      contextReferencePath: plan.parent_spec_path,
      involvement: planState.operator_involvement?.profile,
      design: planState.design_composition,
    })

  recordDeliveryHandoff(root, planState, {
    kind: 'delivery',
    run_id: run.run_id,
    worktree: record.path,
    recorded_at: now(),
  })

  return {
    status: adopted ? 'already_started' : 'started',
    kind: 'delivery',
    run_id: run.run_id,
    worktree: record.path,
    resume_command: `/pan-resume ${run.run_id}`,
  }
}

/**
 * The `delivery` run an earlier handoff attempt created for one chunk: it
 * reads the chunk's child specification as its request and works in the
 * chunk's derived worktree. Two live runs on one worktree would edit the same
 * checkout, so a matching live run is adopted rather than duplicated. A
 * finished run is not: it no longer occupies the worktree.
 */
function existingDeliveryRun(
  root: string,
  childSpecPath: string,
  worktreePath: string,
): RunState | null {
  const workspace = path.resolve(root, worktreePath)
  const matches = (run: RunState): boolean =>
    run.workflow_slug === DELIVERY_WORKFLOW_SLUG &&
    run.request.source_path === childSpecPath &&
    path.resolve(root, run.workspace_root) === workspace

  return (
    newestRun(
      listRunStatesWhere(root, matches).filter(
        (run) => runIsLive(run) && matches(run),
      ),
    ) ?? null
  )
}

/**
 * Returns the run with the latest `created_at` without reordering the input, or
 * undefined for an empty list.
 */
export function newestRun(runs: RunState[]): RunState | undefined {
  return [...runs].sort((left, right) =>
    right.created_at.localeCompare(left.created_at),
  )[0]
}

/**
 * Continue the plan after one cohort's merge proof landed: start the next
 * cohort, or the release run when no cohort is left.
 *
 * Both branches add only worktrees, branches, and run records. The unit
 * commits and the merge that precede them belong to the integration, so the
 * continuation itself touches no source-control history.
 */
export function continueAfterIntegration(
  root: string,
  cohortId: string,
): CohortContinuationResult {
  const pan = panCommand(root)
  const state = loadCohortState(root, cohortId)

  if (firstUnsatisfiedIndex(root, state) !== null) {
    try {
      return {
        status: 'started',
        kind: 'cohort',
        ...startCohort(root, cohortId),
      }
    } catch (error) {
      return {
        status: 'failed',
        kind: 'cohort',
        error: errorMessage(error),
        manual_commands: [`${pan} cohort start ${cohortId}`],
      }
    }
  }

  try {
    return startReleaseRun(root, cohortId)
  } catch (error) {
    // Every merge proof landed, so the retry is the merge-free `cohort
    // release`, which runs only this continuation. A hand-built `pan init`
    // would carry no start-stage record or cohort binding, and neither
    // release nor integrate would adopt it.
    return {
      status: 'failed',
      kind: 'release',
      error: errorMessage(error),
      manual_commands: [`${pan} cohort release ${cohortId}`],
    }
  }
}

/**
 * The involvement profile the plan run snapshotted, which every run the route
 * starts inherits. The snapshot is the authority for what the operator
 * selected, so the live configuration is never consulted here.
 *
 * Propagation is best-effort metadata: a session whose plan run record is gone
 * still has to start and release its runs, exactly as the request path falls
 * back to the parent specification, so an absent record resolves to no profile
 * rather than throwing `RUN_NOT_FOUND`.
 */
export function planRunInvolvement(
  root: string,
  state: CohortSessionState,
): string | undefined {
  if (!fileExists(statePath(root, state.plan_run_id))) {
    return undefined
  }

  return loadState(root, state.plan_run_id).operator_involvement?.profile
}

/**
 * The release run reads the operator's original request, which the plan run
 * stored, and reaches the parent specification by reference. When the plan
 * run's record is gone, the parent specification itself stands in.
 */
export function releaseRunRequestPath(
  root: string,
  state: CohortSessionState,
): string {
  if (fileExists(statePath(root, state.plan_run_id))) {
    return loadState(root, state.plan_run_id).request.stored_path
  }

  return state.parent_spec_path
}
