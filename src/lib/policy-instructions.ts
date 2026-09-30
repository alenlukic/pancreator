import { invariant } from './errors.js'
import type { PolicyAudience, PolicyInstruction } from './types.js'

export type PolicyCardAudience = 'agent' | 'supervisor' | 'operator'

const POLICY_AUDIENCES: readonly PolicyAudience[] = [
  'agent',
  'supervisor',
  'harness',
  'operator',
]

function isPolicyAudience(value: string): value is PolicyAudience {
  return (POLICY_AUDIENCES as readonly string[]).includes(value)
}

/**
 * Return the text of a policy instruction, accepting both the legacy string
 * form and the object form.
 */
export function policyInstructionText(
  instruction: PolicyInstruction | string,
): string {
  return typeof instruction === 'string' ? instruction : instruction.text
}

/**
 * Validate one policy instruction and return it in object form; a bare string
 * becomes an `agent`-audience instruction. Throws `PanError` `INVALID_POLICY`
 * for empty text, an empty, unknown, or duplicate audience, `harness` or
 * `operator` combined with another audience, or a non-boolean `excerpt`.
 */
export function normalizePolicyInstruction(
  value: unknown,
  source: string,
): PolicyInstruction {
  if (typeof value === 'string') {
    invariant(
      value.trim().length > 0,
      `${source} MUST be a non-empty string.`,
      { code: 'INVALID_POLICY' },
    )

    return { text: value, audience: ['agent'] }
  }

  invariant(isRecord(value), `${source} MUST be an object.`, {
    code: 'INVALID_POLICY',
  })

  invariant(
    typeof value.text === 'string' && value.text.trim().length > 0,
    `${source}.text MUST be a non-empty string.`,
    { code: 'INVALID_POLICY' },
  )
  invariant(
    Array.isArray(value.audience) && value.audience.length > 0,
    `${source}.audience MUST be a non-empty array.`,
    { code: 'INVALID_POLICY' },
  )

  const audiences: PolicyAudience[] = []
  const seen = new Set<string>()

  for (const [index, item] of value.audience.entries()) {
    invariant(
      typeof item === 'string' && item.length > 0,
      `${source}.audience[${index}] MUST be a non-empty string.`,
      { code: 'INVALID_POLICY' },
    )
    invariant(
      isPolicyAudience(item),
      `${source}.audience[${index}] MUST be one of ${POLICY_AUDIENCES.join(', ')}.`,
      { code: 'INVALID_POLICY' },
    )
    invariant(
      !seen.has(item),
      `${source}.audience MUST NOT contain duplicates.`,
      { code: 'INVALID_POLICY' },
    )
    seen.add(item)
    audiences.push(item)
  }

  // `harness` and `operator` suppress an instruction at every other audience,
  // so pairing either with a second audience renders the instruction nowhere.
  for (const exclusive of ['harness', 'operator'] as const) {
    invariant(
      !seen.has(exclusive) || seen.size === 1,
      `${source}.audience MUST NOT combine '${exclusive}' with another audience, ` +
        'because the card filter then renders the instruction nowhere.',
      { code: 'INVALID_POLICY' },
    )
  }

  invariant(
    value.excerpt === undefined || typeof value.excerpt === 'boolean',
    `${source}.excerpt MUST be a boolean when present.`,
    { code: 'INVALID_POLICY' },
  )

  return {
    text: value.text,
    audience: audiences,
    ...(value.excerpt === true ? { excerpt: true } : {}),
  }
}

/**
 * Validate a policy's `instructions` array and return each entry in object form
 * through `normalizePolicyInstruction`. Throws `PanError` `INVALID_POLICY` when
 * the value is not an array or an entry is invalid.
 */
export function normalizePolicyInstructions(
  value: unknown,
  source: string,
): PolicyInstruction[] {
  invariant(Array.isArray(value), `${source} MUST be an array.`, {
    code: 'INVALID_POLICY',
  })

  return value.map((item, index) =>
    normalizePolicyInstruction(item, `${source}[${index}]`),
  )
}

function normalizedPolicyInstruction(
  instruction: PolicyInstruction | string,
): PolicyInstruction {
  return typeof instruction === 'string'
    ? { text: instruction, audience: ['agent'] }
    : instruction
}

/**
 * Report whether an instruction renders on a card for the given audience. A
 * `harness` instruction never renders; an `operator` instruction renders only
 * on an operator card; a supervisor card shows `agent` and `supervisor`
 * instructions; an agent card shows only `agent` instructions.
 */
export function policyInstructionAppliesToCard(
  instruction: PolicyInstruction | string,
  audience: PolicyCardAudience,
): boolean {
  const normalized = normalizedPolicyInstruction(instruction)
  const audiences = new Set(normalized.audience)

  // Harness-only instructions live in JSON snapshots for audit and deterministic
  // coverage mapping, but they never render on a card.
  if (audiences.has('harness')) {
    return false
  }

  if (audience === 'operator') {
    return audiences.has('operator')
  }

  // Operator instructions require an explicit operator audience.
  if (audiences.has('operator')) {
    return false
  }

  if (audience === 'supervisor') {
    return audiences.has('agent') || audiences.has('supervisor')
  }

  return audiences.has('agent')
}

/**
 * Return the instructions, in object form, that render on a card for the given
 * audience, per `policyInstructionAppliesToCard`.
 */
export function filterPolicyInstructionsForCard(
  instructions: readonly (PolicyInstruction | string)[],
  audience: PolicyCardAudience,
): PolicyInstruction[] {
  return instructions
    .map(normalizedPolicyInstruction)
    .filter((instruction) =>
      policyInstructionAppliesToCard(instruction, audience),
    )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
