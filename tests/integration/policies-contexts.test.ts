import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createFixture, sharedFixture } from '../fixture-template.js'
import { loadPolicyCatalog, resolvePolicies } from '../../src/lib/policies.js'
import { STANDALONE_MODES } from '../../src/lib/governance-card.js'
import { resolveRequirements } from '../../src/lib/requirements/resolve.js'

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
    'DELEGATE-001',
    'ENG-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'INDEX-001',
    'OPERATOR-001',
    'PLAN-002',
    'PRIMER-001',
    'PRINCIPLES-001',
    'SINGLERUN-001',
    'VALID-001',
  ])

  const verify = ids('verifier', 'delivery', 'verify')

  assert.ok(verify.includes('VERIFY-001'))
  assert.ok(
    verify.includes('DELEGATE-001'),
    'the exclusive-timer rule binds every agent that starts an asynchronous ' +
      'process, including an evidence worker',
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

  // The card renders the title beside the id, so a title carries the same
  // vocabulary onto the card that a summary or an instruction does.
  const hierarchyViolations = (policies: typeof candidate): string[] =>
    policies.flatMap((policy) =>
      [
        policy.title,
        policy.summary,
        ...policy.instructions.map((instruction) => instruction.text),
      ].flatMap((policyText) =>
        hierarchyTerms
          .filter((term) => policyText.toLowerCase().includes(term))
          .map((term) => `${policy.id}:${term}`),
      ),
    )

  assert.deepEqual(hierarchyViolations(candidate), [])

  // Reproduce the omitted-title guard: a title alone introduces the forbidden
  // vocabulary. The shared predicate must observe it without help from the
  // summary or instructions.
  assert.deepEqual(
    hierarchyViolations([
      { ...candidate[0], title: 'Candidate cohort policy' },
      ...candidate.slice(1),
    ]),
    [`${candidate[0]?.id}:cohort`],
  )

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

test('TEST-001 permits directed mechanical governance and preserves judgment boundaries', () => {
  const testPolicy = loadPolicyCatalog(sharedFixture()).get('TEST-001')

  assert.ok(testPolicy)

  const instructions = testPolicy.instructions.map((instruction) =>
    instruction.text.toLowerCase(),
  )
  const hasInstructionWith = (...terms: string[]): boolean =>
    instructions.some((instruction) =>
      terms.every((term) => instruction.includes(term)),
    )
  assert.ok(
    hasInstructionWith(
      'duration ceiling',
      'fast lane',
      'rolling daily average',
    ),
  )
  assert.ok(
    hasInstructionWith(
      'duration ceiling',
      'is soft',
      'must not fail a command, a criterion, or a review',
      'must not route a stage',
      'release advisory',
    ),
  )
  assert.ok(
    hasInstructionWith(
      'fast lane must hold only the unit and regression lanes',
      'integration lane must run only before a branch lands',
      'impacted profile must not select integration tests',
    ),
  )
  assert.ok(
    hasInstructionWith(
      'mechanical structural checks',
      'test placement',
      'fixture construction',
    ),
  )
  assert.ok(
    hasInstructionWith('automated checks', 'contract value', 'must not'),
  )
  assert.ok(hasInstructionWith('count budget', 'tune verdict', 'must not'))
  assert.ok(
    hasInstructionWith(
      'duration',
      'merge',
      'demote',
      'signal',
      'contract analysis',
    ),
  )
  assert.ok(
    hasInstructionWith(
      '2026-09-14',
      'tune-1789426062833',
      'bounded',
      'must not',
    ),
  )
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
