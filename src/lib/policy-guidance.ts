import type {
  ContextReference,
  ContextReferenceStatus,
  Policy,
  PolicyGuidance,
  PolicyGuidanceReference,
} from './types.js'

/** Heading depth a card or rule uses for one guidance block. */
export type GuidanceHeadingLevel = 2 | 3

function normalizedPolicyStatement(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, ' ')
    .trim()
}

/** Heading of a progressively disclosed guidance reference. */
export function guidanceReferenceHeading(
  level: GuidanceHeadingLevel,
  sourcePath: string,
): string {
  return `${'#'.repeat(level)} Guidance reference · \`${sourcePath}\``
}

/** Heading of an inline guidance body, kept for invocations prepared before
 * progressive disclosure existed. */
export function guidanceInlineHeading(
  level: GuidanceHeadingLevel,
  sourcePath: string,
): string {
  return `${'#'.repeat(level)} Unrolled guidance · \`${sourcePath}\``
}

export function guidanceDigestToken(
  reference: PolicyGuidanceReference,
): string {
  return `sha256:${reference.content_sha256}`
}

/**
 * How a reader recomputes a guidance digest. The harness hashes the selection
 * after it trims surrounding whitespace, and a reader who hashes the raw range
 * (with a trailing newline) gets a different digest for identical content.
 * Stating the basis on the reference is what keeps an honest verification from
 * reporting false drift.
 */
export const GUIDANCE_DIGEST_BASIS =
  'SHA-256 of the selected text after leading and trailing whitespace is trimmed.'

export function guidanceSelectedRange(
  reference: PolicyGuidanceReference,
): string {
  if (reference.start_heading && reference.end_heading) {
    return `from \`${reference.start_heading}\` to \`${reference.end_heading}\``
  }

  if (reference.start_heading) {
    return `from \`${reference.start_heading}\` to the end of the file`
  }

  if (reference.end_heading) {
    return `from the start of the file to \`${reference.end_heading}\``
  }

  return 'the complete file'
}

/**
 * Render one guidance block for a policy.
 *
 * A resolved reference renders as a compact pointer rather than the guidance
 * body. The body still exists verbatim in the invocation snapshot, so the
 * reference carries the digest of the exact bytes the harness selected and the
 * condition that makes the guidance apply. Guidance without a reference is a
 * record prepared before progressive disclosure existed, and it keeps its
 * inline body so an in-flight run stays valid.
 */
export function renderGuidanceBlock(
  level: GuidanceHeadingLevel,
  guidance: PolicyGuidance,
): string[] {
  const { reference } = guidance

  if (!reference) {
    return [
      '',
      guidanceInlineHeading(level, guidance.source_path),
      '',
      guidance.content,
    ]
  }

  return [
    '',
    guidanceReferenceHeading(level, guidance.source_path),
    '',
    `- Read when: ${reference.read_trigger}`,
    `- Selected range: ${guidanceSelectedRange(reference)}.`,
    `- Content digest: \`${guidanceDigestToken(reference)}\` — ` +
      `${reference.line_count} lines, ${reference.byte_length} bytes.`,
    `- Digest basis: ${GUIDANCE_DIGEST_BASIS}`,
  ]
}

export function contextReferenceDigestToken(
  reference: ContextReference,
): string {
  return `sha256:${reference.content_sha256}`
}

/**
 * Render one context reference in the guidance-reference shape.
 *
 * A context reference points at a document the run must read and never copies,
 * so the block carries the source path, the digest of the exact selected bytes,
 * the basis a reader recomputes the digest from, and the condition that makes
 * the document apply. `status` reports drift the harness already detected, so a
 * reader meets a stale parent as a stated fact rather than as a silent
 * mismatch.
 */
export function renderContextReferenceBlock(
  level: GuidanceHeadingLevel,
  reference: ContextReference,
  status?: ContextReferenceStatus,
  actualContentSha256?: string,
): string[] {
  return [
    '',
    `${'#'.repeat(level)} Context reference · \`${reference.source_path}\``,
    '',
    `- Read when: ${reference.read_trigger}`,
    '- Selected range: the complete file.',
    `- Content digest: \`${contextReferenceDigestToken(reference)}\` — ` +
      `${reference.line_count} lines, ${reference.byte_length} bytes.`,
    `- Digest basis: ${GUIDANCE_DIGEST_BASIS}`,
    ...(status ? [`- Reference status: ${status}.`] : []),
    ...(status && status !== 'current'
      ? renderContextReferenceFailure(reference, status, actualContentSha256)
      : []),
  ]
}

/**
 * Reference-failure block for a drifted or missing context reference.
 *
 * The worker cannot attest a read against the recorded digest, because the
 * recorded bytes no longer exist on disk and the harness keeps no copy of a
 * context reference. The block names both digests so the operator can tell an
 * edit from a substituted file, and it states the only attestation submission
 * accepts.
 */
function renderContextReferenceFailure(
  reference: ContextReference,
  status: Exclude<ContextReferenceStatus, 'current'>,
  actualContentSha256?: string,
): string[] {
  const recorded = contextReferenceDigestToken(reference)
  const actual = actualContentSha256
    ? `\`sha256:${actualContentSha256}\``
    : 'unavailable, because the source is absent'

  return [
    '',
    `**Reference failure · ${status}.** ` +
      (status === 'drifted'
        ? `The source no longer matches the recorded digest. Recorded digest: \`${recorded}\`. Actual digest: ${actual}.`
        : `The source does not exist at \`${reference.source_path}\`. Recorded digest: \`${recorded}\`.`),
    '',
    'Do not attest this reference as `read`. Set its `invocation_attestation.context_references[]` entry to `reference_failed`, ' +
      'put both digests in `error`, and set the stage `result` to `blocked`. The operator re-plans or re-issues the cohort.',
  ]
}

/**
 * Render the canonical policy block shape used by workflow and standalone
 * contracts.
 */
export function renderPolicyBlocks(
  policies: Policy[],
  guidanceLevel: GuidanceHeadingLevel,
  supersededIds: ReadonlySet<string> = new Set(),
  instrumentIds: ReadonlySet<string> = new Set(),
): string[] {
  if (policies.length === 0) {
    return ['- Only global boundaries apply.']
  }

  return policies.flatMap((policy) => {
    const seen = new Set<string>()
    const instructions = policy.instructions.filter((instruction) => {
      const normalized = normalizedPolicyStatement(instruction)

      if (seen.has(normalized)) {
        return false
      }

      seen.add(normalized)
      return true
    })
    const summary = normalizedPolicyStatement(policy.summary)
    const lines = [
      `**${policy.id} · ${policy.title}**`,
      '',
      // The marker sits under the heading, so the reader meets it before the
      // first instruction.
      ...(supersededIds.has(policy.id)
        ? [
            '> Under review. The text below is the head text you are grading. ' +
              "Your conduct follows this policy's base text in " +
              '**Conduct under the base revision**.',
            '',
          ]
        : instrumentIds.has(policy.id)
          ? [
              '> Under review by an independent reviewer. This policy is ' +
                'instrument tier: the squad does not grade it. Follow the ' +
                'text below as written; the independent reviewer reports on ' +
                'the change.',
              '',
            ]
          : []),
      ...(seen.has(summary) ? [] : [policy.summary, '']),
      ...instructions.map((instruction) => `- ${instruction}`),
    ]

    for (const guidance of policy.guidance ?? []) {
      lines.push(...renderGuidanceBlock(guidanceLevel, guidance))
    }

    return [lines.join('\n'), '']
  })
}
