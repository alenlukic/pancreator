import { readdirSync } from 'node:fs'
import path from 'node:path'

import { fileExists, isRecord, readJson, readText } from '../io.js'
import { isTargetInstallation } from '../project-config.js'
import { detectWorkspaceTechnologies } from '../technologies.js'
import type { HandlerInput, HandlerResult } from '../requirements/types.js'

const GENERATED_BY = 'pancreator-target-language-handbooks'
const CODE_PERSONAS = ['coder', 'qa-tester', 'reviewer', 'spotfixer']
const LANGUAGE_POLICIES: Record<string, string[]> = {
  python: ['PY-001'],
}
/**
 * The bundle splits the same way the durable language policies do. `LANG-001`
 * keeps the target toolchain instructions and references no handbook, and the
 * generated style policy carries every handbook. Only the librarian style row
 * resolves that style policy, so no delivery persona receives it.
 */
const LANGUAGE_POLICY_FILE = 'LANG-001'
const STYLE_POLICY_FILE = 'LANGSTYLE-001'
const STYLE_ROW = {
  persona: 'librarian',
  workflow: 'standalone',
  stage: 'style',
} as const

function issue(code: string, message: string): HandlerResult['issues'][number] {
  return { code, message }
}

function handbookPath(language: string): string {
  return `governance/handbooks/target/${language}/style-guide.md`
}

function generatedHandbookPaths(root: string): string[] {
  const base = path.join(root, 'governance', 'handbooks', 'target')

  if (!fileExists(base)) {
    return []
  }

  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => handbookPath(entry.name))
    .filter((relative) => fileExists(path.join(root, relative)))
    .sort()
}

function generatedLanguageRows(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    return []
  }

  return value.rows.filter(
    (row): row is Record<string, unknown> =>
      isRecord(row) && row.generated_by === GENERATED_BY,
  )
}

function rowPolicies(row: Record<string, unknown>): string[] {
  return Array.isArray(row.policies)
    ? row.policies
        .filter((policy): policy is string => typeof policy === 'string')
        .sort()
    : []
}

function policyGuidanceSources(policy: unknown): string[] {
  return isRecord(policy) && Array.isArray(policy.guidance_sources)
    ? policy.guidance_sources
        .flatMap((source) =>
          isRecord(source) && typeof source.path === 'string'
            ? [source.path]
            : [],
        )
        .sort()
    : []
}

function validateGeneratedPolicy(
  root: string,
  policyId: string,
  expectedPaths: string[],
  issues: HandlerResult['issues'],
): void {
  const policyPath = path.join(
    root,
    'governance',
    'policies',
    `${policyId}.json`,
  )

  if (!fileExists(policyPath)) {
    issues.push(
      issue(
        'language.policy_missing',
        `Generated ${policyId} policy is missing.`,
      ),
    )
    return
  }

  const policy = readJson(policyPath)

  if (!isRecord(policy) || policy.generated_by !== GENERATED_BY) {
    issues.push(
      issue(
        'language.policy_unmarked',
        `${policyId} policy must be marked as generated target language guidance.`,
      ),
    )
  }

  if (policyGuidanceSources(policy).join('\n') !== expectedPaths.join('\n')) {
    issues.push(
      issue(
        'language.policy_sources',
        expectedPaths.length === 0
          ? `${policyId} MUST NOT declare guidance_sources; the generated style policy carries the handbooks.`
          : `${policyId} guidance_sources must exactly equal the detected handbook paths.`,
      ),
    )
  }
}

function expectedLanguagePolicies(languages: string[]): string[] {
  const policies = new Set(['LANG-001'])

  for (const language of languages) {
    for (const policy of LANGUAGE_POLICIES[language] ?? []) {
      policies.add(policy)
    }
  }

  return [...policies].sort()
}

function validateEmptyBundle(
  root: string,
  issues: HandlerResult['issues'],
): void {
  const paths = generatedHandbookPaths(root)

  if (paths.length > 0) {
    issues.push(
      issue(
        'language.handbooks_stale',
        `No language evidence exists, but generated handbooks remain: ${paths.join(', ')}`,
      ),
    )
  }

  for (const policy of [LANGUAGE_POLICY_FILE, STYLE_POLICY_FILE]) {
    if (
      fileExists(path.join(root, 'governance', 'policies', `${policy}.json`))
    ) {
      issues.push(
        issue(
          'language.policy_stale',
          `No language evidence exists, but generated ${policy} policy remains.`,
        ),
      )
    }
  }

  const lookupPath = path.join(
    root,
    'governance',
    'registries',
    'policy_lookup_table.json',
  )
  const rows = generatedLanguageRows(readJson(lookupPath))

  if (rows.length > 0) {
    issues.push(
      issue(
        'language.rows_stale',
        'No language evidence exists, but generated LANG-001 lookup rows remain.',
      ),
    )
  }
}

