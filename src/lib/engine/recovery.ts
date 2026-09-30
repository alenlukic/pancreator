/**
 * Operator feedback and recovery routes that submissions, decisions, stage
 * changes, and resumes share.
 */

import { resolveInside, writeTextAtomic } from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import { panCommand } from '../project-config.js'
import { now } from '../state.js'
import type {
  OperatorFeedbackItem,
  RunActionActor,
  RunState,
  StageDefinition,
  WorkflowDefinition,
} from '../types.js'

/**
 * Clear attempt counters for the remediation stage and every stage declared
 * after it, so an operator-directed rewind starts that pipeline segment fresh
 * instead of inheriting attempts from the run that was rejected.
 */
export function resetAttemptsFrom(
  workflow: WorkflowDefinition,
  state: RunState,
  fromStage: string,
): void {
  const order = workflow.stages.map((candidate) => candidate.slug)
  const startIndex = order.indexOf(fromStage)

  if (startIndex === -1) {
    return
  }

  for (const slug of order.slice(startIndex)) {
    delete state.attempts[slug]
  }
}

/**
 * Persist operator remediation feedback as a durable artifact and register it on
 * the run so the remediation worker receives it as an input reference.
 */
export function recordOperatorFeedback(
  root: string,
  state: RunState,
  fromStage: StageDefinition,
  toStage: string,
  decision: OperatorFeedbackItem['decision'],
  note: string,
  source: RunActionActor = 'operator',
): void {
  const feedback = state.operator_feedback ?? []
  const index = feedback.length + 1
  const attempt = state.attempts[fromStage.slug] ?? 1

  // Control records document operator decisions for workers and audit, so they
  // live beside the decision records rather than in the operator directory.
  const relativePath = resolveRunLayout(root, state.run_id).decision(
    `${source}-feedback-${index}.md`,
  ).relative

  const heading =
    source === 'away'
      ? 'Away-mode remediation directive'
      : decision === 'approve'
        ? 'Operator directive attached to approval'
        : decision === 'reject'
          ? 'Operator rejection'
          : decision === 'revise'
            ? 'Operator revision directive'
            : 'Operator remediation note'
  const body =
    source === 'away'
      ? [
          `# ${heading}: ${fromStage.title} (\`${fromStage.slug}\`)`,
          '',
          `**Run** \`${state.run_id}\` · **Source attempt** ${attempt} · ` +
            `**Remediation stage** \`${toStage}\``,
          '',
          '## Required changes',
          '',
          note.trim(),
          '',
          `Away mode selected '${decision}' within the run guardrails. ` +
            'Treat this rationale as required remediation context.',
          '',
        ].join('\n')
      : [
          `# ${heading}: ${fromStage.title} (\`${fromStage.slug}\`)`,
          '',
          `**Run** \`${state.run_id}\` · **Source attempt** ${attempt} · ` +
            `**${decision === 'approve' ? 'Directed stage' : 'Remediation stage'}** \`${toStage}\``,
          '',
          decision === 'approve'
            ? '## Operator directive'
            : '## Required changes',
          '',
          note.trim().length > 0
            ? note.trim()
            : 'The operator rejected this stage without written feedback. ' +
              'Treat the prior output as unacceptable and re-derive the work.',
          '',
          decision === 'approve'
            ? `The operator approved the '${fromStage.slug}' stage and attached ` +
              'this directive for your stage. Apply it as operator-supplied ' +
              'context; it adds no scope beyond your contract.'
            : decision === 'revise'
              ? 'This is a refinement directive, not a rejection. Keep everything the ' +
                'operator did not ask you to change, apply the changes above, and ' +
                'state in your summary what you changed and what you deliberately ' +
                'left alone.'
              : 'You MUST address this feedback before the run can reach the operator ' +
                'gate again.',
          '',
        ].join('\n')

  writeTextAtomic(resolveInside(root, relativePath), `${body}\n`)

  const item: OperatorFeedbackItem = {
    decision,
    source,
    from_stage: fromStage.slug,
    to_stage: toStage,
    attempt,
    note,
    path: relativePath,
    timestamp: now(),
  }

  feedback.push(item)
  state.operator_feedback = feedback
}

/**
 * The command that performs the operator's intent on a run whose status
 * refused the one they ran.
 *
 * `resume` and `decide` are one intent — continue this run — split across two
 * commands by a status the operator has to infer from an error. Naming the
 * working route in the refusal turns a second failed call into a first
 * successful one.
 */
export function recoveryRouteFor(
  root: string,
  state: RunState,
  attempted: 'resume' | 'decide',
): string {
  const pan = panCommand(root)

  if (attempted === 'resume' && state.status === 'awaiting_operator') {
    return (
      `A run awaiting an operator continues with ` +
      `\`${pan} decide ${state.run_id} <approve|reject|revise> --note "<directive>"\`; ` +
      `route it to another stage with \`${pan} set-stage ${state.run_id} --stage <stage> --note "<directive>"\`.`
    )
  }

  if (attempted === 'decide' && state.status === 'paused') {
    return (
      `A paused run continues with ` +
      `\`${pan} resume ${state.run_id} [--stage <stage>] --note "<directive>"\`.`
    )
  }

  return (
    `Read the run with \`${pan} status ${state.run_id}\` and act on the ` +
    'pending action it reports.'
  )
}
