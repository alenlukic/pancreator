/** The spotfix outcome validator. */

import path from 'node:path'

import { readText } from '../../io.js'
import { hasHeading, parseMarkdown } from '../../markdown.js'
import type { HandlerInput, HandlerResult } from '../../requirements/types.js'
import {
  gitChangedFiles,
  gitUnavailableIssue,
  isSpotfixDiffExempt,
  issue,
  workspaceRootFromInput,
} from './evidence.js'

/**
 * Validate a spotfix outcome Markdown file: it does not claim success and
 * escalation together, runs at most three validation cycles, documents a
 * validation command, changes at most three non-exempt workspace files, and
 * gives an escalation its own section with acceptance criteria, validation
 * cycles, and blocker. Raises `spotfix.*` and `git.unavailable` codes.
 */
export function validateSpotfixOutcome(input: HandlerInput): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const content = readText(path.join(input.root, input.targetPath))
  const lower = content.toLowerCase()

  if (lower.includes('status: success') && lower.includes('escalation')) {
    issues.push(
      issue(
        'spotfix.conflict',
        'Spotfix MUST NOT claim success and escalation simultaneously',
      ),
    )
  }

  const cycleMatches = content.match(/cycle\s+\d/giu) ?? []

  if (cycleMatches.length > 3) {
    issues.push(
      issue(
        'spotfix.cycle_limit',
        'Spotfix MUST NOT exceed three validation cycles',
      ),
    )
  }

  if (!/\bnpm run\b|\.\/bin\/pan\b/u.test(content)) {
    issues.push(
      issue(
        'spotfix.validation_command',
        'Spotfix MUST document configured validation command coverage',
      ),
    )
  }

  // Measure the declared workspace, not the installation root: on a detached
  // installation or a worktree run the two are different repositories.
  const diffResult = gitChangedFiles(workspaceRootFromInput(input))

  if (!diffResult.ok) {
    issues.push(gitUnavailableIssue(diffResult.error))
  } else {
    const diffFiles = diffResult.files
      .filter((file) => !file.startsWith('runtime/'))
      .filter((file) => !isSpotfixDiffExempt(file))

    if (diffFiles.length > 3) {
      issues.push(
        issue(
          'spotfix.diff_bounded',
          'Spotfix MUST keep implementation scope within three non-exempt files (WORK-001 exempts documentation, tests, generated projections, and .cursor/ paths)',
        ),
      )
    }
  }

  if (
    lower.includes('escalation') &&
    !hasHeading(parseMarkdown(content), 'escalation')
  ) {
    issues.push(
      issue(
        'spotfix.escalation_content',
        'Escalation MUST include a dedicated escalation heading and rationale',
      ),
    )
  }

  if (lower.includes('escalation')) {
    const requiredEscalationFields = [
      'acceptance criteria',
      'validation cycle',
      'blocker',
    ]
    const missing = requiredEscalationFields.filter(
      (field) => !lower.includes(field),
    )

    if (missing.length > 0) {
      issues.push(
        issue(
          'spotfix.escalation_incomplete',
          `Escalation MUST document: ${missing.join(', ')}`,
        ),
      )
    }
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}
