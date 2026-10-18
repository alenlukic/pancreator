import path from 'node:path'

import { invariant } from './errors.js'
import { fileExists, isRecord, readJson } from './io.js'

/** Every agent host a tool name can belong to. */
export const AGENT_HOSTS = ['cursor', 'vscode', 'copilot-cli'] as const

export type AgentHost = (typeof AGENT_HOSTS)[number]

/** Neutral tool terms that policies, hooks, and validators share. */
export const HOST_TOOL_TERMS = [
  'question_tool',
  'platform_await',
  'subagent_launch',
  'agent_session',
  'shell',
] as const

export type HostToolTerm = (typeof HOST_TOOL_TERMS)[number]

export interface BackgroundLaunch {
  argument: string
  value: unknown
}

export interface ShellCallBounds {
  argument: string
  unit: 'milliseconds' | 'seconds'
  minimum: number | null
  maximum: number | null
  ordinary: number
  watch: number
}

/** Null extrema mean no independently available host schema establishes them. */
export const HOST_SHELL_SCHEMAS = {
  cursor: {
    argument: 'block_until_ms',
    unit: 'milliseconds',
    minimum: null,
    maximum: null,
  },
  vscode: {
    argument: 'timeout',
    unit: 'milliseconds',
    minimum: null,
    maximum: null,
  },
  'copilot-cli': {
    argument: 'initial_wait',
    unit: 'seconds',
    minimum: 30,
    maximum: 600,
  },
} as const

export interface HostToolEntry {
  description: string
  owning_policy: string
  tools: Record<AgentHost, string[]>
  aliases: string[]
  /** Per host, the launch argument that runs a subagent in the background. */
  background: Record<AgentHost, BackgroundLaunch | null> | null
  /**
   * Per host, tools the term covers only when the named argument is set; a
   * tool absent here is covered on every call.
   */
  when_argument: Partial<Record<AgentHost, Record<string, string>>>
  pending_probes: Partial<Record<AgentHost, string>>
  bounds: Record<AgentHost, ShellCallBounds> | null
}

export interface HostToolRegistry {
  schema_version: 1
  policy: string
  terms: Record<HostToolTerm, HostToolEntry>
}

export const HOST_TOOLS_PATH = 'governance/registries/host_tools.json'

function isAgentHost(value: string): value is AgentHost {
  return (AGENT_HOSTS as readonly string[]).includes(value)
}

function nameList(value: unknown, label: string): string[] {
  invariant(
    Array.isArray(value) &&
      value.every((entry) => typeof entry === 'string' && entry.length > 0),
    `${HOST_TOOLS_PATH}: ${label} MUST be an array of non-empty strings`,
    { code: 'INVALID_HOST_TOOLS' },
  )

  return value as string[]
}

function perHost<T>(
  value: unknown,
  label: string,
  read: (entry: unknown, host: AgentHost) => T,
): Record<AgentHost, T> {
  invariant(isRecord(value), `${HOST_TOOLS_PATH}: ${label} MUST be an object`, {
    code: 'INVALID_HOST_TOOLS',
  })

  const keys = Object.keys(value)

  invariant(
    keys.length === AGENT_HOSTS.length && keys.every(isAgentHost),
    `${HOST_TOOLS_PATH}: ${label} MUST name exactly ${AGENT_HOSTS.join(', ')}`,
    { code: 'INVALID_HOST_TOOLS' },
  )

  return Object.fromEntries(
    AGENT_HOSTS.map((host) => [host, read(value[host], host)]),
  ) as Record<AgentHost, T>
}

function backgroundLaunch(
  value: unknown,
  label: string,
): BackgroundLaunch | null {
  if (value === null) {
    return null
  }

  invariant(
    isRecord(value) &&
      typeof value.argument === 'string' &&
      value.argument.length > 0 &&
      'value' in value,
    `${HOST_TOOLS_PATH}: ${label} MUST be null or { argument, value }`,
    { code: 'INVALID_HOST_TOOLS' },
  )

  return { argument: value.argument, value: value.value }
}

