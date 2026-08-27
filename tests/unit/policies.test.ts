import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createFixture } from '../helpers.js'
import { loadPolicyCatalog, resolvePolicies } from '../../src/lib/policies.js'

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
    /stale policy: MISSING-001/u,
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

test('target policy lookup extensions fail loudly for invalid rows', () => {
  const root = createFixture()

  writePolicyExtension(root, 'missing.json', [
    {
      persona: 'planner',
      workflow: 'delivery',
      stage: 'plan',
      policies: ['MISSING-001'],
    },
  ])

  assert.throws(
    () =>
      resolvePolicies(root, {
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
  const root = createFixture()
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
    'TS-001',
    'VALID-001',
  ])
})

test('representative contexts exclude policies outside their remit', () => {
  const root = createFixture()
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
})

test('pull-request policy follows operator-artifact selection', () => {
  const root = createFixture()
  const ids = (operatorArtifacts: 'requested' | 'suppressed'): string[] =>
    resolvePolicies(root, {
      persona: 'release-steward',
      workflow: 'delivery',
      stage: 'ship',
      operator_artifacts: operatorArtifacts,
    }).map((policy) => policy.id)

  assert.ok(ids('requested').includes('PR-001'))
  assert.equal(ids('suppressed').includes('PR-001'), false)
})

test('best-of-N stages carry the same policies as the delivery stages they mirror', () => {
  const root = createFixture()
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

test('standalone shepherd resolves subagent supervision governance', () => {
  const root = createFixture()
  const ids = resolvePolicies(root, {
    persona: 'coder',
    workflow: 'standalone',
    stage: 'shepherd',
    operator_artifacts: 'suppressed',
  }).map((policy) => policy.id)

  // Shepherd delegates the review squad, so it needs delegation supervision
  // authority alongside its own mode policy.
  assert.ok(ids.includes('SHEPHERD-001'))
  assert.ok(ids.includes('DELEGATE-001'))
})

test('the unbound mode resolves universal and delegation governance', () => {
  const root = createFixture()
  const ids = resolvePolicies(root, {
    persona: 'unbound',
    workflow: 'standalone',
    stage: 'unbound',
    operator_artifacts: 'suppressed',
  }).map((policy) => policy.id)

  // An unbound agent holds no invocation card, so this catch-all context is
  // the only way card-delivered universal policies reach it.
  assert.deepEqual(ids, [
    'ACTION-001',
    'ASK-001',
    'AUTO-001',
    'DELEGATE-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'OPERATOR-001',
    'PRIMER-001',
    'STE-001',
    'VALID-001',
  ])
})

test('the best-of-N session mode resolves its own governance', () => {
  const root = createFixture()
  const policies = resolvePolicies(root, {
    persona: 'meta-orchestrator',
    workflow: 'standalone',
    stage: 'best-of-n',
  })

  assert.deepEqual(
    policies
      .map((policy) => policy.id)
      .filter((id) => id === 'BESTOFN-001' || id === 'WORK-001'),
    ['BESTOFN-001', 'WORK-001'],
  )

  // The session never receives INVOCATION-001, so its delivery authority must
  // be complete inside BESTOFN-001 itself.
  const bestOfN = policies.find((policy) => policy.id === 'BESTOFN-001')
  const instructions = bestOfN?.instructions.join('\n') ?? ''

  assert.match(instructions, /A summary, an excerpt, or a bare path MUST NOT/u)
  assert.match(instructions, /MUST NOT add a parallel scope, policy, gate/u)
  assert.match(
    instructions,
    /missing or mismatched delegation artifact MUST be repaired/u,
  )
})

test('engineering handbook policy loads for verifier and evidence personas', () => {
  const root = createFixture()

  const verifyIds = resolvePolicies(root, {
    persona: 'verifier',
    workflow: 'delivery',
    stage: 'verify',
  }).map((policy) => policy.id)

  assert.deepEqual(verifyIds, [
    'ACTION-001',
    'ASK-001',
    'AUTO-001',
    'BRIEF-001',
    'BROWSER-001',
    'CONTRACT-001',
    'ENG-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'OPERATOR-001',
    'PRIMER-001',
    'STE-001',
    'TS-001',
    'VALID-001',
    'VERIFY-001',
    'WAIVER-001',
  ])

  const reviewerIds = resolvePolicies(root, {
    persona: 'reviewer',
    workflow: 'delivery',
    stage: 'verify',
  }).map((policy) => policy.id)

  for (const id of ['ENG-001', 'CONTRACT-001', 'LANG-001', 'TS-001']) {
    assert.ok(
      reviewerIds.includes(id),
      `the review evidence worker MUST load ${id}`,
    )
  }
})

test('policy registry content remains canonical for inlining', () => {
  const root = createFixture()
  const catalog = loadPolicyCatalog(root)
  const action = catalog.get('ACTION-001')

  assert.ok(action)
  assert.equal(action.title, 'Safe source-control actions')
  assert.match(
    action.summary,
    /MUST NOT perform irreversible source-control actions/,
  )
  assert.equal(action.instructions.length, 2)
})

test('policy resolution snapshots handbook and skill guidance', () => {
  const root = createFixture()
  const catalog = loadPolicyCatalog(root)
  const engineering = catalog.get('ENG-001')
  const python = catalog.get('PY-001')
  const typescript = catalog.get('TS-001')
  const pullRequest = catalog.get('PR-001')

  assert.ok(engineering)
  assert.deepEqual(
    engineering.guidance?.map((guidance) => guidance.source_path),
    ['governance/handbooks/eng/engineering.md'],
  )
  assert.match(
    engineering.guidance?.[0]?.content ?? '',
    /A change MUST be the smallest coherent change/u,
  )

  assert.ok(python)
  assert.deepEqual(
    python.guidance?.map((guidance) => guidance.source_path),
    ['governance/handbooks/python/style-guide.md'],
  )
  assert.match(python.guidance?.[0]?.content ?? '', /## Core principles/u)
  assert.match(
    python.guidance?.[0]?.content ?? '',
    /Mutable default arguments MUST NOT be used/u,
  )
  assert.doesNotMatch(
    python.guidance?.[0]?.content ?? '',
    /Appendix A: Formatter-owned rules/u,
  )

  assert.ok(typescript)
  assert.deepEqual(
    typescript.guidance?.map((guidance) => guidance.source_path),
    [
      'governance/handbooks/typescript/style-guide.md',
      'governance/handbooks/typescript/node.md',
    ],
  )
  assert.match(typescript.guidance?.[0]?.content ?? '', /## Core principles/u)
  assert.doesNotMatch(
    typescript.guidance?.[0]?.content ?? '',
    /Appendix A: Formatter-owned rules/u,
  )

  assert.ok(pullRequest)
  assert.match(pullRequest.guidance?.[0]?.content ?? '', /## Authority modes/u)
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

test('non-Python embedded workspaces do not load Python guidance', () => {
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

  const ids = resolvePolicies(root, {
    persona: 'coder',
    workflow: 'delivery',
    stage: 'implement',
  }).map((policy) => policy.id)

  assert.ok(!ids.includes('PY-001'))
  assert.ok(!ids.includes('TS-001'))
})

test('orchestration and release guidance resolve with required policy dependencies', () => {
  const root = createFixture()
  const orchestratorIds = resolvePolicies(root, {
    persona: 'orchestrator',
    workflow: 'delivery',
    stage: 'plan',
  }).map((policy) => policy.id)
  const releaseIds = resolvePolicies(root, {
    persona: 'release-steward',
    workflow: 'delivery',
    stage: 'ship',
  }).map((policy) => policy.id)

  assert.deepEqual(orchestratorIds, [
    'ACTION-001',
    'ASK-001',
    'AUTO-001',
    'AWAY-001',
    'BRIEF-001',
    'DELEGATE-001',
    'EXECUTOR-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'INVOCATION-001',
    'OPERATOR-001',
    'ORCH-001',
    'OUTPUT-001',
    'PAUSE-001',
    'PRIMER-001',
    'RUNTIME-001',
    'STE-001',
    'VALID-001',
    'WAIVER-001',
    'WORK-001',
  ])
  assert.deepEqual(releaseIds, [
    'ACTION-001',
    'ASK-001',
    'AUTO-001',
    'BRIEF-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'OPERATOR-001',
    'PR-001',
    'PRIMER-001',
    'REPO-001',
    'SHIP-001',
    'STE-001',
    'VALID-001',
    'VERSION-001',
    'WAIVER-001',
    'WORK-001',
  ])
})

test('delivery plan resolves planning guidance without supervisor policies', () => {
  const root = createFixture()
  const planIds = resolvePolicies(root, {
    persona: 'planner',
    workflow: 'delivery',
    stage: 'plan',
  }).map((policy) => policy.id)

  assert.deepEqual(planIds, [
    'ACTION-001',
    'ASK-001',
    'AUTO-001',
    'BRIEF-001',
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

  // Run-advancement authority stays with the supervisor, so a worker that owns
  // the first stage must not inherit it.
  for (const supervisorOnly of [
    'ORCH-001',
    'PAUSE-001',
    'WAIVER-001',
    'WORK-001',
  ]) {
    assert.ok(
      !planIds.includes(supervisorOnly),
      `planner MUST NOT resolve ${supervisorOnly}`,
    )
  }
})
test('design intake keeps resolving faithful intake for the supervisor', () => {
  const root = createFixture()
  const ids = resolvePolicies(root, {
    persona: 'orchestrator',
    workflow: 'design',
    stage: 'intake',
  }).map((policy) => policy.id)

  assert.ok(ids.includes('INTAKE-001'))
  assert.ok(ids.includes('ORCH-001'))
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
})

test('standalone release preparation resolves self-development version ownership', () => {
  const root = createFixture()
  const ids = resolvePolicies(root, {
    persona: 'release-steward',
    workflow: 'standalone',
    stage: 'release',
  }).map((policy) => policy.id)

  assert.ok(ids.includes('VERSION-001'))
})

test('embedded coding stages exclude Pancreator language and binary policies', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  config.installation_mode = 'embedded'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const ids = resolvePolicies(root, {
    persona: 'coder',
    workflow: 'delivery',
    stage: 'implement',
  }).map((policy) => policy.id)

  assert.ok(!ids.includes('BIN-001'))
  assert.ok(!ids.includes('TS-001'))
  assert.ok(ids.includes('ENG-001'))
  assert.ok(ids.includes('REPO-001'))
})

test('decomposer loads conservative decomposition governance', () => {
  const root = createFixture()
  const ids = resolvePolicies(root, {
    persona: 'decomposer',
    workflow: 'standalone',
    stage: 'decompose',
  }).map((policy) => policy.id)

  assert.deepEqual(ids, [
    'ACTION-001',
    'ASK-001',
    'AUTO-001',
    'BRIEF-001',
    'DECOMP-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'OPERATOR-001',
    'PRIMER-001',
    'STE-001',
    'VALID-001',
  ])
})

test('standalone remediation personas load their work-mode policies', () => {
  const root = createFixture()

  const investigatorIds = resolvePolicies(root, {
    persona: 'investigator',
    workflow: 'standalone',
    stage: 'debug',
  }).map((policy) => policy.id)
  assert.deepEqual(investigatorIds, [
    'ACTION-001',
    'ASK-001',
    'AUTO-001',
    'BRIEF-001',
    'DIAG-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'OPERATOR-001',
    'PRIMER-001',
    'STE-001',
    'VALID-001',
    'WORK-001',
  ])

  const spotfixerIds = resolvePolicies(root, {
    persona: 'spotfixer',
    workflow: 'standalone',
    stage: 'spotfix',
  }).map((policy) => policy.id)
  assert.deepEqual(spotfixerIds, [
    'ACTION-001',
    'ASK-001',
    'AUTO-001',
    'BIN-001',
    'BRIEF-001',
    'BROWSER-001',
    'CONTRACT-001',
    'ENG-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'LANG-001',
    'OPERATOR-001',
    'OUTPUT-001',
    'PRIMER-001',
    'REPO-001',
    'RUNTIME-001',
    'SPOT-001',
    'STE-001',
    'TS-001',
    'VALID-001',
    'WORK-001',
  ])
})

test('harness technician loads repair governance', () => {
  const root = createFixture()
  const ids = resolvePolicies(root, {
    persona: 'harness-technician',
    workflow: 'standalone',
    stage: 'repair',
  }).map((policy) => policy.id)

  assert.deepEqual(ids, [
    'ACTION-001',
    'ASK-001',
    'AUTO-001',
    'BRIEF-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'OPERATOR-001',
    'PRIMER-001',
    'REPAIR-001',
    'REPO-001',
    'STE-001',
    'VALID-001',
  ])
})

test('librarian loads target primer governance', () => {
  const root = createFixture()
  const ids = resolvePolicies(root, {
    persona: 'librarian',
    workflow: 'standalone',
    stage: 'build-docs',
  }).map((policy) => policy.id)

  assert.ok(ids.includes('PRIMER-001'))
  assert.ok(ids.includes('VALID-001'))
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
  const root = createFixture()
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
