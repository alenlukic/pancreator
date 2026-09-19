import { agentProfileExecutionAllowance } from './agent-ledger-evidence.js'
import { gateEvidenceLabel, passedGateEvidence } from './context.js'
import { GATE_CACHE_ACCEPTANCE_RULE } from './gate-cache.js'
import {
  renderSuiteProfileSection,
  renderSuiteProfileStatusLine,
} from './suite-profile.js'
import { sha256 } from './io.js'
import {
  renderContextReferenceBlock,
  renderPolicyBlocks,
} from './policy-guidance.js'
import { effectiveRepositoryCheckProfile } from './verification.js'
import type {
  Criterion,
  Invocation,
  InvocationContractGuidance,
  InvocationContractManifest,
  InvocationContractSectionOwner,
  EvidenceWorkerAttempt,
  InvocationEvidenceWorker,
  Policy,
  RunState,
  SuiteProfileSummary,
} from './types.js'
import { DELEGATION_HEADING, normalizeMarkdownContent } from './validation.js'
import type { InvocationValidationStatus } from './validation.js'
import { DEFAULT_WORKSPACE_ATTRIBUTION_DISPOSITION } from './workspace-attribution.js'

function fencedJson(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n')
}

/** Longest section-id slug retained from a heading, so ids stay readable. */
const SECTION_SLUG_MAX_LENGTH = 48

const TOP_LEVEL_HEADING_PATTERN = /^## /u

/**
 * One top-level block of a canonical worker contract. Concatenating every
 * block's `markdown` reproduces the contract byte for byte, which is what lets a
 * section digest and the whole-file digest be checked against the same file.
 */
export interface InvocationContractBlock {
  id: string
  heading: string
  owner: InvocationContractSectionOwner
  markdown: string
  line_count: number
}

/** Normalize to LF with exactly one final newline. */
function normalizeContract(markdown: string): string {
  const normalized = normalizeMarkdownContent(markdown)

  return normalized.endsWith('\n') ? normalized : `${normalized}\n`
}

