/** The investigation Markdown artifact validator. */

import path from 'node:path'

import { readText } from '../../io.js'
import { parseMarkdown, hasHeading } from '../../markdown.js'
import type { HandlerInput, HandlerResult } from '../../requirements/types.js'
import { issue } from './evidence.js'

const WORK_MODES = new Set(['systematic', 'lightweight'])

export function validateInvestigationArtifact(
  input: HandlerInput,
): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const content = readText(path.join(input.root, input.targetPath))
  const parsed = parseMarkdown(content)
  const requiredHeadings = [
    'root cause',
    'acceptance criteria',
    'work mode',
    'next action',
    'work-001',
  ]

  for (const heading of requiredHeadings) {
    if (!hasHeading(parsed, heading)) {
      issues.push(
        issue(
          'investigation.section_missing',
          `Investigation MUST include heading: ${heading}`,
        ),
      )
    }
  }

  const modeLine = content
    .split('\n')
    .find((line) => line.toLowerCase().includes('work mode'))

  if (
    !modeLine ||
    ![...WORK_MODES].some((mode) => modeLine.toLowerCase().includes(mode))
  ) {
    issues.push(
      issue(
        'investigation.work_mode',
        'Investigation MUST declare exactly one work mode (systematic or lightweight)',
      ),
    )
  }

  const criteriaMatches = content.match(/^\s*\d+\.\s+/gmu) ?? []

  if (criteriaMatches.length === 0) {
    issues.push(
      issue(
        'investigation.numbered_criteria',
        'Investigation MUST include numbered acceptance criteria',
      ),
    )
  }

  const work001Section = content.toLowerCase()
  const thresholdChecks = [
    'coherent',
    'acceptance criteria',
    'three implementation files',
    'cross-module',
    'systematic',
  ]
  const thresholdHits = thresholdChecks.filter((item) =>
    work001Section.includes(item),
  ).length

  if (thresholdHits < 3) {
    issues.push(
      issue(
        'investigation.work001_threshold',
        'Investigation MUST evaluate WORK-001 lightweight eligibility thresholds',
      ),
    )
  }

  if (
    content.toLowerCase().includes('uncertain') &&
    !content.toLowerCase().includes('systematic')
  ) {
    issues.push(
      issue(
        'investigation.uncertainty_route',
        'Uncertainty MUST route to systematic work mode',
      ),
    )
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}
