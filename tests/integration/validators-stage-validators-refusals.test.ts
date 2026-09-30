import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  STAGE_VALIDATOR_REFUSALS,
  VALIDATOR_BLOCKING_FIELDS,
  validateImplementationClaims,
  validateSharedFieldContract,
  validateVerifyOutput,
  undeclaredBlockingFieldIssues,
} from '../../src/lib/validators/stage-validators.js'
import { UNCOVERED_REFUSAL_SOURCES } from '../../src/lib/validators/refusals.js'
import { createFixture, writeJson } from '../helpers.js'
import {
  claimsValidatorInput,
  passingQaCase,
  validatorFixtureRoot,
  verifyRequirement,
  writeVerifyOutput,
} from './validators-stage-validators-helpers.js'

test('field contract validator rejects enforced_fields that lack a declared shape', () => {
  const root = createFixture()
  const contractPath = 'library/schemas/stage-output-requirements.json'
  const source = JSON.parse(
    readFileSync(path.join(root, contractPath), 'utf8'),
  ) as Record<string, unknown>
  const plan = (source.stages as Record<string, unknown>).plan as Record<
    string,
    unknown
  >

  plan.validators = [
    {
      registry_id: 'PLAN-TRACE-VALIDATE-001',
      enforcement: 'blocks',
      enforced_fields: [
        'data.acceptance_criteria[].maps_to',
        'data.missing.field',
      ],
    },
  ]

  writeJson(path.join(root, contractPath), source)

  const result = validateSharedFieldContract({
    root,
    targetPath: contractPath,
    requirement: {
      policy_id: 'CONTRACT-001',
      requirement_id: 'shared-stage-field-contract',
      registry_id: 'FIELD-CONTRACT-VALIDATE-001',
      arguments: {},
    },
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (item) =>
        item.code === 'field_contract.enforced_field' &&
        item.message.includes('data.missing.field'),
    ),
  )
  assert.ok(
    result.issues.some(
      (item) =>
        item.code === 'field_contract.required_child_enforcement' &&
        item.message.includes('data.engineering_plan.files[].purpose'),
    ),
  )
})

test('field contract guard requires every verify blocking field in enforced_fields', () => {
  const root = createFixture()
  const contractPath = 'library/schemas/stage-output-requirements.json'

  const source = JSON.parse(
    readFileSync(path.join(root, contractPath), 'utf8'),
  ) as Record<string, unknown>
  const stages = source.stages as Record<string, Record<string, unknown>>
  const validators = stages.verify.validators as Array<Record<string, unknown>>
  const verify = validators.find(
    (entry) => entry.registry_id === 'VERIFY-VALIDATE-001',
  )

  assert.ok(verify)
  verify.enforced_fields = (verify.enforced_fields as string[]).filter(
    (field) => field !== 'data.verify.findings[].id',
  )
  writeJson(path.join(root, contractPath), source)

  const result = validateSharedFieldContract({
    root,
    targetPath: contractPath,
    requirement: {
      policy_id: 'CONTRACT-001',
      requirement_id: 'stage-field-contract-validate',
      registry_id: 'FIELD-CONTRACT-VALIDATE-001',
      arguments: {},
    },
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (item) =>
        item.code === 'field_contract.validator_blocking_field' &&
        item.message.includes('data.verify.findings[].id'),
    ),
    JSON.stringify(result.issues),
  )
})

