import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  linkSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
import test from 'node:test'

import { finalizePlanningReferences } from '../../src/lib/cohorts/specifications.js'
import { buildContextReference } from '../../src/lib/context/references.js'
import { isRecord } from '../../src/lib/io.js'
import { validateChildSpecifications } from '../../src/lib/validators/cohort-plan.js'
import { createTestTempDirectory } from '../temp.js'

const DIRECTORY = 'runtime/logs/workflows/planning-test/operator/specs'

function fixture() {
  const root = createTestTempDirectory('planning-specifications-')
  const parent = `${DIRECTORY}/parent.md`
  const children = ['alpha', 'beta', 'gamma'].map(
    (id) => `${DIRECTORY}/${id}.md`,
  )
  const state: Parameters<typeof finalizePlanningReferences>[1] = {
    run_id: 'planning-test',
    workflow_slug: 'planning',
    current_stage: 'plan',
    status: 'running',
    pending_action: {
      type: 'invoke_agent',
      persona: 'planner',
      path: 'card.md',
    },
    current_invocation: {
      id: 'plan-1',
      json_path: 'card.json',
      markdown_path: 'card.md',
      output_path: 'output.json',
    },
    stage_history: [],
  }
  const output = {
    invocation_id: 'plan-1',
    result: 'success',
    criteria: [{ id: 'plan', result: 'pass', evidence: ['authored'] }],
    risks: ['Worker risk'],
    data: {
      cohort_plan: {
        parent_spec_path: parent,
        chunks: children.map((child_spec_path, index) => ({
          id: ['alpha', 'beta', 'gamma'][index],
          child_spec_path,
          cohort_index: 1,
          depends_on: [],
        })),
      },
    },
  }

  mkdirSync(path.join(root, DIRECTORY), { recursive: true })
  writeFileSync(
    path.join(root, parent),
    '\n # Parent\n\nUnicode: \u03bb \ud83d\ude80\n \n',
  )

  for (const child of children) {
    writeFileSync(
      path.join(root, child),
      [
        '# Child',
        '## Parent specification',
        `- Source: \`${parent}\``,
        '- Selected range: the complete file.',
        '- Content digest: `harness-pending`',
        '- Reference status: draft',
        '- Read when: shared context is needed.',
        '## Objective',
        'Worker objective.',
        '## In scope',
        'US-01',
        '## Out of scope',
        'Unrelated behavior.',
        '## Acceptance criteria',
        '1. AC-01 [proof: test] Preserve this claim.',
        '## Dependencies',
        'None.',
        '## Validation',
        'Focused tests.',
        '## Handoff contract',
        'The child governs its own scope; the parent governs cross-chunk context.',
        '',
      ].join('\n'),
    )
  }

  return { root, parent, children, state, output }
}

test('unsuccessful planning reports preserve unfinished specifications and worker claims', () => {
  for (const result of ['failure', 'blocked']) {
    for (const data of [
      undefined,
      {},
      { cohort_plan: {} },
      { cohort_plan: { chunks: [] } },
      {
        cohort_plan: {
          parent_spec_path: `${DIRECTORY}/absent.md`,
          chunks: [{ child_spec_path: `${DIRECTORY}/unfinished.md` }],
        },
      },
    ]) {
      const { root, children, state, output } = fixture()
      const report = { ...output, result, data }
      const claims = structuredClone(report)
      const original = children.map((child) =>
        readFileSync(path.join(root, child), 'utf8'),
      )

      finalizePlanningReferences(root, state, report, 'plan-1')
      assert.deepEqual(report, claims)
      assert.deepEqual(
        children.map((child) => readFileSync(path.join(root, child), 'utf8')),
        original,
      )
    }
  }
})

