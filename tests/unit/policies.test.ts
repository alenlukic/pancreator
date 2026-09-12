import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { createFixture, sharedFixture } from '../fixture-template.js'
import { loadPolicyCatalog, resolvePolicies } from '../../src/lib/policies.js'
import { STANDALONE_MODES } from '../../src/lib/governance-card.js'
import { filterPolicyInstructionsForCard } from '../../src/lib/policy-instructions.js'
import { resolveRequirements } from '../../src/lib/requirements/resolve.js'

function writePolicyExtension(
  root: string,
  name: string,
  rows: Array<Record<string, unknown>>,
  metadata?: { extension_id: string; policies: string[] },
): void {
  const directory = path.join(
    root,
    'governance',
    'registries',
    'policy_lookup.d',
  )

  mkdirSync(directory, { recursive: true })
  writeFileSync(
    path.join(directory, name),
    `${JSON.stringify({ schema_version: 1, ...metadata, rows }, null, 2)}\n`,
  )
}

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

test('representative contexts exclude policies outside their remit', () => {
  const root = sharedFixture()
  const ids = (persona: string, workflow: string, stage: string): string[] =>
    resolvePolicies(root, {
      persona,
      workflow,
      stage,
      operator_artifacts: 'suppressed',
    }).map((policy) => policy.id)

  assert.deepEqual(ids('planner', 'delivery', 'plan'), [
    'ACTION-001',
    'ASK-001',
    'AUTO-001',
    'BIN-001',
    'COMMS-001',
    'CONTRACT-001',
    'ENG-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'OPERATOR-001',
    'PLAN-002',
    'PRIMER-001',
    'VALID-001',
  ])

  const verify = ids('verifier', 'delivery', 'verify')

  assert.ok(verify.includes('VERIFY-001'))
  assert.equal(
    verify.includes('DELEGATE-001'),
    false,
    'the verifier consolidates parallel evidence and never delegates',
  )

  for (const leaked of ['BRIEF-001', 'LANG-001', 'PY-001']) {
    assert.equal(
      ids('planner', 'delivery', 'plan').includes(leaked),
      false,
      `plan MUST exclude ${leaked}`,
    )
  }

  // Each row lists only the policies beyond the universal set.
  const expectedIncludes: Array<[string, string, string, string[]]> = [
    [
      'coder',
      'standalone',
      'shepherd',
      ['SHEPHERD-001', 'DELEGATE-001', 'ENG-001', 'ACTION-001'],
    ],
    ['orchestrator', 'design', 'intake', ['INTAKE-001', 'ORCH-001']],
    ['release-steward', 'standalone', 'release', ['VERSION-001']],
    [
      'librarian',
      'standalone',
      'build-docs',
      ['LIBRARIAN-001', 'PRIMER-001', 'REPO-001', 'VALID-001'],
    ],
    ['decomposer', 'standalone', 'decompose', ['DECOMP-001']],
    ['orchestrator', 'prototype', 'intake', ['PROTO-001']],
    ['harness-technician', 'standalone', 'repair', ['REPAIR-001']],
    ['investigator', 'standalone', 'debug', ['DIAG-001', 'WORK-001']],
    ['spotfixer', 'standalone', 'spotfix', ['SPOT-001', 'WORK-001']],
    [
      'meta-orchestrator',
      'standalone',
      'best-of-n',
      ['BESTOFN-001', 'WORK-001'],
    ],
    [
      'coder',
      'delivery',
      'implement',
      ['DEV-001', 'ENG-001', 'TEST-001', 'TS-001', 'REPO-001'],
    ],
    ['reviewer', 'delivery', 'verify', ['ENG-001', 'CONTRACT-001', 'TS-001']],
    [
      'reviewer',
      'standalone',
      'review',
      ['REVIEW-001', 'DELEGATE-001', 'ENG-001'],
    ],
  ]

  for (const [persona, workflow, stage, required] of expectedIncludes) {
    const resolved = ids(persona, workflow, stage)

    for (const id of required) {
      assert.ok(
        resolved.includes(id),
        `${persona}/${workflow}/${stage} MUST load ${id}`,
      )
    }
  }
})

