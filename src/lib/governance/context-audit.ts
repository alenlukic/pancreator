import { readdirSync } from 'node:fs'
import path from 'node:path'

import { fileExists, isRecord, readJson, readText } from '../io.js'
import { loadPolicyCatalog } from '../policies.js'
import { renderCursorProjectionSources } from '../projection.js'

const DIRECTIVE_PATTERN =
  /[^.\n]*\b(?:MUST(?: NOT)?|SHOULD(?: NOT)?|MAY)\b[^.\n]*(?:\.|$)/gu
const DISPOSITIONS_PATH =
  'governance/registries/context_bloat_dispositions.json'
const DISPOSITIONS = new Set(['retain', 'absorb', 'generalize', 'remove'])
const CATEGORIES = new Set(['duplicate', 'monkeypatch'])

interface ContextSource {
  category: string
  path: string
  content: string
  generated: boolean
}

interface ContextBloatDisposition {
  id: string
  category: 'duplicate' | 'monkeypatch'
  sources: string[]
  disposition: 'retain' | 'absorb' | 'generalize' | 'remove'
  rationale: string
  evidence: string[]
}

export interface ContextAuditDuplicateGroup {
  fingerprint: string
  sources: Array<{ path: string; line: number }>
}

export interface ContextAuditResult {
  errors: string[]
  disposition_errors: string[]
  source_coverage: Array<{
    category: string
    count: number
    paths: string[]
  }>
  duplicate_groups: ContextAuditDuplicateGroup[]
  monkeypatch_candidates: Array<{ id: string; sources: string[] }>
  dispositions: ContextBloatDisposition[]
}

function listFiles(
  root: string,
  relative: string,
  suffixes: string[],
): string[] {
  const absolute = path.join(root, relative)

  if (!fileExists(absolute)) {
    return []
  }

  const files: string[] = []

  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(relative, entry.name)

    if (entry.isDirectory()) {
      files.push(...listFiles(root, child, suffixes))
    } else if (
      entry.isFile() &&
      suffixes.some((suffix) => entry.name.endsWith(suffix))
    ) {
      files.push(child.split(path.sep).join('/'))
    }
  }

  return files.sort()
}

function source(
  root: string,
  category: string,
  relative: string,
): ContextSource | null {
  const absolute = path.join(root, relative)

  if (!fileExists(absolute)) {
    return null
  }

  return {
    category,
    path: relative,
    content: readText(absolute),
    generated: false,
  }
}

function canonicalSources(root: string): ContextSource[] {
  const definitions: Array<{
    category: string
    root: string
    suffixes: string[]
  }> = [
    {
      category: 'workflow_prompt',
      root: 'library/workflows',
      suffixes: ['.md'],
    },
    { category: 'persona', root: 'library/personas', suffixes: ['.md'] },
    { category: 'skill', root: 'library/skills', suffixes: ['.md'] },
    {
      category: 'cursor_source',
      root: 'library/cursor',
      suffixes: ['.md', '.mdc'],
    },
    {
      category: 'policy',
      root: 'governance/policies',
      suffixes: ['.json'],
    },
    {
      category: 'criterion',
      root: 'governance/criteria',
      suffixes: ['.json', '.md'],
    },
  ]
  const sources = definitions.flatMap((definition) =>
    listFiles(root, definition.root, definition.suffixes).flatMap(
      (relative) => {
        const item = source(root, definition.category, relative)

        return item ? [item] : []
      },
    ),
  )
  const fixed = [
    ['bootstrap', 'AGENTS.md'],
    ['selector', 'governance/registries/policy_lookup_table.json'],
    ['projection_manifest', 'governance/registries/projection_manifest.json'],
    ['renderer', 'src/lib/render.ts'],
    ['renderer', 'src/lib/policy-guidance.ts'],
    ['renderer', 'src/lib/governance-card.ts'],
    ['renderer', 'src/lib/cursor-content.ts'],
    ['renderer', 'src/lib/projection.ts'],
    ['renderer', 'bin/install-support'],
  ] as const

  for (const [category, relative] of fixed) {
    const item = source(root, category, relative)

    if (item) {
      sources.push(item)
    }
  }

  const existing = new Set(sources.map((item) => item.path))

  for (const policy of loadPolicyCatalog(root).values()) {
    for (const guidance of policy.guidance ?? []) {
      if (existing.has(guidance.source_path)) {
        continue
      }

      const item = source(root, 'guidance', guidance.source_path)

      if (item) {
        sources.push(item)
        existing.add(item.path)
      }
    }
  }

  for (const projection of renderCursorProjectionSources(root)) {
    sources.push({
      category: 'generated_projection',
      path: `generated:${projection.path}`,
      content: projection.content,
      generated: true,
    })
  }

  return sources.sort((left, right) => left.path.localeCompare(right.path))
}