test('planning finalization refreshes three file-only children without changing claims', () => {
  const { root, parent, children, state, output } = fixture()
  const claims = structuredClone(output)
  const original = children.map((child) =>
    readFileSync(path.join(root, child), 'utf8'),
  )
  const digest = buildContextReference(root, parent).content_sha256

  finalizePlanningReferences(root, state, output, 'plan-1')
  assert.deepEqual(output, claims)

  for (const [index, child] of children.entries()) {
    assert.equal(
      readFileSync(path.join(root, child), 'utf8'),
      original[index]
        .replace('harness-pending', `sha256:${digest}`)
        .replace('Reference status: draft', 'Reference status: current'),
    )
  }

  const mtimes = children.map(
    (child) => statSync(path.join(root, child)).mtimeMs,
  )

  finalizePlanningReferences(root, state, output, 'plan-1')
  assert.deepEqual(
    children.map((child) => statSync(path.join(root, child)).mtimeMs),
    mtimes,
  )
  writeFileSync(
    path.join(root, parent),
    '\n# Revised parent\n\nUnicode: \u03bb\n\n',
  )
  finalizePlanningReferences(root, state, output, 'plan-1')

  for (const child of children) {
    assert.ok(
      readFileSync(path.join(root, child), 'utf8').includes(
        buildContextReference(root, parent).content_sha256,
      ),
    )
  }

  assert.deepEqual(output, claims)
  const audit = readFileSync(
    path.join(
      root,
      'runtime/logs/workflows/planning-test/agent/evidence/plan-1-planning-references.jsonl',
    ),
    'utf8',
  )
    .trim()
    .split('\n')

  assert.equal(audit.length, 2)
  assert.deepEqual(JSON.parse(audit[1]).changed_reference_paths, children)
})

test('planning finalization rejects unsafe inputs before any child write', () => {
  const cases = [
    'traversal',
    'alias',
    'foreign',
    'missing',
    'duplicate',
    'parent-as-child',
    'symlink',
    'directory-symlink',
    'hardlink',
    'ambiguous',
    'wrong-parent',
    'missing-range',
    'invalid-digest',
    'ambiguous-digest',
    'empty-range',
    'empty-trigger',
    'empty-plan',
  ]

  for (const scenario of cases) {
    const { root, parent, children, state, output } = fixture()
    const first = readFileSync(path.join(root, children[0]), 'utf8')
    const last = children[2]
    const chunk = output.data.cohort_plan.chunks[2]

    switch (scenario) {
      case 'traversal':
        chunk.child_spec_path = `${DIRECTORY}/../outside.md`
        break
      case 'alias':
        chunk.child_spec_path = `${DIRECTORY}/./gamma.md`
        break
      case 'foreign':
        output.data.cohort_plan.parent_spec_path = 'runtime/other/parent.md'
        break
      case 'missing':
        chunk.child_spec_path = `${DIRECTORY}/absent.md`
        break
      case 'duplicate':
        chunk.child_spec_path = children[0]
        break
      case 'parent-as-child':
        chunk.child_spec_path = parent
        break
      case 'symlink':
        symlinkSync(
          path.join(root, last),
          path.join(root, DIRECTORY, 'linked.md'),
        )
        chunk.child_spec_path = `${DIRECTORY}/linked.md`
        break
      case 'directory-symlink':
        symlinkSync(
          path.join(root, DIRECTORY),
          path.join(root, DIRECTORY, 'linked'),
        )
        chunk.child_spec_path = `${DIRECTORY}/linked/gamma.md`
        break
      case 'hardlink':
        linkSync(path.join(root, last), path.join(root, DIRECTORY, 'linked.md'))
        break
      case 'ambiguous':
        writeFileSync(
          path.join(root, last),
          `${first}\n## Parent specification\n`,
        )
        break
      case 'wrong-parent':
        writeFileSync(
          path.join(root, last),
          first.replace(parent, `${DIRECTORY}/different.md`),
        )
        break
      case 'missing-range':
        writeFileSync(
          path.join(root, last),
          first.replace('- Selected range: the complete file.\n', ''),
        )
        break
      case 'invalid-digest':
        writeFileSync(
          path.join(root, last),
          first.replace('harness-pending', 'invented'),
        )
        break
      case 'ambiguous-digest':
        writeFileSync(
          path.join(root, last),
          first.replace(
            '## Objective',
            '- Content digest: `harness-pending`\n## Objective',
          ),
        )
        break
      case 'empty-range':
        writeFileSync(
          path.join(root, last),
          first.replace('the complete file.', ''),
        )
        break
      case 'empty-trigger':
        writeFileSync(
          path.join(root, last),
          first.replace('shared context is needed.', ''),
        )
        break
      case 'empty-plan':
        output.data.cohort_plan.chunks = []
        break
      default:
        assert.fail(`Unknown case: ${scenario}`)
    }

    assert.throws(
      () => finalizePlanningReferences(root, state, output, 'plan-1'),
      Error,
      scenario,
    )
    assert.equal(
      readFileSync(path.join(root, children[0]), 'utf8'),
      first,
      scenario,
    )
  }
})