test('VERIFY-001 binds the blast-radius rule to every verify evidence worker', () => {
  const root = sharedFixture()
  const ids = (persona: string, workflow: string): string[] =>
    resolvePolicies(root, { persona, workflow, stage: 'verify' }).map(
      (policy) => policy.id,
    )

  for (const workflow of [
    'delivery',
    'delivery-chunk',
    'delivery-candidate',
    'metacritic',
  ]) {
    for (const persona of ['reviewer', 'qa-tester', 'verifier']) {
      assert.ok(
        ids(persona, workflow).includes('VERIFY-001'),
        `${persona}/${workflow}/verify MUST load VERIFY-001`,
      )
    }
  }

  // The rule itself lives on VERIFY-001, not on a persona or prompt.
  const verify = loadPolicyCatalog(root).get('VERIFY-001')

  assert.ok(verify)

  const texts = verify.instructions.map((instruction) => instruction.text)

  assert.ok(
    texts.some(
      (text) =>
        /impacted profile is the blast radius/u.test(text) &&
        /MUST NOT run it a second time/u.test(text),
    ),
  )
  assert.ok(
    texts.some((text) =>
      /full profile runs only as the release gate of the ship stage/u.test(
        text,
      ),
    ),
  )
})

test('self-development ship keeps PR policy when briefs are suppressed', () => {
  const root = sharedFixture()
  const ids = (operatorArtifacts: 'requested' | 'suppressed'): string[] =>
    resolvePolicies(root, {
      persona: 'release-steward',
      workflow: 'delivery',
      stage: 'ship',
      operator_artifacts: operatorArtifacts,
    }).map((policy) => policy.id)

  assert.ok(ids('requested').includes('PR-001'))
  assert.ok(ids('suppressed').includes('PR-001'))
})

test('embedded ship excludes PR policy when artifacts are suppressed', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  config.installation_mode = 'embedded'
  config.workspace_root = 'target'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  mkdirSync(path.join(root, 'target'), { recursive: true })

  const ids = resolvePolicies(root, {
    persona: 'release-steward',
    workflow: 'delivery',
    stage: 'ship',
    operator_artifacts: 'suppressed',
  }).map((policy) => policy.id)

  assert.equal(ids.includes('PR-001'), false)
})

test('best-of-N stages carry the same policies as the delivery stages they mirror', () => {
  const root = sharedFixture()
  const ids = (persona: string, workflow: string, stage: string): string[] =>
    resolvePolicies(root, { persona, workflow, stage }).map(
      (policy) => policy.id,
    )

  for (const stage of ['plan', 'implement', 'verify', 'remediate']) {
    const persona = {
      plan: 'planner',
      implement: 'coder',
      verify: 'verifier',
      remediate: 'remediator',
    }[stage] as string

    assert.deepEqual(
      ids(persona, 'delivery-candidate', stage).filter(
        (id) => id !== 'BESTOFN-001',
      ),
      ids(persona, 'delivery', stage),
      `delivery-candidate/${stage} MUST resolve delivery's policies plus BESTOFN-001`,
    )
  }

  const consolidate = ids('metacritic', 'metacritic', 'consolidate')

  // Consolidation writes code, so it carries the implementation policy set.
  for (const id of ['BESTOFN-001', 'DEV-001', 'ENG-001', 'TS-001']) {
    assert.ok(consolidate.includes(id), `consolidate MUST load ${id}`)
  }

  assert.ok(ids('release-steward', 'metacritic', 'ship').includes('SHIP-001'))
})

