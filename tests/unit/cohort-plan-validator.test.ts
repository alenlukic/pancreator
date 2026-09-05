import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { referenceContentSha256, sha256 } from '../../src/lib/io.js'
import {
  validateChildSpecifications,
  validateCohortPlan,
} from '../../src/lib/validators/cohort-plan.js'
import type { HandlerInput } from '../../src/lib/requirements/types.js'
import { createFixture, writeJson } from '../helpers.js'

const PARENT_PATH = 'runtime/specs/parent-specification.md'
const DEFAULT_PARENT_BODY = 'Parent record of the request.\n'

function parentText(body: string): string {
  return `# Parent specification\n\n${body}`
}

/** Digest a child reference must record for a parent with `body`: the trimmed basis. */
function parentDigest(body = DEFAULT_PARENT_BODY): string {
  return `sha256:${referenceContentSha256(parentText(body))}`
}

interface PlanChunkFixture {
  id: string
  title?: string
  cohort_index: number
  child_spec_path: string
  depends_on?: string[]
}

function handlerInput(root: string, targetPath: string): HandlerInput {
  return {
    root,
    targetPath,
    requirement: {
      policy_id: 'COHORT-001',
      requirement_id: 'cohort-plan-validate',
      registry_id: 'COHORT-PLAN-VALIDATE-001',
      arguments: {},
    },
  }
}

function writeParent(root: string, body = DEFAULT_PARENT_BODY) {
  mkdirSync(path.join(root, path.dirname(PARENT_PATH)), { recursive: true })
  writeFileSync(path.join(root, PARENT_PATH), parentText(body))
}

function childSpec(options: {
  inScope: string
  digest?: string
  omitSection?: string
  parentPath?: string
  extra?: string
}): string {
  const sections: Array<[string, string]> = [
    ['Objective', 'Deliver one coherent outcome.'],
    ['In scope', options.inScope],
    ['Out of scope', 'Everything another chunk owns.'],
    ['Acceptance criteria', '- The chunk behaves as stated.'],
    ['Dependencies', 'None.'],
    ['Validation', 'Run the configured fast profile.'],
    ['Handoff contract', 'The branch merges cleanly into the base branch.'],
  ]
  const digest = options.digest ?? parentDigest()
  const lines = [
    '# Child specification',
    '',
    '## Parent specification',
    '',
    `- Source: \`${options.parentPath ?? PARENT_PATH}\``,
    '- Selected range: the complete file.',
    `- Content digest: \`${digest}\``,
    '- Read when: read the parent before you decide anything outside this chunk.',
    '',
  ]

  for (const [heading, body] of sections) {
    if (heading === options.omitSection) {
      continue
    }

    lines.push(`## ${heading}`, '', body, '')
  }

  return `${lines.join('\n')}${options.extra ?? ''}`
}

function writePlanOutput(
  root: string,
  chunks: PlanChunkFixture[],
  options: {
    edges?: Array<{ from: string; to: string }>
    cohorts?: Array<{ index: number; chunks: string[] }>
    serialJustification?: string
    userStoryIds?: string[]
    constraintIds?: string[]
    outOfScopeIds?: string[]
    openQuestionIds?: string[]
    dispositions?: Array<{ id: string; disposition: string }>
    sharedItems?: string[]
    parentSpecPath?: string
    /** Raw `product_spec` entries that replace the generated, labeled ones. */
    productSpecOverrides?: Record<string, unknown>
  } = {},
): string {
  const cohorts =
    options.cohorts ??
    [...new Set(chunks.map((chunk) => chunk.cohort_index))].map((index) => ({
      index,
      chunks: chunks
        .filter((chunk) => chunk.cohort_index === index)
        .map((chunk) => chunk.id),
    }))
  const targetPath = 'runtime/logs/workflows/plan-run/outputs/plan.json'

  writeJson(path.join(root, targetPath), {
    schema_version: 1,
    invocation_id: 'plan-1',
    result: 'success',
    summary: 'Plan fixture',
    data: {
      // The planner writes user stories as objects and writes constraints,
      // out-of-scope statements, and open questions as plain strings that
      // open with their identifier. The fixture keeps that shape so a pass
      // here means a pass against a real ratified plan.
      product_spec: {
        user_stories: (options.userStoryIds ?? []).map((id) => ({
          id,
          statement: `Story ${id}`,
        })),
        constraints: (options.constraintIds ?? []).map(
          (id) => `${id}: Keep the constraint ${id}.`,
        ),
        out_of_scope: (options.outOfScopeIds ?? []).map(
          (id) => `${id}: Leave ${id} to another change.`,
        ),
        open_questions: (options.openQuestionIds ?? []).map(
          (id) => `${id}: Who decides ${id}?`,
        ),
        ...options.productSpecOverrides,
      },
      open_question_dispositions: options.dispositions ?? [],
      cohort_plan: {
        parent_spec_path: options.parentSpecPath ?? PARENT_PATH,
        chunks: chunks.map((chunk) => ({
          title: chunk.title ?? chunk.id,
          depends_on: [],
          ...chunk,
        })),
        edges: options.edges ?? [],
        cohorts,
        ...(options.sharedItems === undefined
          ? {}
          : { shared_items: options.sharedItems }),
        ...(options.serialJustification === undefined
          ? {}
          : { serial_justification: options.serialJustification }),
      },
    },
  })

  return targetPath
}

