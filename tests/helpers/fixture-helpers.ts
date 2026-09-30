import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { sha256 } from '../../src/lib/io.js'
import { parsePersonaMapping } from '../../src/lib/executors/mapping.js'
import { parsePipelineConfig } from '../../src/lib/pipeline-config.js'
import { readHarnessConfig } from '../../src/lib/project-config.js'

export function read(pathname: string): unknown {
  return JSON.parse(readFileSync(pathname, 'utf8')) as unknown
}

export function writeJson(pathname: string, value: unknown): void {
  mkdirSync(path.dirname(pathname), { recursive: true })
  writeFileSync(pathname, `${JSON.stringify(value, null, 2)}\n`)
}

/**
 * Write a one-stage read-only workflow into a fixture and return its slug.
 *
 * A read-only start stage is what a test needs to exercise workspace
 * attribution and immediate terminal failure, and no shipped workflow starts
 * that way. The stage declares a judgment criterion only, so submission
 * evaluates the harness-injected deterministic criteria without running a
 * shell gate.
 */
export function writeInspectionWorkflow(root: string): string {
  const slug = 'inspection'
  const directory = path.join(root, 'library', 'workflows', slug)

  writeJson(path.join(directory, 'workflow.json'), {
    schema_version: 1,
    slug,
    title: 'Repository inspection',
    description: 'A one-stage read-only workflow used to inspect a workspace.',
    start_stage: 'inspect',
    limits: {
      max_total_transitions: 3,
      max_stage_attempts: 1,
      max_consecutive_failures: 1,
    },
    stages: ['inspect'],
  })
  writeJson(path.join(directory, 'stages', 'inspect.json'), {
    slug: 'inspect',
    title: 'Inspect repository',
    persona: 'reviewer',
    prompt_path: `library/workflows/${slug}/prompts/inspect.md`,
    workspace_policy: 'read_only',
    gate: 'stage_verdict',
    context: { request: 'required' },
    required_data: {
      inspection: 'object',
      'inspection.findings': 'array',
      'inspection.verdict': 'string',
    },
    criteria: [
      {
        id: 'inspect.evidence',
        type: 'judgment',
        hard: true,
        statement: 'Every finding names the evidence that establishes it.',
      },
    ],
    transitions: {
      success: 'succeeded',
      failure: 'failed',
      blocked: 'paused',
    },
  })
  mkdirSync(path.join(directory, 'prompts'), { recursive: true })
  writeFileSync(
    path.join(directory, 'prompts', 'inspect.md'),
    [
      '## Objective',
      '',
      'Inspect the workspace and report findings. Change no file.',
      '',
      '## Output',
      '',
      'Populate `data.inspection` (`findings`, `verdict`).',
      '',
    ].join('\n'),
  )

  return slug
}

/** Repository-relative paths of the planning fixture's specification files. */
export const PLANNING_FIXTURE_SPECS = {
  parent: 'runtime/specs/parent-specification.md',
  child: 'runtime/specs/c1.md',
} as const

/**
 * A child specification the child-spec validator accepts.
 *
 * The parent is referenced through an audited block rather than copied, and
 * `In scope` names the originating items the chunk owns, one time each.
 */
export function childSpecificationMarkdown(options: {
  parentPath: string
  parentDigest: string
  inScope: string[]
}): string {
  return [
    '# Child specification',
    '',
    '## Parent specification',
    '',
    `- Source: \`${options.parentPath}\``,
    '- Selected range: the complete file.',
    `- Content digest: \`${options.parentDigest}\``,
    '- Read when: read the parent before you decide anything outside this chunk.',
    '',
    '## Objective',
    '',
    'Deliver one coherent outcome.',
    '',
    '## In scope',
    '',
    ...options.inScope.map((item) => `- ${item}`),
    '',
    '## Out of scope',
    '',
    'Everything another chunk owns.',
    '',
    '## Acceptance criteria',
    '',
    '- The chunk behaves as stated.',
    '',
    '## Dependencies',
    '',
    'None.',
    '',
    '## Validation',
    '',
    'Run the configured fast profile.',
    '',
    '## Handoff contract',
    '',
    'The branch merges cleanly into the base branch.',
    '',
  ].join('\n')
}

/**
 * Write the parent and the single child specification a planning fixture
 * ratifies, and return the matching `cohort_plan` data.
 */