test('planning finalization leaves approved plans and foreign outputs untouched', () => {
  const { root, children, state, output } = fixture()
  const original = readFileSync(path.join(root, children[0]), 'utf8')

  assert.throws(() =>
    finalizePlanningReferences(
      root,
      state,
      { ...output, invocation_id: 'foreign' },
      'plan-1',
    ),
  )
  state.status = 'awaiting_operator'
  state.pending_action = {
    type: 'operator_approval',
    stage: 'plan',
    proposed_transition: 'end',
  }
  assert.throws(() => finalizePlanningReferences(root, state, output, 'plan-1'))
  state.current_invocation = null
  finalizePlanningReferences(root, state, output, null)
  assert.equal(readFileSync(path.join(root, children[0]), 'utf8'), original)
})

test('child validation supplies missing real digests and still rejects stale recorded digests', () => {
  const { root, children, state, output, parent } = fixture()
  const targetPath = 'output.json'
  const input = {
    root,
    targetPath,
    requirement: {
      policy_id: 'COHORT-001',
      requirement_id: 'child-spec-validate',
      registry_id: 'CHILD-SPEC-VALIDATE-001',
      arguments: {},
    },
  }

  writeFileSync(path.join(root, targetPath), JSON.stringify(output))
  assert.equal(
    validateChildSpecifications(input).issues.some((issue) =>
      issue.code.includes('digest'),
    ),
    false,
  )
  assert.match(
    readFileSync(path.join(root, children[0]), 'utf8'),
    /sha256:[0-9a-f]{64}/u,
  )
  finalizePlanningReferences(root, state, output, 'plan-1')
  assert.ok(
    !validateChildSpecifications(input).issues.some((issue) =>
      issue.code.includes('digest'),
    ),
  )
  writeFileSync(path.join(root, parent), '# Changed parent\n')
  const before = readFileSync(path.join(root, children[0]), 'utf8')

  assert.ok(
    validateChildSpecifications(input).issues.some((issue) =>
      issue.code.includes('digest'),
    ),
  )
  assert.equal(readFileSync(path.join(root, children[0]), 'utf8'), before)
})

test('parent edits and partial write failures fail explicitly and retries repair all references', (context) => {
  for (const scenario of ['parent-edit', 'partial-write']) {
    const { root, parent, children, state, output } = fixture()
    const rename = fs.renameSync
    let writes = 0
    const mocked = context.mock.method(
      fs,
      'renameSync',
      (source: fs.PathLike, destination: fs.PathLike) => {
        if (String(destination).startsWith(path.join(root, DIRECTORY))) {
          writes += 1

          if (scenario === 'partial-write' && writes === 2) {
            throw new Error('Injected child write failure')
          }
        }

        rename(source, destination)

        if (scenario === 'parent-edit' && writes === 1) {
          writeFileSync(path.join(root, parent), '# Concurrent parent edit\n')
        }
      },
    )

    syncBuiltinESMExports()

    try {
      assert.throws(
        () => finalizePlanningReferences(root, state, output, 'plan-1'),
        scenario === 'parent-edit'
          ? /changed during finalization/u
          : /Injected child write failure/u,
      )
      assert.equal(writes, scenario === 'parent-edit' ? 1 : 2)
      const audit: unknown = JSON.parse(
        readFileSync(
          path.join(
            root,
            'runtime/logs/workflows/planning-test/agent/evidence/plan-1-planning-references.jsonl',
          ),
          'utf8',
        ).trim(),
      )

      assert.ok(isRecord(audit))
      assert.equal(audit.state, 'failed')
      assert.deepEqual(audit.changed_reference_paths, [children[0]])
      assert.equal(typeof audit.content_sha256, 'string')
      assert.ok(
        readFileSync(path.join(root, children[2]), 'utf8').includes(
          'harness-pending',
        ),
      )
    } finally {
      mocked.mock.restore()
      syncBuiltinESMExports()
    }

    finalizePlanningReferences(root, state, output, 'plan-1')

    for (const child of children) {
      assert.ok(
        readFileSync(path.join(root, child), 'utf8').includes(
          buildContextReference(root, parent).content_sha256,
        ),
      )
    }
  }
})