// R-01 of run 63290: the guard was a literal pair of verify field paths, so
// it proved only that the two known omissions stay closed. The contract it
// has to carry is general — any field a validator blocks on is declared — so
// the case passes a declaration the guard has never seen and asserts the
// refusal. The declaration is a parameter rather than the exported constant,
// because a case that mutates the one structure the mechanism rests on is a
// hazard to every case that runs after it (RV-03).
test('the field contract guard refuses any undeclared blocking field', () => {
  const root = createFixture()
  const contractPath = 'library/schemas/stage-output-requirements.json'
  const source = JSON.parse(
    readFileSync(path.join(root, contractPath), 'utf8'),
  ) as Record<string, unknown>

  assert.deepEqual(
    undeclaredBlockingFieldIssues(source, [
      {
        stage: 'verify',
        registry_id: 'VERIFY-VALIDATE-001',
        fields: ['data.verify.findings[].id'],
      },
    ]),
    [],
  )

  const issues = undeclaredBlockingFieldIssues(source, [
    {
      stage: 'verify',
      registry_id: 'VERIFY-VALIDATE-001',
      fields: ['data.verify.findings[].invented_by_this_case'],
    },
    {
      stage: 'ship',
      registry_id: 'RELEASE-VALIDATE-001',
      fields: ['data.release.invented_by_this_case'],
    },
  ])

  assert.deepEqual(
    issues.map((item) => item.code),
    [
      'field_contract.validator_blocking_field',
      'field_contract.validator_blocking_field',
    ],
  )
  assert.ok(
    issues.some((item) =>
      item.message.includes('data.verify.findings[].invented_by_this_case'),
    ),
    JSON.stringify(issues),
  )
  assert.ok(
    issues.some((item) =>
      item.message.includes('data.release.invented_by_this_case'),
    ),
    JSON.stringify(issues),
  )

  // The live declaration still passes against the shipped contract, so the
  // case above is the general proof and this is the standing guarantee.
  assert.equal(
    validateSharedFieldContract({
      root,
      targetPath: contractPath,
      requirement: {
        policy_id: 'CONTRACT-001',
        requirement_id: 'stage-field-contract-validate',
        registry_id: 'FIELD-CONTRACT-VALIDATE-001',
        arguments: {},
      },
    }).status,
    'passed',
  )
})

/**
 * Every `issue()` call site in one validator module, as the module's own
 * source spells the first argument.
 *
 * The earlier form of this scan matched `'<prefix>.[a-z_]+'` across the whole
 * module, which read past three escape hatches (RV-11): a code carrying an
 * uppercase letter or a digit, a code the handler composes at runtime, and a
 * refusal raised by a handler nobody had scanned. Reading call sites instead
 * of code spellings closes all three, because a composed argument is a call
 * site like any other and the argument text itself has to be declared.
 */
