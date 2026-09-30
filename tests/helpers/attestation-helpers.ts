import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { delegationExecutionPath } from '../../src/lib/validation.js'
import { writeRedlineRecord } from '../../src/lib/watch/redline.js'
import {
  attestSupervisorCard as attestEngineSupervisorCard,
  buildSupervisorCard,
} from '../../src/lib/governance/supervisor-card.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { loadState } from '../../src/lib/state.js'
import { recordForegroundReturn } from '../../src/lib/watch/completion.js'

import type {
  Invocation,
  InvocationAttestation,
  RunState,
  StageOutput,
} from '../../src/lib/types.js'
import { writeJson } from './fixture-helpers.js'

/**
 * Persist the delegation evidence a compliant supervisor would leave: the exact
 * body the invocation names, which is the compact delivery prompt under
 * referenced delivery and the canonical card under verbatim delivery.
 */
export function writeCanonicalDelegation(
  root: string,
  invocation: Invocation,
): void {
  const layout = resolveRunLayout(root, invocation.run_id)
  const deliveredRelative =
    invocation.delegation?.mode === 'referenced' &&
    invocation.delegation.delivery_prompt_path
      ? invocation.delegation.delivery_prompt_path
      : (invocation.delegation?.canonical_markdown_path ??
        layout.invocation(invocation.invocation_id, '.md').relative)
  const delegationAbsolute = layout.invocation(
    invocation.invocation_id,
    '.delegation.md',
  ).absolute

  mkdirSync(path.dirname(delegationAbsolute), { recursive: true })
  writeFileSync(
    delegationAbsolute,
    readFileSync(path.join(root, deliveredRelative), 'utf8'),
  )
}

/**
 * Verbatim last content line of a text, or '' when none exists. Skips empty
 * lines and Markdown divider lines, as the read-evidence rule does.
 */
export function finalLineOf(content: string): string {
  const divider = /^\s*(?:[-_*]\s*){3,}$/u
  const lines = content.split('\n')

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim().length > 0 && !divider.test(lines[index])) {
      return lines[index]
    }
  }

  return ''
}

/** The final-line read evidence a worker owes for one guidance selection. */
function guidanceFinalLine(
  invocation: Invocation,
  entry: { policy_id: string; source_path: string },
): string {
  for (const policies of [
    invocation.policies,
    invocation.delegation?.policies ?? [],
  ]) {
    for (const policy of policies) {
      if (policy.id !== entry.policy_id) {
        continue
      }

      for (const guidance of policy.guidance ?? []) {
        if (guidance.source_path === entry.source_path) {
          return finalLineOf(guidance.content)
        }
      }
    }
  }

  return ''
}

/**
 * Attach compliant per-file read evidence for the given instruction paths.
 * Each entry quotes the file's actual last content line from the fixture
 * tree.
 */
export function attachTargetInstructionEvidence(
  root: string,
  output: StageOutput,
  readPaths: string[],
): void {
  output.target_instruction_evidence = {
    read_paths: readPaths,
    reads: readPaths.map((readPath) => ({
      path: readPath,
      final_line: finalLineOf(readFileSync(path.join(root, readPath), 'utf8')),
    })),
  }
}

/**
 * Attest the run's current supervisor card, the way a compliant supervisor does
 * after reading it. `pan prepare` and `pan submit` refuse an unattested card.
 */
export function attestRunCard(root: string, runId: string): void {
  const card = buildSupervisorCard(root, runId)

  attestEngineSupervisorCard(root, runId, card.sha256)
  // The attestation opens a supervisor session; the session's redline follows.
  writeRedlineRecord(root, runId, 'pan-start')
}

/**
 * Record the foreground-return attestation a compliant supervisor writes after
 * a Cursor worker launch returns. DELEGATE-001 requires it, or a completed
 * `pan watch` record, for every Cursor worker invocation, and `pan submit`
 * refuses with `DELEGATION_UNOBSERVED` otherwise. A harness-delegated
 * invocation is exempt because `pan delegate` writes its own evidence. A run
 * without a current invocation gets no record, so the submission reports its
 * own error.
 */
export function attestForegroundReturn(root: string, runId: string): void {
  let current: RunState['current_invocation']

  try {
    current = loadState(root, runId).current_invocation
  } catch {
    return
  }

  if (!current) {
    return
  }

  const invocationAbsolute = path.join(root, current.json_path)

  if (!existsSync(invocationAbsolute)) {
    return
  }

  const invocation = JSON.parse(
    readFileSync(invocationAbsolute, 'utf8'),
  ) as Invocation
  const executor = invocation.stage.persona_executor ?? 'cursor'

  if (executor !== 'cursor') {
    // `pan submit` exempts an external-executor stage only when the
    // delegation-execution record `pan delegate` writes exists. A test that
    // drives such a stage without spawning the executor stands in for that
    // delegation here, the way it stands in for the supervisor elsewhere.
    const recordAbsolute = path.join(
      root,
      delegationExecutionPath(runId, current.id, root),
    )

    if (!existsSync(recordAbsolute)) {
      writeJson(recordAbsolute, {
        schema_version: 1,
        run_id: runId,
        invocation_id: current.id,
        stage: invocation.stage.slug,
        executor,
        delegated_by: 'harness',
        delegation_kind: 'fresh',
        binary: 'test-stub',
        argv: [],
        exit_code: 0,
        timed_out: false,
        duration_ms: 0,
        stdout_path: delegationExecutionPath(runId, current.id, root).replace(
          /\.delegation-execution\.json$/u,
          '.stdout.log',
        ),
        stderr_path: delegationExecutionPath(runId, current.id, root).replace(
          /\.delegation-execution\.json$/u,
          '.stderr.log',
        ),
        test_stand_in: true,
      })
    }

    return
  }

  recordForegroundReturn(root, runId, { invocationId: current.id })
}

/** The read attestation a worker owes for a referenced invocation contract. */
export function makeAttestation(
  invocation: Invocation,
): InvocationAttestation | undefined {
  const manifest = invocation.contract_manifest

  if (!manifest) {
    return undefined
  }

  return {
    invocation_id: invocation.invocation_id,
    model: invocation.stage.model,
    contract_path: manifest.contract_path,
    contract_sha256: manifest.contract_sha256,
    status: 'read',
    sections: manifest.sections.map((section) => ({
      id: section.id,
      sha256: section.sha256,
    })),
    ...(manifest.guidance?.length
      ? {
          guidance: manifest.guidance.map((entry) => ({
            policy_id: entry.policy_id,
            source_path: entry.source_path,
            content_sha256: entry.content_sha256,
            status: 'read' as const,
            final_line: guidanceFinalLine(invocation, entry),
          })),
        }
      : {}),
  }
}

/** Simulate the supervisor persisting every parallel evidence report. */
export function writeEvidenceReports(
  root: string,
  invocation: Invocation,
): void {
  for (const worker of invocation.evidence_workers ?? []) {
    const absolute = path.join(root, worker.evidence_path)

    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(
      absolute,
      `# ${worker.role} evidence\n\nFixture ${worker.role} report.\n`,
      'utf8',
    )
  }
}
