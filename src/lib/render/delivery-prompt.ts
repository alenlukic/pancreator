/**
 * Worker actions, the evidence report state, and the delegation delivery
 * prompt.
 */

import { cursorAgentName } from '../projection.js'
import type {
  InvocationEvidenceWorker,
  EvidenceWorkerAttempt,
  Invocation,
  InvocationContractManifest,
} from '../types.js'

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

/**
 * Reads an evidence report body and returns whether it carries the completion
 * marker line and the heading text of each case it records so far, in order.
 */
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

/**
 * Returns the ordered launch plan for an invocation that declares evidence
 * workers: one action per evidence worker with its agent, model, brief, and
 * report path, followed by the stage worker, which may launch only after every
 * report exists. Returns an empty list when the invocation declares no evidence
 * workers.
 */
export function orderedWorkerActions(
  invocation: Invocation,
): InvocationWorkerAction[] {
  const evidenceWorkers = invocation.evidence_workers ?? []

  if (evidenceWorkers.length === 0) {
    return []
  }

  const { delegation } = invocation
  const stageAgent =
    cursorAgentName(delegation?.cursor_agent_path) ??
    delegation?.persona ??
    invocation.stage.persona

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
    '2. Read no other repository context before the contract.',
    '3. When the file is unreadable, stop and report a reference failure.',
    '',
    'The harness wrote the contract and the digest above together, and it ' +
      're-hashes the contract file when you submit. Do not recompute the ' +
      'digest; the scaffold already copies it into the attestation.',
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
            'Read each selection directly from its source file. The harness ' +
            'computed each digest below when it wrote the contract, so do ' +
            'not recompute it. Read the exact selected bytes from the ' +
            'invocation JSON snapshot only when the source file is missing ' +
            'or unreadable. The scaffold prefills one ' +
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
