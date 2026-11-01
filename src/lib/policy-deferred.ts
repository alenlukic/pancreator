/**
 * Deferred policy clauses: the clauses a card does not carry at invocation
 * because their `load` trigger has not fired yet.
 *
 * A card renders the eager core inline and lists each deferred group in one
 * index line: policy id, trigger, a one-sentence summary, the digest of the
 * deferred text, and the command that retrieves it. The retrieval command and
 * the hook route both deliver the same card-rendered text, and the digest in
 * the index line is what a receipt names.
 */

import { sha256 } from './io.js'
import {
  type PolicyCardAudience,
  policyInstructionAppliesToCard,
  policyInstructionLoad,
  policyInstructionText,
} from './policy-instructions.js'
import type { Policy, PolicyCapabilities, PolicyLoad } from './types.js'

/** Maximum characters of the one-sentence summary in an index line. */
const SUMMARY_LIMIT = 140

/** Default command prefix when a caller has no resolved workspace command. */
export const DEFAULT_PAN_COMMAND = './bin/pan'

/** One policy's deferred clauses that share a trigger. */
export interface DeferredClauseGroup {
  policy_id: string
  trigger: PolicyLoad
  /** First sentence of the group's first clause, shortened for the index. */
  summary: string
  /** Clause texts in policy order, with duplicates removed. */
  texts: string[]
  /** Digest of `texts` as `deferredClauseDigest` computes it. */
  sha256: string
}

/** Digest a group's clause texts. A receipt and an index line name this value. */
export function deferredClauseDigest(texts: readonly string[]): string {
  return sha256(texts.join('\n'))
}

/** The command that prints a group's card-rendered clause text. */
export function deferredClauseCommand(
  policyId: string,
  trigger: PolicyLoad,
  panCommand: string = DEFAULT_PAN_COMMAND,
): string {
  return `${panCommand} governance clause --policy ${policyId} --trigger ${trigger}`
}

function firstSentence(text: string): string {
  const flat = text.replaceAll(/\s+/gu, ' ').trim()
  const match = /^.*?[.!?](?=\s|$)/u.exec(flat)
  const sentence = match ? match[0] : flat

  return sentence.length > SUMMARY_LIMIT
    ? `${sentence.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…`
    : sentence
}

/**
 * Group a policy's deferred clauses by trigger, in first-appearance order.
 * Only clauses that apply to the card's audience and capabilities count, so an
 * index never advertises a clause the card would not render. `covered` skips a
 * clause that a pointer already delivers through a projected rule.
 */
export function deferredClauseGroups(
  policy: Pick<Policy, 'id' | 'instructions'>,
  audience: PolicyCardAudience,
  capabilities?: PolicyCapabilities,
  covered: (text: string) => boolean = () => false,
): DeferredClauseGroup[] {
  const byTrigger = new Map<PolicyLoad, string[]>()

  for (const instruction of policy.instructions) {
    const trigger = policyInstructionLoad(instruction)
    const text = policyInstructionText(instruction)

    if (
      trigger === 'invocation' ||
      !policyInstructionAppliesToCard(instruction, audience, capabilities) ||
      covered(text)
    ) {
      continue
    }

    const texts = byTrigger.get(trigger) ?? []

    if (!texts.includes(text)) {
      texts.push(text)
    }

    byTrigger.set(trigger, texts)
  }

  return [...byTrigger.entries()].map(([trigger, texts]) => ({
    policy_id: policy.id,
    trigger,
    summary: firstSentence(texts[0]),
    texts,
    sha256: deferredClauseDigest(texts),
  }))
}

/** One index line, in the guidance-reference line shape. */
export function renderDeferredIndexLine(
  group: DeferredClauseGroup,
  panCommand: string = DEFAULT_PAN_COMMAND,
): string {
  return (
    `- \`${group.policy_id}\` · \`${group.trigger}\` · ${group.summary} · ` +
    `digest \`sha256:${group.sha256}\` · ` +
    `\`${deferredClauseCommand(group.policy_id, group.trigger, panCommand)}\``
  )
}

/** Heading text of the index, shared with the validator. */
/**
 * Deferred clauses an executor without a hook route must receive at launch.
 * Event triggers stay indexed: nothing can fire them for such an executor, so
 * they are pulled on demand.
 */
export function inlineClauseGroups(
  policies: readonly Policy[],
  capabilities?: PolicyCapabilities,
): { group: DeferredClauseGroup; title: string }[] {
  return policies.flatMap((policy) =>
    deferredClauseGroups(policy, 'agent', capabilities)
      .filter((group) => !group.trigger.startsWith('event:'))
      .map((group) => ({ group, title: policy.title })),
  )
}

/** The launch-packet block for inlined groups, or an empty string. */
export function renderInlinedClauses(
  inlined: readonly { group: DeferredClauseGroup; title: string }[],
): string {
  if (inlined.length === 0) return ''

  return [
    '# Deferred policy clauses',
    '',
    'Your executor has no hook route, so the clauses below apply from the start. Their triggers are listed beside each.',
    '',
    ...inlined.flatMap(({ group, title }) => [
      `**${group.policy_id} · ${title}** · \`${group.trigger}\``,
      '',
      ...group.texts.map((text) => `- ${text}`),
      '',
    ]),
  ]
    .join('\n')
    .trimEnd()
}

export const DEFERRED_INDEX_HEADING = 'Deferred policy index'

/**
 * Render the index block that follows a card's policy blocks. Returns nothing
 * when no clause is deferred, so a card without a `load` field stays
 * byte-identical.
 */
export function renderDeferredIndex(
  groups: readonly DeferredClauseGroup[],
  level: 2 | 3,
  panCommand: string = DEFAULT_PAN_COMMAND,
): string[] {
  if (groups.length === 0) {
    return []
  }

  return [
    [
      `${'#'.repeat(level)} ${DEFERRED_INDEX_HEADING}`,
      '',
      'These clauses bind you when their trigger fires and are not repeated ' +
        'here. Read each one before the triggering action: `tool:<class>` ' +
        'before your first use of that tool class, `event:<id>` when that ' +
        'event occurs, `path:<glob>` before you first touch a matching ' +
        'file. A hook may deliver the clause for you; otherwise run the ' +
        'command on the line. The harness owns each digest.',
      '',
      ...groups.map((group) => renderDeferredIndexLine(group, panCommand)),
    ].join('\n'),
    '',
  ]
}