export function writePlanningFixtureSpecs(
  root: string,
): Record<string, unknown> {
  const parentBody = '# Parent specification\n\nThe complete record.\n'
  const parentAbsolute = path.join(root, PLANNING_FIXTURE_SPECS.parent)

  mkdirSync(path.dirname(parentAbsolute), { recursive: true })
  writeFileSync(parentAbsolute, parentBody)
  writeFileSync(
    path.join(root, PLANNING_FIXTURE_SPECS.child),
    childSpecificationMarkdown({
      parentPath: PLANNING_FIXTURE_SPECS.parent,
      parentDigest: `sha256:${sha256(parentBody.trim())}`,
      // The single chunk owns every labeled originating item of the fixture
      // product specification, so the child-spec validator's exactly-once
      // check is exercised for real rather than bypassed by unlabeled prose.
      inScope: ['US-01', 'C-1', 'OOS-1'],
    }),
  )

  return {
    parent_spec_path: PLANNING_FIXTURE_SPECS.parent,
    chunks: [
      {
        id: 'c1',
        title: 'Run a workflow',
        cohort_index: 1,
        child_spec_path: PLANNING_FIXTURE_SPECS.child,
        depends_on: [],
      },
    ],
    edges: [],
    cohorts: [{ index: 1, chunks: ['c1'] }],
    serial_justification: 'The fixture change is one indivisible outcome.',
  }
}

/**
 * Write a Cursor model catalog into a fixture covering every cursor-executor
 * spec that fixture's own config names.
 *
 * The real catalog at `governance/registries/cursor_model_catalog.json` is
 * account-local and untracked, so `createFixture` copies one only on a machine
 * whose operator happens to have it. A test that needs a catalog prediction
 * must therefore bring its own, or it passes and fails by whose checkout it
 * runs in.
 */
export function writeFixtureCursorCatalog(root: string): void {
  const config = readHarnessConfig(root, path.join(root, 'config.json'))
  const pipeline = parsePipelineConfig(config, 'config.json')
  const specs = [
    ...Object.values(pipeline.anthropic ?? {}),
    ...Object.values(pipeline.oai ?? {}),
    ...Object.values(pipeline.open ?? {}),
    ...Object.values(pipeline.cursor ?? {}),
    ...Object.values(pipeline.defaults ?? {}),
    ...Object.values(pipeline.configs ?? {}).flatMap((entry) =>
      Object.values(entry.personas ?? {}),
    ),
  ]
  const collected = new Map<
    string,
    { parameters: Map<string, Set<string>>; variants: Record<string, string>[] }
  >()

  for (const raw of specs) {
    if (typeof raw !== 'string' || raw.length === 0) {
      continue
    }

    const mapping = parsePersonaMapping(raw, 'fixture catalog')

    if (mapping.executor !== 'cursor') {
      continue
    }

    const model = collected.get(mapping.model) ?? {
      parameters: new Map<string, Set<string>>(),
      variants: [],
    }

    for (const [key, value] of Object.entries(mapping.options)) {
      const values = model.parameters.get(key) ?? new Set<string>()

      values.add(value)
      model.parameters.set(key, values)
    }

    // Every spec the config names must be a declared combination, or loading
    // that config against this catalog fails.
    model.variants.push({ ...mapping.options })
    collected.set(mapping.model, model)
  }

  // `auto-smart` stands in for the bare-id case a catalog still has to know.
  if (!collected.has('auto-smart')) {
    collected.set('auto-smart', {
      parameters: new Map<string, Set<string>>(),
      variants: [{}],
    })
  }

  const catalogPath = path.join(
    root,
    'governance',
    'registries',
    'cursor_model_catalog.json',
  )

  mkdirSync(path.dirname(catalogPath), { recursive: true })
  writeFileSync(
    catalogPath,
    `${JSON.stringify(
      {
        models: [...collected].map(([id, model]) => ({
          id,
          displayName: id,
          aliases: [],
          parameters: [...model.parameters].map(([parameter, values]) => ({
            id: parameter,
            values: [...values].map((value) => ({ value, displayName: value })),
          })),
          variants: model.variants.map((variant) => ({
            params: Object.entries(variant).map(([id, value]) => ({
              id,
              value,
            })),
          })),
        })),
      },
      null,
      2,
    )}\n`,
  )
}