function parseEntry(term: HostToolTerm, value: unknown): HostToolEntry {
  invariant(isRecord(value), `${HOST_TOOLS_PATH}: ${term} MUST be an object`, {
    code: 'INVALID_HOST_TOOLS',
  })
  invariant(
    typeof value.description === 'string' && value.description.length > 0,
    `${HOST_TOOLS_PATH}: ${term}.description MUST be non-empty`,
    { code: 'INVALID_HOST_TOOLS' },
  )
  invariant(
    typeof value.owning_policy === 'string' &&
      /^[A-Z]+-\d{3}$/u.test(value.owning_policy),
    `${HOST_TOOLS_PATH}: ${term}.owning_policy MUST be a policy id`,
    { code: 'INVALID_HOST_TOOLS' },
  )

  const pending = value.pending_probes ?? {}

  invariant(
    isRecord(pending) &&
      Object.entries(pending).every(
        ([host, note]) => isAgentHost(host) && typeof note === 'string',
      ),
    `${HOST_TOOLS_PATH}: ${term}.pending_probes MUST map hosts to notes`,
    { code: 'INVALID_HOST_TOOLS' },
  )

  const tools = perHost(value.tools, `${term}.tools`, (entry, host) =>
    nameList(entry ?? null, `${term}.tools.${host}`),
  )
  const conditions = value.when_argument ?? {}

  invariant(
    isRecord(conditions) &&
      Object.entries(conditions).every(
        ([host, byTool]) =>
          isAgentHost(host) &&
          isRecord(byTool) &&
          Object.entries(byTool).every(
            ([tool, argument]) =>
              tools[host].includes(tool) &&
              typeof argument === 'string' &&
              argument.length > 0,
          ),
      ),
    `${HOST_TOOLS_PATH}: ${term}.when_argument MUST map hosts to { tool: argument } for tools the host lists`,
    { code: 'INVALID_HOST_TOOLS' },
  )

  return {
    description: value.description,
    owning_policy: value.owning_policy,
    tools,
    aliases:
      value.aliases === undefined
        ? []
        : nameList(value.aliases, `${term}.aliases`),
    background:
      value.background === undefined
        ? null
        : perHost(value.background, `${term}.background`, (entry, host) =>
            backgroundLaunch(entry ?? null, `${term}.background.${host}`),
          ),
    when_argument: conditions as Partial<
      Record<AgentHost, Record<string, string>>
    >,
    pending_probes: pending as Partial<Record<AgentHost, string>>,
    bounds:
      term !== 'shell'
        ? null
        : perHost(value.bounds, 'shell.bounds', (entry, host) => {
            invariant(
              isRecord(entry) &&
                typeof entry.argument === 'string' &&
                entry.argument.length > 0 &&
                (entry.unit === 'milliseconds' || entry.unit === 'seconds') &&
                (entry.minimum === null || typeof entry.minimum === 'number') &&
                (entry.maximum === null || typeof entry.maximum === 'number') &&
                typeof entry.ordinary === 'number' &&
                typeof entry.watch === 'number' &&
                [entry.ordinary, entry.watch].every(
                  (number) => Number.isFinite(number) && number > 0,
                ),
              `${HOST_TOOLS_PATH}: shell.bounds.${host} MUST declare positive calls and numeric or unknown tool bounds`,
              { code: 'INVALID_HOST_TOOLS' },
            )
            const bounds: ShellCallBounds = {
              argument: entry.argument,
              unit: entry.unit,
              minimum: entry.minimum,
              maximum: entry.maximum,
              ordinary: entry.ordinary,
              watch: entry.watch,
            }
            const schema = HOST_SHELL_SCHEMAS[host]
            invariant(
              bounds.argument === schema.argument &&
                bounds.unit === schema.unit &&
                bounds.minimum === schema.minimum &&
                bounds.maximum === schema.maximum &&
                (bounds.minimum === null ||
                  (bounds.minimum <= bounds.ordinary &&
                    bounds.minimum <= bounds.watch)) &&
                (bounds.maximum === null ||
                  (bounds.ordinary <= bounds.maximum &&
                    bounds.watch <= bounds.maximum)) &&
                // Without schema extrema, project only the conservative
                // ordinary example supported by the operating contract.
                (schema.minimum !== null || bounds.ordinary === 5000) &&
                bounds.watch * (bounds.unit === 'seconds' ? 1000 : 1) ===
                  330_000,
              `${HOST_TOOLS_PATH}: shell.bounds.${host} projection is outside the tool range or changes the watch bound`,
              { code: 'INVALID_HOST_TOOLS' },
            )
            return bounds
          }),
  }
}

