import { invariant } from './errors.js'
import type {
  PolicyAudience,
  PolicyInstruction,
  PolicyCapabilities,
  PolicyLoad,
} from './types.js'

export type PolicyCardAudience = 'agent' | 'supervisor' | 'operator'

/** Tool classes a `tool:<class>` load trigger can name. */
export const POLICY_LOAD_TOOL_CLASSES = [
  'shell',
  'delegation',
  'browser',
  'edit',
  'git-remote',
  'question',
] as const

/** Harness and host events an `event:<id>` load trigger can name. */
export const POLICY_LOAD_EVENTS = [
  'tool_failure',
  'gate_failure',
  'validator_failure',
  'stall',
  'pause',
  'resume',
  'retry',
  'submit',
  'operator_override',
] as const

/**
 * Policies whose instructions stay on the card at invocation. They carry
 * invariants, first-response conduct, or irreversible-action prohibitions, so
 * deferring a clause would let a session act before it read the rule.
 */
export const EAGER_ONLY_POLICY_IDS: readonly string[] = [
  'PRINCIPLES-001',
  'OPERATOR-001',
  'ACTION-001',
  'COMMS-001',
  'MOMENTUM-001',
]

/**
 * Context a caller supplies when normalizing: the owning policy id, for the
 * eager-only check, and a policy-level default `load` that applies to every
 * object-form instruction that does not set its own.
 */
export interface PolicyInstructionOptions {
  policyId?: string
  defaultLoad?: unknown
}

const MCP_TOOL_CLASS = /^mcp:[A-Za-z0-9][A-Za-z0-9_.-]*$/u

/**
 * Report whether a string is a valid load trigger: `invocation`,
 * `tool:<class>` (a known class or `mcp:<name>`), `event:<id>` (a known
 * event), or `path:<glob>` (a safe, non-empty, workspace-relative glob).
 */
export function isPolicyLoad(value: unknown): value is PolicyLoad {
  if (typeof value !== 'string') {
    return false
  }

  if (value === 'invocation') {
    return true
  }

  if (value.startsWith('tool:')) {
    const toolClass = value.slice('tool:'.length)

    return (
      (POLICY_LOAD_TOOL_CLASSES as readonly string[]).includes(toolClass) ||
      MCP_TOOL_CLASS.test(toolClass)
    )
  }

  if (value.startsWith('event:')) {
    return (POLICY_LOAD_EVENTS as readonly string[]).includes(
      value.slice('event:'.length),
    )
  }

  if (value.startsWith('path:')) {
    const glob = value.slice('path:'.length)

    return (
      glob.length > 0 &&
      !glob.startsWith('/') &&
      !glob.split(/[\\/]/u).includes('..')
    )
  }

  return false
}

/** Return the effective trigger for an instruction; absent means `invocation`. */
export function policyInstructionLoad(
  instruction: PolicyInstruction | string,
): PolicyLoad {
  return typeof instruction === 'string'
    ? 'invocation'
    : (instruction.load ?? 'invocation')
}

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
  options: PolicyInstructionOptions = {},
): PolicyInstruction {
  if (typeof value === 'string') {
    invariant(
      value.trim().length > 0,
      `${source} MUST be a non-empty string.`,
      { code: 'INVALID_POLICY' },
    )

    // A policy-level `load` default applies to the string form too, so the
    // string is read as the equivalent object and takes the same path.
    if (options.defaultLoad === undefined) {
      return { text: value, audience: ['agent'] }
    }

    value = { text: value, audience: ['agent'] }
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
  if (value.capabilities !== undefined) {
    invariant(
      isRecord(value.capabilities) &&
        Object.keys(value.capabilities).length > 0 &&
        Object.entries(value.capabilities).every(
          ([key, required]) =>
            (key === 'shell' || key === 'delegation') &&
            typeof required === 'boolean',
        ),
      `${source}.capabilities MUST contain only boolean shell or delegation predicates.`,
      { code: 'INVALID_POLICY' },
    )
  }

  const load = value.load ?? options.defaultLoad
  if (load !== undefined) {
    invariant(
      isPolicyLoad(load),
      `${source}.load MUST be invocation, tool:<class>, event:<id>, or path:<glob> ` +
        `with a known class or event.`,
      { code: 'INVALID_POLICY' },
    )
    invariant(
      load === 'invocation' ||
        options.policyId === undefined ||
        !EAGER_ONLY_POLICY_IDS.includes(options.policyId),
      `${source}.load MUST stay invocation on ${options.policyId}, ` +
        'whose clauses carry invariants or first-response conduct.',
      { code: 'INVALID_POLICY' },
    )
  }

  return {
    text: value.text,
    audience: audiences,
    // `invocation` is the default, so it is omitted to keep snapshots stable.
    ...(typeof load === 'string' && load !== 'invocation'
      ? { load: load as PolicyLoad }
      : {}),
    ...(value.excerpt === true ? { excerpt: true } : {}),
    ...(isRecord(value.capabilities)
      ? { capabilities: value.capabilities }
      : {}),
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
  options: PolicyInstructionOptions = {},
): PolicyInstruction[] {
  invariant(Array.isArray(value), `${source} MUST be an array.`, {
    code: 'INVALID_POLICY',
  })

  return value.map((item, index) =>
    normalizePolicyInstruction(item, `${source}[${index}]`, options),
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
  capabilities?: PolicyCapabilities,
): boolean {
  const normalized = normalizedPolicyInstruction(instruction)
  const audiences = new Set(normalized.audience)
  if (
    capabilities &&
    Object.entries(normalized.capabilities ?? {}).some(
      ([key, required]) =>
        capabilities[key as keyof PolicyCapabilities] !== required,
    )
  ) {
    return false
  }

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
  capabilities?: PolicyCapabilities,
): PolicyInstruction[] {
  return instructions
    .map(normalizedPolicyInstruction)
    .filter((instruction) =>
      policyInstructionAppliesToCard(instruction, audience, capabilities),
    )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