function sectionSlug(heading: string): string {
  const slug = heading
    .replace(/^#+\s*/u, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')
    .slice(0, SECTION_SLUG_MAX_LENGTH)
    .replaceAll(/-+$/gu, '')

  return slug.length > 0 ? slug : 'section'
}

function sectionId(index: number, heading: string): string {
  return `${String(index + 1).padStart(3, '0')}-${sectionSlug(heading)}`
}

/**
 * Split a rendered contract into ordered top-level blocks.
 *
 * Content before the first `## ` heading forms a preamble block. The supervisor
 * delivery procedure is appended last, so every block from that heading onward
 * is supervisor-owned and the rest binds the worker.
 */
export function splitInvocationContract(
  markdown: string,
): InvocationContractBlock[] {
  const lines = normalizeContract(markdown).slice(0, -1).split('\n')
  const groups: Array<{ heading: string; lines: string[] }> = []

  for (const line of lines) {
    if (groups.length === 0 || TOP_LEVEL_HEADING_PATTERN.test(line)) {
      groups.push({
        heading: TOP_LEVEL_HEADING_PATTERN.test(line)
          ? line.trim()
          : 'Preamble',
        lines: [],
      })
    }

    groups[groups.length - 1]?.lines.push(line)
  }

  const supervisorIndex = groups.findIndex(
    (group) => group.heading === DELEGATION_HEADING,
  )

  return groups.map((group, index) => ({
    id: sectionId(index, group.heading),
    heading: group.heading,
    owner:
      supervisorIndex !== -1 && index >= supervisorIndex
        ? ('supervisor' as const)
        : ('worker' as const),
    markdown: `${group.lines.join('\n')}\n`,
    line_count: group.lines.length,
  }))
}

/**
 * Name every referenced guidance selection the contract points at, in policy
 * order. Legacy inline guidance carries its body on the card, so a read needs
 * no attestation and it is not listed.
 */
function manifestGuidance(policies: Policy[]): InvocationContractGuidance[] {
  return policies.flatMap((policy) =>
    (policy.guidance ?? []).flatMap((guidance) =>
      guidance.reference
        ? [
            {
              policy_id: policy.id,
              source_path: guidance.source_path,
              content_sha256: guidance.reference.content_sha256,
              read_trigger: guidance.reference.read_trigger,
            },
          ]
        : [],
    ),
  )
}

/** Describe a rendered contract as a flat, digest-bearing section index. */
export function buildInvocationContractManifest(
  contractPath: string,
  markdown: string,
  policies: Policy[] = [],
): InvocationContractManifest {
  const contract = normalizeContract(markdown)
  const blocks = splitInvocationContract(contract)
  const guidance = manifestGuidance(policies)

  return {
    contract_path: contractPath,
    contract_sha256: sha256(contract),
    byte_length: Buffer.byteLength(contract, 'utf8'),
    line_count: contract.slice(0, -1).split('\n').length,
    sections: blocks.map((block) => ({
      id: block.id,
      heading: block.heading,
      owner: block.owner,
      line_count: block.line_count,
      sha256: sha256(block.markdown),
    })),
    ...(guidance.length > 0 ? { guidance } : {}),
  }
}

/** One launch a prepared stage owes, in the order the supervisor performs it. */
export interface InvocationWorkerAction {
  order: number
  /** `evidence` produces one report the stage worker consumes. */
  role: 'evidence' | 'stage'
  persona: string
  /** Named projected agent the launch must bind to. */
  agent: string
  model: string
  /** Prompt body the supervisor pastes for this launch. */
  prompt_path: string
  /** Artifact this launch must produce before the next action runs. */
  produces: string
  action: string
}

/**
 * The ordered launches of a prepared stage: one per declared evidence worker,
 * then the stage worker that consumes their reports.
 *
 * The dependency is a consequence of the consolidating worker's contract, so
 * no procedure ever stated it, and three recorded runs launched the verifier
 * first and paid for a `blocked` report. A stage with no evidence worker owes
 * one launch and gets an empty list rather than a list of one.
 */
/**
 * Heading that opens one case or finding in an evidence report.
 *
 * An evidence report is appended case by case, so the heading is what a
 * reader counts to see how far an interrupted worker got.
 */
export const EVIDENCE_REPORT_CASE_PREFIX = '### '

/**
 * Line an evidence worker writes last, once every case is recorded.
 *
 * A report is a file the harness watches while it is being written, so
 * presence cannot mean completeness. This marker is the difference, and a
 * report truncated before it reads as the partial record it is.
 */
export const EVIDENCE_REPORT_COMPLETE_MARKER =
  '<!-- evidence-report: complete -->'

/** What an evidence report on disk records so far. */
export interface EvidenceReportState {
  complete: boolean
  /** Heading text of each case the report already holds, in order. */
  cases: string[]
}

export function readEvidenceReportState(body: string): EvidenceReportState {
  const lines = body.split('\n')

  return {
    complete: lines.some(
      (line) => line.trim() === EVIDENCE_REPORT_COMPLETE_MARKER,
    ),
    cases: lines
      .filter((line) => line.startsWith(EVIDENCE_REPORT_CASE_PREFIX))
      .map((line) => line.slice(EVIDENCE_REPORT_CASE_PREFIX.length).trim()),
  }
}

/**
 * Every launch of one evidence role, oldest first.
 *
 * Invocations prepared before attempts were recorded carry only the two
 * declared paths, which read as the single attempt they are.
 */
export function evidenceWorkerAttempts(
  worker: InvocationEvidenceWorker,
): EvidenceWorkerAttempt[] {
  return worker.attempts?.length
    ? [...worker.attempts].sort((left, right) => left.attempt - right.attempt)
    : [
        {
          attempt: 1,
          brief_path: worker.brief_path,
          evidence_path: worker.evidence_path,
          recorded_at: '',
        },
      ]
}

export function orderedWorkerActions(
  invocation: Invocation,
): InvocationWorkerAction[] {
  const evidenceWorkers = invocation.evidence_workers ?? []

  if (evidenceWorkers.length === 0) {
    return []
  }

  const { delegation } = invocation
  const stageAgent =
    typeof delegation?.cursor_agent_path === 'string'
      ? (delegation.cursor_agent_path.split('/').pop() ?? '').replace(
          /\.md$/u,
          '',
        )
      : (delegation?.persona ?? invocation.stage.persona)

  return [
    ...evidenceWorkers.map((worker, index) => ({
      order: index + 1,
      role: 'evidence' as const,
      persona: worker.persona,
      agent: worker.agent,
      model: worker.model,
      prompt_path: worker.brief_path,
      produces: worker.evidence_path,
      action:
        `Launch \`${worker.agent}\` (role \`${worker.role}\`) with ` +
        `\`${worker.brief_path}\` and confirm it writes ` +
        `\`${worker.evidence_path}\`.`,
    })),
    {
      order: evidenceWorkers.length + 1,
      role: 'stage' as const,
      persona: delegation?.persona ?? invocation.stage.persona,
      agent: stageAgent,
      model: invocation.stage.model,
      prompt_path:
        delegation?.delivery_prompt_path ??
        delegation?.canonical_markdown_path ??
        '',
      produces: invocation.output.path,
      action:
        `Launch \`${stageAgent}\` only after every report above exists and ` +
        `is non-empty; it reports \`blocked\` without them.`,
    },
  ]
}

/**
 * Render the exact prompt body a supervisor delivers under referenced mode.
 *
 * The prompt stays bounded no matter how large the contract grows: it carries
 * one contract reference, one digest, and one flat section index. It deliberately
 * holds no nested appendix, because a second level of indirection lowers the
 * accuracy of the read it is meant to guarantee.
 */
export function renderInvocationDeliveryPrompt(
  invocation: Invocation,
  manifest: InvocationContractManifest,
): string {
  const { delegation } = invocation
  const workerSections = manifest.sections.filter(
    (section) => section.owner === 'worker',
  )
  const lines = [
    `Persona: \`${delegation?.persona ?? invocation.stage.persona}\`.`,
    '',
    `Your complete contract for stage \`${invocation.stage.slug}\` is one file. ` +
      'Read that file before any other work.',
    '',
    `- Contract: \`${manifest.contract_path}\``,
    `- Digest: \`sha256:${manifest.contract_sha256}\``,
    `- Size: ${manifest.line_count} lines, ${manifest.byte_length} bytes`,
    `- Sections: ${manifest.sections.length} (${workerSections.length} bind you)`,
    '',
    '## How to read the contract',
    '',
    `1. Read \`${manifest.contract_path}\` in full, from line 1 to line ${manifest.line_count}.`,
    '2. Compare the digest of that file with the digest above.',
    '3. Read no other repository context before the contract.',
    '4. When the file is unreadable, or the digest differs, stop and report a reference failure.',
    '',
    '## Contract sections',
    '',
    'The list below is complete and flat. A `worker` section binds you. A ' +
      '`supervisor` section addresses the supervisor, and you must ignore it.',
    '',
    '| Section id | Heading | Owner | Lines | Digest |',
    '| --- | --- | --- | --- | --- |',
    ...manifest.sections.map(
      (section) =>
        `| \`${section.id}\` | ${section.heading} | ${section.owner} | ` +
        `${section.line_count} | \`${section.sha256}\` |`,
    ),
    '',
    'Use the list to confirm that your read covered every section that binds you.',
    '',
    '## Read attestation',
    '',
    `Declare the read in \`invocation_attestation\` in \`${invocation.output.path}\`:`,
    '',
    `- Set \`invocation_id\` to \`${invocation.invocation_id}\`.`,
    `- Set \`contract_path\` to \`${manifest.contract_path}\`.`,
    `- Set \`contract_sha256\` to \`${manifest.contract_sha256}\`.`,
    '- Set `status` to `read` after you read the complete contract.',
    '',
    'The required stage-output scaffold automation prefills these fields with ' +
      'status `pending`. Change `pending` to `read` yourself — submission ' +
      'rejects `pending`, because only you can declare the read. Do not ' +
      'transcribe the per-section digest table into the attestation; the ' +
      'contract digest alone is required.',
    '',
    'When you cannot read the contract, set `status` to `reference_failed`, put ' +
      'the concrete read error in `error`, and set the stage `result` to ' +
      '`blocked`. Do not report a product verdict you have no contract for.',
    '',
    ...(manifest.guidance?.length
      ? [
          '## Referenced guidance',
          '',
          'The contract references policy guidance instead of inlining it. ' +
            'Read each selection from its source file; when the file no ' +
            'longer matches its digest, read the exact selected bytes from ' +
            'the invocation JSON snapshot. The scaffold prefills one ' +
            '`invocation_attestation.guidance` entry per selection, with ' +
            'both prose fields empty. Each entry takes exactly one of two ' +
            'shapes, and the field differs between them:',
          '',
          '- A completed read: set `status` to `read` and put the ' +
            "selection's verbatim last content line in `final_line` — skip " +
            'empty lines and Markdown divider lines such as `---`. Leave ' +
            '`reason` empty. The final line is not printed here, so quoting ' +
            'it is your read evidence.',
          '- A skipped read: set `status` to `skipped` and put the reason ' +
            'the read trigger does not apply in `reason`. Leave ' +
            '`final_line` empty. A reason written into `final_line` fails ' +
            'validation.',
          '',
          '| Policy | Guidance source | Digest |',
          '| --- | --- | --- |',
          ...manifest.guidance.map(
            (entry) =>
              `| \`${entry.policy_id}\` | \`${entry.source_path}\` | ` +
              `\`sha256:${entry.content_sha256}\` |`,
          ),
          '',
        ]
      : []),
  ]

  return `${lines.join('\n')}\n`
}

/**
 * Render the supervisor delivery procedure: policies, resolved paths, and the
 * lifecycle steps that advance the stage. New invocations write this to the
 * sibling `<invocation-id>.supervisor.md` document so the worker contract
 * carries no lifecycle command; legacy invocations inline it on the card.
 */
function renderSupervisorProcedureBody(
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
    typeof delegation.cursor_agent_path === 'string'
      ? (delegation.cursor_agent_path.split('/').pop() ?? '').replace(
          /\.md$/u,
          '',
        )
      : delegation.persona

  // `pan watch` and `pan worker record` share one command prefix built in
  // `prepare`, and that prefix — `./bin/pan` in the harness checkout, an
  // absolute path in a target installation — reaches this renderer only
  // through `watch_command`. Both forms render under the same guard below.
  const workerRecordCommand = delegation.watch_command?.replace(
    / watch /u,
    ' worker record ',
  )
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
                  'any other action. This step is unconditional: no launch ' +
                  'outcome skips it, and recognizing an outcome is never a ' +
                  'precondition for running it. Pick the flag from what the ' +
                  'launch did, never from whether a watch is needed:',
                `   - the platform converted the launch into a background ` +
                  `subagent — \`${delegation.watch_command} ` +
                  `--mark-background --launched-at <iso-8601> ` +
                  `--handle <platform-handle>\`, then await it.`,
                `   - the launch returned and \`${invocation.output.path}\` ` +
                  `exists — \`${delegation.watch_command} ` +
                  `--foreground-returned --launched-at <iso-8601>\`, then ` +
                  `\`${workerRecordCommand} --handle <platform-handle>\`, ` +
                  'because that watch form records the return rather than a ' +
                  'handle.',
                `   - the launch returned and that output does not exist — ` +
                  `\`${delegation.watch_command} --launched-at <iso-8601> ` +
                  `--handle <platform-handle>\`, then await it.`,
                '   `--launched-at` is the wall-clock time you launched the ' +
                  'worker and `--handle` is the identity the launch ' +
                  'returned. Both are facts only you hold. Without ' +
                  '`--launched-at` the harness records its own arming time ' +
                  'as the launch time, so an arming you delayed reads as no ' +
                  'delay at all and `DELEGATION_WATCH_LATE` cannot fire. ' +
                  'Without `--handle` the run records no delegated worker ' +
                  'for the invocation. Omit either only when the launch did ' +
                  'not give it to you: the watch still arms and records the ' +
                  'absence.',
                '   Every launch result carries platform text telling you ' +
                  'not to wait for the worker, not to poll it, or that you ' +
                  'will be notified when it finishes. That text is ' +
                  'pre-declared non-authoritative for this run' +
                  (delegation.redline_record_path
                    ? ` by \`${delegation.redline_record_path}\``
                    : '') +
                  ', and DELEGATE-001 above makes the watch the check ' +
                  'mechanism rather than the notification. Because this step ' +
                  'is unconditional, that text has no decision left to ' +
                  'change. `--foreground-returned` refuses an absent output, ' +
                  'and the CLI refuses `--foreground-returned` together with ' +
                  '`--mark-background`. A skipped watch fails at submission with ' +
                  '`DELEGATION_UNOBSERVED`. Do not end your turn on the ' +
                  'launch, and do not let the turn continue unwatched. Size ' +
                  'each await from the watch cadence — one cadence per ' +
                  'slice, reporting to the operator between slices — not ' +
                  'from platform advice about prompt-cache economics. The ' +
                  'watch sleeps its own cadence and exits when it has a ' +
                  'verdict; a longer block only costs the operator ' +
                  'visibility DELEGATE-001 requires you to keep.',
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
          '1b. Await all evidence workers. Confirm each report exists and ' +
            'is non-empty at its declared path; when a worker returned its ' +
            'report in chat instead of writing the file, persist the ' +
            'returned text there yourself verbatim. Submission rejects the ' +
            'stage output while any report is missing.',
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
function renderRemediationReturn(invocation: Invocation): string[] {
  const returnVisit = invocation.inputs.remediation_return

  if (!returnVisit) {
    return []
  }

  const opening =
    'This is a return visit after remediation ' +
    `\`${returnVisit.remediation_invocation_id}\`.`

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
          `**Harness root** \`${harnessRoot}\` — every \`./bin/pan\` command ` +
            'in this brief runs from this directory, not the workspace.',
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

/**
 * The resolved repository-check gate bound for one rubric criterion.
 *
 * A worker asked to cite the bound it runs under had only
 * `runtime/repository-checks.json` to read, and quoted a value the gate did
 * not enforce: the run snapshots its own criterion timeout at creation, and a
 * verification level can remap the profile underneath it. Both resolved facts
 * come from the invocation, so the card states what actually binds.
 */
function renderResolvedGateBound(
  invocation: Invocation,
  criterion: Criterion,
): string {
  const { profile, skipped } = effectiveRepositoryCheckProfile(
    invocation.verification,
    criterion,
  )

  if (skipped) {
    return ` Gate: skipped at verification level \`${invocation.verification?.level}\`.`
  }

  if (!profile) {
    return ''
  }

  const command = `pan repository-check ${profile}`

  return criterion.timeout_ms === undefined
    ? ` Gate: \`${command}\`, no snapshotted bound; the profile's own configured budget applies.`
    : ` Gate: \`${command}\`, resolved timeout ${criterion.timeout_ms} ms from the run snapshot.`
}

/** Render an invocation card for both the operator and the assigned worker. */
export function renderInvocationMarkdown(invocation: Invocation): string {
  const { stage } = invocation
  const requiredData = Object.entries(invocation.output.required_data)
  const referenceLines = (
    retrieval: 'required' | 'conditional' | 'index_only',
  ) =>
    invocation.inputs.references
      .filter((item) => (item.retrieval ?? 'required') === retrieval)
      .flatMap((item) => [
        `- \`${item.path}\` — ${item.description}`,
        ...(item.condition ? [`  - Read when: ${item.condition}`] : []),
      ])

  const requiredReferences = referenceLines('required')
  const conditionalReferences = referenceLines('conditional')
  const indexReferences = referenceLines('index_only')

  const missingRequired = invocation.inputs.missing_required ?? []
  const contextReference = invocation.inputs.context_reference
  const contextReferenceLines = contextReference
    ? renderContextReferenceBlock(
        3,
        contextReference,
        contextReference.reference_status,
        contextReference.actual_content_sha256,
      ).slice(1)
    : []

  const policies = renderPolicyBlocks(invocation.policies, 3, 'agent')
  const requirements = invocation.requirements
    ? [
        ...invocation.requirements.automation_requirements,
        ...invocation.requirements.validation_requirements,
      ]
    : []
  const agentRequirements = requirements.filter(
    (requirement) => requirement.executor !== 'harness',
  )
  const harnessRequirements = requirements.filter(
    (requirement) => requirement.executor === 'harness',
  )

  const requirementRows = agentRequirements.length
    ? [
        '| Policy | Requirement | Registry | Phase | Executor | Enforcement | Target | Success | Failure route |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        ...agentRequirements.map(
          (requirement) =>
            `| ${requirement.policy_id} | ${requirement.requirement_id} | ` +
            `${requirement.registry_id}@${requirement.registry_version} | ` +
            `${requirement.phase} | ${requirement.executor} | ${requirement.enforcement} | ` +
            `${requirement.resolved_target ?? requirement.target} | ` +
            `${requirement.success_condition} | ${requirement.failure_route} |`,
        ),
      ]
    : []
  const harnessRequirementLines = harnessRequirements.map(
    (requirement) =>
      `- \`${requirement.registry_id}@${requirement.registry_version}\` — ` +
      `${requirement.requirement_id} (${requirement.phase}, ${requirement.enforcement}); harness-owned, no agent action.`,
  )

  const gateOverrideEntries = Object.entries(invocation.gate_overrides ?? {})
  const gateOverrideLines = gateOverrideEntries.map(([id, command]) =>
    command === false
      ? `- 🚫 **${id}** — disabled by run configuration.`
      : `- 🛠️ **${id}** — overridden: \`${command}\``,
  )

  const priorFailure = invocation.prior_failure
  const priorFailureReasons =
    (priorFailure?.failed_hard_criteria.length ?? 0) +
    (priorFailure?.declared_criteria_failures?.length ?? 0) +
    (priorFailure?.failed_deterministic.length ?? 0) +
    (priorFailure?.validation_errors.length ?? 0) +
    (priorFailure?.governance_artifact_warnings.length ?? 0) +
    (priorFailure?.supervisor_assessment ? 1 : 0)
  const priorFailureLines = priorFailure
    ? [
        '## ⛔ Why the previous attempt failed',
        '',
        (priorFailure.outcome === 'success' &&
        priorFailure.supervisor_assessment
          ? `Attempt ${priorFailure.attempt} of \`${priorFailure.stage}\` ` +
            'submitted cleanly but was rejected by the supervisor. '
          : `Attempt ${priorFailure.attempt} of \`${priorFailure.stage}\` ` +
            `ended in \`${priorFailure.outcome}\`. `) +
          (priorFailureReasons === 0
            ? 'No reason of any kind was recorded for it.'
            : 'This is the complete recorded reason. ' +
              'Address every item below; resubmitting unchanged work will fail the ' +
              'same way.'),
        '',
        ...(priorFailure.failed_hard_criteria.length > 0
          ? [
              '### Hard criteria that did not pass',
              '',
              ...priorFailure.failed_hard_criteria.flatMap((criterion) => [
                `- **${criterion.id}** (${criterion.type}) — ${criterion.statement}`,
                ...(criterion.explanation
                  ? [`  - Recorded explanation: ${criterion.explanation}`]
                  : []),
              ]),
              '',
            ]
          : []),
        ...((priorFailure.declared_criteria_failures?.length ?? 0) > 0
          ? [
              '### Criteria the attempt reported failing',
              '',
              ...(priorFailure.declared_criteria_failures ?? []).map(
                (criterion) =>
                  `- **${criterion.id}** (${criterion.result})` +
                  (criterion.explanation ? ` — ${criterion.explanation}` : ''),
              ),
              '',
            ]
          : []),
        ...(priorFailure.failed_deterministic.length > 0
          ? [
              '### Deterministic checks that failed',
              '',
              ...priorFailure.failed_deterministic.flatMap((item) => [
                `- **${item.id}**` +
                  (item.command ? ` — \`${item.command}\`` : '') +
                  (item.timed_out
                    ? ' (timed out)'
                    : item.exit_code !== undefined && item.exit_code !== null
                      ? ` (exit ${item.exit_code})`
                      : ''),
                ...(item.evidence_path
                  ? [`  - Evidence: \`${item.evidence_path}\``]
                  : []),
              ]),
              '',
            ]
          : []),
        ...(priorFailure.supervisor_assessment
          ? [
              '### Supervisor assessment',
              '',
              `Verdict \`${priorFailure.supervisor_assessment.verdict}\`` +
                (priorFailure.supervisor_assessment.summary
                  ? ` — ${priorFailure.supervisor_assessment.summary}`
                  : ''),
              '',
              ...(priorFailure.supervisor_assessment.action_items.length > 0
                ? [
                    'Action items:',
                    '',
                    ...priorFailure.supervisor_assessment.action_items.map(
                      (item) => `- ${item}`,
                    ),
                    '',
                  ]
                : []),
            ]
          : []),
        ...(priorFailure.validation_errors.length > 0
          ? [
              '### Output validation errors',
              '',
              ...priorFailure.validation_errors.map((item) => `- ${item}`),
              '',
            ]
          : []),
        ...(priorFailure.governance_artifact_warnings.length > 0
          ? [
              '### Governance and artifact diagnostics',
              '',
              ...priorFailure.governance_artifact_warnings.map(
                (item) => `- ${item}`,
              ),
              '',
            ]
          : []),
        ...(priorFailureReasons === 0
          ? [
              'No specific failing criterion, check, or validation error was ' +
                `recorded. Read \`${priorFailure.output_path}\` and treat the ` +
                'absent reason itself as a defect to report.',
              '',
            ]
          : []),
      ]
    : []

  const stageRepair = invocation.operator_stage_repair
  const stageRepairLines = stageRepair
    ? [
        '## ⛔ Why this attempt exists',
        '',
        `The ${stageRepair.actor} moved this run from \`${stageRepair.from_stage}\` ` +
          `to \`${stageRepair.to_stage}\` and gave this reason. It supersedes ` +
          'every earlier verdict, including any output of the stage the run ' +
          'came from. Treat it as required input.',
        '',
        ...stageRepair.note
          .trim()
          .split('\n')
          .map((line) => `> ${line}`.trimEnd()),
        '',
        `Recorded at \`${stageRepair.path}\`.`,
        '',
      ]
    : []

  const involvement = invocation.operator_involvement
  const appliedGateEntries = Object.entries(involvement?.applied_gates ?? {})
  const involvementLines = involvement
    ? [
        '## 🎚️ Operator involvement',
        '',
        `Profile \`${involvement.profile}\` — ${involvement.summary}`,
        '',
        ...(involvement.contracts.length > 0
          ? [
              `Active run contracts: ${involvement.contracts
                .map((contract) => `\`${contract}\``)
                .join(', ')}.`,
              '',
            ]
          : []),
        ...(appliedGateEntries.length > 0
          ? [
              'Gates this run uses instead of the workflow default:',
              '',
              ...appliedGateEntries.map(
                ([slug, change]) =>
                  `- \`${slug}\`: \`${change.workflow_gate}\` → ` +
                  `\`${change.run_gate}\` (${change.source})`,
              ),
              '',
            ]
          : ['Every stage uses its workflow-declared gate.', '']),
      ]
    : []

  const verification = invocation.verification
  const verificationGateEntries = Object.entries(verification?.gates ?? {})
  const verificationLines = verification
    ? [
        '## 🔬 Verification level',
        '',
        `Level \`${verification.level}\` — ${verification.summary}`,
        '',
        ...(verificationGateEntries.length > 0
          ? [
              'Repository-check gates this level remaps:',
              '',
              ...verificationGateEntries.map(
                ([criterionId, profile]) =>
                  `- \`${criterionId}\`: ` +
                  (profile === false
                    ? 'skipped'
                    : `runs profile \`${profile}\``),
              ),
              '',
            ]
          : ['Every gate runs its workflow-declared profile.', '']),
        ...(invocation.stage.slug === 'intake' ||
        invocation.stage.slug === 'plan'
          ? [
              'If this change warrants a different level, you MAY set ' +
                '`data.verification_recommendation` to `{ "level": <name>, ' +
                '"reason": <why> }`. The operator decides; do not assume the ' +
                'change.',
              '',
            ]
          : []),
      ]
    : []

  const operatorBrief = invocation.output.operator_brief
  const declaredArtifactLines = invocation.output.artifacts
    ? [
        'Declare these artifacts in this exact order:',
        ...invocation.output.artifacts.map(
          (artifact, index) =>
            `${index}. \`${artifact.path}\` — ${artifact.description}`,
        ),
        '',
      ]
    : []
  const requiredDataLines = requiredData.length
    ? [
        'Required `data` fields:',
        ...requiredData.map(
          ([key, typeName]) => `- \`data.${key}\`: ${typeName}`,
        ),
      ]
    : ['No stage-specific `data` fields are required.']
  const fieldContractLines = invocation.output.field_contract
    ? [
        '',
        'Shared field contract:',
        ...(invocation.output.field_contract.criterion_results
          ? [
              '- `criteria[].result` values:',
              ...Object.entries(
                invocation.output.field_contract.criterion_results,
              ).map(([value, meaning]) => `  - \`${value}\`: ${meaning}`),
            ]
          : []),
        ...invocation.output.field_contract.validators.map(
          (validator) =>
            `- \`${validator.registry_id}\` ${validator.enforcement} the stage.`,
        ),
        ...invocation.output.field_contract.fields.map((field) => {
          const details = [
            field.type,
            ...(field.enum ? [`values: ${field.enum.join(', ')}`] : []),
            ...(field.required
              ? [`required keys: ${field.required.join(', ')}`]
              : []),
            ...(field.format ? [`format: ${field.format}`] : []),
          ]

          return `- \`${field.path}\`: ${details.join(', ')}`
        }),
      ]
    : []

  const { delegation } = invocation
  // Legacy invocations inline the full procedure on the card. New invocations
  // point at the sibling supervisor document instead, so the worker-visible
  // contract never carries a workflow lifecycle command.
  const delegationLines = delegation
    ? delegation.supervisor_procedure_path
      ? [
          DELEGATION_HEADING,
          '',
          'This section addresses the supervisor that prepared this card, not ' +
            'the assigned worker. The worker MUST ignore it. The complete ' +
            'delivery procedure, its policies, and every resolved workflow ' +
            'lifecycle command live in ' +
            `\`${delegation.supervisor_procedure_path}\`; the supervisor MUST ` +
            'follow that document and MUST NOT deliver it to the worker. ' +
            'Worker-visible sections of this card carry no workflow ' +
            'lifecycle command.',
          '',
        ]
      : renderSupervisorProcedureBody(invocation)
    : []

  const lines = [
    `# 🚀 ${invocation.$operator.headline}`,
    '',
    `**Run** \`${invocation.run_id}\` · **Stage** ${stage.title} ` +
      `(\`${stage.slug}\`) · **Owner** \`${stage.persona}\` · ` +
      `**Model** \`${stage.model}\`` +
      (stage.persona_executor
        ? ` · **Executor** \`${stage.persona_executor}\``
        : '') +
      ` · **Attempt** ${invocation.attempt}`,
    '',
    `**Workspace** \`${invocation.workspace_root}\` — fingerprints, ` +
      'deterministic gate commands, and scope checks target this directory.',
    ...(invocation.managed_worktree
      ? [
          '',
          `**Managed worktree** \`${invocation.managed_worktree.name}\` · ` +
            `**Branch** \`${invocation.managed_worktree.branch}\` · ` +
            `**Path** \`${invocation.managed_worktree.path}\``,
        ]
      : []),
    ...(invocation.harness_root
      ? [
          '',
          `**Harness root** \`${invocation.harness_root}\` — every harness-relative ` +
            'path in this contract (`runtime/…`, `library/…`, `governance/…`, ' +
            '`docs/…`) and every `./bin/pan` command resolve against this ' +
            'directory, not the workspace. Write the stage output at ' +
            `\`${invocation.harness_root}/${invocation.output.path}\`. ` +
            'Target source paths resolve against the workspace.',
        ]
      : []),
    '',
    '## Operator view',
    '',
    invocation.$operator.summary,
    '',
    `**Next action:** ${invocation.$operator.next_action}`,
    '',
    '## 📋 Task',
    '',
    invocation.prompt,
    '',
    ...priorFailureLines,
    ...stageRepairLines,
    '## 📥 Inputs',
    '',
    '### Required inputs',
    '',
    ...(requiredReferences.length > 0
      ? requiredReferences
      : ['- No required artifact inputs.']),
    '',
    ...((invocation.evidence_workers ?? []).length > 0
      ? [
          '### Parallel evidence reports',
          '',
          'The supervisor persists these reports before delegating this ' +
            'card. Read each in full and cite it where your output ' +
            'consolidates its findings.',
          '',
          ...(invocation.evidence_workers ?? []).flatMap((worker) => {
            const attempts = evidenceWorkerAttempts(worker)

            // A relaunched worker wrote beside the first report rather than
            // over it, so the card names every attempt instead of sending
            // the reader to one path that holds only part of the evidence.
            return attempts.map(
              (attempt) =>
                `- \`${attempt.evidence_path}\` — ${worker.role} evidence ` +
                `report from the parallel \`${worker.persona}\` worker` +
                (attempts.length > 1 ? ` (attempt ${attempt.attempt})` : '') +
                '.',
            )
          }),
          '',
        ]
      : []),
    ...(contextReferenceLines.length > 0 ? [...contextReferenceLines, ''] : []),
    ...(conditionalReferences.length > 0
      ? ['### Conditional references', '', ...conditionalReferences, '']
      : []),
    ...(indexReferences.length > 0
      ? ['### Context index', '', ...indexReferences, '']
      : []),
    ...(missingRequired.length > 0
      ? [
          '### Missing required context',
          '',
          ...missingRequired.map((item) => `- ${item}`),
          '',
        ]
      : []),
    '## 📜 Policies in force',
    '',
    ...policies,
    '',
    ...(requirementRows.length > 0
      ? ['## ✅ Agent validation requirements', '', ...requirementRows, '']
      : []),
    ...(harnessRequirementLines.length > 0
      ? ['## 🧰 Harness-owned checks', '', ...harnessRequirementLines, '']
      : []),
    '## 🎯 Rubric',
    '',
    ...invocation.rubric.map(
      (criterion) =>
        `- ${criterion.hard ? '🔴 hard' : '⚪ soft'} ` +
        `**${criterion.id}** (${criterion.type}) — ${criterion.statement}` +
        renderResolvedGateBound(invocation, criterion),
    ),
    '',
    // Whoever owns a repository-check gate runs one, and whoever is handed
    // gate evidence judges one. Both meet the `cached` mark, so both get the
    // rule.
    ...(invocation.rubric.some((criterion) =>
      criterion.command?.includes('repository-check'),
    ) || invocation.inputs.references.some((item) => item.gate_evidence)
      ? [GATE_CACHE_ACCEPTANCE_RULE, '']
      : []),
    ...(gateOverrideLines.length > 0
      ? ['## 🧪 Gate overrides', '', ...gateOverrideLines, '']
      : []),
    ...involvementLines,
    ...verificationLines,
    ...(invocation.suite_profile || invocation.fast_wall
      ? renderSuiteProfileSection(
          invocation.suite_profile ?? null,
          invocation.fast_wall,
        )
      : []),
    '## 📤 Output contract',
    '',
    `Write JSON to \`${invocation.output.path}\` using ` +
      `\`${invocation.output.template}\` as the base shape ` +
      `(schema \`${invocation.output.schema}\`).`,
    '',
    ...(invocation.output.scaffold_command
      ? [
          'Prefill the output with the required scaffold automation, exactly ' +
            'as printed:',
          '',
          `\`${invocation.output.scaffold_command}\``,
          '',
          'The `--invocation` argument accepts only that invocation JSON ' +
            'snapshot. The Markdown contract beside it is not a valid ' +
            'argument and fails by artifact type.',
          '',
        ]
      : []),
    ...(invocation.attempt > 1
      ? [
          'This is a retry. Instead of re-emitting the whole document, you ' +
            'MAY submit a revision: write ' +
            '`{ "revises": "<prior invocation id' +
            (invocation.prior_failure
              ? `, here ${invocation.prior_failure.invocation_id}`
              : '') +
            '>", "patch": { ... } }` to the output path, where `patch` is an ' +
            'RFC 7386 JSON merge patch over the prior attempt output ' +
            '(objects merge recursively, arrays replace whole, `null` ' +
            'deletes). The patch MUST set `invocation_id` and ' +
            "`invocation_attestation` to this card's values. Patch only " +
            'what the failure or directive requires; the harness validates ' +
            'the merged document.',
          '',
        ]
      : []),
    ...(operatorBrief
      ? [
          `Operator brief artifact index: source ` +
            `\`${operatorBrief.source_path}\`; rendered HTML ` +
            `\`${operatorBrief.rendered_path}\`; schema ` +
            `\`${operatorBrief.schema}\`; profile ` +
            `\`${operatorBrief.profile}\`. The source file already exists. ` +
            `Edit it in place; do not search the repository for brief artifacts and ` +
            `do not run the renderer. The harness renders and validates it during submission. ` +
            `Required section-heading phrases: ${operatorBrief.required_headings.join(', ')}. ` +
            'The rendered HTML is artifact 0.' +
            (operatorBrief.source_lifecycle === 'transient' ||
            operatorBrief.source_transient
              ? ' The source JSON is transient and the harness deletes it after successful rendering and validation.'
              : ' This legacy invocation retains the source JSON.'),
          '',
          ...((operatorBrief.allowed_card_types ?? []).length > 0
            ? [
                'The renderer accepts only these values. The schema types both ' +
                  'fields as open strings, so an unlisted value produces a ' +
                  'schema-valid brief that fails to render, and you are not ' +
                  'permitted to run the renderer to find out. Reuse the closest ' +
                  'listed value rather than inventing one.',
                '',
                `- Card \`type\`: ${(operatorBrief.allowed_card_types ?? [])
                  .map((item) => `\`${item}\``)
                  .join(', ')}`,
                `- Section \`semantic\`: ${(
                  operatorBrief.allowed_section_semantics ?? []
                )
                  .map((item) => `\`${item}\``)
                  .join(', ')}`,
                '',
              ]
            : []),
        ]
      : [
          'This invocation does not request an operator brief. Do not create a brief source or rendered stage HTML.',
          'Use an empty artifacts array unless the stage produces another declared deliverable.',
          '',
        ]),
    ...declaredArtifactLines,
    ...requiredDataLines,
    ...fieldContractLines,
    '',
    'When tracked workspace files change during the stage, include top-level `workspace_changes` with `attribution`, every changed path in `paths`, and a concise `explanation`. Use `attribution: internal` only when the active worker can trace every listed change to its own actions; the cleanliness gate blocks only external or unattributed contamination.',
    '',
    ...attributedChangeLines(invocation),
    '## 🚧 Boundaries',
    '',
    ...invocation.boundaries.map((item) => `- ${item}`),
    '',
    '## Technical appendix',
    '',
    fencedJson({
      invocation_id: invocation.invocation_id,
      workflow: invocation.workflow,
      workspace_root: invocation.workspace_root,
      ...(invocation.managed_worktree
        ? { managed_worktree: invocation.managed_worktree }
        : {}),
      workspace_fingerprint: invocation.workspace_before.fingerprint,
      model: stage.model,
      model_config: stage.model_config,
      ...(stage.persona_executor
        ? { persona_executor: stage.persona_executor }
        : {}),
      workspace_policy: stage.workspace_policy,
      gate: stage.gate,
    }),
    ...(delegationLines.length > 0 ? ['', ...delegationLines] : []),
  ]

  return `${lines.join('\n')}\n`
}

/**
 * Workspace changes an operator directive already accounted for.
 *
 * Without this section the delta belongs to no stage on the card, and each
 * worker audits it again before reporting it as unattributed.
 */
function attributedChangeLines(invocation: Invocation): string[] {
  const records = invocation.attributed_changes ?? []

  if (records.length === 0) {
    return []
  }

  return [
    '## 📌 Attributed workspace changes',
    '',
    'An operator directive accounts for the paths below. Do not report them ' +
      'as unattributed, and do not audit them to find their author.',
    '',
    ...records.flatMap((record) => [
      `- **${record.acting_role}** executed an operator directive at ` +
        `${record.timestamp} (\`${record.artifact_path}\`, disposition ` +
        `\`${record.disposition ?? DEFAULT_WORKSPACE_ATTRIBUTION_DISPOSITION}\`): ` +
        record.directive,
      ...record.changed_paths.map((item) => `  - \`${item}\``),
    ]),
    '',
  ]
}