function issueCodes(
  result: ReturnType<typeof validateCohortPlan>,
): Set<string> {
  return new Set(result.issues.map((entry) => entry.code))
}

test('cohort-plan-validate accepts an acyclic two-cohort plan', () => {
  const root = createFixture()

  writeParent(root)
  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime/specs/c1.md'),
    childSpec({ inScope: '- US-1' }),
  )
  writeFileSync(
    path.join(root, 'runtime/specs/c2.md'),
    childSpec({ inScope: '- US-2' }),
  )

  const targetPath = writePlanOutput(root, [
    { id: 'c1', cohort_index: 1, child_spec_path: 'runtime/specs/c1.md' },
    {
      id: 'c2',
      cohort_index: 2,
      child_spec_path: 'runtime/specs/c2.md',
      depends_on: ['c1'],
    },
  ])
  const result = validateCohortPlan(handlerInput(root, targetPath))

  assert.deepEqual(result.issues, [])
  assert.equal(result.status, 'passed')
})

test('cohort-plan-validate rejects a dependency inside one cohort', () => {
  const root = createFixture()

  writeParent(root)
  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime/specs/c1.md'),
    childSpec({ inScope: '- US-1' }),
  )
  writeFileSync(
    path.join(root, 'runtime/specs/c2.md'),
    childSpec({ inScope: '- US-2' }),
  )

  const targetPath = writePlanOutput(
    root,
    [
      { id: 'c1', cohort_index: 1, child_spec_path: 'runtime/specs/c1.md' },
      {
        id: 'c2',
        cohort_index: 1,
        child_spec_path: 'runtime/specs/c2.md',
        depends_on: ['c1'],
      },
    ],
    { edges: [{ from: 'c1', to: 'c2' }] },
  )
  const codes = issueCodes(validateCohortPlan(handlerInput(root, targetPath)))

  assert.ok(codes.has('cohort.intra_cohort_dependency'))
  assert.ok(codes.has('cohort.intra_cohort_edge'))
})

test('cohort-plan-validate rejects a forward dependency and a cycle', () => {
  const root = createFixture()

  writeParent(root)
  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })

  for (const name of ['c1', 'c2']) {
    writeFileSync(
      path.join(root, `runtime/specs/${name}.md`),
      childSpec({ inScope: `- US-${name}` }),
    )
  }

  const forward = writePlanOutput(root, [
    {
      id: 'c1',
      cohort_index: 1,
      child_spec_path: 'runtime/specs/c1.md',
      depends_on: ['c2'],
    },
    { id: 'c2', cohort_index: 2, child_spec_path: 'runtime/specs/c2.md' },
  ])

  assert.ok(
    issueCodes(validateCohortPlan(handlerInput(root, forward))).has(
      'cohort.forward_dependency',
    ),
  )

  const cyclic = writePlanOutput(
    root,
    [
      { id: 'c1', cohort_index: 1, child_spec_path: 'runtime/specs/c1.md' },
      { id: 'c2', cohort_index: 2, child_spec_path: 'runtime/specs/c2.md' },
    ],
    {
      edges: [
        { from: 'c1', to: 'c2' },
        { from: 'c2', to: 'c1' },
      ],
    },
  )

  assert.ok(
    issueCodes(validateCohortPlan(handlerInput(root, cyclic))).has(
      'cohort.cycle',
    ),
  )
})

test('cohort-plan-validate rejects a chunk without a child specification', () => {
  const root = createFixture()

  writeParent(root)

  const targetPath = writePlanOutput(
    root,
    [{ id: 'c1', cohort_index: 1, child_spec_path: 'runtime/specs/gone.md' }],
    { serialJustification: 'One coherent outcome.' },
  )

  assert.ok(
    issueCodes(validateCohortPlan(handlerInput(root, targetPath))).has(
      'cohort.child_spec_missing',
    ),
  )
})

