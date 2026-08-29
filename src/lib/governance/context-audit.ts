import { readdirSync } from 'node:fs'
import path from 'node:path'

import { fileExists, isDirectory, isRecord, readJson, readText } from '../io.js'
import { loadPolicyCatalog } from '../policies.js'
import { renderCursorProjectionSources } from '../projection.js'

const DIRECTIVE_PATTERN =
  /[^.\n]*\b(?:MUST(?: NOT)?|SHOULD(?: NOT)?|MAY)\b[^.\n]*(?:\.|$)/gu
const DISPOSITIONS_PATH =
  'governance/registries/context_bloat_dispositions.json'
const DISPOSITIONS_EXTENSION_DIRECTORY =
  'governance/registries/context_bloat_dispositions.d'
const EXTENSION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const DISPOSITIONS = new Set(['retain', 'absorb', 'generalize', 'remove'])
const CATEGORIES = new Set(['duplicate', 'monkeypatch'])

type ContextOwner = 'harness' | 'target'

interface ContextSource {
  category: string
  path: string
  content: string
  generated: boolean
  owner: ContextOwner
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
  sources: Array<{ path: string; line: number; owner: ContextOwner }>
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
  owner: ContextOwner = 'harness',
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
    owner,
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
  const catalog = loadPolicyCatalog(root)
  const targetPolicyPaths = new Set<string>()
  const targetGuidance = new Set<string>()
  const harnessGuidance = new Set<string>()

  // A target extension declares its own policies and handbooks. Those surfaces
  // restate harness norms in target vocabulary by design, so ownership has to
  // travel with them. A file any harness policy also references stays
  // harness-owned.
  for (const policy of catalog.values()) {
    const targetOwned = typeof policy.target_extension === 'string'

    if (targetOwned) {
      targetPolicyPaths.add(`governance/policies/${policy.id}.json`)
    }

    for (const guidance of policy.guidance ?? []) {
      if (targetOwned) {
        targetGuidance.add(guidance.source_path)
      } else {
        harnessGuidance.add(guidance.source_path)
      }
    }
  }

