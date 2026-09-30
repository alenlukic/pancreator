/**
 * The bound of a ship repair: a failed land may be repaired in place, without
 * a remediate round, only when the fix is a small change to lane tests.
 *
 * The limit of three paths is a cost rule. A larger or wider fix earns the
 * remediate stage's review and its full verify round.
 */
import { gitChangedPathsBetweenCommits } from './git.js'

export const SHIP_REPAIR_MAX_PATHS = 3

/** Lane test directories a ship repair may change, and the profile each needs. */
const LANE_PROFILES: ReadonlyArray<readonly [string, string]> = [
  ['tests/unit/', 'fast'],
  ['tests/regression/', 'fast'],
  ['tests/integration/', 'impacted-integration'],
  ['tests/secondary/', 'secondary'],
]

export type ShipRepairBound =
  | { within: true; paths: string[] }
  | { within: false; paths: string[]; reason: string }

function laneProfile(relativePath: string): string | null {
  return (
    LANE_PROFILES.find(([prefix]) => relativePath.startsWith(prefix))?.[1] ??
    null
  )
}

/** Judge the paths a repair changed against the ship repair bound. */
export function judgeShipRepair(paths: readonly string[]): ShipRepairBound {
  const sorted = [...paths].sort()

  if (sorted.length === 0) {
    return {
      within: false,
      paths: sorted,
      reason: 'the repair changed no path',
    }
  }

  if (sorted.length > SHIP_REPAIR_MAX_PATHS) {
    return {
      within: false,
      paths: sorted,
      reason: `the repair changed ${sorted.length} paths; the bound is ${SHIP_REPAIR_MAX_PATHS}`,
    }
  }

  const outside = sorted.filter((entry) => laneProfile(entry) === null)

  return outside.length === 0
    ? { within: true, paths: sorted }
    : {
        within: false,
        paths: sorted,
        reason: `the repair changed paths outside the lane test directories: ${outside.join(', ')}`,
      }
}

/** Paths the commits above a finalized release's index commit changed. */
export function shipRepairPaths(
  worktreePath: string,
  indexCommit: string,
  head = 'HEAD',
): string[] {
  return gitChangedPathsBetweenCommits(worktreePath, indexCommit, head, {
    detectRenames: false,
  })
}

/** The verify profiles a bounded repair owes beyond `static` and `configuration`. */
export function shipRepairLaneProfiles(paths: readonly string[]): string[] {
  return [
    ...new Set(
      paths
        .map(laneProfile)
        .filter((profile): profile is string => profile !== null),
    ),
  ]
}
