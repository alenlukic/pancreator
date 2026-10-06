/**
 * Whether each enabled host's projected hooks configuration still carries the
 * agent-index hooks.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { enabledHosts } from '../project-config/resolve.js'

const AGENT_INDEX_HOOK_MARKER = 'pan-hook-agent-index'

/** Each host's canonical hook source and the file projection writes from it. */
const HOOK_PROJECTIONS = [
  {
    host: 'cursor',
    source: 'library/cursor/hooks.json',
    target: '.cursor/hooks.json',
  },
  {
    host: 'vscode',
    source: 'library/vscode/hooks.json',
    target: '.github/hooks/pan-hooks.json',
  },
] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJsonFileOrNull(filePath: string): unknown {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

/** Hook event names whose entries include a command naming `marker`. */
function hookEventsWithMarker(document: unknown, marker: string): string[] {
  if (!isPlainObject(document) || !isPlainObject(document.hooks)) {
    return []
  }

  const events: string[] = []

  for (const [event, entries] of Object.entries(document.hooks)) {
    if (!Array.isArray(entries)) {
      continue
    }

    // Cursor entries name the script in `command`, VS Code ones in `bash`.
    const carriesMarker = entries.some(
      (entry) =>
        isPlainObject(entry) &&
        [entry.command, entry.bash].some(
          (command) => typeof command === 'string' && command.includes(marker),
        ),
    )

    if (carriesMarker) {
      events.push(event)
    }
  }

  return events
}

export interface AgentIndexHooksProjection {
  /** The projected hooks file, relative to the root. */
  path: string
  projected: boolean
  missing_events: string[]
}

export interface AgentIndexHooksStatus {
  /** True when every checked projection carries every canonical hook. */
  projected: boolean
  /** Canonical hook events some checked projection lacks. */
  missing_events: string[]
  projections: AgentIndexHooksProjection[]
}

function projectionStatus(
  root: string,
  source: string,
  target: string,
): AgentIndexHooksProjection | null {
  const canonical = readJsonFileOrNull(path.join(root, source))

  if (canonical === null) {
    return null
  }

  const requiredEvents = hookEventsWithMarker(
    canonical,
    AGENT_INDEX_HOOK_MARKER,
  )
  const projectedEvents = new Set(
    hookEventsWithMarker(
      readJsonFileOrNull(path.join(root, target)),
      AGENT_INDEX_HOOK_MARKER,
    ),
  )
  const missingEvents = requiredEvents.filter(
    (event) => !projectedEvents.has(event),
  )

  return {
    path: target,
    projected: missingEvents.length === 0,
    missing_events: missingEvents,
  }
}

function hostsToCheck(root: string): string[] {
  try {
    return enabledHosts(root)
  } catch {
    return ['cursor']
  }
}

/**
 * Whether the checkout's projected hooks files (`.cursor/hooks.json`, and
 * `.github/hooks/pan-hooks.json` when the vscode host is enabled) still wire
 * the agent-index hooks (`bin/pan-hook-agent-index`) their canonical sources
 * declare. Without them, no subagent ever registers in the agent index, and
 * `pan watch --agent` cannot tell an unregistered agent apart from a stalled
 * one. Returns null when no canonical source is present, which happens in a
 * unit-test temp root that carries no `library/` tree and therefore has
 * nothing to compare against.
 */
export function agentIndexHooksStatus(
  root: string,
): AgentIndexHooksStatus | null {
  const hosts = hostsToCheck(root)
  const projections = HOOK_PROJECTIONS.filter((entry) =>
    hosts.includes(entry.host),
  )
    .map((entry) => projectionStatus(root, entry.source, entry.target))
    .filter((entry): entry is AgentIndexHooksProjection => entry !== null)

  if (projections.length === 0) {
    return null
  }

  return {
    projected: projections.every((entry) => entry.projected),
    missing_events: [
      ...new Set(projections.flatMap((entry) => entry.missing_events)),
    ],
    projections,
  }
}
