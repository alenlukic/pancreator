import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createFixture } from '../fixture-template.js'
import { loadPolicyCatalog, resolvePolicies } from '../../src/lib/policies.js'
import { writePolicyExtension } from './policies-helpers.js'

function writeTargetPolicy(
  root: string,
  id: string,
  extensionId?: string,
): void {
  writeFileSync(
    path.join(root, 'governance', 'policies', `${id}.json`),
    `${JSON.stringify(
      {
        id,
        ...(extensionId ? { extension_id: extensionId } : {}),
        title: 'Target policy',
        severity: 'hard',
        summary: 'Agents MUST apply the target policy.',
        instructions: ['Agents MUST preserve target behavior.'],
      },
      null,
      2,
    )}\n`,
  )
}

test('target policy lookup extensions add validated rows', () => {
  const root = createFixture()

  writeFileSync(
    path.join(root, 'governance', 'policies', 'TARGET-001.json'),
    `${JSON.stringify(
      {
        id: 'TARGET-001',
        title: 'Target policy',
        severity: 'hard',
        summary: 'Agents MUST apply the target policy.',
        instructions: ['Agents MUST preserve target behavior.'],
      },
      null,
      2,
    )}\n`,
  )
  writePolicyExtension(root, 'target.json', [
    {
      persona: 'planner',
      workflow: 'delivery',
      stage: 'plan',
      policies: ['TARGET-001'],
    },
  ])

  const ids = resolvePolicies(root, {
    persona: 'planner',
    workflow: 'delivery',
    stage: 'plan',
  }).map((policy) => policy.id)

  assert.ok(ids.includes('TARGET-001'))
})

test('structured target policy extensions bind their owned policies', () => {
  const root = createFixture()

  writeTargetPolicy(root, 'TARGET-001', 'target')
  const policyPath = path.join(
    root,
    'governance',
    'policies',
    'TARGET-001.json',
  )
  const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as Record<
    string,
    unknown
  >

  policy.artifact_authority = {
    pr_description: {
      template_path: '.github/PULL_REQUEST_TEMPLATE.md',
      instruction_paths: ['docs/pr-rules.md'],
    },
  }
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`)
  writePolicyExtension(
    root,
    'target.json',
    [
      {
        persona: 'planner',
        workflow: 'delivery',
        stage: 'plan',
        policies: ['TARGET-001'],
      },
    ],
    { extension_id: 'target', policies: ['TARGET-001'] },
  )

  const policies = resolvePolicies(root, {
    persona: 'planner',
    workflow: 'delivery',
    stage: 'plan',
  })
  const ids = policies.map((item) => item.id)

  assert.ok(ids.includes('TARGET-001'))
  assert.deepEqual(
    policies.find((item) => item.id === 'TARGET-001')?.artifact_authority,
    policy.artifact_authority,
  )
})

test('binding-only target extensions reference existing policies without ownership', () => {
  const root = createFixture()

  writePolicyExtension(
    root,
    'acme-tool.json',
    [
      {
        persona: 'coder',
        workflow: 'standalone',
        stage: 'target-acme-tool',
        policies: ['ENG-001', 'REPO-001'],
      },
    ],
    { extension_id: 'acme-tool', policies: [] },
  )

  const ids = resolvePolicies(root, {
    persona: 'coder',
    workflow: 'standalone',
    stage: 'target-acme-tool',
  }).map((policy) => policy.id)

  assert.ok(ids.includes('ENG-001'))
  assert.ok(ids.includes('REPO-001'))
})

test('target PR authority rejects paths outside the workspace', () => {
  const root = createFixture()

  writeTargetPolicy(root, 'TARGET-001')
  const policyPath = path.join(
    root,
    'governance',
    'policies',
    'TARGET-001.json',
  )
  const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as Record<
    string,
    unknown
  >

  policy.artifact_authority = {
    pr_description: { template_path: '../outside.md' },
  }
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`)

  assert.throws(
    () => loadPolicyCatalog(root),
    /template_path MUST be a safe workspace-relative path/u,
  )
})