/** Validate a parsed host tool registry and return its typed form. */
export function parseHostToolRegistry(value: unknown): HostToolRegistry {
  invariant(
    isRecord(value) && value.schema_version === 1,
    `${HOST_TOOLS_PATH}: schema_version MUST be 1`,
    { code: 'INVALID_HOST_TOOLS' },
  )
  invariant(
    value.policy === 'CONTRACT-001',
    `${HOST_TOOLS_PATH}: policy MUST be CONTRACT-001`,
    { code: 'INVALID_HOST_TOOLS' },
  )
  const hosts: unknown[] = Array.isArray(value.hosts) ? value.hosts : []

  invariant(
    hosts.length === AGENT_HOSTS.length &&
      AGENT_HOSTS.every((host, index) => hosts[index] === host),
    `${HOST_TOOLS_PATH}: hosts MUST be ${AGENT_HOSTS.join(', ')}`,
    { code: 'INVALID_HOST_TOOLS' },
  )
  invariant(
    isRecord(value.terms),
    `${HOST_TOOLS_PATH}: terms MUST be an object`,
    {
      code: 'INVALID_HOST_TOOLS',
    },
  )

  const terms = value.terms

  invariant(
    Object.keys(terms).length === HOST_TOOL_TERMS.length &&
      HOST_TOOL_TERMS.every((term) => term in terms),
    `${HOST_TOOLS_PATH}: terms MUST be exactly ${HOST_TOOL_TERMS.join(', ')}`,
    { code: 'INVALID_HOST_TOOLS' },
  )

  return {
    schema_version: 1,
    policy: value.policy,
    terms: Object.fromEntries(
      HOST_TOOL_TERMS.map((term) => [term, parseEntry(term, terms[term])]),
    ) as Record<HostToolTerm, HostToolEntry>,
  }
}

/** Load the host tool registry under `root`. Throws `INVALID_HOST_TOOLS`. */
export function loadHostToolRegistry(root: string): HostToolRegistry {
  const absolute = path.join(root, HOST_TOOLS_PATH)

  invariant(fileExists(absolute), `missing required file: ${HOST_TOOLS_PATH}`, {
    code: 'INVALID_HOST_TOOLS',
  })

  return parseHostToolRegistry(readJson(absolute))
}

/** Every tool name a term carries on any host, without its aliases. */
export function allHostToolNames(
  registry: HostToolRegistry,
  term: HostToolTerm,
): string[] {
  const entry = registry.terms[term]

  return [...new Set(AGENT_HOSTS.flatMap((host) => entry.tools[host]))]
}

/**
 * Terms whose Cursor tool name projected prose MAY rewrite to another host's
 * name. Each maps one tool to one tool with the same contract; the subagent,
 * await, and shell terms differ in contract per host, so prose names them.
 */
export const TRANSLATED_HOST_TOOL_TERMS = [
  'question_tool',
] as const satisfies readonly HostToolTerm[]

/** Cursor-to-host tool name pairs for every translated term `host` names. */
export function hostToolTranslations(
  registry: HostToolRegistry,
  host: AgentHost,
): Array<[string, string]> {
  return TRANSLATED_HOST_TOOL_TERMS.flatMap((term): Array<[string, string]> => {
    const cursorName = registry.terms[term].tools.cursor[0]
    const hostName = registry.terms[term].tools[host][0]

    return cursorName && hostName && cursorName !== hostName
      ? [[cursorName, hostName]]
      : []
  })
}

/**
 * Registry drift against the owning policy: each host tool name MUST appear in
 * that policy's summary or instructions, so the rule an agent reads names the
 * tool the hooks enforce.
 */
export function hostToolPolicyIssues(
  registry: HostToolRegistry,
  policyText: (policyId: string) => string | null,
): string[] {
  const issues: string[] = []

  for (const term of HOST_TOOL_TERMS) {
    const entry = registry.terms[term]
    const text = policyText(entry.owning_policy)

    if (text === null) {
      issues.push(
        `${HOST_TOOLS_PATH}: ${term} names missing owning policy ${entry.owning_policy}`,
      )
      continue
    }

    for (const name of allHostToolNames(registry, term)) {
      if (!text.includes(`\`${name}\``)) {
        issues.push(
          `${HOST_TOOLS_PATH}: ${entry.owning_policy} does not name ${term} tool \`${name}\``,
        )
      }
    }
  }

  return issues
}
