/**
 * `CLEANUP_ARTIFACT_CLASSES`, the single inventory of the harness-owned
 * runtime classes cleanup may touch, and the cleanup plan, option, and result
 * shapes.
 */

import type { InboxReconciliationMove } from '../inbox.js'

/**
 * `archive_then_delete` names a class `pan archive` moves into an `archive/`
 * child first; the deletion tier reaches both the active root and that child.
 * `delete` names a class with no archive tier.
 */
export type CleanupDisposal =
  | 'archive_then_delete'
  | 'delete'
  | 'remove_worktree'
  | 'retain'

/**
 * `temporal_name` reads age from the sortable UTC name a run, session, or
 * standardized file carries, so both retention tiers agree on what is old; a
 * name without one falls back to `mtime`.
 */
export type CleanupAgeSource = 'mtime' | 'temporal_name' | 'created_at' | 'none'

export interface CleanupArtifactClass {
  name: string
  paths: string[]
  age_source: CleanupAgeSource
  disposal: CleanupDisposal
  /**
   * Entry names under this class's paths that planning never inspects or
   * lists, such as a navigation symlink a producer refreshes in place. A
   * plain `mtime`/`statSync` age check would otherwise judge the symlink by
   * its live target's age, which a concurrent deletion of that same target
   * could also race.
   */
  skip?: readonly string[]
}

/**
 * One inventory of the harness-owned state cleanup may touch. Durable entries
 * stay visible as retained so adding a broad sweep cannot silently absorb them.
 */
