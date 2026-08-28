import { gitChangedPathsBetween, gitMergeBase, gitRevParse } from './git.js'
import { invariant } from './errors.js'

/**
 * Files that decide how a squad review behaves: the lineup and its charters,
 * the coordinator persona and its projected agent, the mode policy, and the
 * command that starts a session.
 *
 * A squad cannot audit a change to these. The charters are what the dimension
 * agents are told to look for, so a defect introduced into a charter is a
 * defect in the instrument doing the looking — it reports itself clean. The
 * harness answers the overlap deterministically instead of asking a reviewing
 * agent to notice that it is grading its own instructions.
 *
 * Patterns are repository-relative. A trailing `*` matches any suffix; every
 * other pattern matches one exact path.
 */
export const REVIEW_MACHINERY_PATTERNS = [
  'governance/policies/REVIEW-001.json',
  'governance/policies/SHEPHERD-001.json',
  'library/cursor/agents/shepherd-reviewer.md',
  'library/cursor/commands/pan-review.md',
  'library/cursor/commands/pan-shepherd.md',
  'library/personas/shepherd-reviewer.md',
  'library/skills/review-squad*',
  'library/skills/shepherd-pr.md',
  'src/lib/review-scope.ts',
] as const

export interface ReviewScope {
  base: string
  head: string
  /** Every path the three-dot diff changes. */
  changed_paths: string[]
  /** Changed paths that are part of the review machinery itself. */
  conflicts: string[]
  /** True when the squad can grade the whole target without grading itself. */
  independent: boolean
}

function matchesPattern(candidate: string, pattern: string): boolean {
  return pattern.endsWith('*')
    ? candidate.startsWith(pattern.slice(0, -1))
    : candidate === pattern
}

/** Review-machinery paths within a changed-path set, sorted and deduplicated. */
export function reviewMachineryConflicts(changedPaths: string[]): string[] {
  const conflicts = changedPaths.filter((candidate) =>
    REVIEW_MACHINERY_PATTERNS.some((pattern) =>
      matchesPattern(candidate, pattern),
    ),
  )

  return [...new Set(conflicts)].sort()
}

export interface ResolveReviewScopeOptions {
  head: string
  /** Defaults to the merge base of `head` and the repository's default branch. */
  base?: string | null
  defaultBranch?: string | null
}

/**
 * Resolve one review target and report whether the squad can grade all of it.
 *
 * The caller passes the target it already resolved; this does not guess a
 * target from the working tree, because the session states its range before
 * anything reads it.
 */
export function resolveReviewScope(
  root: string,
  options: ResolveReviewScopeOptions,
): ReviewScope {
  const head = gitRevParse(root, options.head)
  const base = options.base
    ? gitRevParse(root, options.base)
    : gitMergeBase(root, options.defaultBranch ?? 'main', head)

  invariant(
    base,
    `No merge base between '${options.defaultBranch ?? 'main'}' and ` +
      `'${options.head}'. Pass an explicit base.`,
    { code: 'REVIEW_BASE_UNRESOLVED' },
  )

  const changedPaths = gitChangedPathsBetween(root, base, head)
  const conflicts = reviewMachineryConflicts(changedPaths)

  return {
    base,
    head,
    changed_paths: changedPaths,
    conflicts,
    independent: conflicts.length === 0,
  }
}
