import { readdirSync } from 'node:fs'
import path from 'node:path'

import { fileExists, isRecord, readJson, readText } from '../io.js'
import { loadPolicyCatalog, readPolicyLookupTable } from '../policies.js'

const DIRECTIVE_PATTERN =
  /\b(?:MUST(?: NOT)?|SHOULD(?: NOT)?|MAY)\b[^.\n]{10,}/gu

const AUDIT_ROOTS = [
  'AGENTS.md',
  'library/cursor/agents',
  'library/cursor/commands',
  'library/personas',
  'library/skills',
  'docs',
  'governance/handbooks',
]

interface DirectiveExemption {
  fingerprint: string
  source: string
  rationale: string
}

export interface DirectiveAuditResult {
  errors: string[]
  warnings: string[]
  directives: Array<{
    source: string
    line: number
    fingerprint: string
    owned: boolean
  }>
}

function loadExemptions(root: string): DirectiveExemption[] {
  const filePath = path.join(root, 'governance', 'directive_exemptions.json')

  if (!fileExists(filePath)) {
    return []
  }

  const value = readJson(filePath)

  if (!isRecord(value) || !Array.isArray(value.exemptions)) {
    return []
  }

  return value.exemptions.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.fingerprint !== 'string' ||
      typeof item.rationale !== 'string'
    ) {
      return []
    }

    return [
      {
        fingerprint: item.fingerprint,
        source: typeof item.source === 'string' ? item.source : '',
        rationale: item.rationale,
      },
    ]
  })
}

function listMarkdownFiles(root: string, relative: string): string[] {
  const absolute = path.join(root, relative)
  const files: string[] = []

  if (!fileExists(absolute)) {
    return files
  }

  const stat = readdirSync(absolute, { withFileTypes: true })

  if (!stat.length && absolute.endsWith('.md')) {
    return [relative]
  }

  for (const entry of stat) {
    const child = path.join(relative, entry.name)

    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(root, child))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(child.split(path.sep).join('/'))
    }
  }

  if (fileExists(absolute) && relative.endsWith('.md')) {
    files.push(relative)
  }

  return files
}

function normalizeDirective(text: string): string {
  return text.replace(/\s+/gu, ' ').trim().toLowerCase().slice(0, 120)
}

function isInCodeBlock(lines: string[], lineIndex: number): boolean {
  let inFence = false

  for (let index = 0; index <= lineIndex; index += 1) {
    if (lines[index].startsWith('```')) {
      inFence = !inFence
    }
  }

  return inFence
}

function hasPolicyReference(text: string): boolean {
  return /\b[A-Z][A-Z0-9]*-\d{3}\b/u.test(text)
}

function personaFromRelative(relative: string): string | null {
  const personaMatch =
    /^(?:library\/personas|library\/cursor\/agents)\/([^/]+)\.md$/u.exec(
      relative,
    )

  return personaMatch ? personaMatch[1] : null
}

function policiesForPersona(root: string, persona: string): Set<string> {
  const lookup = readPolicyLookupTable(root)
  const ids = new Set<string>()

  for (const row of lookup.rows) {
    if (row.persona !== persona && row.persona !== '*') {
      continue
    }

    for (const policyId of row.policies) {
      ids.add(policyId)
    }
  }

  return ids
}

function policiesForSource(root: string, relative: string): Set<string> {
  const persona = personaFromRelative(relative)

  if (persona) {
    return policiesForPersona(root, persona)
  }

  if (relative === 'AGENTS.md') {
    return new Set(['GLOBAL-001', 'GLOBAL-002', 'ORCH-001'])
  }

  return new Set()
}

function directiveRegistryKeywords(text: string): string[] {
  const keywords: string[] = []
  const lower = text.toLowerCase()

  if (/\bvalidate\b/u.test(lower)) {
    keywords.push('validate')
  }

  if (/\bscaffold\b/u.test(lower)) {
    keywords.push('scaffold')
  }

  if (/\baudit\b/u.test(lower)) {
    keywords.push('audit')
  }

  if (/\bresolve\b/u.test(lower)) {
    keywords.push('resolve')
  }

  return keywords
}

function policyHasMatchingRequirement(
  root: string,
  policyId: string,
  directiveText: string,
): boolean {
  const catalog = loadPolicyCatalog(root)
  const policy = catalog.get(policyId)

  if (!policy?.requirements?.length) {
    return false
  }

  const keywords = directiveRegistryKeywords(directiveText)
  const directiveLower = directiveText.toLowerCase()

  for (const requirement of policy.requirements) {
    const registryId = requirement.registry_id.toLowerCase()
    const requirementId = requirement.id.toLowerCase()

    if (
      directiveLower.includes(registryId) ||
      directiveLower.includes(requirementId)
    ) {
      return true
    }

    if (
      keywords.some(
        (keyword) =>
          registryId.includes(keyword) || requirementId.includes(keyword),
      )
    ) {
      return true
    }
  }

  return false
}

