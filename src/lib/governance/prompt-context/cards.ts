/**
 * The active card a reminder cites: the live run's supervisor card, the
 * newest standalone mode card, or the operating card, as the workspace names
 * it.
 */

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { sha256, readText, fileExists } from '../../io.js'
import {
  isTargetInstallation,
  harnessPathPrefix,
} from '../../project-config.js'
import { listRunStates, runIsLive } from '../../state.js'
import type { RunState } from '../../types.js'
import { CARD_PATH, type TurnReminderRole } from './registry.js'

export interface ActiveCard {
  path: string
  sha256: string
}
const STANDALONE_SESSION_ROOT = 'runtime/logs/sessions'

/**
 * Return the live runs of the workspace, most recently updated first.
 */
export function liveRuns(root: string): RunState[] {
  return listRunStates(root)
    .filter(runIsLive)
    .sort(
      (left, right) =>
        Date.parse(right.updated_at) - Date.parse(left.updated_at),
    )
}

/**
 * Return the operating card `AGENTS.md` with its current SHA-256 digest. Throws
 * when the file cannot be read.
 */
export function fallbackCard(root: string): ActiveCard {
  return {
    path: CARD_PATH,
    sha256: sha256(readText(path.join(root, CARD_PATH))),
  }
}

function supervisorCard(runs: RunState[]): ActiveCard | null {
  for (const run of runs) {
    const card = run.supervisor_card

    if (card) {
      return { path: card.path, sha256: card.sha256 }
    }
  }

  return null
}

function latestStandaloneCard(root: string, mode: string): ActiveCard | null {
  const sessions = path.join(root, STANDALONE_SESSION_ROOT)
  const filename = `${mode}-card.md`
  let latest: { path: string; mtimeMs: number } | null = null

  try {
    for (const entry of readdirSync(sessions, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }

      const absolute = path.join(sessions, entry.name, filename)

      if (!fileExists(absolute)) {
        continue
      }

      const mtimeMs = statSync(absolute).mtimeMs

      if (!latest || mtimeMs > latest.mtimeMs) {
        latest = {
          path: path.posix.join(STANDALONE_SESSION_ROOT, entry.name, filename),
          mtimeMs,
        }
      }
    }
  } catch {
    return null
  }

  if (!latest) {
    return null
  }

  return {
    path: latest.path,
    sha256: sha256(readText(path.join(root, latest.path))),
  }
}

/**
 * Cursor runs the hook from the target workspace, so an installed harness
 * cites its card by the path an agent there can open: under `.pancreator/`
 * for an embedded harness, and under the absolute harness root for a
 * detached one. Self-development already runs at the harness root.
 */
function workspaceCard(root: string, card: ActiveCard): ActiveCard {
  if (!isTargetInstallation(root)) {
    return card
  }

  return {
    path: path.join(harnessPathPrefix(root), card.path),
    sha256: card.sha256,
  }
}

/**
 * Return the card a turn reminder cites for a role: for a supervisor role, the
 * newest live run's supervisor card; for any other role, the newest session
 * card of `mode` under `runtime/logs/sessions/`. Either falls back to
 * `AGENTS.md`. In a target installation the path is rewritten to one an agent
 * in the target workspace can open.
 */
export function activeCard(
  root: string,
  role: Exclude<TurnReminderRole, 'none'>,
  mode: string | null,
  runs: RunState[],
): ActiveCard {
  const card =
    role === 'regular-supervisor' ||
    role === 'cohort-supervisor' ||
    role === 'long-horizon-supervisor'
      ? (supervisorCard(runs) ?? fallbackCard(root))
      : ((mode ? latestStandaloneCard(root, mode) : null) ?? fallbackCard(root))

  return workspaceCard(root, card)
}