function formatValidationArtifactStatus(
  label: string,
  artifactPath: string,
  load: InvocationValidationStatus['invocation'],
): string[] {
  if ('state' in load) {
    if (load.state === 'missing') {
      return [`${label}: missing`, `  Artifact: ${artifactPath}`]
    }

    return [
      `${label}: malformed`,
      `  Artifact: ${artifactPath}`,
      `  Reason: ${load.reason}`,
    ]
  }

  const statusLabel = load.status === 'pass' ? 'pass' : 'fail'
  const lines = [
    `${label}: ${statusLabel}`,
    `  Artifact: ${artifactPath}`,
    `  Summary: ${load.summary}`,
  ]
  const failedChecks = load.checks.filter((check) => !check.passed)

  if (failedChecks.length > 0) {
    lines.push(
      ...failedChecks.map((check) => `  - ${check.id}: ${check.message}`),
    )
  }

  return lines
}

function renderDeliveryHandoff(
  handoff: RunState['delivery_handoff'],
): string[] {
  if (!handoff) {
    return []
  }

  switch (handoff.kind) {
    case 'delivery':
      return [`Delivery handoff: run ${handoff.run_id} in ${handoff.worktree}`]
    case 'cohort':
      return [`Delivery handoff: cohort ${handoff.cohort_id}`]
    case 'failed':
      return [
        `Delivery route failed: ${handoff.error}`,
        ...handoff.manual_commands.map((command) => `  Manual: ${command}`),
      ]
    default: {
      const exhaustive: never = handoff

      throw new Error(`Unhandled delivery handoff kind: ${String(exhaustive)}`)
    }
  }
}

