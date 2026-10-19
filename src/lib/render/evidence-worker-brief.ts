/** Evidence-worker skips and the evidence-worker brief. */

import type { Invocation, InvocationEvidenceWorker } from '../types.js'
import {
  EVIDENCE_REPORT_CASE_PREFIX,
  EVIDENCE_REPORT_COMPLETE_MARKER,
  evidenceDefectLine,
  evidenceVerdictLine,
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
            'records `evidence_unavailable` with the gap; it fails only on a ' +
            'cited defect. Grade each `review` criterion from the review evidence ' +
            'and your spot checks, and record `observe` as the result of ' +
            'each `observe` criterion.',
          '',
        ]
      : []),
  ]
}

export function renderVerificationExecution(invocation: Invocation): string[] {
  const execution = invocation.verification_execution
  if (!execution) return []
  return [
    '### Verification execution',
    '',
    `The harness supplies raw observations in \`${execution.manifest_path}\`. ` +
      'Independently grade the observed content; collection success is not a verdict.',
    ...execution.operations.map(
      ({ operation, source }) =>
        `- \`${operation.id}\` — ${operation.criterion ?? operation.finding}; ` +
        `${operation.required === false ? 'available on request' : 'mandatory'}; ` +
        `authority \`${source.path}\` (${source.authority}, ${source.sha256}); ` +
        `timeout ${operation.timeout_ms} ms.`,
    ),
    ...execution.gaps.map(
      (gap) => `- Evidence gap \`${gap.id}\`: ${gap.reason}`,
    ),
    '',
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
    `**Workspace** \`${invocation.workspace_root}\` — inspect this directory ` +
      'read-only.',
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
                'Execution observations are collected by the harness against ' +
                  'this worktree before delegation. Independently grade the ' +
                  'raw observations referenced below.',
              ]
            : []),
        ]
      : []),
    '',
    'The harness owns process execution, repository-check profiles, and final ' +
      'output validation. Cite current gate evidence for profile results. ' +
      'Independently grade collected raw observations; command stdout alone ' +
      'cannot prove a browser verdict.',
    'You MUST NOT run a cost-bearing or mutating command, any shell command, ' +
      'or a repository-check profile. Request authorized observations by id.',
    'You MUST NOT launch subagents or alternate sessions. The authorized caller owns fan-out, observation, and recovery.',
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
    ...renderVerificationExecution(invocation),
    '## Report contract',
    '',
    'For a justified procedural workaround, preserve correctness, security, authorization, scope, target instructions, required evidence, and gate enforcement. Recording grants no waiver or permission.',
    'Keep pending records and any exact recording error in one `## Procedural exceptions` section with one JSON fence containing `{"procedural_exceptions":[...]}` before the verdict and completion marker. Each version-1 record names client_id, affected, classification, observed_defect, evidence, workaround, justification, preserved_constraints, and outcome or required_follow_up.',
    `The harness imports these records independently of the report verdict. Retrieve them with \`pan exception list ${invocation.run_id} --unresolved\`; the caller can reconcile using \`pan exception reconcile ${invocation.run_id} --artifact ${worker.evidence_path}\`.`,
    '',
    `Write your report as Markdown to \`${worker.evidence_path}\`.`,
    `To request a missing declared observation, write an array of ` +
      `\`{id, reason}\` to \`${worker.evidence_path}.execution-request.json\`. ` +
      'Requests select pinned operation ids and cannot authorize commands. ' +
      'Report an undefined operation or unavailable browser observation as an ' +
      'evidence gap, without a product verdict.',
    'Append each case or finding to that file as you finish it, under its ' +
      `own \`${EVIDENCE_REPORT_CASE_PREFIX}\` heading, rather than holding ` +
      'the whole report for one write at the end. A run that is interrupted ' +
      'part way then keeps every case you had already recorded.',
    'A criterion fails only on a specific defect you can point to: a cited ' +
      'file and line, a failing test, a reproducible observation, or a ' +
      'concrete contradiction. Absence of evidence is not evidence of an ' +
      'issue. Record a criterion whose evidence is absent, unavailable, ' +
      'stale, or environment-blocked as `evidence_unavailable` with the gap ' +
      'reason and its owner. An evidence gap never counts as unmet and never ' +
      'blocks the run.',
    `For each defect, write one line \`${evidenceDefectLine('<file:line, test, or observation>')}\` ` +
      'that names it.',
    'Once every case is recorded, write your dimension verdict on its own ' +
      `line: \`${evidenceVerdictLine('fail')}\` only when you cited at ` +
      `least one defect, and \`${evidenceVerdictLine('pass')}\` otherwise, ` +
      'including when evidence gaps remain. The consolidating worker runs ' +
      'unless a report states fail and cites a defect. The harness reads a ' +
      'fail that cites no defect as a pass with evidence gaps.',
    `Write the line \`${EVIDENCE_REPORT_COMPLETE_MARKER}\` last, immediately ` +
      'after the verdict line. A report without it is read as incomplete.',
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
      'files, and you MUST write only your report and execution request sidecar.',
    '- You MUST NOT run workflow lifecycle commands, write stage outputs or ' +
      'delegation artifacts, or launch further subagents.',
    '- Report missing evidence and uncertainty as evidence gaps instead of ' +
      'manufacturing completion. A gap is not a defect.',
  ]

  return `${lines.join('\n')}\n`
}
