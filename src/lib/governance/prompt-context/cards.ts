/** Governance sources for reminders, independent of session worktrees. */

import path from 'node:path'

import { sha256, readText } from '../../io.js'
import {
  isTargetInstallation,
  harnessPathPrefix,
} from '../../project-config.js'
import { listRunStates, runIsLive } from '../../state.js'
import type { RunState } from '../../types.js'
import { CARD_PATH } from './registry.js'

export interface ActiveCard {
  path: string
  sha256: string
}

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
 * Return the common operating card in workspace coordinates. A reminder has
 * no authority to select a session or a worktree from global runtime state.
 */
export function activeCard(root: string): ActiveCard {
  return workspaceCard(root, fallbackCard(root))
}
