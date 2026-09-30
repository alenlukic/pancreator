/**
 * Whether the projected Cursor hooks configuration still carries the
 * agent-index hooks.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const AGENT_INDEX_HOOK_MARKER = 'pan-hook-agent-index'

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

    const carriesMarker = entries.some(
      (entry) =>
        isPlainObject(entry) &&
        typeof entry.command === 'string' &&
        entry.command.includes(marker),
    )

    if (carriesMarker) {
      events.push(event)
    }
  }

  return events
}

export interface AgentIndexHooksStatus {
  /** True when the projected file carries every canonical agent-index hook. */
  projected: boolean
  /** Canonical hook events whose agent-index entry the projected file lacks. */
  missing_events: string[]
}

/**
 * Whether the checkout's projected `.cursor/hooks.json` still wires the
 * agent-index hooks (`bin/pan-hook-agent-index`) that `library/cursor/hooks.json`
 * declares. Without them, no subagent ever registers in the agent index, and
 * `pan watch --agent` cannot tell an unregistered agent apart from a stalled
 * one. Returns null when the canonical source is absent, which happens in a
 * unit-test temp root that carries no `library/` tree and therefore has
 * nothing to compare against.
 */
export function agentIndexHooksStatus(
  root: string,
): AgentIndexHooksStatus | null {
  const canonical = readJsonFileOrNull(
    path.join(root, 'library', 'cursor', 'hooks.json'),
  )

  if (canonical === null) {
    return null
  }

  const requiredEvents = hookEventsWithMarker(
    canonical,
    AGENT_INDEX_HOOK_MARKER,
  )

  if (requiredEvents.length === 0) {
    return { projected: true, missing_events: [] }
  }

  const projected = readJsonFileOrNull(path.join(root, '.cursor', 'hooks.json'))

  if (projected === null) {
    return { projected: false, missing_events: requiredEvents }
  }

  const projectedEvents = new Set(
    hookEventsWithMarker(projected, AGENT_INDEX_HOOK_MARKER),
  )
  const missingEvents = requiredEvents.filter(
    (event) => !projectedEvents.has(event),
  )

  return {
    projected: missingEvents.length === 0,
    missing_events: missingEvents,
  }
}
