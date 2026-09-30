/** Passed-gate evidence: acceptance classification, labels, and selection. */

import {
  agentProfileExecutionAllowance,
  agentRecordedProfilePasses,
} from '../agent-ledger-evidence.js'
import type { AgentRecordedProfilePass } from '../agent-ledger-evidence.js'
import { repositoryCheckProfileName } from '../repository-checks/diagnostics.js'
import type {
  RunState,
  InvocationReference,
  StageDefinition,
} from '../types.js'
import { addReference } from './references.js'
import { remediationReturn } from './remediation-return.js'

interface PassedGateEvidence {
  profile: string
  evidencePath: string
  fingerprint: string
  origin: string
  acceptanceMode: 'clean_pass' | 'baseline_relative_acceptance' | 'unknown'
  rawExitCode: number | null
  preexistingFailure: boolean
}

function classifyGateAcceptance(result: {
  exit_code?: number | null
  preexisting_failure?: boolean
  passed: boolean
}): Pick<
  PassedGateEvidence,
  'acceptanceMode' | 'rawExitCode' | 'preexistingFailure'
> {
  const rawExitCode =
    typeof result.exit_code === 'number' ? result.exit_code : null
  const preexistingFailure = Boolean(result.preexisting_failure)

  if (
    preexistingFailure ||
    (result.passed && rawExitCode !== null && rawExitCode !== 0)
  ) {
    return {
      acceptanceMode: 'baseline_relative_acceptance',
      rawExitCode,
      preexistingFailure,
    }
  }

  if (result.passed && rawExitCode === 0) {
    return {
      acceptanceMode: 'clean_pass',
      rawExitCode,
      preexistingFailure: false,
    }
  }

  return {
    acceptanceMode: 'unknown',
    rawExitCode,
    preexistingFailure,
  }
}

export function gateEvidenceLabel(
  evidence: Pick<
    PassedGateEvidence,
    'acceptanceMode' | 'rawExitCode' | 'preexistingFailure'
  >,
): string {
  if (evidence.acceptanceMode === 'clean_pass') {
    return 'clean pass'
  }

  if (evidence.acceptanceMode === 'baseline_relative_acceptance') {
    const exitCode = evidence.rawExitCode ?? 'unknown'
    const carriedFailure = evidence.preexistingFailure
      ? ', carried failure'
      : ''

    return `baseline-relative acceptance (raw exit code ${exitCode}${carriedFailure})`
  }

  return 'passed gate evidence'
}

function gateEvidenceDescription(
  evidence: PassedGateEvidence,
  current: boolean,
): string {
  const currency = current ? 'the current workspace' : 'a superseded workspace'
  const modeLabel = gateEvidenceLabel(evidence)

  return (
    `\`${modeLabel}\` \`${evidence.profile}\` repository-check gate evidence ` +
    `(${evidence.origin}) at workspace fingerprint ` +
    `\`${evidence.fingerprint}\` — ${currency}`
  )
}

/**
 * The latest passed run of each repository-check profile, from stage-history
 * gates first, pre-implementation baselines second, and the agent-run ledger
 * third. A skipped, disabled, or failed gate is not evidence.
 *
 * A ledger pass is read last but outranks evidence taken at another
 * fingerprint (`HR3-008`): a worker of this run already paid for that profile
 * against the workspace the card is judging, so reporting a gap there would
 * send the next worker to buy the same execution again.
 */