test('the best-of-N candidate planner receives no specification hierarchy or cohort rules', () => {
  const root = sharedFixture()
  const candidate = resolvePolicies(root, {
    persona: 'planner',
    workflow: 'delivery-candidate',
    stage: 'plan',
  })
  const ids = candidate.map((policy) => policy.id)

  assert.ok(ids.includes('PLAN-002'))
  assert.equal(ids.includes('COHORT-001'), false)

  // The candidate plan stage declares no cohort_plan data and no child
  // specification path, so no instruction on its card may demand either.
  const hierarchyTerms = [
    'child specification',
    'parent specification',
    'cohort',
    'unit of work',
  ]

  for (const policy of candidate) {
    for (const text of [
      policy.summary,
      ...policy.instructions.map((instruction) => instruction.text),
    ]) {
      for (const term of hierarchyTerms) {
        assert.equal(
          text.toLowerCase().includes(term),
          false,
          `${policy.id} MUST NOT reach the candidate planner with "${term}"`,
        )
      }
    }
  }

  const hierarchyValidators = [
    'COHORT-PLAN-VALIDATE-001',
    'CHILD-SPEC-VALIDATE-001',
  ]
  const boundFor = (workflow: string, persona: string, stage: string) =>
    resolveRequirements(root, { persona, workflow, stage })
      .validation_requirements.map((requirement) => requirement.registry_id)
      .filter((registryId) => hierarchyValidators.includes(registryId))

  assert.deepEqual(boundFor('delivery-candidate', 'planner', 'plan'), [])
  // The cohort policy also reaches every delivery-chunk worker, whose stage
  // output is not a plan; the validators stay scoped to the planning workflow.
  assert.deepEqual(boundFor('delivery-chunk', 'coder', 'implement'), [])
  assert.deepEqual(
    boundFor('planning', 'planner', 'plan').sort(),
    [...hierarchyValidators].sort(),
  )

  // One policy owns the hierarchy rule, so no second card can reintroduce it.
  const owners = [...loadPolicyCatalog(root).values()].filter((policy) =>
    policy.instructions.some((instruction) =>
      instruction.text.includes(
        'one child specification for each unit of work',
      ),
    ),
  )

  assert.deepEqual(
    owners.map((policy) => policy.id),
    ['COHORT-001'],
  )
})

test('Python policy loads only for detected Python workspaces', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  config.installation_mode = 'embedded'
  config.workspace_root = 'target'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  mkdirSync(path.join(root, 'target'), { recursive: true })

  writeFileSync(path.join(root, 'target', 'package.json'), '{}\n')

  const nonPythonIds = resolvePolicies(root, {
    persona: 'coder',
    workflow: 'delivery',
    stage: 'implement',
  }).map((policy) => policy.id)

  assert.ok(!nonPythonIds.includes('PY-001'))
  assert.ok(!nonPythonIds.includes('TS-001'))

  writeFileSync(
    path.join(root, 'target', 'pyproject.toml'),
    '[project]\nname = "fixture"\n',
    {
      flag: 'w',
    },
  )

  const pythonIds = resolvePolicies(root, {
    persona: 'coder',
    workflow: 'delivery',
    stage: 'implement',
  }).map((policy) => policy.id)

  assert.ok(pythonIds.includes('PY-001'))
  assert.ok(!pythonIds.includes('TS-001'))

  const plannerIds = resolvePolicies(root, {
    persona: 'planner',
    workflow: 'delivery',
    stage: 'plan',
  }).map((policy) => policy.id)

  for (const policyId of ['ENG-001', 'PLAN-002']) {
    assert.ok(plannerIds.includes(policyId), `plan MUST include ${policyId}`)
  }
  for (const policyId of ['LANG-001', 'PY-001', 'TS-001']) {
    assert.equal(plannerIds.includes(policyId), false)
  }

  rmSync(path.join(root, 'target', 'pyproject.toml'))
  writeFileSync(path.join(root, 'target', 'main.py'), 'VALUE = 1\n')
  execFileSync('git', ['add', 'target/main.py'], {
    cwd: root,
    encoding: 'utf8',
  })

  const sourceDetectedIds = resolvePolicies(root, {
    persona: 'verifier',
    workflow: 'delivery',
    stage: 'verify',
  }).map((policy) => policy.id)

  assert.ok(sourceDetectedIds.includes('PY-001'))
})

