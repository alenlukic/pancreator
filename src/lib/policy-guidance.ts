import type { PolicyGuidance, PolicyGuidanceReference } from './types.js'

/** Heading depth a card or rule uses for one guidance block. */
export type GuidanceHeadingLevel = 2 | 3

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
  ]
}