test('cohort-plan-validate requires depends_on on every chunk and refuses an empty cohort', () => {
  const root = createFixture()

  writeParent(root)
  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime/specs/c1.md'),
    childSpec({ inScope: '- US-1' }),
  )
  writeFileSync(
    path.join(root, 'runtime/specs/c2.md'),
    childSpec({ inScope: '- US-2' }),
  )

  // An explicit `undefined` wins over the fixture default and is dropped from
  // the JSON, so the chunk reaches the validator with no depends_on key.
  const missing = writePlanOutput(root, [
    {
      id: 'c1',
      cohort_index: 1,
      child_spec_path: 'runtime/specs/c1.md',
      depends_on: undefined,
    },
    {
      id: 'c2',
      cohort_index: 2,
      child_spec_path: 'runtime/specs/c2.md',
      depends_on: ['c1'],
    },
  ])
  const missingResult = validateCohortPlan(handlerInput(root, missing))

  assert.ok(issueCodes(missingResult).has('cohort.depends_on_missing'))
  assert.ok(
    missingResult.issues.some((entry) => entry.message.includes("'c1'")),
  )

  const empty = writePlanOutput(
    root,
    [
      { id: 'c1', cohort_index: 1, child_spec_path: 'runtime/specs/c1.md' },
      {
        id: 'c2',
        cohort_index: 3,
        child_spec_path: 'runtime/specs/c2.md',
        depends_on: ['c1'],
      },
    ],
    {
      cohorts: [
        { index: 1, chunks: ['c1'] },
        { index: 2, chunks: [] },
        { index: 3, chunks: ['c2'] },
      ],
    },
  )
  const emptyResult = validateCohortPlan(handlerInput(root, empty))

  assert.ok(issueCodes(emptyResult).has('cohort.empty_group'))
  assert.ok(
    emptyResult.issues.some((entry) => entry.message.includes('Cohort 2')),
  )
})

test('cohort-plan-validate requires a serial justification for a single chunk', () => {
  const root = createFixture()

  writeParent(root)
  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime/specs/c1.md'),
    childSpec({ inScope: '- US-1' }),
  )

  const without = writePlanOutput(root, [
    { id: 'c1', cohort_index: 1, child_spec_path: 'runtime/specs/c1.md' },
  ])

  assert.ok(
    issueCodes(validateCohortPlan(handlerInput(root, without))).has(
      'cohort.serial_justification',
    ),
  )

  const withReason = writePlanOutput(
    root,
    [{ id: 'c1', cohort_index: 1, child_spec_path: 'runtime/specs/c1.md' }],
    { serialJustification: 'The change is one indivisible migration.' },
  )

  assert.deepEqual(
    validateCohortPlan(handlerInput(root, withReason)).issues,
    [],
  )
})

test('child-spec-validate accepts complete child specifications', () => {
  const root = createFixture()

  writeParent(root)
  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime/specs/c1.md'),
    childSpec({ inScope: '- US-1' }),
  )
  writeFileSync(
    path.join(root, 'runtime/specs/c2.md'),
    childSpec({ inScope: '- US-2' }),
  )

  const targetPath = writePlanOutput(
    root,
    [
      { id: 'c1', cohort_index: 1, child_spec_path: 'runtime/specs/c1.md' },
      { id: 'c2', cohort_index: 2, child_spec_path: 'runtime/specs/c2.md' },
    ],
    { userStoryIds: ['US-1', 'US-2'] },
  )

  assert.deepEqual(
    validateChildSpecifications(handlerInput(root, targetPath)).issues,
    [],
  )
})

test('child-spec-validate rejects a missing section and a malformed parent reference', () => {
  const root = createFixture()

  writeParent(root)
  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime/specs/c1.md'),
    childSpec({
      inScope: '- US-1',
      omitSection: 'Handoff contract',
      digest: 'not-a-digest',
    }),
  )

  const targetPath = writePlanOutput(
    root,
    [{ id: 'c1', cohort_index: 1, child_spec_path: 'runtime/specs/c1.md' }],
    { userStoryIds: ['US-1'], serialJustification: 'One outcome.' },
  )
  const codes = issueCodes(
    validateChildSpecifications(handlerInput(root, targetPath)),
  )

  assert.ok(codes.has('child.section_missing'))
  assert.ok(codes.has('child.parent_reference_digest'))
})