export function passedGateEvidence(
  state: RunState,
  agentPasses: AgentRecordedProfilePass[] = [],
  workspaceFingerprint: string | null = null,
): PassedGateEvidence[] {
  const byProfile = new Map<string, PassedGateEvidence>()

  for (const item of state.stage_history) {
    for (const result of item.deterministic) {
      const profile = repositoryCheckProfileName(result.command ?? '')
      const executed =
        result.passed &&
        !result.skipped &&
        !result.disabled &&
        !result.overridden

      if (!profile || !executed || !result.evidence_path) {
        continue
      }

      byProfile.set(profile, {
        profile,
        evidencePath: result.evidence_path,
        fingerprint: result.workspace_fingerprint,
        origin: `${item.stage} attempt ${item.attempt} gate \`${result.id}\``,
        ...classifyGateAcceptance(result),
      })
    }
  }

  for (const baseline of Object.values(
    state.repository_check_baselines ?? {},
  )) {
    if (!baseline || baseline.status !== 'passed') {
      continue
    }

    if (!byProfile.has(baseline.profile)) {
      byProfile.set(baseline.profile, {
        profile: baseline.profile,
        evidencePath: baseline.artifact_path,
        fingerprint: baseline.workspace_fingerprint,
        origin: 'pre-implementation baseline',
        acceptanceMode: 'clean_pass',
        rawExitCode: 0,
        preexistingFailure: false,
      })
    }
  }

  for (const pass of agentPasses) {
    const held = byProfile.get(pass.profile)

    if (
      held &&
      (workspaceFingerprint === null ||
        held.fingerprint === workspaceFingerprint ||
        pass.fingerprint !== workspaceFingerprint)
    ) {
      continue
    }

    byProfile.set(pass.profile, {
      profile: pass.profile,
      evidencePath: pass.evidencePath,
      fingerprint: pass.fingerprint,
      origin:
        pass.invokedBy === 'harness'
          ? `harness prefetch at prepare${pass.invocationId ? ` for invocation \`${pass.invocationId}\`` : ''} ` +
            `(${pass.ledgerPath})`
          : `agent-recorded pass by role \`${pass.workerRole ?? 'stage'}\`` +
            `${pass.invocationId ? ` for invocation \`${pass.invocationId}\`` : ''} ` +
            `(${pass.ledgerPath})`,
      acceptanceMode: 'clean_pass',
      rawExitCode: 0,
      preexistingFailure: false,
    })
  }

  return [...byProfile.values()]
}

export function selectGateEvidence(
  references: Map<string, InvocationReference>,
  root: string,
  state: RunState,
  stage: StageDefinition,
  workspaceFingerprint: string,
): void {
  if (!stage.context.gate_evidence) {
    return
  }

  // Every surface of the card reads the allowance from the same predicate.
  // A reference that decided for itself is how a return-visit card kept
  // offering the run its own rule line had already forbidden.
  const allowance = agentProfileExecutionAllowance(
    remediationReturn(root, state, stage) !== undefined,
  )
  const agentPasses = agentRecordedProfilePasses(root, state.run_id)

  for (const evidence of passedGateEvidence(
    state,
    agentPasses,
    workspaceFingerprint,
  )) {
    const current = evidence.fingerprint === workspaceFingerprint

    // A superseded artifact stays listed, but its condition denies citation.
    addReference(references, {
      path: evidence.evidencePath,
      description: gateEvidenceDescription(evidence, current),
      retrieval: 'conditional',
      // Both branches close with the same allowance sentence, so the card
      // states one rule about agent-side execution however the evidence fell.
      condition: current
        ? `Cite this evidence in \`data.verify.gate_evidence_citations\` with ` +
          `profile \`${evidence.profile}\`, fingerprint \`${evidence.fingerprint}\`, ` +
          'and this path. Read the evidence to confirm what the gate ' +
          'covered. The verifier does not run this profile. ' +
          allowance
        : `This evidence predates the current workspace fingerprint ` +
          `\`${workspaceFingerprint}\`. Do not cite it as current. Record ` +
          'the gap in your verify output. ' +
          allowance,
      gate_evidence: {
        profile: evidence.profile,
        fingerprint: evidence.fingerprint,
        current,
        acceptance_mode: evidence.acceptanceMode,
        raw_exit_code: evidence.rawExitCode,
        preexisting_failure: evidence.preexistingFailure,
      },
    })
  }
}
