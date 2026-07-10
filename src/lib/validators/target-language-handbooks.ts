import { readdirSync } from 'node:fs'
import path from 'node:path'

import { fileExists, isRecord, readJson, readText } from '../io.js'
import { isEmbeddedInstallation } from '../project-config.js'
import { detectWorkspaceTechnologies } from '../technologies.js'
import type { HandlerInput, HandlerResult } from '../requirements/types.js'

const GENERATED_BY = 'pancreator-target-language-handbooks'
const CODE_PERSONAS = ['coder', 'qa-tester', 'reviewer', 'spotfixer']

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

  if (fileExists(path.join(root, 'governance', 'policies', 'LANG-001.json'))) {
    issues.push(
      issue(
        'language.policy_stale',
        'No language evidence exists, but generated LANG-001 policy remains.',
      ),
    )
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
  if (!isEmbeddedInstallation(input.root)) {
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

  const policyPath = path.join(
    input.root,
    'governance',
    'policies',
    'LANG-001.json',
  )

  if (!fileExists(policyPath)) {
    issues.push(
      issue('language.policy_missing', 'Generated LANG-001 policy is missing.'),
    )
  } else {
    const policy = readJson(policyPath)
    const sources =
      isRecord(policy) && Array.isArray(policy.guidance_sources)
        ? policy.guidance_sources
            .flatMap((source) =>
              isRecord(source) && typeof source.path === 'string'
                ? [source.path]
                : [],
            )
            .sort()
        : []

    if (!isRecord(policy) || policy.generated_by !== GENERATED_BY) {
      issues.push(
        issue(
          'language.policy_unmarked',
          'LANG-001 policy must be marked as generated target language guidance.',
        ),
      )
    }

    if (sources.join('\n') !== expectedPaths.join('\n')) {
      issues.push(
        issue(
          'language.policy_sources',
          'LANG-001 guidance_sources must exactly equal the detected handbook paths.',
        ),
      )
    }
  }

  const lookup = readJson(
    path.join(
      input.root,
      'governance',
      'registries',
      'policy_lookup_table.json',
    ),
  )
  const rows = generatedLanguageRows(lookup)
  const personas = rows
    .filter(
      (row) =>
        Array.isArray(row.policies) &&
        row.policies.length === 1 &&
        row.policies[0] === 'LANG-001' &&
        typeof row.persona === 'string',
    )
    .map((row) => row.persona)
    .sort()

  if (personas.join('\n') !== CODE_PERSONAS.join('\n')) {
    issues.push(
      issue(
        'language.lookup_rows',
        `Generated LANG-001 rows must exactly cover ${CODE_PERSONAS.join(', ')}.`,
      ),
    )
  }

  if (rows.length !== CODE_PERSONAS.length) {
    issues.push(
      issue(
        'language.lookup_duplicates',
        'Generated LANG-001 lookup rows must be unique and contain no extra rows.',
      ),
    )
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}
