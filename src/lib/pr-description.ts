import { readdirSync } from 'node:fs'
import path from 'node:path'

import { PanError, invariant } from './errors.js'
import { fileExists, readText } from './io.js'
import { resolveTargetInstructionPaths } from './target-instructions.js'
import type { Policy, PrDescriptionContext } from './types.js'

const STANDARD_TEMPLATE_FILES = [
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/pull_request_template.md',
  'docs/PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
  'PULL_REQUEST_TEMPLATE.md',
  'pull_request_template.md',
]
const STANDARD_TEMPLATE_DIRECTORIES = [
  '.github/PULL_REQUEST_TEMPLATE',
  '.github/pull_request_template',
]

interface TemplateSection {
  heading: string
  optional: boolean
}

function workspacePath(workspaceRoot: string, relativePath: string): string {
  const root = path.resolve(workspaceRoot)
  const absolute = path.resolve(root, relativePath)

  invariant(
    absolute === root || absolute.startsWith(`${root}${path.sep}`),
    `PR authority path escapes the workspace: ${relativePath}`,
    { code: 'PR_AUTHORITY_PATH_INVALID' },
  )

  return absolute
}

function discoveredTemplates(workspaceRoot: string): string[] {
  const templates = STANDARD_TEMPLATE_FILES.filter((relativePath) =>
    fileExists(workspacePath(workspaceRoot, relativePath)),
  )

  for (const relativeDirectory of STANDARD_TEMPLATE_DIRECTORIES) {
    const directory = workspacePath(workspaceRoot, relativeDirectory)

    if (!fileExists(directory)) {
      continue
    }

    for (const name of readdirSync(directory).sort()) {
      if (name.toLowerCase().endsWith('.md')) {
        templates.push(path.posix.join(relativeDirectory, name))
      }
    }
  }

  return [...new Set(templates)].sort()
}

function commentText(
  lines: string[],
  start: number,
): {
  value: string
  end: number
} {
  const parts: string[] = []

  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const opening = index === start ? line.indexOf('<!--') + 4 : 0
    const closing = line.indexOf('-->', opening)

    parts.push(line.slice(opening, closing >= 0 ? closing : undefined).trim())

    if (closing >= 0) {
      return { value: parts.join(' ').trim(), end: index }
    }
  }

  return { value: parts.join(' ').trim(), end: lines.length - 1 }
}

function parseTemplate(content: string): {
  sections: TemplateSection[]
  allowsBodyTitle: boolean
} {
  const lines = content.split('\n')
  const sections: TemplateSection[] = []
  let current: TemplateSection | null = null
  let fence: string | null = null
  let allowsBodyTitle = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/u)

    if (fenceMatch) {
      const marker = fenceMatch[1]?.[0] ?? ''

      if (fence === marker) {
        fence = null
      } else if (fence === null) {
        fence = marker
      }

      continue
    }

    if (fence !== null) {
      continue
    }

    if (trimmed.startsWith('<!--')) {
      const comment = commentText(lines, index)

      if (current && /^Optional:/iu.test(comment.value)) {
        current.optional = true
      }

      if (sections.length === 0 && /^Title:/iu.test(comment.value)) {
        allowsBodyTitle = true
      }

      index = comment.end
      continue
    }

    if (/^#\s+\S/u.test(trimmed)) {
      allowsBodyTitle = true
      continue
    }

    const heading = trimmed.match(/^##\s+(.+?)(?:\s+#+)?$/u)

    if (heading?.[1]) {
      current = { heading: heading[1].trim(), optional: false }
      sections.push(current)
    }
  }

  return { sections, allowsBodyTitle }
}

function declaredAuthority(policies: Policy[]): {
  templatePath?: string
  instructionPaths: string[]
} | null {
  const declarations = policies.flatMap((policy) => {
    const authority = policy.artifact_authority?.pr_description

    return authority
      ? [
          {
            policyId: policy.id,
            templatePath: authority.template_path,
            instructionPaths: authority.instruction_paths ?? [],
          },
        ]
      : []
  })

  if (declarations.length === 0) {
    return null
  }

  invariant(
    declarations.length === 1,
    `More than one policy declares PR authority: ${declarations.map((item) => item.policyId).join(', ')}`,
    { code: 'PR_AUTHORITY_CONFLICT' },
  )

  return declarations[0] ?? null
}

/** Resolve target PR authority from policy metadata and standard GitHub paths. */
export function resolvePrDescriptionContext(
  workspaceRoot: string,
  policies: Policy[],
): PrDescriptionContext {
  const declared = declaredAuthority(policies)
  let templatePath = declared?.templatePath

  if (templatePath) {
    invariant(
      fileExists(workspacePath(workspaceRoot, templatePath)),
      `Declared PR template does not exist: ${templatePath}`,
      { code: 'PR_TEMPLATE_MISSING' },
    )
  } else {
    const discovered = discoveredTemplates(workspaceRoot)

    if (discovered.length > 1) {
      throw new PanError(
        `More than one PR template exists: ${discovered.join(', ')}`,
        {
          code: 'PR_TEMPLATE_AMBIGUOUS',
          details: { templates: discovered },
        },
      )
    }

    templatePath = discovered[0]
  }

  const declaredInstructions = declared?.instructionPaths ?? []

  for (const instructionPath of declaredInstructions) {
    invariant(
      fileExists(workspacePath(workspaceRoot, instructionPath)),
      `Declared PR instruction does not exist: ${instructionPath}`,
      { code: 'PR_INSTRUCTION_MISSING' },
    )
  }

  const automaticInstructions = templatePath
    ? resolveTargetInstructionPaths(workspaceRoot, [templatePath])
    : []
  const instructionPaths = [
    ...new Set([...automaticInstructions, ...declaredInstructions]),
  ].sort()

  if (!templatePath && instructionPaths.length === 0) {
    return {
      mode: 'fallback',
      template_path: null,
      instruction_paths: [],
      heading_order: ['Summary', 'Changelist'],
      required_headings: ['Summary', 'Changelist'],
      optional_headings: [],
      allows_body_title: true,
    }
  }

  if (!templatePath) {
    return {
      mode: 'target',
      template_path: null,
      instruction_paths: instructionPaths,
      heading_order: [],
      required_headings: [],
      optional_headings: [],
      allows_body_title: false,
    }
  }

  const template = parseTemplate(
    readText(workspacePath(workspaceRoot, templatePath)),
  )

  return {
    mode: 'target',
    template_path: templatePath,
    instruction_paths: instructionPaths,
    heading_order: template.sections.map((section) => section.heading),
    required_headings: template.sections
      .filter((section) => !section.optional)
      .map((section) => section.heading),
    optional_headings: template.sections
      .filter((section) => section.optional)
      .map((section) => section.heading),
    allows_body_title: template.allowsBodyTitle,
  }
}
