import path from 'node:path'

import { invariant } from '../errors.js'
import {
  STANDALONE_MODES,
  renderGovernanceCardMarkdown,
} from '../governance-card.js'
import {
  ensureDir,
  fileExists,
  readText,
  resolveInside,
  sha256,
  withOperationMutex,
  writeTextAtomic,
} from '../io.js'
import { resolvePolicies } from '../policies.js'
import {
  harnessPathPrefix,
  isTargetInstallation,
  panCommand,
} from '../project-config.js'
import { resolveRequirements } from '../requirements/resolve.js'
import { resolveRunLayout } from '../run-layout.js'
import { loadState, now, operationMutexPath, persist } from '../state.js'
import { loadWorkflowFile } from '../workflow.js'
import type {
  Policy,
  RunContract,
  RunState,
  SupervisorCardState,
  WorkflowDefinition,
} from '../types.js'

export const SUPERVISOR_CARD_FILENAME = 'supervisor-card.md'

export interface SupervisorCardRender {
  state: SupervisorCardState
  markdown: string
  policies: Policy[]
  /** True when the run had no card before this render. */
  first: boolean
  /** True when the digest differs from the previously recorded one. */
  changed: boolean
}

/** Harness-relative path of a run's supervisor card. */
export function supervisorCardPath(root: string, runId: string): string {
  return `${resolveRunLayout(root, runId).agent.relative}/${SUPERVISOR_CARD_FILENAME}`
}

/** The command the supervisor runs after reading the card. */
export function supervisorAttestCommand(
  root: string,
  runId: string,
  digest: string,
): string {
  return `${panCommand(root)} governance attest-supervisor ${runId} --sha256 ${digest}`
}

/**
 * Every policy the lookup table resolves for the orchestrator persona over the
 * whole run: the wildcard stage plus each stage the workflow declares, so a
 * stage-scoped supervisor row (for example `design/intake`) is delivered too.
 */
export function resolveSupervisorPolicies(
  root: string,
  workflow: WorkflowDefinition,
  contracts: RunContract[] = [],
): Policy[] {
  const byId = new Map<string, Policy>()

  for (const stage of ['*', ...workflow.stages.map((item) => item.slug)]) {
    for (const policy of resolvePolicies(root, {
      persona: 'orchestrator',
      workflow: workflow.slug,
      stage,
      contracts,
      operator_artifacts: 'suppressed',
    })) {
      byId.set(policy.id, policy)
    }
  }

  return [...byId.keys()].sort().map((id) => byId.get(id) as Policy)
}

/**
 * Render the supervisor card for a run and record it in `state.supervisor_card`.
 * The write is idempotent: an unchanged digest rewrites nothing unless the file
 * is missing. The caller persists the state.
 */
export function renderSupervisorCard(
  root: string,
  state: RunState,
  workflow: WorkflowDefinition,
): SupervisorCardRender {
  const mode = STANDALONE_MODES.supervisor

  invariant(mode, 'The supervisor mode is not registered.', {
    code: 'UNKNOWN_STANDALONE_MODE',
  })

  const contracts = state.operator_involvement?.contracts ?? []
  const policies = resolveSupervisorPolicies(root, workflow, contracts)
  const requirements = resolveRequirements(root, {
    persona: mode.persona,
    workflow: workflow.slug,
    stage: '*',
    invocation_kind: mode.kind,
    contracts,
    operator_artifacts: 'suppressed',
  })
  const relativePath = supervisorCardPath(root, state.run_id)
  const markdown = renderGovernanceCardMarkdown({
    mode,
    policies,
    requirements,
    requestPath: state.request.stored_path,
    harnessPrefixNote: isTargetInstallation(root)
      ? `Harness-relative paths beginning \`runtime/\`, \`library/\`, or ` +
        `\`governance/\` are rooted at \`${harnessPathPrefix(root)}/\` when ` +
        'accessed from the target repository.'
      : null,
    worktree: null,
    baseConduct: null,
    run: {
      run_id: state.run_id,
      workflow_slug: workflow.slug,
      attest_command: supervisorAttestCommand(root, state.run_id, '<sha256>'),
    },
  })
  const digest = sha256(markdown)
  const previous = state.supervisor_card
  const absolute = resolveInside(root, relativePath)
  const changed = previous?.sha256 !== digest

  if (changed || !fileExists(absolute) || readText(absolute) !== markdown) {
    ensureDir(path.dirname(absolute))
    writeTextAtomic(absolute, markdown)
  }

  const next: SupervisorCardState = changed
    ? {
        path: relativePath,
        sha256: digest,
        rendered_at: now(),
        // A stale attestation stays on record as evidence, but it no longer
        // matches the current digest, so the run is unattested again.
        ...(previous?.attested_sha256
          ? {
              attested_sha256: previous.attested_sha256,
              ...(previous.attested_at
                ? { attested_at: previous.attested_at }
                : {}),
            }
          : {}),
      }
    : { ...(previous as SupervisorCardState), path: relativePath }

  state.supervisor_card = next

  return {
    state: next,
    markdown,
    policies,
    first: previous === undefined,
    changed,
  }
}

