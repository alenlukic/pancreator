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

export function policyInstructionText(
  instruction: PolicyInstruction | string,
): string {
  return typeof instruction === 'string' ? instruction : instruction.text
}

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

  return {
    text: value.text,
    audience: audiences,
  }
}

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
