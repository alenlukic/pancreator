import path from 'node:path'

import { hasHeading, parseMarkdown } from '../markdown.js'
import { readText } from '../io.js'
import type { HandlerInput, HandlerResult } from '../requirements/types.js'

function issue(code: string, message: string): HandlerResult['issues'][number] {
  return { code, message }
}

function sectionBody(content: string, heading: string): string {
  const lines = content.replaceAll('\r\n', '\n').split('\n')
  const headingIndex = lines.findIndex(
    (line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`,
  )

  if (headingIndex === -1) {
    return ''
  }

  const nextHeadingOffset = lines
    .slice(headingIndex + 1)
    .findIndex((line) => line.startsWith('## '))
  const endIndex =
    nextHeadingOffset === -1
      ? lines.length
      : headingIndex + 1 + nextHeadingOffset

  return lines
    .slice(headingIndex + 1, endIndex)
    .join('\n')
    .trim()
}

export function validateTargetRepoPrimer(input: HandlerInput): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const content = readText(path.join(input.root, input.targetPath))
  const parsed = parseMarkdown(content)
  const requiredSections = [
    'Summary',
    'Administrative commands',
    'Architecture',
    'Project structure',
    'Public interfaces',
    'Gotchas',
  ]

  if (!hasHeading(parsed, 'Target repository primer', 1)) {
    issues.push(
      issue(
        'primer.title_missing',
        'Primer MUST use the title: Target repository primer',
      ),
    )
  }

  for (const section of requiredSections) {
    if (!hasHeading(parsed, section, 2)) {
      issues.push(
        issue('primer.section_missing', `Primer MUST include: ${section}`),
      )
      continue
    }

    if (sectionBody(content, section).length === 0) {
      issues.push(
        issue(
          'primer.section_empty',
          `Primer section MUST not be empty: ${section}`,
        ),
      )
    }
  }

  for (const subsection of ['Install', 'Build', 'Test', 'Other']) {
    if (!hasHeading(parsed, subsection, 3)) {
      issues.push(
        issue(
          'primer.admin_subsection_missing',
          `Administrative commands MUST include: ${subsection}`,
        ),
      )
    }
  }

  const status = /<!--\s*pancreator-primer-status:\s*([^>]+?)\s*-->/iu.exec(
    content,
  )?.[1]
  const generatedAt = /<!--\s*generated-at:\s*([^>]+?)\s*-->/iu.exec(
    content,
  )?.[1]
  const sourceHead = /<!--\s*source-head:\s*([^>]+?)\s*-->/iu.exec(content)?.[1]

  if (status?.trim().toLowerCase() !== 'ready') {
    issues.push(
      issue(
        'primer.status_not_ready',
        'Primer metadata MUST declare pancreator-primer-status: ready',
      ),
    )
  }

  if (
    !generatedAt ||
    Number.isNaN(Date.parse(generatedAt.trim())) ||
    !generatedAt.trim().endsWith('Z')
  ) {
    issues.push(
      issue(
        'primer.generated_at',
        'Primer metadata MUST include a valid UTC generated-at timestamp',
      ),
    )
  }

  if (
    !sourceHead ||
    !/^(?:[0-9a-f]{7,64}|unavailable)$/iu.test(sourceHead.trim())
  ) {
    issues.push(
      issue(
        'primer.source_head',
        'Primer metadata source-head MUST be a Git hash or unavailable',
      ),
    )
  }

  const architecture = sectionBody(content, 'Architecture')

  if (
    !/```mermaid\s+[\s\S]*?\b(?:flowchart|graph)\b[\s\S]*?```/iu.test(
      architecture,
    )
  ) {
    issues.push(
      issue(
        'primer.architecture_mermaid',
        'Architecture MUST contain a Mermaid flowchart or graph',
      ),
    )
  }

  const structure = sectionBody(content, 'Project structure')

  if (!/`[^`]+`/u.test(structure) && !/\bUnavailable\b/iu.test(structure)) {
    issues.push(
      issue(
        'primer.project_paths',
        'Project structure MUST include repository-relative paths in backticks',
      ),
    )
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}
