import path from 'node:path'

import { hasHeading, parseMarkdown } from '../markdown.js'
import { readText } from '../io.js'
import { isTargetInstallation } from '../project-config.js'
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

function isExplicitNotApplicable(body: string): boolean {
  return /^(?:[-*]\s*)?not applicable\b/iu.test(body.trim())
}

function isExplicitNoneIdentified(body: string): boolean {
  return /^(?:[-*]\s*)?none identified\b/iu.test(body.trim())
}

interface RequiredField {
  pattern: RegExp
  missingCode: string
  emptyCode: string
  label: string
}

/**
 * Bold labels the external-only sections MUST carry, verbatim. Governance
 * quotes these strings, so they are declared once here and the patterns are
 * built from them: a label the validator enforces but no policy states is a
 * contract the librarian cannot follow.
 */
export const PRIMER_FRONTEND_LABELS = [
  'Startup',
  'Route/state',
  'Browser inspection',
] as const

export const PRIMER_FLOW_STEP_LABELS = [
  'Input shape',
  'Logic excerpt',
  'Output shape',
] as const

/**
 * Match one bold label and the value on its line. The value MUST share the
 * label's line; a label alone on a line captures the empty string and reports
 * as empty rather than missing.
 */
function labelPattern(alternation: string): RegExp {
  return new RegExp(
    String.raw`^[ \t]*(?:[-*][ \t]*)?\*\*(?:${alternation}):\*\*[ \t]*([^\r\n]*)[ \t]*$`,
    'imu',
  )
}

function validateRequiredFields(
  body: string,
  fields: RequiredField[],
  context: string,
): HandlerResult['issues'] {
  const issues: HandlerResult['issues'] = []

  for (const { pattern, missingCode, emptyCode, label } of fields) {
    const match = pattern.exec(body)

    if (!match) {
      issues.push(issue(missingCode, `${context} MUST include **${label}:**`))
    } else if (match[1].trim().length === 0) {
      issues.push(
        issue(emptyCode, `${context} **${label}:** MUST not be empty`),
      )
    }
  }

  return issues
}

function validateFrontendInspectionSection(
  body: string,
): HandlerResult['issues'] {
  const issues: HandlerResult['issues'] = []

  if (body.length === 0) {
    issues.push(
      issue(
        'primer.frontend_inspection_empty',
        'Frontend visual inspection MUST not be empty for external target primers',
      ),
    )
    return issues
  }

  if (isExplicitNotApplicable(body)) {
    return issues
  }

  const requiredLabels = [
    {
      pattern: labelPattern('Startup'),
      missingCode: 'primer.frontend_startup_missing',
      emptyCode: 'primer.frontend_startup_empty',
      label: PRIMER_FRONTEND_LABELS[0],
    },
    {
      // The canonical label is `Route/state`; `Route` and `State` alone stay
      // accepted for primers written before the label was fixed.
      pattern: labelPattern(String.raw`Route(?:\/state)?|State`),
      missingCode: 'primer.frontend_route_missing',
      emptyCode: 'primer.frontend_route_empty',
      label: PRIMER_FRONTEND_LABELS[1],
    },
    {
      pattern: labelPattern('Browser inspection'),
      missingCode: 'primer.frontend_browser_missing',
      emptyCode: 'primer.frontend_browser_empty',
      label: PRIMER_FRONTEND_LABELS[2],
    },
  ]

  issues.push(
    ...validateRequiredFields(
      body,
      requiredLabels,
      'Frontend visual inspection',
    ),
  )

  return issues
}

function validateFlowSteps(body: string): HandlerResult['issues'] {
  const issues: HandlerResult['issues'] = []

  if (body.length === 0) {
    issues.push(
      issue(
        'primer.major_flows_empty',
        'Major workflows and data flows MUST not be empty for external target primers',
      ),
    )
    return issues
  }

  if (isExplicitNoneIdentified(body)) {
    return issues
  }

  const flowSections = body.split(/^###\s+/mu).slice(1)

  for (const flowSection of flowSections) {
    const flowName = flowSection.split('\n', 1)[0].trim()
    const flowBody = flowSection.replace(/^[^\n]*(?:\n|$)/u, '')

    if (!/^####\s+Step\b/imu.test(flowBody)) {
      issues.push(
        issue(
          'primer.major_flow_steps_missing',
          `Flow "${flowName}" MUST document ordered steps beginning with #### Step 1`,
        ),
      )
    }
  }

  const stepBlocks = body.split(/^####\s+/mu).slice(1)

  if (stepBlocks.length === 0) {
    issues.push(
      issue(
        'primer.major_flow_steps_missing',
        'Major workflows and data flows MUST document ordered steps or state None identified',
      ),
    )
    return issues
  }

  let expectedStep = 1

  for (const [index, block] of stepBlocks.entries()) {
    const heading = block.split('\n', 1)[0].trim()
    const stepNumber = /^Step\s+([1-9][0-9]*)(?::|\s|$)/iu.exec(heading)?.[1]
    const previousBlock = index === 0 ? body : stepBlocks[index - 1]

    if (/^###\s+/mu.test(previousBlock)) {
      expectedStep = 1
    }

    if (!stepNumber || Number(stepNumber) !== expectedStep) {
      issues.push(
        issue(
          'primer.major_flow_step_order',
          `Flow steps MUST use contiguous ordered headings beginning with #### Step 1; expected Step ${expectedStep}`,
        ),
      )
    } else {
      expectedStep += 1
    }

    const stepBody = block.replace(/^[^\n]*\n/u, '').trim()

    if (stepBody.length === 0) {
      issues.push(
        issue(
          'primer.major_flow_step_empty',
          'Each documented flow step MUST include input, logic, and output fields',
        ),
      )
      continue
    }

    issues.push(
      ...validateRequiredFields(
        stepBody,
        [
          {
            pattern: labelPattern('Input shape'),
            missingCode: 'primer.major_flow_input_missing',
            emptyCode: 'primer.major_flow_input_empty',
            label: PRIMER_FLOW_STEP_LABELS[0],
          },
          {
            pattern: labelPattern('Logic excerpt'),
            missingCode: 'primer.major_flow_logic_missing',
            emptyCode: 'primer.major_flow_logic_empty',
            label: PRIMER_FLOW_STEP_LABELS[1],
          },
          {
            pattern: labelPattern('Output shape'),
            missingCode: 'primer.major_flow_output_missing',
            emptyCode: 'primer.major_flow_output_empty',
            label: PRIMER_FLOW_STEP_LABELS[2],
          },
        ],
        'Each documented flow step',
      ),
    )
  }

  return issues
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
  const externalTarget = isTargetInstallation(input.root)

  if (externalTarget) {
    requiredSections.push(
      'Frontend visual inspection',
      'Major workflows and data flows',
    )
  }

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

  if (externalTarget) {
    issues.push(
      ...validateFrontendInspectionSection(
        sectionBody(content, 'Frontend visual inspection'),
      ),
      ...validateFlowSteps(
        sectionBody(content, 'Major workflows and data flows'),
      ),
    )
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}