function issueCallSites(file: string): { fn: string; expression: string }[] {
  const source = readFileSync(path.join(process.cwd(), file), 'utf8')
  const lines = source.split('\n')
  const offsets: number[] = []
  let cursor = 0

  for (const line of lines) {
    offsets.push(cursor)
    cursor += line.length + 1
  }

  // Prettier closes every top-level declaration with a lone `}` in column 0,
  // so a function spans from its header to the next such line.
  const ranges: { fn: string; start: number; end: number }[] = []

  lines.forEach((line, index) => {
    const header = /^(?:export )?function (\w+)[(<]/u.exec(line)

    if (!header) {
      return
    }

    const close = lines.findIndex(
      (candidate, offset) => offset > index && candidate === '}',
    )

    ranges.push({
      fn: header[1] as string,
      start: offsets[index] as number,
      end: offsets[close] as number,
    })
  })

  const sites: { fn: string; expression: string }[] = []

  for (const match of source.matchAll(/\bissue\(/gu)) {
    const at = match.index

    // The `issue()` factory's own declaration is not a call site.
    if (source.slice(Math.max(0, at - 9), at) === 'function ') {
      continue
    }

    const range = ranges.find(
      (candidate) => at >= candidate.start && at < candidate.end,
    )

    assert.ok(
      range,
      `${file}: issue() call at offset ${at} sits outside every top-level function`,
    )
    sites.push({
      fn: range.fn,
      expression: firstArgument(source, at + match[0].length),
    })
  }

  return sites
}

/** The first `issue()` argument: the code itself, or the raw expression. */
function firstArgument(source: string, from: number): string {
  let at = from

  while (/\s/u.test(source[at] as string)) {
    at += 1
  }

  if (source[at] === "'") {
    const close = source.indexOf("'", at + 1)

    return source.slice(at + 1, close)
  }

  let depth = 0

  for (let scan = at; scan < source.length; scan += 1) {
    const character = source[scan] as string

    if ('([{'.includes(character)) {
      depth += 1
    } else if (')]}'.includes(character)) {
      if (depth === 0) {
        return source.slice(at, scan).trim()
      }

      depth -= 1
    } else if (character === ',' && depth === 0) {
      return source.slice(at, scan).trim()
    }
  }

  return source.slice(at).trim()
}

// RV-01, RV-07, and RV-09 of run 63290 were the same defect found three
// times: the completeness proof covered the one handler a verifier had
// named, so the next round found the next handler blocking a worker on a
// field its contract never declared. This case runs the proof over every
// stage-output validator at once. A new `issue(...)` branch in any of them
// fails here until its author classifies it as field-shaped or explains why
// no declared field owns it.
test('every stage-output validator refusal is classified in the canonical declaration', () => {
  const contract = JSON.parse(
    readFileSync(
      path.join(
        process.cwd(),
        'library/schemas/stage-output-requirements.json',
      ),
      'utf8',
    ),
  ) as {
    stages: Record<
      string,
      { validators: { registry_id: string; enforced_fields?: string[] }[] }
    >
  }

  assert.ok(
    STAGE_VALIDATOR_REFUSALS.length >= 9,
    `only ${STAGE_VALIDATOR_REFUSALS.length} validators are declared`,
  )

  for (const entry of STAGE_VALIDATOR_REFUSALS) {
    const label = `${entry.registry_id} (${entry.stage ?? 'no stage'})`
    const raised = new Set<string>()

    for (const source of entry.sources) {
      for (const site of issueCallSites(source.file)) {
        if (!source.functions.includes(site.fn)) {
          continue
        }

        const generated = entry.generated?.find(
          (candidate) => candidate.expression === site.expression,
        )

        for (const code of generated?.codes ?? [site.expression]) {
          raised.add(code)
        }
      }
    }

    assert.ok(raised.size > 0, `${label} scanned no refusal at all`)
    assert.deepEqual(
      [...raised].sort(),
      [...new Set(entry.refusals.map((refusal) => refusal.code))].sort(),
      label,
    )

    // A refusal that owns no declared field has to say why, because an
    // unexplained entry is how a field-shaped refusal escapes the declaration.
    for (const refusal of entry.refusals) {
      if (refusal.paths.length === 0) {
        assert.ok(
          (refusal.unowned_reason ?? '').length > 0,
          `${label}: ${refusal.code} declares no path and no reason`,
        )
      }
    }

    if (entry.stage === null) {
      // No stage entry means nowhere to declare a field, so a refusal that
      // claimed one would name a path no card can render.
      assert.deepEqual(
        entry.refusals.filter((refusal) => refusal.paths.length > 0),
        [],
        `${label} declares fields it has no stage contract to declare them in`,
      )
      continue
    }

    // The declaration only pays off where the worker reads it, so the shipped
    // contract has to carry every path the handler can refuse on.
    const enforced = new Set(
      contract.stages[entry.stage]?.validators.find(
        (validator) => validator.registry_id === entry.registry_id,
      )?.enforced_fields ?? [],
    )
    const declared = new Set(
      VALIDATOR_BLOCKING_FIELDS.filter(
        (fields) =>
          fields.stage === entry.stage &&
          fields.registry_id === entry.registry_id,
      ).flatMap((fields) => fields.fields),
    )

    for (const refusal of entry.refusals) {
      for (const fieldPath of refusal.paths) {
        assert.ok(
          declared.has(fieldPath),
          `${label}: ${refusal.code} omits ${fieldPath}`,
        )
        assert.ok(
          enforced.has(fieldPath),
          `${entry.stage} enforced_fields omits ${fieldPath}`,
        )
      }
    }
  }
})

// The per-validator proof above only reaches the functions a declaration
// names. A handler nobody listed is the way the whole mechanism is escaped,
// so every refusal raised anywhere in the scanned modules has to belong to a
// declared validator or to an entry that states why no stage contract binds
// it.
test('every refusal in the validator modules belongs to a declared validator', () => {
  const covered = new Map<string, Set<string>>()

  for (const entry of STAGE_VALIDATOR_REFUSALS) {
    for (const source of entry.sources) {
      const functions = covered.get(source.file) ?? new Set<string>()

      for (const fn of source.functions) {
        functions.add(fn)
      }

      covered.set(source.file, functions)
    }
  }

  for (const uncovered of UNCOVERED_REFUSAL_SOURCES) {
    assert.ok(
      uncovered.reason.length > 0,
      `${uncovered.function} states no reason`,
    )
    assert.ok(
      !covered.get(uncovered.file)?.has(uncovered.function),
      `${uncovered.function} is both covered and excused`,
    )
  }

  // The stage validators live one module each under one directory, and the
  // whole directory is scanned as the single module it replaced was, so a
  // refusal in a module no declaration names still fails here.
  const stageDirectory = 'src/lib/validators/stage'
  const scanned = new Set([
    ...covered.keys(),
    ...UNCOVERED_REFUSAL_SOURCES.map((uncovered) => uncovered.file),
    ...readdirSync(path.join(process.cwd(), stageDirectory))
      .filter((name) => name.endsWith('.ts'))
      .map((name) => `${stageDirectory}/${name}`),
  ])

  for (const file of scanned) {
    const excused = new Set(
      UNCOVERED_REFUSAL_SOURCES.filter(
        (uncovered) => uncovered.file === file,
      ).map((uncovered) => uncovered.function),
    )

    for (const site of issueCallSites(file)) {
      assert.ok(
        covered.get(file)?.has(site.fn) || excused.has(site.fn),
        `${file}: ${site.fn} raises ${site.expression} and no validator declaration claims it`,
      )
    }
  }
})

// The source-checked proof above reads declarations. This case reads
// behavior: the claims handler really does refuse each of these shapes, and
// the implement and remediate contracts really do declare the field it
// refuses on. RV-09 of run 63290 is the reason both halves are asserted
// together — the handler had refused a worker on an acceptance id and on
// every blocked-output field while neither stage contract named them, so a
// proof of either half alone would have passed.
test('every claims refusal reaches the implement and remediate contracts', () => {
  const root = createFixture()
  const target =
    'runtime/logs/workflows/run-changed-files/outputs/implement-1-test.json'

  writeJson(path.join(root, target), {
    data: {
      implementation: {
        changed_files: [{ path: 'src/lib/example.ts' }],
        tests_added: [],
        notes: [],
      },
      acceptance_results: [{ evidence: ['fixture evidence'] }],
    },
  })

  const result = validateImplementationClaims(
    claimsValidatorInput(root, target),
  )

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some((issue) => issue.code === 'claim.entry_shape'),
    JSON.stringify(result.issues),
  )
  assert.ok(
    result.issues.some((issue) => issue.code === 'acceptance.shape'),
    JSON.stringify(result.issues),
  )

  // An acceptance entry that carries an id but no result reaches the second
  // refusal, which the first one short-circuits.
  writeJson(path.join(root, target), {
    data: {
      implementation: { changed_files: [], tests_added: [], notes: [] },
      acceptance_results: [{ id: 'AC-01', evidence: ['fixture evidence'] }],
    },
  })

  assert.ok(
    validateImplementationClaims(
      claimsValidatorInput(root, target),
    ).issues.some((issue) => issue.code === 'acceptance.result'),
  )

  const blockedTarget =
    'runtime/logs/workflows/run-changed-files/outputs/implement-2-test.json'

  writeJson(path.join(root, blockedTarget), {
    result: 'blocked',
    data: { blocked: {}, acceptance_results: [] },
  })

  const blocked = validateImplementationClaims(
    claimsValidatorInput(root, blockedTarget),
  )

  assert.ok(
    blocked.issues.some((issue) => issue.code === 'blocked.shape'),
    JSON.stringify(blocked.issues),
  )
  assert.ok(
    blocked.issues.some((issue) => issue.code === 'blocked.evidence'),
    JSON.stringify(blocked.issues),
  )

  const contract = JSON.parse(
    readFileSync(
      path.join(root, 'library/schemas/stage-output-requirements.json'),
      'utf8',
    ),
  ) as {
    stages: Record<
      string,
      {
        validators: { registry_id: string; enforced_fields?: string[] }[]
        fields: { path: string }[]
      }
    >
  }

  for (const stage of ['implement', 'remediate']) {
    const enforced = new Set(
      contract.stages[stage].validators.find(
        (validator) =>
          validator.registry_id === 'IMPLEMENTATION-CLAIMS-VALIDATE-001',
      )?.enforced_fields ?? [],
    )
    const declared = new Set(
      contract.stages[stage].fields.map((field) => field.path),
    )

    for (const fieldPath of [
      'data.implementation.changed_files[]',
      'data.acceptance_results[].id',
      'data.acceptance_results[].result',
      'data.blocked.missing_precondition',
      'data.blocked.supplying_command',
      'data.blocked.evidence[]',
    ]) {
      assert.ok(
        enforced.has(fieldPath),
        `${stage} does not enforce ${fieldPath}`,
      )
      assert.ok(
        declared.has(fieldPath),
        `${stage} does not declare ${fieldPath}`,
      )
    }
  }
})

// The three paths RV-01 found undeclared, asserted at the handler so the
// declaration and the refusal cannot be satisfied separately.
test('the verify handler refuses undeclared QA and acceptance item fields', () => {
  const root = validatorFixtureRoot('pan-verify-item-fields-')
  const target = 'output.json'

  writeVerifyOutput(root, target, {
    verdict: 'pass_with_warnings',
    findings: [],
    qa_cases: [{ steps: 'a', expected: 'b', actual: 'c', result: 'pass' }],
    acceptance_results: [{ id: 'AC-01' }, { result: 'pass' }],
  })

  const result = validateVerifyOutput({
    root,
    targetPath: target,
    requirement: verifyRequirement(),
  })
  const codes = result.issues.map((item) => item.code)

  assert.equal(result.status, 'failed')
  assert.ok(codes.includes('verify.case_shape'), JSON.stringify(codes))
  assert.ok(codes.includes('verify.acceptance_shape'), JSON.stringify(codes))
  assert.ok(codes.includes('verify.acceptance_result'), JSON.stringify(codes))

  const enforced = new Set(
    (
      JSON.parse(
        readFileSync(
          path.join(root, 'library/schemas/stage-output-requirements.json'),
          'utf8',
        ),
      ) as {
        stages: {
          verify: {
            validators: { registry_id: string; enforced_fields: string[] }[]
          }
        }
      }
    ).stages.verify.validators.find(
      (entry) => entry.registry_id === 'VERIFY-VALIDATE-001',
    )?.enforced_fields ?? [],
  )

  for (const fieldPath of [
    'data.verify.qa_cases[].id',
    'data.verify.acceptance_results[].id',
    'data.verify.acceptance_results[].result',
  ]) {
    assert.ok(enforced.has(fieldPath), fieldPath)
  }
})

// The other half of the same contract: the verify handler raises its finding
// refusals from the declaration, so a blocking branch cannot exist outside
// the set the guard above checks. `statement` is the field that proved the
// old arrangement wrong — the handler blocked on it while the schema, the
// rendered card, and the scaffold all stayed silent.
test('every verify finding refusal names a declared blocking field', () => {
  const root = validatorFixtureRoot('pan-verify-blocking-fields-')
  const target = 'output.json'
  const declared = new Set(
    VALIDATOR_BLOCKING_FIELDS.filter(
      (entry) => entry.registry_id === 'VERIFY-VALIDATE-001',
    ).flatMap((entry) => entry.fields),
  )

  assert.ok(declared.has('data.verify.findings[].statement'))

  writeVerifyOutput(root, target, {
    verdict: 'pass_with_warnings',
    findings: [
      {
        id: 'VF-1',
        severity: 'low',
        source: 'review',
        evidence: ['fixture'],
      },
    ],
    qa_cases: [passingQaCase],
    acceptance_results: [{ id: 'AC-01', result: 'pass' }],
  })

  const result = validateVerifyOutput({
    root,
    targetPath: target,
    requirement: verifyRequirement(),
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (item) =>
        item.code === 'verify.finding_statement' &&
        item.message.includes('VF-1'),
    ),
    JSON.stringify(result.issues),
  )
})

// Run 63308 finding F-02: the guard read the plan file contract alone, so a
// stage that declared a required child gained no coverage, and the guard
// passing looked the same as the guard not running. The stage here is not
// `plan`, and the removed declaration is a shape rather than an enforcement.
test('the field contract guard reaches a required child of any stage', () => {
  const root = createFixture()
  const contractPath = 'library/schemas/stage-output-requirements.json'
  const source = JSON.parse(
    readFileSync(path.join(root, contractPath), 'utf8'),
  ) as Record<string, unknown>
  const stages = source.stages as Record<string, Record<string, unknown>>

  const requirement = {
    policy_id: 'CONTRACT-001',
    requirement_id: 'shared-stage-field-contract',
    registry_id: 'FIELD-CONTRACT-VALIDATE-001',
    arguments: {},
  }

  const intact = validateSharedFieldContract({
    root,
    targetPath: contractPath,
    requirement,
  })

  assert.equal(intact.status, 'passed', JSON.stringify(intact.issues))

  const implement = stages.implement as {
    fields: Array<Record<string, unknown>>
  }

  implement.fields = implement.fields.filter(
    (field) => field.path !== 'data.implementation.tests_added[].contract',
  )
  writeJson(path.join(root, contractPath), source)

  const result = validateSharedFieldContract({
    root,
    targetPath: contractPath,
    requirement,
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (item) =>
        item.code === 'field_contract.required_child_shape' &&
        item.message.includes('data.implementation.tests_added[].contract'),
    ),
    JSON.stringify(result.issues),
  )
})