function normalizeDirective(value: string): string {
  return value
    .replaceAll(/\\n|\\r|["'`*_()[\]{}]/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .toLowerCase()
}

function ignoredDirective(value: string): boolean {
  const normalized = normalizeDirective(value)

  return (
    ((normalized.startsWith('the terms must') ||
      normalized.startsWith('must')) &&
      normalized.includes('must not') &&
      normalized.includes('should') &&
      normalized.includes('should not') &&
      normalized.includes('may use')) ||
    normalized.includes('use rfc 2119 meanings') ||
    normalized.includes('indicate requirement levels as defined by rfc 2119')
  )
}

function duplicateGroups(
  sources: ContextSource[],
): ContextAuditDuplicateGroup[] {
  const occurrences = new Map<
    string,
    Map<string, { path: string; line: number }>
  >()

  for (const item of sources) {
    if (item.generated || item.category === 'renderer') {
      continue
    }

    for (const [index, line] of item.content.split('\n').entries()) {
      for (const match of line.matchAll(DIRECTIVE_PATTERN)) {
        if (ignoredDirective(match[0])) {
          continue
        }

        const fingerprint = normalizeDirective(match[0])
        const wordCount = fingerprint.split(' ').filter(Boolean).length

        if (fingerprint.length < 20 || wordCount < 8) {
          continue
        }

        const bySource = occurrences.get(fingerprint) ?? new Map()
        bySource.set(item.path, { path: item.path, line: index + 1 })
        occurrences.set(fingerprint, bySource)
      }
    }
  }

  return [...occurrences.entries()]
    .filter(([, bySource]) => bySource.size > 1)
    .map(([fingerprint, bySource]) => ({
      fingerprint,
      sources: [...bySource.values()].sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
    }))
    .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint))
}

function parseDispositions(
  root: string,
  errors: string[],
): ContextBloatDisposition[] {
  const absolute = path.join(root, DISPOSITIONS_PATH)

  if (!fileExists(absolute)) {
    errors.push(
      `missing context-bloat disposition record: ${DISPOSITIONS_PATH}`,
    )
    return []
  }

  const value = readJson(absolute)

  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    !Array.isArray(value.entries)
  ) {
    errors.push(
      `${DISPOSITIONS_PATH} MUST contain schema_version 1 and entries[].`,
    )
    return []
  }

  const dispositions: ContextBloatDisposition[] = []
  const ids = new Set<string>()

  for (const [index, item] of value.entries.entries()) {
    const label = `${DISPOSITIONS_PATH}:entries[${index}]`

    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(item.id) ||
      typeof item.category !== 'string' ||
      !CATEGORIES.has(item.category) ||
      !Array.isArray(item.sources) ||
      item.sources.length === 0 ||
      !item.sources.every(
        (entry) => typeof entry === 'string' && entry.length > 0,
      ) ||
      typeof item.disposition !== 'string' ||
      !DISPOSITIONS.has(item.disposition) ||
      typeof item.rationale !== 'string' ||
      item.rationale.trim().length === 0 ||
      !Array.isArray(item.evidence) ||
      item.evidence.length === 0 ||
      !item.evidence.every(
        (entry) => typeof entry === 'string' && entry.length > 0,
      )
    ) {
      errors.push(`${label} is invalid.`)
      continue
    }

    if (ids.has(item.id)) {
      errors.push(`${label} duplicates disposition id ${item.id}.`)
      continue
    }

    ids.add(item.id)
    dispositions.push(item as unknown as ContextBloatDisposition)
  }

  return dispositions
}

