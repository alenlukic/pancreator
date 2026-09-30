/** Evidence-worker skips and the evidence-worker brief. */

import { agentProfileExecutionAllowance } from '../agent-ledger-evidence.js'
import type { Invocation, InvocationEvidenceWorker } from '../types.js'
import {
  EVIDENCE_REPORT_CASE_PREFIX,
  EVIDENCE_REPORT_COMPLETE_MARKER,
} from './delivery-prompt.js'
import { renderRemediationReturn } from './remediation-return.js'

/**
 * The declared evidence workers the harness kept off this visit, so the
 * stage worker knows the dimension did not run and why (`VERIFY-001`).
 */
export function renderEvidenceWorkerSkips(invocation: Invocation): string[] {
  const skips = invocation.evidence_worker_skips ?? []

  if (skips.length === 0) {
    return []
  }

  return [
    '### Evidence workers not launched',
    '',
    ...skips.map(
      (skip) =>
        `- \`${skip.role}\` (\`${skip.persona}\`) did not run: ${skip.reason}. ` +
        'No report exists for it, so do not wait for one or report it missing.',
    ),
    '',
    ...(skips.some((skip) => skip.role === 'qa')
      ? [
          'QA did not run on this visit. `data.verify.qa_cases` is not ' +
            'owed. Grade each `test` criterion from the test that the ' +
            "implementation's `acceptance_results` evidence or " +
            '`tests_added` names for it, plus the gate evidence that the ' +
            'test ran and passed. A `test` criterion with no named test ' +
            'fails. Grade each `review` criterion from the review evidence ' +
            'and your spot checks, and record `observe` as the result of ' +
            'each `observe` criterion.',
          '',
        ]
      : []),
  ]
}

/**
 * Render the prompt brief for one parallel evidence worker. The brief is the
 * worker's complete contract: it launches as a top-level named agent, reads
 * the same stage inputs as the consolidating worker, and writes exactly one
 * evidence report. It carries no lifecycle command and no stage output
 * contract — the consolidating worker owns both.
 */
export function renderEvidenceWorkerBrief(
  invocation: Invocation,
  worker: InvocationEvidenceWorker,
): string {
  const references = invocation.inputs.references
    .filter((item) => (item.retrieval ?? 'required') !== 'index_only')
    .flatMap((item) => [
      `- \`${item.path}\` — ${item.description}`,
      ...(item.condition ? [`  - Read when: ${item.condition}`] : []),
    ])
  // A passed `fast` gate at the current workspace fingerprint is the evidence
  // the worker's scope tells it to cite. Naming the command then would turn a
  // permission into an order to rerun a profile the gate already ran.
  const fastEvidenceCurrent = invocation.inputs.references.some(
    (item) =>
      item.gate_evidence?.profile === 'fast' && item.gate_evidence.current,
  )
  const harnessRoot = invocation.harness_root
  const lines = [
    `# Evidence brief: ${worker.role} for stage \`${invocation.stage.slug}\``,
    '',
    `**Run** \`${invocation.run_id}\` · **Invocation** ` +
      `\`${invocation.invocation_id}\` · **Persona** \`${worker.persona}\``,
    '',
    // The brief is the worker's whole contract, so it must name the workspace
    // it inspects: a run bound to a managed worktree lives outside the main
    // checkout, and a worker that reads the main checkout reports the change
    // as missing.
    `**Workspace** \`${invocation.workspace_root}\` — inspect and run ` +
      'commands against this directory.',
    ...(invocation.managed_worktree
      ? [
          '',
          `**Managed worktree** \`${invocation.managed_worktree.name}\` · ` +
            `**Branch** \`${invocation.managed_worktree.branch}\` · ` +
            `**Path** \`${invocation.managed_worktree.path}\``,
        ]
      : []),
    ...(harnessRoot
      ? [
          '',
          `**Harness root** \`${harnessRoot}\` — lifecycle and evidence ` +
            'commands run from this installation directory.',
          ...(invocation.installation_mode === 'self_development' &&
          invocation.managed_worktree
            ? [
                '',
                `**Verification root** Commands that exercise changed harness ` +
                  `source run from \`${harnessRoot}\` as ` +
                  `\`PANCREATOR_EXEC_ROOT=${harnessRoot}/${invocation.workspace_root} ./bin/pan …\`. ` +
                  'Bare `./bin/pan` remains the installation-root form for ' +
                  'lifecycle and evidence commands.',
              ]
            : []),
        ]
      : []),
    '',
    // The run is where the supervisor audits an agent-run profile, so the
    // brief names the exact command that records the execution against it,
    // or the gate evidence that makes running it unnecessary. The role is
    // part of that command because every evidence worker of this stage
    // shares its invocation id and owes its own recorded pass.
    invocation.inputs.remediation_return
      ? agentProfileExecutionAllowance(true)
      : fastEvidenceCurrent
        ? 'The implement gate already ran `fast` at this workspace ' +
          'fingerprint. Cite that gate evidence reference from your card ' +
          'instead of running the profile.'
        : `${agentProfileExecutionAllowance(false)} Run that one validation ` +
          `as exactly \`./bin/pan repository-check fast --run ${invocation.run_id} ` +
          `--role ${worker.role}\` ` +
          (harnessRoot
            ? `from the harness root \`${harnessRoot}\` `
            : 'from this checkout ') +
          'so the run records the execution.',
    '',
    'You are one of several parallel evidence workers for this stage. A ' +
      'separate consolidating worker joins every report into the stage ' +
      'verdict; you own one evidence dimension and no verdict.',
    ...renderRemediationReturn(invocation),
    '',
    '## Scope',
    '',
    worker.scope,
    '',
    '## Inputs',
    '',
    ...(references.length > 0 ? references : ['- No artifact inputs.']),
    '',
    '## Report contract',
    '',
    `Write your report as Markdown to \`${worker.evidence_path}\`.`,
    'Append each case or finding to that file as you finish it, under its ' +
      `own \`${EVIDENCE_REPORT_CASE_PREFIX}\` heading, rather than holding ` +
      'the whole report for one write at the end. A run that is interrupted ' +
      'part way then keeps every case you had already recorded.',
    `Write the line \`${EVIDENCE_REPORT_COMPLETE_MARKER}\` last, and only ` +
      'once every case is recorded. A report without it is read as ' +
      'incomplete.',
    'It MUST contain:',
    '',
    '- Every finding or executed case with a severity or result, the exact ' +
      'evidence behind it (paths, commands, observed output), and a ' +
      'reproduction step where one applies.',
    '- An explicit statement for each acceptance criterion your dimension ' +
      'can assess.',
    '- A closing summary the consolidating worker can quote.',
    '',
    '## Boundaries',
    '',
    '- The workspace is read-only for you: you MUST NOT modify tracked ' +
      'files, and you MUST write only your report file.',
    '- You MUST NOT run workflow lifecycle commands, write stage outputs or ' +
      'delegation artifacts, or launch further subagents.',
    '- Report missing evidence and uncertainty instead of manufacturing ' +
      'completion.',
  ]

  return `${lines.join('\n')}\n`
}