test('self-development version policy is excluded from embedded installations', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  config.installation_mode = 'embedded'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const releaseIds = resolvePolicies(root, {
    persona: 'release-steward',
    workflow: 'delivery',
    stage: 'ship',
  }).map((policy) => policy.id)

  assert.ok(!releaseIds.includes('VERSION-001'))
  assert.ok(!releaseIds.includes('BIN-001'))
  assert.ok(!releaseIds.includes('TS-001'))
  assert.ok(releaseIds.includes('REPO-001'))
  assert.ok(releaseIds.includes('SHIP-001'))

  const coderIds = resolvePolicies(root, {
    persona: 'coder',
    workflow: 'delivery',
    stage: 'implement',
  }).map((policy) => policy.id)

  assert.ok(!coderIds.includes('BIN-001'))
  assert.ok(coderIds.includes('TS-001'))
  assert.ok(coderIds.includes('ENG-001'))
  assert.ok(coderIds.includes('REPO-001'))
})

test('the style handbooks reach the batch pass and no delivery persona', () => {
  const root = sharedFixture()
  const mode = STANDALONE_MODES.style

  assert.ok(mode)

  const styleIds = resolvePolicies(root, {
    persona: mode.persona,
    workflow: mode.workflow,
    stage: mode.stage,
    contracts: [],
    operator_artifacts: 'suppressed',
  }).map((policy) => policy.id)

  assert.ok(styleIds.includes('TSTYLE-001'))
  assert.ok(styleIds.includes('PYSTYLE-001'))

  const deliveryContexts = [
    { persona: 'coder', workflow: 'delivery', stage: 'implement' },
    { persona: 'reviewer', workflow: 'delivery', stage: 'review' },
    { persona: 'qa-tester', workflow: 'delivery', stage: 'test' },
    { persona: 'metacritic', workflow: 'metacritic', stage: 'consolidate' },
    { persona: 'spotfixer', workflow: 'standalone', stage: 'spotfix' },
    { persona: 'verifier', workflow: 'delivery', stage: 'verify' },
    { persona: 'remediator', workflow: 'delivery', stage: 'remediate' },
    { persona: 'remediator-severe', workflow: 'delivery', stage: 'remediate' },
    { persona: 'hypervisor', workflow: 'standalone', stage: 'hypervisor' },
  ]

  for (const context of deliveryContexts) {
    const ids = resolvePolicies(root, {
      ...context,
      technologies: ['python', 'typescript'],
    }).map((policy) => policy.id)
    const label = `${context.persona}/${context.workflow}/${context.stage}`

    for (const style of ['TSTYLE-001', 'PYSTYLE-001']) {
      assert.equal(ids.includes(style), false, `${label} resolves ${style}`)
    }
  }

  // The toolchain policies keep their existing bindings.
  const coderIds = resolvePolicies(root, {
    persona: 'coder',
    workflow: 'delivery',
    stage: 'implement',
    technologies: ['python', 'typescript'],
  }).map((policy) => policy.id)

  assert.ok(coderIds.includes('TS-001'))
  assert.ok(coderIds.includes('PY-001'))
})

/**
 * Trigger `parseGuidanceSource` generates when a policy declares none. It exists
 * for generated target-repository policies, which have no author to phrase one,
 * and it names no concrete action. A checked-in policy must therefore not rely
 * on it: the trigger is the only thing on a card that tells a worker when to
 * open the referenced guidance.
 */
function generatedReadTrigger(policyId: string): string {
  return `Read this guidance before work that ${policyId} governs.`
}

test('every checked-in policy declares its own guidance read trigger', () => {
  const root = sharedFixture()
  const catalog = loadPolicyCatalog(root)

  const sources = [...catalog.values()].flatMap((policy) =>
    (policy.guidance ?? []).map((guidance) => ({ policy, guidance })),
  )

  assert.ok(sources.length > 0, 'the catalog MUST resolve guidance sources')

  for (const { policy, guidance } of sources) {
    const { reference } = guidance

    assert.ok(reference, `${policy.id} guidance MUST resolve a reference`)
    assert.notEqual(
      reference.read_trigger,
      generatedReadTrigger(policy.id),
      `${policy.id} MUST declare a read_trigger for ${guidance.source_path}`,
    )
  }
})

