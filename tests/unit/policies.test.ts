import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createFixture, sharedFixture } from '../helpers.js'
import { loadPolicyCatalog, resolvePolicies } from '../../src/lib/policies.js'
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

test('policy resolution unions global and stage-specific policies', () => {
  const root = sharedFixture()
  const catalog = loadPolicyCatalog(root)
  assert.ok(catalog.size >= 8)
  const ids = resolvePolicies(root, {
    persona: 'coder',
    workflow: 'delivery',
    stage: 'implement',
  }).map((policy) => policy.id)
  assert.deepEqual(ids, [
    'ACTION-001',
    'ASK-001',
    'AUTO-001',
    'BIN-001',
    'BRIEF-001',
    'CONTRACT-001',
    'DEV-001',
    'ENG-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'LANG-001',
    'OPERATOR-001',
    'OUTPUT-001',
    'PRIMER-001',
    'REPO-001',
    'RUNTIME-001',
    'STE-001',
    'TEST-001',
    'TS-001',
    'VALID-001',
  ])
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
    'CONTRACT-001',
    'ENG-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'OPERATOR-001',
    'PLAN-002',
    'PRIMER-001',
    'STE-001',
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
    ['librarian', 'standalone', 'build-docs', ['PRIMER-001', 'VALID-001']],
    ['decomposer', 'standalone', 'decompose', ['DECOMP-001']],
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
      'reviewer',
      'delivery',
      'verify',
      ['ENG-001', 'CONTRACT-001', 'LANG-001', 'TS-001'],
    ],
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
    for (const text of [policy.summary, ...policy.instructions]) {
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
})

test('the specification hierarchy rules live in exactly one policy', () => {
  const catalog = loadPolicyCatalog(sharedFixture())
  const owners = [...catalog.values()].filter((policy) =>
    policy.instructions.some((instruction) =>
      instruction.includes('one child specification for each unit of work'),
    ),
  )

  assert.deepEqual(
    owners.map((policy) => policy.id),
    ['COHORT-001'],
  )

  const shared = catalog.get('PLAN-002')

  assert.ok(shared)
  assert.equal(
    shared.instructions.some((instruction) =>
      /child specification|cohort|unit of work/iu.test(instruction),
    ),
    false,
    'PLAN-002 MUST keep only the consolidated-planning rules both planners share',
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

  for (const policyId of ['CONTRACT-001', 'ENG-001', 'PLAN-002']) {
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

test('REPAIR-001 allows several intakes and keeps one as the default', () => {
  const root = sharedFixture()
  const policy = JSON.parse(
    readFileSync(
      path.join(root, 'governance', 'policies', 'REPAIR-001.json'),
      'utf8',
    ),
  ) as { instructions: string[] }
  const instructions = policy.instructions.join('\n')

  assert.match(instructions, /MUST write one intake by default/u)
  assert.match(
    instructions,
    /more than one intake only when the operator requests more than one/u,
  )
  assert.match(
    instructions,
    /one intake for each distinct root cause and MUST NOT split one root cause/u,
  )
  assert.match(instructions, /Every completed intake MUST pass/u)
})

test('every repair instruction surface agrees that several intakes are allowed', () => {
  const root = sharedFixture()

  // The multi-intake contract is spread across a policy, a persona, a projected
  // agent, and a command. A reverted singular phrase on any one of them makes
  // the harness technician refuse the second intake the operator asked for, so
  // each surface is pinned to the plural contract here.
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
      /more than one/u,
      `${surface.relative} must admit more than one intake`,
    )
    assert.doesNotMatch(
      surface.text,
      /write only the declared intake under/u,
      `${surface.relative} must not fence writes to a single intake`,
    )
  }

  const persona = surfaces[0]?.text ?? ''

  assert.match(persona, /one intake for each\s+distinct root cause/u)
  assert.doesNotMatch(
    persona,
    /write one implementation-ready Markdown intake/u,
    'the persona must not mandate exactly one intake',
  )

  const command = surfaces[2]?.text ?? ''

  assert.match(command, /once for each intake path/u)
  assert.match(command, /default to one intake/u)
})