/** Whether the run's current supervisor card digest is attested. */
export function supervisorCardAttested(state: RunState): boolean {
  const card = state.supervisor_card

  return card !== undefined && card.attested_sha256 === card.sha256
}

/**
 * Refuse a lifecycle action while the current supervisor card is unattested.
 * A run without a card (created before the card existed) passes; it gains a
 * card on its next prepare and is bound from then on.
 */
export function assertSupervisorCardAttested(
  root: string,
  state: RunState,
  action: 'prepare' | 'submit',
): void {
  const card = state.supervisor_card

  if (!card) {
    return
  }

  invariant(
    card.attested_sha256 === card.sha256,
    `pan ${action} refused: the supervisor card for run ` +
      `${state.run_id} is not attested at its current digest. Read ` +
      `${card.path} in full, then run ` +
      `${supervisorAttestCommand(root, state.run_id, card.sha256)}.`,
    {
      code: 'SUPERVISOR_CARD_UNATTESTED',
      details: {
        run_id: state.run_id,
        card_path: card.path,
        sha256: card.sha256,
        attested_sha256: card.attested_sha256 ?? null,
      },
    },
  )
}

export interface SupervisorCardBuild {
  run_id: string
  path: string
  sha256: string
  attested: boolean
  attest_command: string
  policies: string[]
  changed: boolean
}

/** `pan governance card --mode supervisor --run <run-id>`: render or refresh. */
export function buildSupervisorCard(
  root: string,
  runId: string,
): SupervisorCardBuild {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)
    const workflow = loadWorkflowFile(
      root,
      resolveInside(root, state.workflow_snapshot.path),
    )
    const render = renderSupervisorCard(root, state, workflow)

    if (render.changed) {
      persist(root, state, 'supervisor_card_rendered', {
        path: render.state.path,
        sha256: render.state.sha256,
        first: render.first,
        policies: render.policies.map((policy) => policy.id),
      })
    }

    return {
      run_id: runId,
      path: render.state.path,
      sha256: render.state.sha256,
      attested: supervisorCardAttested(state),
      attest_command: supervisorAttestCommand(root, runId, render.state.sha256),
      policies: render.policies.map((policy) => policy.id),
      changed: render.changed,
    }
  })
}

/** `pan governance attest-supervisor <run-id> --sha256 <digest>`. */
export function attestSupervisorCard(
  root: string,
  runId: string,
  digest: string,
): SupervisorCardState {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)
    const card = state.supervisor_card

    invariant(
      card,
      `Run ${runId} has no supervisor card yet. Run ` +
        `${panCommand(root)} governance card --mode supervisor --run ${runId} first.`,
      { code: 'SUPERVISOR_CARD_MISSING' },
    )

    const normalized = digest.trim().replace(/^sha256:/u, '')

    invariant(
      normalized === card.sha256,
      `The attested digest does not match the current supervisor card. ` +
        `Current digest: ${card.sha256}. Re-read ${card.path}, then attest ` +
        'that digest.',
      {
        code: 'SUPERVISOR_CARD_DIGEST_MISMATCH',
        details: { expected: card.sha256, received: normalized },
      },
    )

    const absolute = resolveInside(root, card.path)

    invariant(
      fileExists(absolute) && sha256(readText(absolute)) === card.sha256,
      `The supervisor card at ${card.path} is missing or differs from the ` +
        'recorded digest. Re-render it with ' +
        `${panCommand(root)} governance card --mode supervisor --run ${runId}.`,
      { code: 'SUPERVISOR_CARD_STALE' },
    )

    if (card.attested_sha256 === card.sha256) {
      return card
    }

    card.attested_sha256 = card.sha256
    card.attested_at = now()
    persist(root, state, 'supervisor_card_attested', {
      path: card.path,
      sha256: card.sha256,
    })

    return card
  })
}