test('a policy without a declared trigger keeps the generated fallback', () => {
  const root = createFixture()
  const policyPath = path.join(root, 'governance', 'policies', 'ENG-001.json')
  const definition = JSON.parse(readFileSync(policyPath, 'utf8')) as {
    guidance_sources: { read_trigger?: string }[]
  }

  delete definition.guidance_sources[0].read_trigger
  writeFileSync(policyPath, `${JSON.stringify(definition, null, 2)}\n`)

  const guidance = loadPolicyCatalog(root).get('ENG-001')?.guidance?.[0]

  assert.ok(guidance)
  assert.equal(
    guidance.reference?.read_trigger,
    generatedReadTrigger('ENG-001'),
  )
})

test('TEST-001 resolves testing.md for self-development test personas', () => {
  const root = sharedFixture()
  const catalog = loadPolicyCatalog(root)
  const testPolicy = catalog.get('TEST-001')

  assert.ok(testPolicy)
  assert.equal(
    testPolicy?.guidance?.[0]?.source_path,
    'governance/handbooks/eng/testing.md',
  )

  const personas = [
    'coder',
    'remediator',
    'remediator-severe',
    'reviewer',
    'qa-tester',
    'verifier',
  ] as const

  for (const persona of personas) {
    const policies = resolvePolicies(root, {
      persona,
      workflow: 'delivery',
      stage: 'implement',
      operator_artifacts: 'suppressed',
    })
    const resolvedTestPolicy = policies.find(
      (policy) => policy.id === 'TEST-001',
    )

    assert.ok(resolvedTestPolicy, `${persona} MUST resolve TEST-001`)
  }

  const targetRoot = createFixture()
  const configPath = path.join(targetRoot, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  config.installation_mode = 'embedded'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const targetIds = resolvePolicies(targetRoot, {
    persona: 'coder',
    workflow: 'delivery',
    stage: 'implement',
    operator_artifacts: 'suppressed',
  }).map((policy) => policy.id)

  assert.equal(targetIds.includes('TEST-001'), false)
})

test('TUNE-001 resolves its record validator for tune-harness sessions', () => {
  const manifest = resolveRequirements(sharedFixture(), {
    persona: 'reviewer',
    workflow: 'standalone',
    stage: 'tune-harness',
    invocation_kind: 'standalone',
    invocation: {
      artifact_paths: ['runtime/tune-harness/records/session.json'],
    },
  })
  const validator = manifest.validation_requirements.find(
    (item) => item.registry_id === 'TUNE-RECORD-VALIDATE-001',
  )

  assert.equal(
    validator?.resolved_target,
    'runtime/tune-harness/records/session.json',
  )
})

test('every repair instruction surface agrees on the category partition', () => {
  const root = sharedFixture()

  // The partition contract is spread across a policy, a persona, a projected
  // agent, and a command. A reverted singular phrase on any one of them makes
  // the harness technician collapse the partition back into one document, so
  // each surface is pinned here. Only the registry names the categories, so
  // no surface may carry a second copy of the list.
  const categories = (
    JSON.parse(
      readFileSync(
        path.join(root, 'governance/registries/harness_repair_categories.json'),
        'utf8',
      ),
    ) as { categories: Array<{ slug: string }> }
  ).categories

  assert.ok(categories.length > 0)

  const surfaces = [
    'library/personas/harness-technician.md',
    'library/cursor/agents/harness-technician.md',
    'library/cursor/commands/pan-repair.md',
  ].map((relative) => ({
    relative,
    text: readFileSync(path.join(root, relative), 'utf8'),
  }))

  for (const surface of surfaces) {
    assert.match(
      surface.text,
      /categor/iu,
      `${surface.relative} must state the category partition`,
    )
    assert.doesNotMatch(
      surface.text,
      /write only the declared intake under/u,
      `${surface.relative} must not fence writes to a single intake`,
    )
    assert.doesNotMatch(
      surface.text,
      /one intake by default/u,
      `${surface.relative} must not restore the one-intake default`,
    )

    // A copied list spells each slug out; a surface that reads the registry
    // names the pattern instead.
    const copied = categories
      .filter((category) => surface.text.includes(`\`${category.slug}\``))
      .map((category) => category.slug)

    assert.deepEqual(
      copied,
      [],
      `${surface.relative} must read the category list rather than copy it`,
    )
  }

  const persona = surfaces[0]?.text ?? ''

  assert.match(persona, /MUST follow the\s+operator rather than the category/u)
  assert.match(persona, /\*\*Category:\*\* <display name>/u)

  const agent = surfaces[1]?.text ?? ''

  assert.match(agent, /harness_repair_categories\.json/u)

  const command = surfaces[2]?.text ?? ''

  assert.match(command, /once for each intake path/u)
  assert.match(command, /harness-repair-<UTC timestamp>-<category-slug>-/u)
  assert.doesNotMatch(command, /requested intake count/u)
})

test('ship, write-pr, and conform keep required STE checks', () => {
  const root = sharedFixture()
  const requiredSte = (
    persona: string,
    workflow: string,
    stage: string,
    invocationKind: 'workflow' | 'standalone',
  ): string[] =>
    resolveRequirements(root, {
      persona,
      workflow,
      stage,
      invocation_kind: invocationKind,
    })
      .validation_requirements.filter(
        (requirement) =>
          requirement.registry_id === 'SIMPLIFIED-ENGLISH-VALIDATE-001' &&
          requirement.enforcement === 'required',
      )
      .map((requirement) => requirement.requirement_id)
      .sort()

  assert.deepEqual(
    requiredSte('release-steward', 'delivery', 'ship', 'workflow'),
    ['workflow-pr-simplified-english-validate'],
  )
  assert.deepEqual(
    requiredSte('release-steward', 'standalone', 'write-pr', 'standalone'),
    ['standalone-pr-simplified-english-validate'],
  )
  assert.deepEqual(
    requiredSte('librarian', 'standalone', 'conform', 'standalone'),
    ['standalone-conform-simplified-english-validate'],
  )

  const planner = resolvePolicies(root, {
    persona: 'planner',
    workflow: 'planning',
    stage: 'plan',
  }).map((policy) => policy.id)

  assert.equal(planner.includes('STE-001'), false)
})

test('no conform policy forbids an edit the conform boundary requires', () => {
  const root = sharedFixture()
  const mode = STANDALONE_MODES.conform

  assert.ok(mode)

  const policies = resolvePolicies(root, {
    persona: mode.persona,
    workflow: mode.workflow,
    stage: mode.stage,
  })
  const rendered = policies.flatMap((policy) =>
    filterPolicyInstructionsForCard(policy.instructions, 'agent').map(
      (instruction) => `${policy.id}: ${instruction.text}`,
    ),
  )
  const boundary = mode.boundaries.join('\n')
  const editable = mode.boundaries.find((line) =>
    line.includes('MUST edit only'),
  )
  // One sentence carries the exclusion, and the exception that follows
  // `except` is the governed set rather than part of the exclusion.
  const exclusions = rendered
    .flatMap((instruction) => instruction.split(/(?<=\.)\s+/u))
    .filter((sentence) =>
      /outside (?:the|those|these) (?:writing )?rules|MUST NOT restyle/u.test(
        sentence,
      ),
    )

  assert.ok(editable, boundary)

  // Fail closed. The replaced guard skipped its own body when the exclusion
  // was reworded, and discarded every word after the first `except`, so it
  // passed against the base text it was written to reject.
  assert.ok(
    exclusions.length > 0,
    `no rendered conform instruction states an exclusion:\n${rendered.join('\n')}`,
  )

  // The boundary requires the librarian to repair these paths, so no rendered
  // instruction may place them outside the writing rules of this card.
  for (const required of ['docs/issues/', 'runtime/pr-descriptions/']) {
    assert.ok(editable.includes(required), `the boundary omits ${required}`)

    for (const sentence of exclusions) {
      const exceptAt = sentence.search(/\bexcept\b/u)
      const excluded = exceptAt === -1 ? sentence : sentence.slice(0, exceptAt)

      assert.ok(
        !excluded.includes(required),
        `${sentence} forbids restyling ${required}, which the conform boundary requires`,
      )
    }
  }

  // Absence is not the contract. The carve-out MUST be stated, so a revert to
  // an exclusion covering all of `docs/` fails here rather than passing.
  assert.ok(
    exclusions.some((sentence) => {
      const exceptAt = sentence.search(/\bexcept\b/u)

      return (
        exceptAt !== -1 && sentence.slice(exceptAt).includes('docs/issues/')
      )
    }),
    `no rendered conform instruction carves docs/issues/ out of its exclusion:\n${rendered.join('\n')}`,
  )

  // The boundary reserves release metadata, so nothing on the card may hand it
  // to this persona. The replaced pin named the removed wording, so any other
  // wording that grants the same edit passed it.
  assert.ok(!editable.includes('CHANGELOG.md'), editable)
  assert.ok(
    mode.boundaries.some(
      (line) => line.includes('CHANGELOG.md') && line.includes('MUST NOT edit'),
    ),
    boundary,
  )
})

test('build-docs owns primer validators on LIBRARIAN-001', () => {
  const root = sharedFixture()
  const catalog = loadPolicyCatalog(root)
  const librarian = catalog.get('LIBRARIAN-001')
  const primer = catalog.get('PRIMER-001')

  assert.ok(librarian)
  assert.ok(primer)
  assert.equal(primer.requirements?.length ?? 0, 0)

  const ids = resolveRequirements(root, {
    persona: 'librarian',
    workflow: 'standalone',
    stage: 'build-docs',
    invocation_kind: 'documentation',
  })
    .validation_requirements.filter((requirement) =>
      [
        'TARGET-REPO-PRIMER-VALIDATE-001',
        'TARGET-LANGUAGE-HANDBOOK-VALIDATE-001',
      ].includes(requirement.registry_id),
    )
    .map((requirement) => requirement.requirement_id)
    .sort()

  assert.deepEqual(ids, [
    'target-language-handbook-validate',
    'target-repo-primer-validate',
  ])
  assert.equal(
    resolveRequirements(root, {
      persona: 'librarian',
      workflow: 'standalone',
      stage: 'build-docs',
      invocation_kind: 'documentation',
    }).validation_requirements.some(
      (requirement) => requirement.policy_id === 'LIBRARIAN-001',
    ),
    true,
  )
})

test('self-development skips generated language rows that target installs keep', () => {
  const selfDev = resolvePolicies(sharedFixture(), {
    persona: 'coder',
    workflow: 'delivery',
    stage: 'implement',
  }).map((policy) => policy.id)

  assert.equal(selfDev.includes('LANG-001'), false)

  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  config.installation_mode = 'embedded'
  config.workspace_root = 'target'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  mkdirSync(path.join(root, 'target'), { recursive: true })
  writeFileSync(path.join(root, 'target', 'package.json'), '{}\n')
  writeFileSync(path.join(root, 'target', 'tsconfig.json'), '{}\n')

  const embedded = resolvePolicies(root, {
    persona: 'coder',
    workflow: 'delivery',
    stage: 'implement',
  }).map((policy) => policy.id)

  assert.ok(embedded.includes('LANG-001'))
})

test('mixed policies tag supervisor, harness, and operator audiences', () => {
  const catalog = loadPolicyCatalog(sharedFixture())
  const audiences = (policyId: string): string[][] =>
    (catalog.get(policyId)?.instructions ?? []).map(
      (instruction) => instruction.audience,
    )
  const audienceFor = (policyId: string, excerpt: string): string[] => {
    const instruction = (catalog.get(policyId)?.instructions ?? []).find(
      (item) => item.text.includes(excerpt),
    )

    assert.ok(
      instruction,
      `${policyId} MUST contain the named instruction ${excerpt}`,
    )

    return instruction.audience
  }

  // The durable-instruction-text rules govern how agents author policies,
  // personas, skills, and commands, so they render on an agent card. No code
  // path renders a card at audience `operator`.
  assert.deepEqual(audienceFor('STE-001', 'durable-instruction-text'), [
    'agent',
  ])
  // The chat rules moved to COMMS-001 at audience `agent`, so one universal
  // row delivers them to a worker card, a standalone card, and a supervisor
  // card alike.
  assert.equal(
    audiences('STE-001').some((audience) => audience.includes('supervisor')),
    false,
    'STE-001 gave up its supervisor-audience chat rules',
  )
  assert.deepEqual(
    audienceFor('COMMS-001', 'Operator chat reports MUST state the outcome'),
    ['agent'],
  )
  assert.deepEqual(
    audiences('COMMS-001').filter(
      (audience) => audience.length !== 1 || audience[0] !== 'agent',
    ),
    [],
    'every COMMS-001 instruction carries audience agent',
  )
  // The chat shapes stay judgment-only, so no validator and no handbook
  // selection may bind to COMMS-001.
  assert.equal(catalog.get('COMMS-001')?.requirements, undefined)
  assert.equal(catalog.get('COMMS-001')?.guidance, undefined)
  assert.deepEqual(audienceFor('OPERATOR-001', '--redline --occasion'), [
    'supervisor',
  ])
  assert.deepEqual(audienceFor('OPERATOR-001', 'A non-empty `--note`'), [
    'supervisor',
  ])
  assert.deepEqual(audienceFor('CONTRACT-001', 'registry-validate'), [
    'harness',
  ])
  assert.deepEqual(audienceFor('CONTRACT-001', 'projection_manifest.json'), [
    'harness',
  ])
  assert.deepEqual(audienceFor('CONTRACT-001', 'directive-audit'), ['harness'])
  assert.deepEqual(audienceFor('CONTRACT-001', '.git/info/exclude'), [
    'harness',
  ])
  assert.deepEqual(
    audienceFor('BRIEF-001', 'MUST render requested HTML during submission'),
    ['harness'],
  )
  assert.deepEqual(audienceFor('BRIEF-001', 'retained brief system'), [
    'harness',
  ])
  assert.deepEqual(
    audienceFor('BRIEF-001', 'MUST delete transient source JSON'),
    ['harness'],
  )
  assert.deepEqual(
    audienceFor('BRIEF-001', 'MUST NOT loop the workflow to implementation'),
    ['harness'],
  )
  assert.deepEqual(
    audienceFor('VALID-001', 'treat an agent-run result as early feedback'),
    ['harness'],
  )
  assert.deepEqual(
    audienceFor('VALID-001', 'MUST NOT inline the full validator catalog'),
    ['harness'],
  )
  assert.deepEqual(
    audienceFor('VALID-001', 'MUST NOT invent a separate validator set'),
    ['harness'],
  )
  // A policy whose every instruction is harness-tagged renders an empty block
  // on the one card that loads it. Both of these keep a rendered instruction.
  assert.ok(
    audiences('OUTPUT-001').some((audience) => audience.includes('harness')),
  )
  assert.ok(
    audiences('OUTPUT-001').some((audience) => audience.includes('agent')),
  )
  assert.ok(
    audiences('RUNTIME-001').some((audience) => audience.includes('harness')),
  )
  assert.ok(
    audiences('RUNTIME-001').some((audience) => audience.includes('agent')),
  )
  assert.ok(
    catalog
      .get('LIBRARIAN-001')
      ?.instructions.some((instruction) =>
        instruction.text.includes('Repository-check commands MUST be copied'),
      ),
  )
  assert.equal(
    catalog
      .get('REPO-001')
      ?.instructions.some((instruction) =>
        instruction.text.includes('Repository-check commands MUST be copied'),
      ),
    false,
  )
})
