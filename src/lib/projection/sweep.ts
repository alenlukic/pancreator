/**
 * Orphan-sweep guard for host directories a target repository may also own.
 */

import { spawnSync } from 'node:child_process'

/**
 * The candidates under `directory` that an orphan sweep may delete. Git never
 * reports a tracked file as ignored, so a target-tracked `pan-*` file stays,
 * while a projection the clone-local exclusions or `.gitignore` cover goes.
 * Outside a Git work tree every candidate is sweepable.
 */
export function sweepableCandidates(
  directory: string,
  candidates: readonly string[],
): Set<string> {
  if (candidates.length === 0) {
    return new Set()
  }

  const result = spawnSync(
    'git',
    ['-C', directory, 'check-ignore', '--stdin', '-z'],
    { input: candidates.join('\0'), encoding: 'utf8' },
  )

  if (result.status !== 0 && result.status !== 1) {
    return new Set(candidates)
  }

  return new Set(result.stdout.split('\0').filter(Boolean))
}