  const sources = definitions.flatMap((definition) =>
    listFiles(root, definition.root, definition.suffixes).flatMap(
      (relative) => {
        const item = source(
          root,
          definition.category,
          relative,
          targetPolicyPaths.has(relative) ? 'target' : 'harness',
        )

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

  for (const relative of [...harnessGuidance, ...targetGuidance]) {
    if (existing.has(relative)) {
      continue
    }

    const item = source(
      root,
      'guidance',
      relative,
      harnessGuidance.has(relative) ? 'harness' : 'target',
    )

    if (item) {
      sources.push(item)
      existing.add(item.path)
    }
  }

  for (const projection of renderCursorProjectionSources(root)) {
    sources.push({
      category: 'generated_projection',
      path: `generated:${projection.path}`,
      content: projection.content,
      generated: true,
      owner: 'harness',
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

  // A formatter wraps the RFC 2119 preamble, which leaves the RFC clause on a
  // later line. The term enumeration alone identifies the boilerplate.
  if (
    normalized.startsWith('the terms must') &&
    normalized.includes('must not') &&
    normalized.includes('should not')
  ) {
    return true
  }

  return (
    (normalized.startsWith('must') &&
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
    Map<string, { path: string; line: number; owner: ContextOwner }>
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
        bySource.set(item.path, {
          path: item.path,
          line: index + 1,
          owner: item.owner,
        })
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

function validDispositionEntry(item: unknown): boolean {
  return (
    isRecord(item) &&
    typeof item.id === 'string' &&
    EXTENSION_ID_PATTERN.test(item.id) &&
    typeof item.category === 'string' &&
    CATEGORIES.has(item.category) &&
    Array.isArray(item.sources) &&
    item.sources.length > 0 &&
    item.sources.every(
      (entry) => typeof entry === 'string' && entry.length > 0,
    ) &&
    typeof item.disposition === 'string' &&
    DISPOSITIONS.has(item.disposition) &&
    typeof item.rationale === 'string' &&
    item.rationale.trim().length > 0 &&
    Array.isArray(item.evidence) &&
    item.evidence.length > 0 &&
    item.evidence.every(
      (entry) => typeof entry === 'string' && entry.length > 0,
    )
  )
}

function collectDispositionEntries(
  entries: unknown[],
  source: string,
  ids: Set<string>,
  dispositions: ContextBloatDisposition[],
  errors: string[],
): void {
  for (const [index, item] of entries.entries()) {
    const label = `${source}:entries[${index}]`

    if (!validDispositionEntry(item)) {
      errors.push(`${label} is invalid.`)
      continue
    }

    const entry = item as unknown as ContextBloatDisposition

    if (ids.has(entry.id)) {
      errors.push(`${label} duplicates disposition id ${entry.id}.`)
      continue
    }

    ids.add(entry.id)
    dispositions.push(entry)
  }
}

function dispositionExtensionNames(root: string): string[] {
  const absolute = path.join(root, DISPOSITIONS_EXTENSION_DIRECTORY)

  if (!isDirectory(absolute)) {
    return []
  }

  return readdirSync(absolute)
    .filter((name) => name.endsWith('.json'))
    .sort()
}

/**
 * Read the harness registry, then every target-authored layer under
 * `context_bloat_dispositions.d/`. An installation replaces the harness
 * registry wholesale, so a target records dispositions for its own context
 * surfaces in that directory to survive an update.
 */
function parseDispositions(
  root: string,
  errors: string[],
): ContextBloatDisposition[] {
  const dispositions: ContextBloatDisposition[] = []
  const ids = new Set<string>()
  const absolute = path.join(root, DISPOSITIONS_PATH)

  if (!fileExists(absolute)) {
    errors.push(
      `missing context-bloat disposition record: ${DISPOSITIONS_PATH}`,
    )
  } else {
    const value = readJson(absolute)

    if (
      !isRecord(value) ||
      value.schema_version !== 1 ||
      !Array.isArray(value.entries)
    ) {
      errors.push(
        `${DISPOSITIONS_PATH} MUST contain schema_version 1 and entries[].`,
      )
    } else {
      collectDispositionEntries(
        value.entries,
        DISPOSITIONS_PATH,
        ids,
        dispositions,
        errors,
      )
    }
  }

  for (const name of dispositionExtensionNames(root)) {
    const source = `${DISPOSITIONS_EXTENSION_DIRECTORY}/${name}`
    const value = readJson(path.join(root, source))

    if (
      !isRecord(value) ||
      value.schema_version !== 1 ||
      !Array.isArray(value.entries)
    ) {
      errors.push(`${source} MUST contain schema_version 1 and entries[].`)
      continue
    }

    if (
      typeof value.extension_id !== 'string' ||
      !EXTENSION_ID_PATTERN.test(value.extension_id)
    ) {
      errors.push(`${source}.extension_id MUST use lowercase hyphenated words.`)
      continue
    }

    if (name !== `${value.extension_id}.json`) {
      errors.push(`${source} MUST match extension_id ${value.extension_id}.`)
      continue
    }

    collectDispositionEntries(value.entries, source, ids, dispositions, errors)
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

/**
 * File component of an evidence string such as `tests/unit/x.test.ts: what it
 * pins`. Prose evidence with no path component is not checked.
 */
function dispositionEvidenceFile(evidence: string): string | null {
  const candidate = evidence.split(/[:\s]/u, 1)[0] ?? ''

  return candidate.includes('/') ? candidate : null
}

/**
 * A fixture or installation that carries no `tests/` tree cannot be asked to
 * hold the test the harness registry cites; the check applies only where the
 * top-level directory of the evidence path exists.
 */
function evidenceTreePresent(root: string, evidenceFile: string): boolean {
  const top = evidenceFile.split('/', 1)[0] ?? ''

  return top.length > 0 && fileExists(path.join(root, top))
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

    // A retained duplication claims a guard. When the evidence names a file,
    // that file must exist, or the claim outlives the test that backed it.
    for (const evidence of disposition.evidence) {
      const evidenceFile = dispositionEvidenceFile(evidence)

      if (
        evidenceFile &&
        evidenceTreePresent(root, evidenceFile) &&
        !fileExists(path.join(root, evidenceFile))
      ) {
        errors.push(
          `stale disposition evidence in ${disposition.id}: ${evidenceFile}`,
        )
      }
    }
  }

  const duplicateDispositions = dispositions.filter(
    (item) => item.category === 'duplicate',
  )

  for (const group of groups) {
    // A target handbook restating a harness directive is the documented
    // purpose of a target extension, not context bloat. Requiring a
    // disposition here would charge every target a recurring tax for
    // guidance the harness itself asked it to write.
    if (new Set(group.sources.map((item) => item.owner)).size > 1) {
      continue
    }

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