test('child-spec-validate rejects a parent digest computed on the untrimmed file', () => {
  const root = createFixture()

  writeParent(root)
  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })

  // `shasum` over the file hashes the trailing newline; the card and the
  // validator hash the trimmed text. The two differ for identical content.
  const rawDigest = `sha256:${sha256(parentText(DEFAULT_PARENT_BODY))}`

  assert.notEqual(rawDigest, parentDigest())

  writeFileSync(
    path.join(root, 'runtime/specs/c1.md'),
    childSpec({ inScope: '- US-1', digest: rawDigest }),
  )

  const targetPath = writePlanOutput(
    root,
    [{ id: 'c1', cohort_index: 1, child_spec_path: 'runtime/specs/c1.md' }],
    { userStoryIds: ['US-1'], serialJustification: 'One outcome.' },
  )
  const result = validateChildSpecifications(handlerInput(root, targetPath))
  const mismatch = result.issues.find(
    (entry) => entry.code === 'child.parent_reference_digest_mismatch',
  )

  assert.equal(result.status, 'failed')
  assert.ok(mismatch)
  assert.ok(mismatch.message.includes(rawDigest))
  assert.ok(mismatch.message.includes(parentDigest()))
  assert.ok(!issueCodes(result).has('child.parent_reference_digest'))

  // The trimmed digest is accepted, and it is the digest the chunk card
  // records for the same file.
  writeFileSync(
    path.join(root, 'runtime/specs/c1.md'),
    childSpec({ inScope: '- US-1' }),
  )

  assert.deepEqual(
    validateChildSpecifications(handlerInput(root, targetPath)).issues,
    [],
  )
})

test('child-spec-validate rejects a pasted parent body', () => {
  const root = createFixture()

  const parentBody = Array.from(
    { length: 60 },
    (_, index) => `requirement ${index}`,
  ).join(' ')

  writeParent(root, `${parentBody}\n`)
  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime/specs/c1.md'),
    childSpec({ inScope: '- US-1', extra: `\n${parentBody}\n` }),
  )

  const targetPath = writePlanOutput(
    root,
    [{ id: 'c1', cohort_index: 1, child_spec_path: 'runtime/specs/c1.md' }],
    { userStoryIds: ['US-1'], serialJustification: 'One outcome.' },
  )

  assert.ok(
    issueCodes(validateChildSpecifications(handlerInput(root, targetPath))).has(
      'child.parent_body_pasted',
    ),
  )
})

test('child-spec-validate rejects an item traced zero times or twice', () => {
  const root = createFixture()

  writeParent(root)
  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime/specs/c1.md'),
    childSpec({ inScope: '- US-1' }),
  )
  writeFileSync(
    path.join(root, 'runtime/specs/c2.md'),
    childSpec({ inScope: '- US-1' }),
  )

  const targetPath = writePlanOutput(
    root,
    [
      { id: 'c1', cohort_index: 1, child_spec_path: 'runtime/specs/c1.md' },
      { id: 'c2', cohort_index: 2, child_spec_path: 'runtime/specs/c2.md' },
    ],
    { userStoryIds: ['US-1', 'US-2'] },
  )
  const codes = issueCodes(
    validateChildSpecifications(handlerInput(root, targetPath)),
  )

  assert.ok(codes.has('child.double_traced_item'))
  assert.ok(codes.has('child.untraced_item'))
})

test('child-spec-validate accepts a shared item two chunks name and still refuses an undeclared double trace', () => {
  const root = createFixture()

  writeParent(root)
  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime/specs/c1.md'),
    childSpec({ inScope: '- US-1\n- C-1' }),
  )
  writeFileSync(
    path.join(root, 'runtime/specs/c2.md'),
    childSpec({ inScope: '- US-2\n- C-1' }),
  )

  const chunks = [
    { id: 'c1', cohort_index: 1, child_spec_path: 'runtime/specs/c1.md' },
    { id: 'c2', cohort_index: 2, child_spec_path: 'runtime/specs/c2.md' },
  ]
  const spec = { userStoryIds: ['US-1', 'US-2'], constraintIds: ['C-1'] }

  const declared = writePlanOutput(root, chunks, {
    ...spec,
    sharedItems: ['C-1'],
  })

  assert.deepEqual(
    validateChildSpecifications(handlerInput(root, declared)).issues,
    [],
  )

  const undeclared = writePlanOutput(root, chunks, spec)
  const codes = issueCodes(
    validateChildSpecifications(handlerInput(root, undeclared)),
  )

  assert.ok(codes.has('child.double_traced_item'))
})

