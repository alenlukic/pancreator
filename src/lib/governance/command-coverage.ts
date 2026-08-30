import { readdirSync } from 'node:fs'
import path from 'node:path'

import { STANDALONE_MODES } from '../governance-card.js'
import { fileExists, readJson, readText } from '../io.js'
import { readPolicyLookupTable } from '../policies.js'

/**
 * Registry of canonical Cursor commands and how each one receives governance.
 *
 * Every command under `library/cursor/commands/` either runs a governance card
 * (`pan governance card --mode <mode>`) or is listed here as read-only. A
 * command that names a policy file by hand is rejected: the card is the only
 * delivery path, so no session can treat a policy reference as optional.
 */
export const COMMAND_GOVERNANCE_REGISTRY_PATH =
  'governance/registries/command_governance.json'

const CARD_STEP_PATTERN = /governance card --mode ([a-z0-9-]+)/gu
const SUPERVISOR_MODE = 'supervisor'
const POLICY_FILE_PATTERN = /governance\/policies\/[A-Z]+-\d{3}\.json/gu

interface CommandGovernanceRegistry {
  schema_version: 1
  /** Commands that read run or repository state and delegate nothing. */
  read_only_commands: string[]
  /** Commands that open a supervisor session and MUST run the supervisor card. */
  supervisor_commands: string[]
  /**
   * Commands whose card step is known to be missing until a named insertion
   * lands. Each entry is a warning until then and an error once the step exists.
   */
  pending_card_steps: Array<{ command: string; expires_with: string }>
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function loadRegistry(
  root: string,
  errors: string[],
): CommandGovernanceRegistry | null {
  const absolute = path.join(root, COMMAND_GOVERNANCE_REGISTRY_PATH)

  if (!fileExists(absolute)) {
    errors.push(`missing required file: ${COMMAND_GOVERNANCE_REGISTRY_PATH}`)
    return null
  }

  const value = readJson(absolute) as Partial<CommandGovernanceRegistry>

  if (
    value.schema_version !== 1 ||
    !isStringArray(value.read_only_commands) ||
    !isStringArray(value.supervisor_commands) ||
    !Array.isArray(value.pending_card_steps) ||
    !value.pending_card_steps.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { command?: unknown }).command === 'string' &&
        typeof (item as { expires_with?: unknown }).expires_with === 'string',
    )
  ) {
    errors.push(
      `${COMMAND_GOVERNANCE_REGISTRY_PATH} MUST declare schema_version 1, ` +
        'read_only_commands, supervisor_commands, and pending_card_steps',
    )
    return null
  }

  return value as CommandGovernanceRegistry
}

function listCommands(root: string): string[] {
  const directory = path.join(root, 'library', 'cursor', 'commands')

  if (!fileExists(directory)) {
    return []
  }

  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => entry.replace(/\.md$/u, ''))
    .sort()
}

function cardModesOf(content: string): string[] {
  return [...content.matchAll(CARD_STEP_PATTERN)].map((match) => match[1] ?? '')
}

/**
 * Deterministic guard: every canonical command delivers its governance through
 * a harness-resolved card or is an allowlisted read-only utility, and every
 * standalone mode is backed by the lookup table.
 */