test('the policy catalog is parsed once per process and rebuilt after an edit', () => {
  // Every command resolves policies many times over, and each resolution
  // re-read, re-sliced, and re-hashed the same governance tree. The memo is
  // only safe if an authoring edit inside the same process is still seen, so
  // both halves are one contract.
  const root = createFixture()
  const first = loadPolicyCatalog(root)

  // Identity is the proof: a second parse could not return the same Map.
  assert.equal(loadPolicyCatalog(root), first)

  const policyPath = path.join(
    root,
    'governance',
    'policies',
    'BROWSER-001.json',
  )
  const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as Record<
    string,
    unknown
  >

  policy.summary = `${String(policy.summary)} Edited inside this process.`
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`)

  const afterPolicyEdit = loadPolicyCatalog(root)

  assert.notEqual(afterPolicyEdit, first)
  assert.match(
    afterPolicyEdit.get('BROWSER-001')?.summary ?? '',
    /Edited inside this process/u,
  )

  // A handbook edit changes no policy file, and the guidance content and its
  // digest live in the policy object, so the memo has to watch the handbook
  // too or an authored edit would go unpublished until the process restarts.
  const guidance = afterPolicyEdit.get('BROWSER-001')?.guidance?.[0]

  assert.ok(guidance)
  appendFileSync(
    path.join(root, guidance.source_path),
    '\nAn operator edited this handbook.\n',
  )

  const reread = loadPolicyCatalog(root).get('BROWSER-001')?.guidance?.[0]

  assert.ok(reread)
  assert.match(reread.content, /An operator edited this handbook/u)
  assert.notEqual(
    reread.reference?.content_sha256,
    guidance.reference?.content_sha256,
  )
})

test('structured target policy extensions reject missing and stale bindings', () => {
  const missingRoot = createFixture()

  writeTargetPolicy(missingRoot, 'TARGET-001', 'target')
  assert.throws(
    () =>
      resolvePolicies(missingRoot, {
        persona: 'planner',
        workflow: 'delivery',
        stage: 'plan',
      }),
    /binding layer is missing/u,
  )

  const staleRoot = createFixture()

  writePolicyExtension(
    staleRoot,
    'target.json',
    [
      {
        persona: 'planner',
        workflow: 'delivery',
        stage: 'plan',
        policies: ['MISSING-001'],
      },
    ],
    { extension_id: 'target', policies: ['MISSING-001'] },
  )
  assert.throws(
    () =>
      resolvePolicies(staleRoot, {
        persona: 'planner',
        workflow: 'delivery',
        stage: 'plan',
      }),
    (error: unknown) =>
      error instanceof Error &&
      /stale policy: MISSING-001/u.test(error.message) &&
      error.message.includes('policy_lookup.d/target.json'),
  )

  const unknownRoot = createFixture()

  writePolicyExtension(unknownRoot, 'missing.json', [
    {
      persona: 'planner',
      workflow: 'delivery',
      stage: 'plan',
      policies: ['MISSING-001'],
    },
  ])
  assert.throws(
    () =>
      resolvePolicies(unknownRoot, {
        persona: 'planner',
        workflow: 'delivery',
        stage: 'plan',
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('policy_lookup.d/missing.json') &&
      error.message.includes('MISSING-001'),
  )
})

test('structured target policy extensions reject ownership conflicts', () => {
  const root = createFixture()

  writeTargetPolicy(root, 'TARGET-001', 'target')
  writePolicyExtension(
    root,
    'other.json',
    [
      {
        persona: 'planner',
        workflow: 'delivery',
        stage: 'plan',
        policies: ['TARGET-001'],
      },
    ],
    { extension_id: 'other', policies: ['TARGET-001'] },
  )

  assert.throws(
    () =>
      resolvePolicies(root, {
        persona: 'planner',
        workflow: 'delivery',
        stage: 'plan',
      }),
    /belongs to target/u,
  )

  const conflictRoot = createFixture()

  writeTargetPolicy(conflictRoot, 'TARGET-001')

  for (const extensionId of ['first', 'second']) {
    writePolicyExtension(
      conflictRoot,
      `${extensionId}.json`,
      [
        {
          persona: 'planner',
          workflow: 'delivery',
          stage: 'plan',
          policies: ['TARGET-001'],
        },
      ],
      { extension_id: extensionId, policies: ['TARGET-001'] },
    )
  }

  assert.throws(
    () =>
      resolvePolicies(conflictRoot, {
        persona: 'planner',
        workflow: 'delivery',
        stage: 'plan',
      }),
    /conflicts with/u,
  )
})

test('target policy lookup extensions reject duplicates and malformed JSON', () => {
  const duplicateRoot = createFixture()

  writePolicyExtension(duplicateRoot, 'duplicate.json', [
    {
      persona: 'planner',
      workflow: 'delivery',
      stage: 'plan',
      policies: ['PLAN-002'],
    },
  ])
  assert.throws(
    () =>
      resolvePolicies(duplicateRoot, {
        persona: 'planner',
        workflow: 'delivery',
        stage: 'plan',
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('policy_lookup.d/duplicate.json') &&
      error.message.includes('duplicates'),
  )

  const malformedRoot = createFixture()
  const malformedDirectory = path.join(
    malformedRoot,
    'governance',
    'registries',
    'policy_lookup.d',
  )

  mkdirSync(malformedDirectory, { recursive: true })
  writeFileSync(path.join(malformedDirectory, 'malformed.json'), '{\n')
  assert.throws(() =>
    resolvePolicies(malformedRoot, {
      persona: 'planner',
      workflow: 'delivery',
      stage: 'plan',
    }),
  )
})
