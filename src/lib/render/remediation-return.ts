/** The remediation return and scoped return sections of a card. */

import type { Invocation } from '../types.js'

/**
 * What a returning evidence worker executes again and what it carries
 * (`VERIFY-001`).
 *
 * A first visit renders nothing: every case is new work. On a return after a
 * remediation with a bounded blast radius the brief caps re-execution by the
 * paths that changed. A return whose remediation declared no changed path
 * bounds nothing, so the worker re-executes its scope in full and carries no
 * case forward.
 */
export function renderRemediationReturn(invocation: Invocation): string[] {
  const returnVisit = invocation.inputs.remediation_return

  if (!returnVisit) {
    return []
  }

  const gate = returnVisit.routing_gate
  const opening =
    'This is a return visit after remediation ' +
    `\`${returnVisit.remediation_invocation_id}\`.` +
    (returnVisit.routing_output_path
      ? ' The verdict that routed it, with the prior findings, is ' +
        `\`${returnVisit.routing_output_path}\`.`
      : gate
        ? ` The failed release gate \`${gate.criterion_id}\` of stage ` +
          `'${gate.stage}' routed it. Its evidence is ` +
          `\`${gate.evidence_path}\`. Confirm that failure is repaired.`
        : '')

  if (returnVisit.blast_radius.length === 0) {
    return [
      '',
      `${opening} That remediation declared no changed path, so nothing ` +
        'bounds the radius: execute your scope in full and carry no case ' +
        'forward.',
    ]
  }

  return [
    '',
    `${opening} Execute the cases your scope reaches that touch the ` +
      "remediation's blast radius:",
    '',
    ...returnVisit.blast_radius.map((changedPath) => `- \`${changedPath}\``),
    '',
    'Carry every other case forward with its earlier result rather than ' +
      'executing it again, and record `carried_from` on that case with the ' +
      'prior invocation id and the workspace fingerprint it was observed ' +
      'at. This caps case coverage only; it changes no profile allowance.',
  ]
}

/**
 * The section a scoped return visit carries in place of the evidence
 * reports: why the harness scoped it, the repair it serves, and each
 * dimension's scope with the output section that records it.
 */
export function renderScopedReturn(invocation: Invocation): string[] {
  const scoped = invocation.scoped_return

  if (!scoped) {
    return []
  }

  const { limits } = scoped
  const excluded =
    limits.excluded_path_globs.length > 0
      ? `, none under ${limits.excluded_path_globs.map((glob) => `\`${glob}\``).join(', ')}`
      : ''

  return [
    '### Scoped return visit',
    '',
    'No evidence worker runs on this visit. The harness scoped it because ' +
      `remediation \`${scoped.remediation_invocation_id}\` changed ` +
      `${scoped.blast_radius.length} path(s) and the routing verdict carried ` +
      `${scoped.findings.length} finding(s), within this stage's limits: at ` +
      `most ${limits.max_paths} paths and ${limits.max_findings} findings` +
      `${excluded}, no deleted test, and no fail_severe verdict.`,
    '',
    'You cover every evidence dimension below yourself, each as its own ' +
      'section of `data.verify.dimensions`, and you stay independent of the ' +
      'remediation. `VERIFY-001` treats each section as the report its ' +
      'evidence worker would have written.',
    '',
    'Blast radius:',
    '',
    ...scoped.blast_radius.map((changedPath) => `- \`${changedPath}\``),
    '',
    'Findings of the routing verdict:',
    '',
    ...(scoped.findings.length > 0
      ? scoped.findings.map(
          (finding) =>
            `- \`${finding.id}\` (${finding.severity}, from ${finding.source})`,
        )
      : ['- None.']),
    '',
    ...scoped.dimensions.flatMap((dimension) => [
      `#### ${dimension.role} dimension`,
      '',
      dimension.scope,
      '',
      `Record it in \`data.verify.dimensions.${dimension.role}\` with a ` +
        'non-empty `summary` and a non-empty `evidence[]` of paths, ' +
        'commands, or observations. Cite this dimension as the `source` of ' +
        'each finding it raises.',
      '',
    ]),
    ...(scoped.dimensions.some((dimension) => dimension.role === 'qa')
      ? [
          'Execute the cases the blast radius reaches, record each in ' +
            '`data.verify.qa_cases`, and carry every other case forward ' +
            'with `carried_from`, as a return-visit evidence worker would.',
          '',
        ]
      : []),
  ]
}
