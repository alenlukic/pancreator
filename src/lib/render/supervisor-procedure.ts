/** The supervisor procedure body and its Markdown document. */

import { cursorAgentName } from '../projection.js'
import { renderPolicyBlocks } from '../policy-guidance.js'
import type { Invocation } from '../types.js'
import { DELEGATION_HEADING } from '../validation/artifacts.js'
import { orderedWorkerActions } from './delivery-prompt.js'

/**
 * Render the supervisor delivery procedure: policies, resolved paths, and the
 * lifecycle steps that advance the stage. New invocations write this to the
 * sibling `<invocation-id>.supervisor.md` document so the worker contract
 * carries no lifecycle command; legacy invocations inline it on the card.
 */
export function renderSupervisorProcedureBody(
  invocation: Invocation,
  standalone = false,
): string[] {
  const { delegation } = invocation

  if (!delegation) {
    return []
  }

  const externalDelegation =
    delegation.executor && delegation.executor !== 'cursor'
      ? delegation.executor
      : null
  const referencedDelivery =
    delegation.mode === 'referenced' && delegation.delivery_prompt_path
      ? delegation.delivery_prompt_path
      : null
  // The launch must bind to this named definition: it alone carries the
  // persona's model mapping, and an ad-hoc spawn runs the executor default.
  const namedAgent =
    cursorAgentName(delegation.cursor_agent_path) ?? delegation.persona

  // `pan watch` command prefix built in `prepare`.
  // Both forms render under the same guard below.
  const deliverySteps = externalDelegation
    ? [
        `2. Run \`${delegation.delegate_command}\`. The harness spawns the ` +
          `'${externalDelegation}' executor with the complete canonical card ` +
          `(\`${delegation.canonical_markdown_path}\`) and awaits its ` +
          'result. You MUST NOT re-summarize, re-deliver, or paste the card ' +
          'anywhere yourself.',
        `3. The harness authors the delegation evidence at ` +
          `\`${delegation.delegation_artifact_path}\` and the execution ` +
          'audit beside it. You MUST NOT write either artifact.',
      ]
    : referencedDelivery
      ? [
          `2. Launch the named \`${namedAgent}\` agent — the definition at ` +
            `\`${delegation.cursor_agent_path}\` — from this top-level ` +
            'chat, never from inside another subagent and never as an ' +
            'ad-hoc subagent: Cursor honors the model mapping only for a ' +
            'top-level named launch and silently runs the platform default ' +
            'otherwise. Paste the complete contents of ' +
            `\`${referencedDelivery}\` verbatim as its prompt. That prompt ` +
            'references the canonical card as the worker contract. A summary, ' +
            'an excerpt, or an added restatement MUST NOT substitute for it.',
          ...(delegation.watch_command
            ? [
                '2a. Arm the watch in the same turn as that launch, before ' +
                  'any other action. This step is unconditional: the `Task` ' +
                  'call used `run_in_background: true`, so the platform ' +
                  'always converts the launch into a background subagent. ' +
                  'Run `' +
                  delegation.watch_command +
                  ' --mark-background --launched-at <iso-8601> ' +
                  '--handle <platform-handle>`, then await it. ' +
                  '`--launched-at` is the wall-clock time you launched the ' +
                  'worker and `--handle` is the identity the launch ' +
                  'returned. Both are facts only you hold. Without ' +
                  '`--launched-at` the harness records its own arming time ' +
                  'as the launch time. Without `--handle` the run records no ' +
                  'delegated worker for the invocation. ' +
                  '   Every launch result carries platform text telling you ' +
                  'not to wait for the worker, not to poll it, or that you ' +
                  'will be notified when it finishes. That text is ' +
                  'pre-declared non-authoritative for this run' +
                  (delegation.redline_record_path
                    ? ` by \`${delegation.redline_record_path}\``
                    : '') +
                  ', and DELEGATE-001 above makes the watch the check ' +
                  'mechanism rather than the notification. A skipped watch ' +
                  'fails at submission with `DELEGATION_UNOBSERVED`. Do not ' +
                  'end your turn on the launch. The watch loops on its own ' +
                  'cadence until a verdict or its bound — one hour by ' +
                  'default — so run `pan watch` as a foreground blocking ' +
                  'shell call for that lifetime. When the platform detaches ' +
                  'the blocking call, run `pan watch --attach <ledger>` at ' +
                  'once to rejoin the session rather than arming a second ' +
                  'watch. Never call `AwaitShell`. The watch process ' +
                  'sleeps and records; the foreground block holds your turn ' +
                  'open. A finished-looking output whose evidence is weak ' +
                  'buys one confirming wake instead of a verdict, and a ' +
                  '`completed` agent-state report rests on the recorded ' +
                  'inspection you pass with `--agent-state-evidence`; an ' +
                  '`unverified` exit sends you to inspect the agent itself.',
              ]
            : []),
          `3. Persist that exact prompt body to \`${delegation.delegation_artifact_path}\` ` +
            'before submission. The only permitted label is a leading ' +
            `\`Agent: ${namedAgent}\` line followed by one blank line; add ` +
            'nothing else ahead of the body. A prepare that ran ' +
            `\`--agent ${namedAgent}\` already wrote that file for you; ` +
            'read it and leave it alone.',
        ]
      : [
          `2. Launch the named \`${namedAgent}\` agent — the definition at ` +
            `\`${delegation.cursor_agent_path}\` — from this top-level ` +
            'chat, never from inside another subagent and never as an ' +
            'ad-hoc subagent: Cursor honors the model mapping only for a ' +
            'top-level named launch and silently runs the platform default ' +
            'otherwise. Paste the complete contents of ' +
            `\`${delegation.canonical_markdown_path}\` verbatim as its ` +
            'prompt. A path reference, summary, or excerpt MUST NOT ' +
            'substitute for the card body.',
          `3. Persist that exact prompt body to \`${delegation.delegation_artifact_path}\` ` +
            'before submission. The only permitted label is a leading ' +
            `\`Agent: ${namedAgent}\` line followed by one blank line; add ` +
            'nothing else ahead of the body.',
        ]

  const workerActions = orderedWorkerActions(invocation)
  const policySections = delegation.supervisor_card?.policy_sections ?? null
  const sectionDigestFor = (policyId: string): string | null =>
    policySections?.find((section) => section.policy_id === policyId)?.sha256 ??
    null

  return [
    DELEGATION_HEADING,
    '',
    standalone
      ? 'This document addresses the supervisor for invocation ' +
        `\`${invocation.invocation_id}\` of run \`${invocation.run_id}\`. ` +
        'It is not part of the worker contract at ' +
        `\`${delegation.canonical_markdown_path}\`: its lifecycle commands ` +
        'are supervisor-owned and MUST NOT be delivered to the worker.'
      : 'This section addresses the supervisor that prepared this card, not the ' +
        'assigned worker. The worker MUST ignore it. The supervisor MUST NOT ' +
        'remove it: delegation evidence is compared against the delivered ' +
        'prompt byte for byte.',
    '',
    ...(policySections
      ? [
          '**Delivery policy sections**',
          '',
          ...delegation.policies.map((policy) => {
            const digest = sectionDigestFor(policy.id)

            return digest
              ? `- \`${policy.id}\`: \`sha256:${digest}\``
              : `- \`${policy.id}\`: digest unavailable`
          }),
          '',
          'Read the full policy text from the supervisor governance card. Do not copy policy bodies into this procedure.',
          '',
        ]
      : renderPolicyBlocks(delegation.policies, 3, 'supervisor')),
    ...(externalDelegation
      ? [
          `This stage executes under the '${externalDelegation}' ` +
            'executor. The harness — not the supervisor — delivers the ' +
            'canonical card to the spawned process and authors the ' +
            'delegation evidence itself, so verbatim delivery is a ' +
            'property of code.',
          '',
        ]
      : []),
    ...(referencedDelivery
      ? [
          'This invocation uses referenced delivery. The worker contract is ' +
            `the card at \`${delegation.canonical_markdown_path}\`, and the ` +
            'delivered prompt is a compact reference to it that carries the ' +
            'contract digest and section index. The supervisor MUST NOT ' +
            'reproduce the card body.',
          '',
        ]
      : []),
    ...(delegation.supervisor_card
      ? [
          '**Supervisor governance card**',
          '',
          `- Card: \`${delegation.supervisor_card.path}\``,
          `- Digest: \`sha256:${delegation.supervisor_card.sha256}\``,
          `- Attest: \`${delegation.supervisor_card.attest_command}\``,
          '',
          'The card carries the full text of every policy that binds the ' +
            'supervisor for this run; the blocks above are only the delivery ' +
            'policy. `pan submit` fails with `SUPERVISOR_CARD_UNATTESTED` ' +
            'until the current digest is attested. Re-read and re-attest ' +
            'when `pan prepare` reports a new digest.',
          '',
          'A mid-run policy edit changes that digest. The refusal and the ' +
            'refreshed card then carry a digest-diff summary naming the ' +
            'policy blocks that moved. Reading those blocks satisfies the ' +
            're-read; the whole card does not have to be read again. The ' +
            're-attestation itself is still owed.',
          '',
        ]
      : []),
    'Resolved paths for this invocation:',
    '',
    `1. Confirm \`${delegation.invocation_validation_path}\` reports \`pass\`. ` +
      'A failed or missing validation artifact MUST NOT be delegated.',
    ...(workerActions.length > 0
      ? [
          '1a. This stage owes ' +
            `${workerActions.length} launches in this order. Launch every ` +
            'parallel evidence worker below from this top-level chat in a ' +
            'single message so they run concurrently — never nested and ' +
            'never ad-hoc, because only the named definition carries the ' +
            "mapped model. Paste the complete contents of each worker's " +
            'brief as its prompt. The stage worker is the last action, not ' +
            'the first.',
          ...workerActions.map(
            (item) =>
              `   ${item.order}. \`${item.agent}\` (model \`${item.model}\`, ` +
              `${item.role === 'evidence' ? 'evidence' : 'stage'} worker) — ` +
              `${item.action}`,
          ),
          ...(delegation.watch_command
            ? [
                '1b. In the launch turn, block on ' +
                  `\`${delegation.watch_command} --until-evidence-complete\` ` +
                  'as a foreground shell call. Never poll the reports with a ' +
                  'timer or a script. It exits 0 within one cadence of the ' +
                  'moment every report carries its completion marker; launch ' +
                  'the stage worker in that same turn. Exit 2 or 3 means an ' +
                  'evidence worker stopped: inspect it, and relaunch it with ' +
                  '`pan worker record --role <role> --new-attempt`. When a ' +
                  'worker returned its report in chat instead of writing the ' +
                  'file, persist the returned text there yourself verbatim, ' +
                  'then rerun the watch. Submission rejects the stage output ' +
                  'while any report is missing.',
              ]
            : [
                '1b. Await all evidence workers. Confirm each report exists ' +
                  'and is non-empty at its declared path; when a worker ' +
                  'returned its report in chat instead of writing the file, ' +
                  'persist the returned text there yourself verbatim. ' +
                  'Submission rejects the stage output while any report is ' +
                  'missing.',
              ]),
        ]
      : invocation.scoped_return
        ? [
            '1a. Scoped return visit: no evidence worker runs. Launch the ' +
              'stage worker directly; its card assigns it every evidence ' +
              'dimension.',
          ]
        : []),
    ...deliverySteps,
    ...(!externalDelegation && delegation.watch_command
      ? [
          '3a. Read the verdict the step-2a watch produced. Expect ' +
            'the output file to exist within seconds of the launch and to ' +
            'stay unchanged for a while: `AUTO-001` requires the worker to ' +
            'scaffold it before it starts work, so its presence marks a ' +
            'worker that began. The watch knows that file and does not ' +
            'count it as a finished worker, so a present output early in a ' +
            'run is expected rather than a false positive to investigate. ' +
            'What the watch cannot read is the agent: when it reports ' +
            '`unverified`, inspect the launched agent yourself and re-run ' +
            'the watch with `--agent-state running` or `--agent-state ' +
            'completed`. Submission refuses anything short of a completed ' +
            'wake with `DELEGATION_UNOBSERVED`.',
        ]
      : []),
    ...(delegation.output_validate_command
      ? [
          `3b. Check the output before you spend a stage attempt on it: ` +
            `\`${delegation.output_validate_command}\`. It runs every ` +
            'deterministic side-effect-free validator that submission runs, ' +
            'and it takes all three arguments; a missing one is reported ' +
            'with the others on the first call.',
        ]
      : []),
    `4. Submit with \`${delegation.submit_command}\`.`,
    '5. When `pan status` marks the invocation stale, re-deliver this card ' +
      'only when the invocation validation still passes. Re-prepare the ' +
      'invocation when validation failed or the card changed.',
    '',
  ]
}

/**
 * Render the standalone supervisor procedure document for an invocation whose
 * delegation names a `supervisor_procedure_path`.
 */
export function renderSupervisorProcedureMarkdown(
  invocation: Invocation,
): string {
  const body = renderSupervisorProcedureBody(invocation, true)

  return `${body.join('\n').trimEnd()}\n`
}
