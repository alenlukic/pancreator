import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validateMarshalOutput } from '../../src/lib/validators/stage-validators.js'
import {
  captureMarshalBaseline,
  marshalBaselinePath,
} from '../../src/lib/standard-marshal.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { AGENT_REPOSITORY_CHECK_RUNS_FILE } from '../../src/lib/repository-checks/ledger.js'
import type { Invocation } from '../../src/lib/types.js'
import { createTestTempDirectory } from '../fixture-template.js'

const REQUIREMENT = {
  policy_id: 'SCENARIO-001',
  requirement_id: 'marshal-validate',
  registry_id: 'MARSHAL-VALIDATE-001',
  arguments: {},
}

function writeOutput(
  root: string,
  data: Record<string, unknown>,
): { root: string; targetPath: string } {
  const relative = 'runtime/agent/implement-output.json'
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  writeFileSync(
    path.join(root, relative),
    `${JSON.stringify({ data }, null, 2)}\n`,
  )
  return { root, targetPath: relative }
}

test('marshaling that loosens an assertion fails validation', () => {
  const { root, targetPath } = writeOutput(
    createTestTempDirectory('marshal-'),
    {
      marshaling: {
        edits: [
          {
            kind: 'assertion',
            path: 'tests/unit/example.test.ts',
            note: 'Loosen the expected value so the new implementation passes.',
          },
        ],
      },
    },
  )
  const result = validateMarshalOutput({
    root,
    targetPath,
    requirement: REQUIREMENT,
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some((item) => item.code === 'marshal.assertion_loosened'),
  )
})

test('allowed marshaling kinds pass and absent marshaling is skipped', () => {
  const allowed = writeOutput(createTestTempDirectory('marshal-'), {
    marshaling: {
      edits: [
        {
          kind: 'call_site',
          path: 'tests/unit/example.test.ts',
          note: 'Call the exported helper under its real name.',
        },
      ],
    },
  })
  const skipped = writeOutput(createTestTempDirectory('marshal-'), {
    implementation: { changed_files: [] },
  })

  assert.equal(
    validateMarshalOutput({
      root: allowed.root,
      targetPath: allowed.targetPath,
      requirement: REQUIREMENT,
    }).status,
    'passed',
  )
  assert.equal(
    validateMarshalOutput({
      root: skipped.root,
      targetPath: skipped.targetPath,
      requirement: REQUIREMENT,
    }).status,
    'passed',
  )
})

test('a mislabeled assertion edit fails against the captured author baseline', () => {
  const root = createTestTempDirectory('marshal-')
  const relative = 'tests/independent.test.ts'
  const report = 'runtime/agent/author.md'
  mkdirSync(path.join(root, 'runtime/agent'), { recursive: true })
  mkdirSync(path.join(root, 'tests'), { recursive: true })
  writeFileSync(
    path.join(root, relative),
    'const actual = oldCall()\nassert.equal(actual, 42)\n',
  )
  writeFileSync(
    path.join(root, report),
    `<!-- marshal-test: ${relative} -->\n<!-- evidence-verdict: pass -->\n<!-- evidence-report: complete -->\n`,
  )
  const { targetPath } = writeOutput(root, {
    marshaling: {
      edits: [{ kind: 'call_site', path: relative, note: 'Adapt call.' }],
    },
  })
  writeFileSync(
    path.join(root, targetPath),
    JSON.stringify({
      result: 'success',
      data: {
        marshaling: {
          edits: [{ kind: 'call_site', path: relative, note: 'Adapt call.' }],
        },
      },
    }),
  )
  const invocation = {
    workflow: { slug: 'standard' },
    stage: { slug: 'implement' },
    workspace_root: root,
    output: { path: targetPath },
    evidence_workers: [
      { role: 'test-author', evidence_path: report, brief_path: report },
    ],
  } as unknown as Invocation
  captureMarshalBaseline(root, invocation)
  writeFileSync(
    path.join(root, relative),
    'const actual = newCall()\nassert.equal(actual, 42)\n',
  )
  const check = () =>
    validateMarshalOutput({
      root,
      targetPath,
      requirement: REQUIREMENT,
      invocation: invocation as unknown as Record<string, unknown>,
    })
  assert.equal(check().status, 'passed')
  writeFileSync(
    path.join(root, relative),
    'const actual = newCall()\nassert.ok(actual)\n',
  )
  assert.equal(check().status, 'failed')
})

test('standard contract join requires no reconciliation on success and permits only evidenced shape corrections', () => {
  const root = createTestTempDirectory('contract-join-')
  const relative = 'tests/independent.test.ts'
  const report = 'runtime/agent/author.md'
  mkdirSync(path.join(root, 'runtime/agent'), { recursive: true })
  mkdirSync(path.join(root, 'tests'), { recursive: true })
  const authored = 'const actual = oldCall()\nassert.equal(actual, 42)\n'
  writeFileSync(path.join(root, relative), authored)
  writeFileSync(
    path.join(root, report),
    `<!-- marshal-test: ${relative} -->\n<!-- evidence-verdict: pass -->\n<!-- evidence-report: complete -->\n`,
  )
  const { targetPath } = writeOutput(root, {})
  const invocation = {
    run_id: 'run-fixture',
    invocation_id: 'inv-join',
    workflow: { slug: 'standard' },
    stage: { slug: 'implement' },
    rubric: [{ id: 'standard.contract_alignment' }],
    workspace_root: root,
    output: { path: targetPath },
    evidence_workers: [
      { role: 'test-author', evidence_path: report, brief_path: report },
    ],
  } as unknown as Invocation
  captureMarshalBaseline(root, invocation)
  const baseline = JSON.parse(
    readFileSync(marshalBaselinePath(root, invocation), 'utf8'),
  )
  const check = (marshaling?: Record<string, unknown>) => {
    writeFileSync(
      path.join(root, targetPath),
      JSON.stringify({
        result: 'success',
        data: marshaling === undefined ? {} : { marshaling },
      }),
    )
    return validateMarshalOutput({
      root,
      targetPath,
      requirement: REQUIREMENT,
      invocation: invocation as unknown as Record<string, unknown>,
    })
  }
  const reconciliation = {
    check_profile: 'impacted',
    mismatch:
      'IF-01: impacted check could not resolve oldCall; use the approved newCall.',
    edits: [
      { kind: 'call_site', path: relative, note: 'Use the ratified name.' },
    ],
  }
  assert.equal(check().status, 'passed')
  writeFileSync(
    path.join(root, relative),
    authored.replace('oldCall', 'newCall'),
  )
  assert.equal(check().status, 'failed', 'unreported test change')
  assert.equal(check(reconciliation).status, 'failed', 'no failed check')
  const ledger = resolveRunLayout(root, invocation.run_id).evidence(
    AGENT_REPOSITORY_CHECK_RUNS_FILE,
  ).absolute
  mkdirSync(path.dirname(ledger), { recursive: true })
  const record = {
    profile: 'impacted',
    invocation_id: invocation.invocation_id,
    workspace_fingerprint: baseline.fingerprint,
    status: 'failed',
  }
  writeFileSync(
    ledger,
    JSON.stringify({ ...record, workspace_fingerprint: 'stale' }) + '\n',
  )
  assert.equal(check(reconciliation).status, 'failed', 'stale failure')
  writeFileSync(ledger, JSON.stringify(record) + '\n')
  assert.equal(
    check(reconciliation).status,
    'passed',
    'evidenced shape correction',
  )
  writeFileSync(
    path.join(root, relative),
    'const actual = newCall()\nassert.ok(actual)\n',
  )
  assert.ok(
    check(reconciliation).issues.some(
      (item) => item.code === 'marshal.assertion_loosened',
    ),
  )
})