/** Validate an embedded target's generated language guidance bundle. */
export function validateTargetLanguageHandbooks(
  input: HandlerInput,
): HandlerResult {
  if (!isTargetInstallation(input.root)) {
    return { status: 'passed', issues: [] }
  }

  const issues: HandlerResult['issues'] = []
  const languages = detectWorkspaceTechnologies(input.root).languages.map(
    (language) => language.id,
  )

  if (languages.length === 0) {
    validateEmptyBundle(input.root, issues)
    return { status: issues.length === 0 ? 'passed' : 'failed', issues }
  }

  const expectedPaths = languages.map(handbookPath)

  for (const relative of expectedPaths) {
    const absolute = path.join(input.root, relative)

    if (!fileExists(absolute)) {
      issues.push(
        issue(
          'language.handbook_missing',
          `Detected language handbook is missing: ${relative}`,
        ),
      )
      continue
    }

    const language = relative.split('/')[3]

    if (
      !readText(absolute).includes(
        `<!-- pancreator-target-language-handbook: ${language} -->`,
      )
    ) {
      issues.push(
        issue(
          'language.handbook_unmarked',
          `Generated language handbook lacks its ownership marker: ${relative}`,
        ),
      )
    }
  }

  const actualPaths = generatedHandbookPaths(input.root)

  if (actualPaths.join('\n') !== expectedPaths.join('\n')) {
    issues.push(
      issue(
        'language.handbook_coverage',
        `Generated handbook paths must exactly match detection. Expected ${expectedPaths.join(', ')}; found ${actualPaths.join(', ') || 'none'}.`,
      ),
    )
  }

  validateGeneratedPolicy(input.root, LANGUAGE_POLICY_FILE, [], issues)
  validateGeneratedPolicy(input.root, STYLE_POLICY_FILE, expectedPaths, issues)

  const lookup = readJson(
    path.join(
      input.root,
      'governance',
      'registries',
      'policy_lookup_table.json',
    ),
  )
  const rows = generatedLanguageRows(lookup)
  const expectedPolicies = expectedLanguagePolicies(languages)
  const codeRows = rows.filter(
    (row) => row.workflow === '*' && row.stage === '*',
  )
  const styleRows = rows.filter(
    (row) =>
      row.persona === STYLE_ROW.persona &&
      row.workflow === STYLE_ROW.workflow &&
      row.stage === STYLE_ROW.stage,
  )
  const personas = codeRows
    .filter(
      (row) =>
        rowPolicies(row).join('\n') === expectedPolicies.join('\n') &&
        typeof row.persona === 'string',
    )
    .map((row) => row.persona)
    .sort()

  if (personas.join('\n') !== CODE_PERSONAS.join('\n')) {
    issues.push(
      issue(
        'language.lookup_rows',
        `Generated language rows must exactly cover ${CODE_PERSONAS.join(', ')} with policies ${expectedPolicies.join(', ')}.`,
      ),
    )
  }

  if (codeRows.length !== CODE_PERSONAS.length) {
    issues.push(
      issue(
        'language.lookup_duplicates',
        `Generated ${LANGUAGE_POLICY_FILE} lookup rows must be unique and contain no extra rows.`,
      ),
    )
  }

  if (
    styleRows.length !== 1 ||
    rowPolicies(styleRows[0] ?? {}).join('\n') !== STYLE_POLICY_FILE
  ) {
    issues.push(
      issue(
        'language.style_lookup_row',
        `Exactly one generated row must bind ${STYLE_POLICY_FILE} to persona ${STYLE_ROW.persona} on workflow ${STYLE_ROW.workflow} at stage ${STYLE_ROW.stage}.`,
      ),
    )
  }

  if (rows.length !== codeRows.length + styleRows.length) {
    issues.push(
      issue(
        'language.lookup_extra_rows',
        'Generated language rows must cover only the code personas and the librarian style row.',
      ),
    )
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}