export const CLEANUP_ARTIFACT_CLASSES: readonly CleanupArtifactClass[] = [
  {
    name: 'workflow-runs',
    paths: ['runtime/logs/workflows', 'runtime/workflows'],
    age_source: 'temporal_name',
    disposal: 'archive_then_delete',
  },
  {
    name: 'standalone-sessions',
    paths: ['runtime/logs/sessions'],
    age_source: 'temporal_name',
    disposal: 'archive_then_delete',
  },
  {
    name: 'best-of-n',
    paths: ['runtime/logs/best-of-n'],
    age_source: 'temporal_name',
    disposal: 'archive_then_delete',
  },
  {
    name: 'cohorts',
    paths: ['runtime/logs/cohorts'],
    age_source: 'mtime',
    disposal: 'archive_then_delete',
  },
  {
    name: 'traces',
    paths: ['runtime/logs/traces'],
    age_source: 'mtime',
    disposal: 'archive_then_delete',
  },
  {
    name: 'evals',
    paths: ['runtime/logs/evals'],
    age_source: 'mtime',
    disposal: 'archive_then_delete',
  },
  {
    name: 'horizon',
    paths: ['runtime/logs/horizon'],
    age_source: 'mtime',
    disposal: 'archive_then_delete',
  },
  {
    name: 'hypervisor',
    paths: ['runtime/logs/hypervisor'],
    age_source: 'mtime',
    disposal: 'archive_then_delete',
  },
  {
    name: 'away-mode',
    paths: ['runtime/logs/away-mode'],
    age_source: 'mtime',
    disposal: 'archive_then_delete',
  },
  {
    name: 'orchestrator-events',
    paths: ['runtime/logs/events'],
    age_source: 'mtime',
    disposal: 'archive_then_delete',
  },
  // Also owns inbox housekeeping across every lifecycle directory: status
  // reconciliation, legacy loose-file relocation, and temporal renames. The
  // open `queue/` and `active/` directories never appear in `paths`, so no
  // retention window reaches them.
  {
    name: 'inbox-history',
    paths: [
      'runtime/inbox/complete',
      'runtime/inbox/canceled',
      'runtime/inbox/archive',
    ],
    age_source: 'temporal_name',
    disposal: 'archive_then_delete',
  },
  {
    name: 'pr-descriptions',
    paths: ['runtime/pr-descriptions'],
    age_source: 'temporal_name',
    disposal: 'archive_then_delete',
  },
  {
    name: 'research',
    paths: ['runtime/research'],
    age_source: 'temporal_name',
    disposal: 'archive_then_delete',
  },
  {
    name: 'benchmarks',
    paths: ['runtime/benchmarks'],
    age_source: 'temporal_name',
    disposal: 'archive_then_delete',
  },
  // `tests.noindex` is listed on its own so each suite run directory inside it
  // is judged by its own owner marker rather than by the shared parent.
  {
    name: 'scratch',
    paths: [
      'runtime/tmp',
      'runtime/tmp/tests.noindex',
      'runtime/cache/output-validate',
    ],
    age_source: 'mtime',
    disposal: 'delete',
  },
  {
    name: 'worktrees',
    paths: ['worktrees/operator'],
    age_source: 'created_at',
    disposal: 'remove_worktree',
  },
  {
    name: 'durable-cache',
    paths: ['runtime/cache/conform.json', 'runtime/cache/style.json'],
    age_source: 'none',
    disposal: 'retain',
  },
  {
    name: 'release-allocations',
    paths: ['runtime/release/allocations.jsonl'],
    age_source: 'none',
    disposal: 'retain',
  },
  {
    // The landing event log is append-only and durable for audit purposes.
    name: 'landing-log',
    paths: ['runtime/release/landing.jsonl'],
    age_source: 'none',
    disposal: 'retain',
  },
  {
    // Reclaimed landing locks only. The ledgers and the live lock sit one
    // level up, outside every deleting path.
    name: 'landing-lock-stale',
    paths: ['runtime/release/stale-locks'],
    age_source: 'mtime',
    disposal: 'delete',
  },
  {
    name: 'repository-checks',
    paths: ['runtime/repository-checks.json'],
    age_source: 'none',
    disposal: 'retain',
  },
  {
    // `pan observations resolve` appends here; a lost line would reopen an
    // observation the audit already confirmed or refuted.
    name: 'observation-resolutions',
    paths: ['runtime/observations'],
    age_source: 'none',
    disposal: 'retain',
  },
  {
    name: 'spend-ledger',
    paths: ['runtime/spend'],
    age_source: 'none',
    disposal: 'retain',
  },
  {
    name: 'shell-logs',
    paths: ['runtime/logs/shell'],
    age_source: 'mtime',
    disposal: 'archive_then_delete',
    // bin/pan-run refreshes this symlink to the newest record on every run;
    // it is navigation, not an artifact, and a per-run compaction inside the
    // wrapper already bounds this directory well under the 30-day default.
    skip: ['latest'],
  },
  // One full-output log per `pan repository-check` or `pan tests impacted`
  // execution. A run's durable evidence lives in its own evidence directory,
  // so these are diagnostic copies with no archive tier.
  {
    name: 'repository-check-logs',
    paths: ['runtime/logs/repository-check'],
    age_source: 'mtime',
    disposal: 'delete',
  },
  {
    name: 'agent-index',
    paths: ['runtime/logs/agents'],
    age_source: 'mtime',
    disposal: 'delete',
  },
]

export interface CleanupAction {
  class: string
  path: string
  action: 'delete' | 'relocate' | 'rename' | 'remove_worktree'
  age_days: number
  reason: string
}

export interface CleanupSkip {
  class: string
  path: string
  reason: string
}

export interface CleanupBranch {
  worktree: string
  branch: string
  merged_into_default: boolean | null
  default_branch: string | null
}

export interface CleanupWorktree {
  name: string
  path: string
  branch: string
  age_days: number
  action: 'remove' | 'skip'
  reason: string
}

export interface CleanupPlan {
  status: 'planned'
  generated_at: string
  retention: Record<string, number>
  actions: CleanupAction[]
  worktrees: CleanupWorktree[]
  branches: CleanupBranch[]
  skipped: CleanupSkip[]
}

export interface CleanupOptions {
  days?: number
  classes?: string[]
  now?: Date
}

export interface CleanupResult extends Omit<CleanupPlan, 'status'> {
  status: 'applied'
  inbox_moves: InboxReconciliationMove[]
  relocated_files: number
  renames: Record<string, string>
  updated_references: number
}