test('child-spec-validate refuses a shared item no child names and a shared id the specification does not declare', () => {
  const root = createFixture()

  writeParent(root)
  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime/specs/c1.md'),
    childSpec({ inScope: '- US-1' }),
  )

  const chunks = [
    { id: 'c1', cohort_index: 1, child_spec_path: 'runtime/specs/c1.md' },
  ]

  const unnamed = writePlanOutput(root, chunks, {
    userStoryIds: ['US-1'],
    constraintIds: ['C-1'],
    serialJustification: 'One outcome.',
    sharedItems: ['C-1'],
  })

  assert.ok(
    validateChildSpecifications(handlerInput(root, unnamed)).issues.some(
      (entry) =>
        entry.code === 'child.untraced_item' && entry.message.includes("'C-1'"),
    ),
  )

  const unknown = writePlanOutput(root, chunks, {
    userStoryIds: ['US-1'],
    serialJustification: 'One outcome.',
    sharedItems: ['C-9'],
  })

  assert.ok(
    validateChildSpecifications(handlerInput(root, unknown)).issues.some(
      (entry) =>
        entry.code === 'child.unknown_shared_item' &&
        entry.message.includes("'C-9'"),
    ),
  )
})

test('child-spec-validate traces string constraints, exclusions, and questions by their leading identifier', () => {
  const root = createFixture()

  writeParent(root)
  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime/specs/c1.md'),
    childSpec({ inScope: '- US-1\n- C-1' }),
  )
  writeFileSync(
    path.join(root, 'runtime/specs/c2.md'),
    childSpec({ inScope: '- US-2' }),
  )

  const targetPath = writePlanOutput(
    root,
    [
      { id: 'c1', cohort_index: 1, child_spec_path: 'runtime/specs/c1.md' },
      { id: 'c2', cohort_index: 2, child_spec_path: 'runtime/specs/c2.md' },
    ],
    {
      userStoryIds: ['US-1', 'US-2'],
      constraintIds: ['C-1', 'C-2'],
      outOfScopeIds: ['OOS-1'],
      openQuestionIds: ['Q1'],
    },
  )
  const result = validateChildSpecifications(handlerInput(root, targetPath))
  const untraced = result.issues
    .filter((entry) => entry.code === 'child.untraced_item')
    .map((entry) => entry.message)

  assert.equal(result.status, 'failed')
  assert.equal(untraced.length, 3)
  assert.ok(untraced.some((message) => message.includes("'C-2'")))
  assert.ok(untraced.some((message) => message.includes("'OOS-1'")))
  assert.ok(untraced.some((message) => message.includes("'Q1'")))
  assert.ok(!untraced.some((message) => message.includes("'C-1'")))
})

test('child-spec-validate reports an originating item that carries no identifier', () => {
  const root = createFixture()

  writeParent(root)
  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime/specs/c1.md'),
    childSpec({ inScope: '- US-1' }),
  )

  // Plain prose with no leading identifier cannot be traced by any child, so
  // it must be reported rather than silently dropped from the check.
  const targetPath = writePlanOutput(
    root,
    [{ id: 'c1', cohort_index: 1, child_spec_path: 'runtime/specs/c1.md' }],
    {
      userStoryIds: ['US-1'],
      serialJustification: 'One outcome.',
      productSpecOverrides: {
        constraints: ['Keep the runtime dependency-free.'],
        out_of_scope: ['Remote services.'],
        open_questions: [{ question: 'Who owns the cache?' }],
      },
    },
  )
  const result = validateChildSpecifications(handlerInput(root, targetPath))
  const unlabeled = result.issues
    .filter((entry) => entry.code === 'child.unlabeled_item')
    .map((entry) => entry.message)

  assert.equal(result.status, 'failed')
  assert.equal(unlabeled.length, 3)
  assert.ok(
    unlabeled.some((message) =>
      message.includes('product_spec.constraints[0]'),
    ),
  )
  assert.ok(
    unlabeled.some((message) =>
      message.includes('product_spec.out_of_scope[0]'),
    ),
  )
  assert.ok(
    unlabeled.some((message) =>
      message.includes('product_spec.open_questions[0]'),
    ),
  )
  assert.ok(!issueCodes(result).has('child.untraced_item'))
})

test('child-spec-validate accepts a deferred question that no chunk owns', () => {
  const root = createFixture()

  writeParent(root)
  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime/specs/c1.md'),
    childSpec({ inScope: '- US-1' }),
  )

  const targetPath = writePlanOutput(
    root,
    [{ id: 'c1', cohort_index: 1, child_spec_path: 'runtime/specs/c1.md' }],
    {
      userStoryIds: ['US-1'],
      openQuestionIds: ['Q-1'],
      serialJustification: 'One outcome.',
      dispositions: [{ id: 'Q-1', disposition: 'deferred' }],
    },
  )

  assert.deepEqual(
    validateChildSpecifications(handlerInput(root, targetPath)).issues,
    [],
  )
})
