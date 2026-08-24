import path from 'node:path'

import { fileExists, isRecord, readText } from '../io.js'
import { resolvePolicies } from '../policies.js'
import { configuredWorkspaceRoot } from '../project-config.js'
import { resolvePrDescriptionContext } from '../pr-description.js'
import type { HandlerInput, HandlerResult } from '../requirements/types.js'
import type { PrDescriptionContext } from '../types.js'

interface BodySection {
  heading: string
  content: string[]
}

function issue(code: string, message: string): HandlerResult['issues'][number] {
  return { code, message }
}

function scanBody(content: string): {
  preamble: string[]
  sections: BodySection[]
} {
  const preamble: string[] = []
  const sections: BodySection[] = []
  let current: BodySection | null = null
  let fence: string | null = null
  let inComment = false

  for (const line of content.split('\n')) {
    const trimmed = line.trim()

    if (inComment) {
      if (trimmed.includes('-->')) {
        inComment = false
      }

      continue
    }

    if (trimmed.startsWith('<!--')) {
      inComment = !trimmed.includes('-->')
      continue
    }

    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/u)

    if (fenceMatch) {
      const marker = fenceMatch[1]?.[0] ?? ''

      if (fence === marker) {
        fence = null
      } else if (fence === null) {
        fence = marker
      }

      if (current) {
        current.content.push(line)
      } else if (trimmed.length > 0) {
        preamble.push(line)
      }

      continue
    }

    if (fence === null) {
      const heading = trimmed.match(/^##\s+(.+?)(?:\s+#+)?$/u)

      if (heading?.[1]) {
        current = { heading: heading[1].trim(), content: [] }
        sections.push(current)
        continue
      }
    }

    if (current) {
      current.content.push(line)
    } else if (trimmed.length > 0) {
      preamble.push(line)
    }
  }

  return { preamble, sections }
}

function contextFromUnknown(value: unknown): PrDescriptionContext | null {
  if (
    !isRecord(value) ||
    (value.mode !== 'target' && value.mode !== 'fallback') ||
    !(
      typeof value.template_path === 'string' || value.template_path === null
    ) ||
    !Array.isArray(value.instruction_paths) ||
    !value.instruction_paths.every((item) => typeof item === 'string') ||
    !Array.isArray(value.heading_order) ||
    !value.heading_order.every((item) => typeof item === 'string') ||
    !Array.isArray(value.required_headings) ||
    !value.required_headings.every((item) => typeof item === 'string') ||
    !Array.isArray(value.optional_headings) ||
    !value.optional_headings.every((item) => typeof item === 'string') ||
    typeof value.allows_body_title !== 'boolean'
  ) {
    return null
  }

  return value as unknown as PrDescriptionContext
}

function resolveContext(input: HandlerInput): PrDescriptionContext | null {
  if (input.invocation) {
    const inputs = isRecord(input.invocation.inputs)
      ? input.invocation.inputs
      : null

    return contextFromUnknown(inputs?.pr_description)
  }

  const workspaceRoot = path.resolve(
    input.root,
    configuredWorkspaceRoot(input.root),
  )
  const policies = resolvePolicies(input.root, {
    persona: 'release-steward',
    workflow: 'standalone',
    stage: 'write-pr',
    operator_artifacts: 'requested',
  })

  return resolvePrDescriptionContext(workspaceRoot, policies)
}

/** Validate one PR Markdown body against its resolved target authority. */
export function validatePrDescription(input: HandlerInput): HandlerResult {
  const context = resolveContext(input)

  if (!context) {
    return {
      status: 'invalid',
      issues: [
        issue(
          'pr.context_missing',
          'Resolved PR description context is missing or invalid.',
        ),
      ],
    }
  }

  const absolute = path.join(input.root, input.targetPath)

  if (!fileExists(absolute)) {
    return {
      status: 'failed',
      issues: [
        issue(
          'pr.file_missing',
          `Declared PR description is missing: ${input.targetPath}`,
        ),
      ],
    }
  }

  // Instruction-only target authority carries no template, so there is no
  // section contract to enforce; the instructions bind the author, not this
  // structural check.
  if (context.mode === 'target' && context.template_path === null) {
    return { status: 'passed', issues: [] }
  }

  const content = readText(absolute)
  const body = scanBody(content)
  const issues: HandlerResult['issues'] = []

  if (context.mode === 'fallback') {
    const firstLine = content.split('\n')[0]?.trim() ?? ''

    if (!/^[a-z][a-z0-9-]*(?:\([^)]+\))?!?:\s+\S/u.test(firstLine)) {
      issues.push(
        issue(
          'pr.title_invalid',
          'The fallback PR description needs a conventional title on line 1.',
        ),
      )
    }
  } else if (!context.allows_body_title && body.preamble.length > 0) {
    issues.push(
      issue(
        'pr.title_forbidden',
        'The target PR template does not permit body content before its first section.',
      ),
    )
  }

  const actualHeadings = body.sections.map((section) => section.heading)
  const permittedHeadings = new Set(context.heading_order)

  for (const heading of actualHeadings) {
    if (!permittedHeadings.has(heading)) {
      issues.push(
        issue(
          'pr.heading_unexpected',
          `The PR description contains an unexpected section: ${heading}`,
        ),
      )
    }
  }

  for (const heading of context.required_headings) {
    const section = body.sections.find((item) => item.heading === heading)

    if (!section) {
      issues.push(
        issue(
          'pr.heading_missing',
          `The PR description is missing a required section: ${heading}`,
        ),
      )
      continue
    }

    if (section.content.every((line) => line.trim().length === 0)) {
      issues.push(
        issue(
          'pr.section_empty',
          `The required PR description section is empty: ${heading}`,
        ),
      )
    }
  }

  const expectedIndexes = actualHeadings
    .filter((heading) => permittedHeadings.has(heading))
    .map((heading) => context.heading_order.indexOf(heading))

  if (
    expectedIndexes.some(
      (value, index) =>
        index > 0 && value <= (expectedIndexes[index - 1] ?? -1),
    )
  ) {
    issues.push(
      issue(
        'pr.heading_order',
        'The PR description sections do not match the target template order.',
      ),
    )
  }

  return {
    status: issues.length === 0 ? 'passed' : 'failed',
    issues,
  }
}