/** Render a one-screen status summary for `pan status`. */
export function renderStatus(
  state: RunState,
  validationStatus: InvocationValidationStatus | null = null,
  suiteProfile: SuiteProfileSummary | null = null,
): string {
  const lines = [
    `Run ${state.run_id}`,
    `Status: ${state.status}`,
    `Workflow: ${state.workflow_slug}`,
    `Model config: ${state.pipeline_config?.name ?? 'live default'}`,
    `Workspace: ${state.workspace_root || '.'}`,
    ...(state.managed_worktree
      ? [
          `Managed worktree: ${state.managed_worktree.name}`,
          `Managed branch: ${state.managed_worktree.branch}`,
        ]
      : []),
    ...(state.request.context_reference
      ? [`Context reference: ${state.request.context_reference.source_path}`]
      : []),
    ...(state.cohort?.role === 'release'
      ? [`Release of cohort: ${state.cohort.cohort_id}`]
      : []),
    `Current stage: ${state.current_stage ?? 'none'}`,
    `Pending action: ${state.pending_action.type}`,
    ...renderDeliveryHandoff(state.delivery_handoff),
    `Revision: ${state.revision}`,
    `Transitions: ${state.transition_count}/` +
      state.limits.max_total_transitions,
  ]

  if (state.operator_involvement) {
    const { profile, contracts } = state.operator_involvement

    lines.push(
      `Involvement profile: ${profile}` +
        (contracts.length > 0 ? ` (contracts: ${contracts.join(', ')})` : ''),
    )
  }

  if ('path' in state.pending_action) {
    lines.push(`Card: ${state.pending_action.path}`)
  }

  if (state.agent_health) {
    lines.push(
      `Agent health: ${state.agent_health.health}`,
      `Health evidence time: ${state.agent_health.evidence_at}`,
      `Recovery state: ${state.agent_health.recovery.step ?? 'none'}`,
    )
  } else if (state.pending_action.type === 'invoke_agent') {
    lines.push(
      'Agent health: unknown',
      'Health evidence time: unavailable',
      'Recovery state: none',
    )
  }

  if (state.pause_reason) {
    lines.push(`Pause reason: ${state.pause_reason}`)
  }

  if (suiteProfile) {
    lines.push(renderSuiteProfileStatusLine(suiteProfile))
  }

  if ((state.operator_gate_waivers ?? []).length > 0) {
    lines.push('', '## Operator gate waivers', '')

    for (const waiver of state.operator_gate_waivers ?? []) {
      lines.push(
        `- ${waiver.stage} attempt ${waiver.source_attempt}: ` +
          `${waiver.criterion_ids.join(', ')} → ${waiver.directive_target ?? 'stage success'} ` +
          `(${waiver.artifact_path})`,
      )

      if (waiver.whole_stage_bypass) {
        lines.push('  Whole-stage bypass: true')
      }

      if (waiver.spotfix_case_path) {
        lines.push(`  Follow-up: ${waiver.spotfix_case_path}`)
      }
    }
  }

  const appliedGates = Object.entries(
    state.operator_involvement?.applied_gates ?? {},
  )

  if (appliedGates.length > 0) {
    lines.push('', '## Run gates replacing workflow defaults', '')

    for (const [slug, change] of appliedGates) {
      lines.push(
        `- ${slug}: ${change.workflow_gate} → ${change.run_gate} ` +
          `(${change.source})`,
      )
    }
  }

  if (Object.keys(state.operator_revisions ?? {}).length > 0) {
    lines.push('', '## Operator revisions granted', '')

    for (const [slug, count] of Object.entries(
      state.operator_revisions ?? {},
    )) {
      lines.push(
        `- ${slug}: ${count} extra attempt${count === 1 ? '' : 's'} ` +
          `(ceiling ${state.limits.max_stage_attempts + count})`,
      )
    }
  }

  if ((state.operator_workspace_ratifications ?? []).length > 0) {
    const latest = state.operator_workspace_ratifications?.at(-1)

    if (latest) {
      lines.push(
        '',
        '## Latest workspace ratification',
        '',
        `Fingerprint: ${latest.workspace_fingerprint}`,
        `Artifact: ${latest.artifact_path}`,
      )
    }
  }

  // ORCH-001: the supervisor reads this inventory to avoid a duplicate run.
  const gateEvidence = passedGateEvidence(state)

  if (gateEvidence.length > 0) {
    const latestFingerprint =
      state.stage_history.at(-1)?.workspace_fingerprint ?? null

    lines.push('', '## Gate evidence', '')

    for (const evidence of gateEvidence) {
      const currency =
        evidence.fingerprint === latestFingerprint ? 'current' : 'superseded'
      const label = gateEvidenceLabel(evidence)

      lines.push(
        `- ${evidence.profile}: ${label} at ${evidence.fingerprint} ` +
          `(${evidence.origin}) — ${evidence.evidencePath} [${currency}]`,
      )
    }
  }

  if ((state.advisories ?? []).length > 0) {
    lines.push('', '## Advisories', '')

    for (const advisory of state.advisories ?? []) {
      const context = advisory.stage
        ? `${advisory.stage} (${advisory.source})`
        : advisory.source

      lines.push(`- ${context}: ${advisory.message}`)
    }
  }

  if (validationStatus) {
    lines.push('', '## Validation', '')
    lines.push(
      ...formatValidationArtifactStatus(
        'Invocation validation',
        validationStatus.invocation_validation_path,
        validationStatus.invocation,
      ),
    )
    lines.push(
      ...formatValidationArtifactStatus(
        'Delegation validation',
        validationStatus.delegation_validation_path,
        validationStatus.delegation,
      ),
    )
    lines.push(`Delegation artifact: ${validationStatus.delegation_path}`)
  }

  return `${lines.join('\n')}\n`
}