function hasValidatorLinkage(
  root: string,
  relative: string,
  directiveText: string,
): boolean {
  const policyRef = directiveText.match(/\b([A-Z][A-Z0-9]*-\d{3})\b/u)?.[1]

  if (policyRef) {
    return policyHasMatchingRequirement(root, policyRef, directiveText)
  }

  const policyIds = policiesForSource(root, relative)

  for (const policyId of policyIds) {
    if (policyHasMatchingRequirement(root, policyId, directiveText)) {
      return true
    }
  }

  return false
}

function handbookOwned(root: string, relative: string): boolean {
  const catalog = loadPolicyCatalog(root)

  for (const policy of catalog.values()) {
    const text = [policy.summary, ...policy.instructions].join('\n')

    if (text.includes(relative)) {
      return true
    }
  }

  return false
}

function isOwnedDirective(
  root: string,
  relative: string,
  content: string,
  exempt: boolean,
): boolean {
  if (exempt || hasPolicyReference(content)) {
    return true
  }

  const persona = personaFromRelative(relative)

  if (persona && policiesForPersona(root, persona).size > 0) {
    return true
  }

  if (
    relative.startsWith('governance/handbooks/') &&
    handbookOwned(root, relative)
  ) {
    return true
  }

  if (relative === 'AGENTS.md') {
    return true
  }

  return false
}

function isMachineCheckableDirective(text: string): boolean {
  if (!/\b(?:MUST|SHOULD)\b/u.test(text)) {
    return false
  }

  return (
    /\b(?:validator|validators|validation requirements?|validation-result|scaffold|audit-directives|validation-map)\b/iu.test(
      text,
    ) ||
    /\bpolicy-bound\b.*\bvalidat/iu.test(text) ||
    /\b(?:run|invoke)\b[^.\n]{0,80}\b(?:validator|validate|scaffold|audit)\b/iu.test(
      text,
    ) ||
    /\b[A-Z][A-Z0-9]*-(?:VALIDATE|SCAFFOLD)-\d{3}\b/u.test(text)
  )
}

/** Audit normative instruction ownership across agent-facing surfaces. */
export function auditDirectives(root: string): DirectiveAuditResult {
  const errors: string[] = []
  const warnings: string[] = []
  const directives: DirectiveAuditResult['directives'] = []
  const exemptions = loadExemptions(root)

  for (const auditRoot of AUDIT_ROOTS) {
    const files = auditRoot.endsWith('.md')
      ? fileExists(path.join(root, auditRoot))
        ? [auditRoot]
        : []
      : listMarkdownFiles(root, auditRoot)

    for (const relative of files) {
      const content = readText(path.join(root, relative))
      const lines = content.split('\n')

      for (const [index, line] of lines.entries()) {
        if (isInCodeBlock(lines, index)) {
          continue
        }

        const matches = line.matchAll(DIRECTIVE_PATTERN)

        for (const match of matches) {
          const fingerprint = normalizeDirective(match[0])
          const exempt = exemptions.some(
            (item) =>
              item.fingerprint.length > 0 &&
              (fingerprint.includes(item.fingerprint.replaceAll('-', ' ')) ||
                item.fingerprint.replaceAll('-', ' ').includes(fingerprint)),
          )
          const owned = isOwnedDirective(root, relative, content, exempt)
          const machineCheckable = isMachineCheckableDirective(match[0])

          directives.push({
            source: relative,
            line: index + 1,
            fingerprint,
            owned,
          })

          if (!owned && machineCheckable) {
            errors.push(
              `unowned machine-checkable directive in ${relative}:${index + 1}`,
            )
          } else if (owned && machineCheckable && !exempt) {
            if (
              !relative.startsWith('governance/handbooks/') &&
              !hasValidatorLinkage(root, relative, match[0])
            ) {
              errors.push(
                `machine-checkable directive without validator linkage in ${relative}:${index + 1}`,
              )
            }
          } else if (exempt && machineCheckable) {
            const exemption = exemptions.find(
              (item) =>
                fingerprint.includes(item.fingerprint.replaceAll('-', ' ')) ||
                item.fingerprint.replaceAll('-', ' ').includes(fingerprint),
            )

            if (!exemption || exemption.rationale.trim().length === 0) {
              errors.push(
                `judgment-only exemption missing rationale for machine-checkable directive in ${relative}:${index + 1}`,
              )
            }
          } else if (!owned) {
            warnings.push(
              `unowned advisory directive in ${relative}:${index + 1}`,
            )
          }
        }
      }
    }
  }

  return { errors, warnings, directives }
}