function dispositionSourceExists(root: string, sourcePath: string): boolean {
  if (sourcePath.startsWith('generated:')) {
    return true
  }

  const relative = sourcePath.split('#', 1)[0] ?? ''
  return relative.length > 0 && fileExists(path.join(root, relative))
}

function sourceCovered(candidate: string, declared: string): boolean {
  const normalized = declared.split('#', 1)[0] ?? declared

  return (
    candidate === normalized ||
    (normalized.endsWith('/') && candidate.startsWith(normalized))
  )
}

function dispositionErrors(
  root: string,
  groups: ContextAuditDuplicateGroup[],
  dispositions: ContextBloatDisposition[],
  monkeypatchCandidates: Array<{ id: string; sources: string[] }>,
): string[] {
  const errors: string[] = []
  const activeMonkeypatchIds = new Set(
    monkeypatchCandidates.map((candidate) => candidate.id),
  )

  for (const disposition of dispositions) {
    if (
      disposition.category === 'monkeypatch' &&
      !activeMonkeypatchIds.has(disposition.id)
    ) {
      continue
    }

    for (const sourcePath of disposition.sources) {
      if (!dispositionSourceExists(root, sourcePath)) {
        errors.push(
          `stale disposition source in ${disposition.id}: ${sourcePath}`,
        )
      }
    }
  }

  const duplicateDispositions = dispositions.filter(
    (item) => item.category === 'duplicate',
  )

  for (const group of groups) {
    const covered = duplicateDispositions.some((disposition) =>
      group.sources.every((occurrence) =>
        disposition.sources.some((declared) =>
          sourceCovered(occurrence.path, declared),
        ),
      ),
    )

    if (!covered) {
      errors.push(
        `duplicate group lacks a disposition: ${group.sources
          .map((item) => item.path)
          .join(', ')}`,
      )
    }
  }

  for (const candidate of monkeypatchCandidates) {
    const disposition = dispositions.find(
      (item) => item.id === candidate.id && item.category === 'monkeypatch',
    )

    if (!disposition) {
      errors.push(`monkeypatch candidate lacks a disposition: ${candidate.id}`)
      continue
    }

    if (
      !candidate.sources.every((candidateSource) =>
        disposition.sources.includes(candidateSource),
      )
    ) {
      errors.push(
        `monkeypatch disposition ${candidate.id} does not cover every source.`,
      )
    }
  }

  return errors
}

/** Inventory agent context surfaces and validate context-bloat dispositions. */
export function auditAgentContext(root: string): ContextAuditResult {
  const sources = canonicalSources(root)
  const groups = duplicateGroups(sources)
  const errors: string[] = []
  const dispositions = parseDispositions(root, errors)
  const monkeypatchCandidates = [
    {
      id: 'installer-projection-renderer-mirror',
      sources: [
        'src/lib/cursor-content.ts#projectCursorContent',
        'bin/install-support#projectCursorContent',
      ],
    },
    {
      id: 'installer-policy-renderer-mirror',
      sources: [
        'src/lib/cursor-content.ts#renderPolicyCursorRule',
        'bin/install-support#renderPolicyCursorRule',
      ],
    },
  ].filter((candidate) =>
    candidate.sources.every((sourcePath) =>
      dispositionSourceExists(root, sourcePath),
    ),
  )
  const dispositionIssues = dispositionErrors(
    root,
    groups,
    dispositions,
    monkeypatchCandidates,
  )
  const categories = new Map<string, string[]>()

  for (const item of sources) {
    const paths = categories.get(item.category) ?? []
    paths.push(item.path)
    categories.set(item.category, paths)
  }

  return {
    errors: [...errors, ...dispositionIssues],
    disposition_errors: dispositionIssues,
    source_coverage: [...categories.entries()]
      .map(([category, paths]) => ({
        category,
        count: paths.length,
        paths: paths.sort(),
      }))
      .sort((left, right) => left.category.localeCompare(right.category)),
    duplicate_groups: groups,
    monkeypatch_candidates: monkeypatchCandidates,
    dispositions,
  }
}