export function validateCommandGovernance(
  root: string,
  errors: string[],
  warnings: string[],
): void {
  const registry = loadRegistry(root, errors)

  if (!registry) {
    return
  }

  const readOnly = new Set(registry.read_only_commands)
  const supervisor = new Set(registry.supervisor_commands)
  const pending = new Map(
    registry.pending_card_steps.map((item) => [
      item.command,
      item.expires_with,
    ]),
  )
  const commands = listCommands(root)
  const known = new Set(commands)

  for (const name of [...readOnly, ...supervisor, ...pending.keys()]) {
    if (!known.has(name)) {
      errors.push(
        `${COMMAND_GOVERNANCE_REGISTRY_PATH} names command '${name}', which ` +
          'does not exist under library/cursor/commands/',
      )
    }
  }

  for (const name of readOnly) {
    if (supervisor.has(name) || pending.has(name)) {
      errors.push(
        `${COMMAND_GOVERNANCE_REGISTRY_PATH} lists '${name}' as read-only ` +
          'and as a card-bearing command',
      )
    }
  }

  for (const name of commands) {
    const relative = `library/cursor/commands/${name}.md`
    const content = readText(path.join(root, relative))
    const modes = cardModesOf(content)
    // A policy path is a hand-delivery instruction only when the line tells the
    // session to read or inline it; a declared output path (for example the
    // generated LANG-001 policy the librarian writes) is not.
    const policyReferences = [
      ...new Set(
        content
          .split('\n')
          .filter((line) => /\b(?:read|inline)\b/iu.test(line))
          .flatMap((line) => line.match(POLICY_FILE_PATTERN) ?? []),
      ),
    ]

    if (readOnly.has(name)) {
      if (modes.length > 0) {
        errors.push(
          `${relative} runs a governance card but ${COMMAND_GOVERNANCE_REGISTRY_PATH} ` +
            'lists it as read-only; remove it from read_only_commands',
        )
      }

      continue
    }

    if (policyReferences.length > 0) {
      errors.push(
        `${relative} references ${policyReferences.join(', ')} by file path; ` +
          'a command MUST deliver policies through `pan governance card --mode <mode>`, ' +
          'never by telling the session to read a policy file',
      )
    }

    const expectedMode = supervisor.has(name) ? SUPERVISOR_MODE : null

    if (modes.length === 0) {
      const expiresWith = pending.get(name)

      if (expiresWith !== undefined) {
        warnings.push(
          `${relative} has no governance card step yet (pending: ${expiresWith}); ` +
            `it MUST run \`pan governance card --mode ${expectedMode ?? '<mode>'}\``,
        )
        continue
      }

      errors.push(
        `${relative} delivers no governance card. Add a step that runs ` +
          `\`pan governance card --mode ${expectedMode ?? '<mode>'}\` as its first ` +
          `action, or list the command in ${COMMAND_GOVERNANCE_REGISTRY_PATH} ` +
          'read_only_commands when it reads state and delegates nothing',
      )
      continue
    }

    if (pending.has(name)) {
      errors.push(
        `${relative} now runs a governance card; remove its ` +
          `pending_card_steps entry from ${COMMAND_GOVERNANCE_REGISTRY_PATH}`,
      )
    }

    for (const mode of modes) {
      if (!(mode in STANDALONE_MODES)) {
        errors.push(
          `${relative} runs \`governance card --mode ${mode}\`, which is not a ` +
            `registered mode (${Object.keys(STANDALONE_MODES).sort().join(', ')})`,
        )
      }
    }

    if (expectedMode && !modes.includes(expectedMode)) {
      errors.push(
        `${relative} opens a supervisor session and MUST run ` +
          `\`pan governance card --mode ${SUPERVISOR_MODE} --run <run-id>\``,
      )
    }

    if (
      !expectedMode &&
      modes.includes(SUPERVISOR_MODE) &&
      !supervisor.has(name)
    ) {
      // A non-supervisor command may still mention the supervisor card when it
      // drives a run (for example workflow QA). It is not an error, but the
      // command still needs its own mode card.
      const ownModes = modes.filter((mode) => mode !== SUPERVISOR_MODE)

      if (ownModes.length === 0) {
        errors.push(
          `${relative} runs only the supervisor card; a non-supervisor command ` +
            'MUST run its own mode card as well',
        )
      }
    }
  }

  // Every standalone mode resolves persona-specific governance, and every
  // standalone lookup row names a stage some mode declares.
  let lookup: ReturnType<typeof readPolicyLookupTable>

  try {
    lookup = readPolicyLookupTable(root)
  } catch {
    // A malformed lookup table is reported by the policy validator; the
    // mode-to-row check has nothing sound to compare against.
    return
  }

  const modeStages = new Map<string, string>()

  for (const [name, mode] of Object.entries(STANDALONE_MODES)) {
    if (mode.workflow !== 'standalone' || mode.stage === '*') {
      continue
    }

    modeStages.set(mode.stage, name)

    const covered = lookup.rows.some(
      (row) =>
        row.persona === mode.persona &&
        (row.workflow === '*' || row.workflow === 'standalone') &&
        (row.stage === '*' || row.stage === mode.stage),
    )

    if (!covered) {
      errors.push(
        `standalone mode '${name}' (persona ${mode.persona}, stage ${mode.stage}) ` +
          'has no persona-specific row in governance/registries/policy_lookup_table.json',
      )
    }
  }

  for (const row of lookup.rows) {
    if (row.workflow !== 'standalone' || row.stage === '*') {
      continue
    }

    if (!modeStages.has(row.stage)) {
      errors.push(
        `policy_lookup_table.json row (persona ${row.persona}, workflow standalone, ` +
          `stage ${row.stage}) names a stage no STANDALONE_MODES entry declares`,
      )
    }
  }
}
