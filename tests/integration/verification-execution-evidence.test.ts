import assert from 'node:assert/strict'
import {
  existsSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { maybeStartDelivery } from '../../src/lib/cohorts.js'
import { prepareInvocation } from '../../src/lib/engine/prepare.js'
import { delegateInvocation } from '../../src/lib/engine/delegate.js'
import { delegateEvidenceWorkers } from '../../src/lib/engine/evidence-workers.js'
import {
  collectVerificationExecutionEvidence,
  resolveVerificationExecutionOperations,
  verificationExecutionGaps,
} from '../../src/lib/engine/verification-execution.js'
import { isRecord, readJson, writeJsonAtomic } from '../../src/lib/io.js'
import { loadState, statePath } from '../../src/lib/state.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import { createTestTempDirectory } from '../fixture-template.js'
import {
  checkpoint,
  submitStageOutput,
  installClaudeCodeFixture,
  withStub,
} from './delivery-helpers.js'
import { ratifiedPlanRun } from './cohort-helpers.js'
import { attestRunCard } from '../helpers.js'
import { operation } from './verification-execution-helpers.js'
import { renderInvocationMarkdown } from '../../src/lib/render/invocation-markdown.js'
import { renderSupervisorProcedureMarkdown } from '../../src/lib/render/supervisor-procedure.js'
import { resolveRequirements } from '../../src/lib/requirements/resolve.js'

import { prepared, enforced } from './verification-execution-fixtures.js'

test('non-Git workspaces need a source fingerprint only for declared operations', () => {
  const { root, state, invocation } = prepared([
    operation('requires-source', 'console.log("raw")'),
  ])
  const workspace = createTestTempDirectory('execution-non-git-')
  const nonGit = { ...invocation, workspace_root: workspace }
  const nonGitState = { ...state, workspace_root: workspace }
  const required = collectVerificationExecutionEvidence(
    root,
    nonGitState,
    nonGit,
  )
  assert.equal(required.manifest.source_fingerprint, null)
  assert.ok(
    verificationExecutionGaps(root, nonGit).some((gap) =>
      /Missing current successful observation/u.test(gap),
    ),
  )

  const empty = {
    ...nonGit,
    verification_execution: {
      ...invocation.verification_execution!,
      operations: [],
      sources: [],
      gaps: [],
    },
  }
  const unused = collectVerificationExecutionEvidence(root, nonGitState, empty)
  assert.deepEqual(unused.manifest.records, [])
  assert.deepEqual(verificationExecutionGaps(root, empty), [])
})

for (const chunks of [1, 2]) {
  test(`approved plan execution authority survives routing ${chunks} delivery unit(s)`, () => {
    const { root, workflow } = prepared([])
    const planRunId = ratifiedPlanRun(
      root,
      Array.from({ length: chunks }, (_, index) => ({
        id: `unit-${index}`,
        cohort_index: 1,
      })),
    )
    const planState = loadState(root, planRunId)
    const record = planState.stage_history[0]
    const planPath = path.join(root, record.output_path)
    const plan = readJson(planPath)
    assert.ok(isRecord(plan) && isRecord(plan.data))
    plan.invocation_id = record.invocation_id
    plan.data.test_plan = [
      {
        id: 'TP-01',
        criterion: 'AC-01',
        execution: {
          operations: [
            operation('from-plan', "console.log('planned live observation')"),
          ],
        },
      },
      {
        id: 'TP-OTHER',
        criterion: 'AC-OTHER',
        execution: {
          operations: [
            operation('other-unit', "console.log('not this unit')", {
              criterion: 'AC-OTHER',
            }),
          ],
        },
      },
    ]
    writeJsonAtomic(planPath, plan)
    for (let index = 0; index < chunks; index++) {
      writeFileSync(
        path.join(root, `runtime/specs/unit-${index}.md`),
        '# Request\n\n## Acceptance criteria\n\n1. AC-01 [proof: live] Observe the terminal.\n',
      )
    }
    const routed = maybeStartDelivery(root, planState, {
      actor: 'operator',
      action: 'approve',
    })
    assert.ok(routed)
    assert.equal(routed.status, 'started', JSON.stringify(routed))
    assert.ok(routed.kind === 'delivery' || routed.kind === 'cohort')
    const runIds =
      routed.kind === 'delivery'
        ? [routed.run_id]
        : routed.chunks.map((chunk) => chunk.run_id)
    for (const runId of runIds) {
      const state = loadState(root, runId)
      assert.deepEqual(state.stage_history, [])
      attestRunCard(root, runId)
      const implementation = prepareInvocation(root, runId).invocation
      assert.ok(implementation?.inputs.context_reference)
      const parentReference = implementation.inputs.context_reference
      const implemented = submitStageOutput(
        root,
        runId,
        stageBySlug(workflow, 'implement'),
        'success',
        [],
        (output) => {
          assert.ok(output.invocation_attestation)
          assert.ok(output.invocation_attestation.status !== 'reference_failed')
          output.invocation_attestation.context_references = [
            {
              source_path: parentReference.source_path,
              content_sha256: parentReference.content_sha256,
              status: 'read',
            },
          ]
        },
      )
      assert.equal(
        implemented.record.outcome,
        'success',
        JSON.stringify(implemented.record.evaluation),
      )
      const verified = prepareInvocation(root, runId)
      const consumer = verified.invocation
      assert.ok(consumer?.verification_execution)
      const inputs = consumer.inputs
      const contract = consumer.verification_execution
      assert.deepEqual(contract.gaps, [])
      assert.equal(contract.operations.length, 1)
      assert.equal(contract.operations[0].source.authority, 'approved_plan')
      assert.equal(
        contract.operations[0].source.invocation_id,
        record.invocation_id,
      )
      assert.ok(
        inputs.references.some(
          (reference) => reference.path === record.output_path,
        ),
      )
      const collected = collectVerificationExecutionEvidence(
        root,
        verified.state,
        consumer,
      )
      assert.equal(collected.manifest.records.length, 1)
      if (enforced(root)) {
        assert.equal(
          collected.manifest.records[0].stdout.trim(),
          'planned live observation',
        )
      } else {
        assert.notEqual(collected.manifest.records[0].status, 'collected')
      }
      writeJsonAtomic(planPath, { ...plan, summary: 'changed after routing' })
      const drifted = resolveVerificationExecutionOperations(
        root,
        verified.state,
        consumer,
      )
      assert.equal(drifted.operations.length, 0)
      assert.ok(
        drifted.gaps.some((gap) => /digest|changed|drift/iu.test(gap.reason)),
      )
      writeJsonAtomic(planPath, plan)
      const planningStatePath = statePath(root, planRunId)
      const planningState = readJson(planningStatePath)
      rmSync(planningStatePath)
      const missing = resolveVerificationExecutionOperations(
        root,
        verified.state,
        consumer,
      )
      assert.equal(missing.operations.length, 0)
      assert.ok(missing.gaps.some((gap) => gap.id === 'approved_plan'))
      writeJsonAtomic(planningStatePath, planningState)
    }
  })
}

test('optional reproductions cannot satisfy mandatory live criterion authority', () => {
  const { root, state, invocation } = prepared(
    [
      operation('optional-only', "console.log('optional')", {
        required: false,
      }),
    ],
    {
      key: 'execution-optional-only-live',
      run: { requestPath: 'runtime/live-optional-request.md' },
      fixture: (root) =>
        writeFileSync(
          path.join(root, 'runtime/live-optional-request.md'),
          '# Request\n\n## Acceptance criteria\n\n1. AC-01 [proof: live] Observe the live case.\n',
        ),
    },
  )
  assert.ok(
    invocation.verification_execution!.gaps.some((gap) => gap.id === 'AC-01'),
  )
  const collected = collectVerificationExecutionEvidence(
    root,
    state,
    invocation,
  )
  assert.deepEqual(collected.manifest.records, [])
  assert.ok(verificationExecutionGaps(root, invocation).length > 0)
})

test('source-authorized handoffs supply missing legacy live-case authority on the next visit', () => {
  const { root, state, invocation } = prepared(
    [operation('recovery', "console.log('live')")],
    {
      key: 'execution-live-recovery',
      run: { requestPath: 'runtime/live-execution-request.md' },
      fixture: (root) =>
        writeFileSync(
          path.join(root, 'runtime/live-execution-request.md'),
          '# Request\n\n## Acceptance criteria\n\n1. AC-01 [proof: live] Observe the live case.\n',
        ),
    },
  )
  const planPath = 'runtime/legacy-execution-plan.json'
  writeJsonAtomic(path.join(root, planPath), {
    invocation_id: 'approved-plan',
    result: 'success',
    data: {
      test_plan: [
        { id: 'TP-01', criterion: 'AC-01', action: 'Legacy terminal case' },
      ],
    },
  })
  const planRecord = {
    ...state.stage_history[0],
    stage: 'plan',
    invocation_id: 'approved-plan',
    output_path: planPath,
    outcome: 'success' as const,
  }
  const consumer = {
    ...invocation,
    inputs: {
      ...invocation.inputs,
      references: [
        ...invocation.inputs.references,
        { path: planPath, description: 'Approved legacy plan' },
      ],
    },
  }
  const before = resolveVerificationExecutionOperations(
    root,
    {
      ...state,
      stage_history: [planRecord],
    },
    consumer,
  )
  assert.ok(before.gaps.some((gap) => gap.id === 'TP-01'))
  assert.ok(before.gaps.some((gap) => gap.id === 'AC-01'))
  const recovery = resolveVerificationExecutionOperations(
    root,
    {
      ...state,
      stage_history: [planRecord, ...state.stage_history],
    },
    consumer,
  )
  assert.equal(recovery.operations.length, 1)
  assert.equal(recovery.operations[0].source.authority, 'source_allowed')
  assert.deepEqual(recovery.gaps, [])
  const recovered = { ...consumer, verification_execution: recovery }
  const collected = collectVerificationExecutionEvidence(root, state, recovered)
  assert.equal(collected.manifest.records.length, 1)
  if (enforced(root)) {
    assert.equal(collected.manifest.records[0].stdout.trim(), 'live')
    assert.deepEqual(verificationExecutionGaps(root, recovered), [])
  } else {
    assert.ok(verificationExecutionGaps(root, recovered).length > 0)
  }
})

test('expected files are archived before launch and sanitized before persistence', () => {
  const output = 'runtime/verification-execution/sanitize/result.txt'
  const { root, state, invocation } = prepared([
    operation(
      'sanitize',
      `const fs=require('node:fs');const value=fs.readFileSync('.env','utf8').trim().split('=')[1];console.log(value);console.error(value);fs.writeFileSync('${output}',value)`,
      { required: false, evidence_paths: [output] },
    ),
    operation('stale-file', "console.log('did not produce a file')", {
      required: false,
      evidence_paths: ['runtime/verification-execution/stale-file/result.txt'],
    }),
    operation(
      'deny-source',
      "require('node:fs').writeFileSync('README.md','escaped')",
      { required: false },
    ),
  ])
  const synthetic = 'synthetic-execution-redaction-credential'
  writeFileSync(path.join(root, '.env'), `API_TOKEN=${synthetic}\n`)
  mkdirSync(path.join(root, 'runtime/verification-execution/stale-file'), {
    recursive: true,
  })
  const stale = path.join(
    root,
    'runtime/verification-execution/stale-file/result.txt',
  )
  writeFileSync(stale, 'stale file')
  const original = readFileSync(path.join(root, 'README.md'), 'utf8')
  const result = collectVerificationExecutionEvidence(root, state, invocation, [
    { id: 'sanitize', reason: 'redaction' },
    { id: 'stale-file', reason: 'fresh artifact' },
    { id: 'deny-source', reason: 'write boundary' },
  ])
  assert.equal(readFileSync(path.join(root, 'README.md'), 'utf8'), original)
  assert.equal(JSON.stringify(result.manifest).includes(synthetic), false)
  if (enforced(root)) {
    assert.equal(
      readFileSync(path.join(root, output), 'utf8').includes(synthetic),
      false,
    )
    assert.equal(result.manifest.records[0].status, 'collected')
    assert.equal(existsSync(`${stale}.execution-archive-1`), true)
    assert.equal(result.manifest.records[1].status, 'gap')
    assert.notEqual(result.manifest.records[2].exit_code, 0)
  }
})

test('raw observations and a scaffold exist before read-only delegation and cache without overwriting work', () => {
  const file = 'runtime/verification-execution/raw/result.txt'
  const fixture = prepared([
    operation(
      'raw',
      `require('node:fs').writeFileSync('${file}','observed');console.log('raw stdout');console.error('raw stderr')`,
      { evidence_paths: [file] },
    ),
  ])
  const { root, state, invocation } = fixture
  const contract = invocation.verification_execution!
  const initial = collectVerificationExecutionEvidence(root, state, invocation)
  assert.equal(
    initial.collected,
    0,
    'preparation already collected the operation',
  )
  assert.ok(existsSync(path.join(root, invocation.output.path)))
  assert.ok(
    invocation.inputs.references.some(
      (reference) =>
        reference.path === contract.manifest_path &&
        reference.retrieval === 'required',
    ),
  )
  const record = initial.manifest.records[0]
  assert.equal(record.invocation_id, invocation.invocation_id)
  assert.equal(record.attempt, invocation.attempt)
  assert.equal(record.source.authority, 'source_allowed')
  assert.equal(record.cwd, '.')
  assert.ok(record.definition_sha256)
  assert.ok(record.source_fingerprint)
  assert.equal(
    'verdict' in record,
    false,
    'stdout is not a product or browser verdict',
  )
  if (enforced(root)) {
    assert.equal(record.status, 'collected', JSON.stringify(record))
    assert.equal(record.exit_code, 0)
    assert.equal(record.stdout, 'raw stdout\n')
    assert.equal(record.stderr, 'raw stderr\n')
    assert.equal(record.observations[0].content, 'observed')
    assert.deepEqual(verificationExecutionGaps(root, invocation), [])
  } else {
    assert.equal(record.status, 'gap')
    assert.match(record.error ?? '', /enforcement unavailable/u)
    assert.ok(verificationExecutionGaps(root, invocation).length > 0)
  }
  const work = '{"worker":"completed independent grading"}\n'
  writeFileSync(path.join(root, invocation.output.path), work)
  prepareInvocation(root, fixture.runId)
  assert.equal(
    readFileSync(path.join(root, invocation.output.path), 'utf8'),
    work,
  )
})

test('fresh source recollects actual observations while preserving historical provenance', () => {
  const { root, state, invocation } = prepared([
    operation(
      'fresh',
      "console.log(require('node:fs').readFileSync('README.md','utf8'))",
    ),
  ])
  const prior = collectVerificationExecutionEvidence(root, state, invocation)
  writeFileSync(path.join(root, 'README.md'), '# Changed source\n')
  assert.ok(
    verificationExecutionGaps(root, invocation).some((gap) =>
      /different source|Missing current/u.test(gap),
    ),
  )
  const next = collectVerificationExecutionEvidence(root, state, invocation)
  assert.notEqual(
    next.manifest.source_fingerprint,
    prior.manifest.source_fingerprint,
  )
  assert.equal(next.manifest.history.length, 1)
  assert.deepEqual(next.manifest.history[0], prior.manifest.records[0])
  if (enforced(root)) {
    assert.equal(next.collected, 1)
    assert.equal(next.manifest.records[0].stdout, '# Changed source\n\n')
    assert.deepEqual(verificationExecutionGaps(root, invocation), [])
  }
})

test('requests cannot invent authority and optional selection runs only once', () => {
  const { root, state, invocation } = prepared([
    operation('optional', "console.log('selected')", { required: false }),
  ])
  assert.equal(
    collectVerificationExecutionEvidence(root, state, invocation).manifest
      .records.length,
    0,
  )
  const selected = collectVerificationExecutionEvidence(
    root,
    state,
    invocation,
    [{ id: 'optional', reason: 'pivotal claim' }],
  )
  assert.equal(selected.manifest.records.length, 1)
  assert.equal(
    collectVerificationExecutionEvidence(root, state, invocation, [
      { id: 'optional', reason: 'unchanged observation' },
    ]).updated,
    false,
  )
  assert.equal(
    collectVerificationExecutionEvidence(root, state, invocation, [
      { id: 'optional', reason: 'same request' },
    ]).collected,
    0,
  )
  const missing = collectVerificationExecutionEvidence(
    root,
    state,
    invocation,
    [{ id: 'invented', reason: 'missing reproduction' }],
  )
  assert.ok(missing.manifest.gaps.some((gap) => gap.id === 'invented'))
  assert.ok(
    collectVerificationExecutionEvidence(
      root,
      state,
      invocation,
    ).manifest.gaps.some((gap) => gap.id === 'invented'),
  )
  assert.ok(
    verificationExecutionGaps(root, invocation).some((gap) =>
      /invented/u.test(gap),
    ),
  )
  assert.equal(
    collectVerificationExecutionEvidence(root, state, invocation, [
      { id: 'invented', reason: 'same missing authority' },
    ]).updated,
    false,
  )
})

test('normal preparation consumes only the requesting role and preserves final verifier work across requests', () => {
  const fixture = prepared([
    operation('pivotal', "console.log('disputed observation')", {
      required: false,
    }),
  ])
  const { root, invocation, runId } = fixture
  const qa = invocation.evidence_workers?.find((worker) => worker.role === 'qa')
  const review = invocation.evidence_workers?.find(
    (worker) => worker.role === 'review',
  )
  assert.ok(qa && review)
  const report = path.join(root, qa.evidence_path)
  const sibling = path.join(root, review.evidence_path)
  writeFileSync(report, 'prior QA grading')
  writeFileSync(sibling, 'independent review')
  writeJsonAtomic(`${report}.execution-request.json`, [
    { id: 'pivotal', reason: 'conflicting claim' },
  ])
  prepareInvocation(root, runId)
  assert.equal(existsSync(report), false)
  assert.equal(
    readFileSync(`${report}.execution-archive-1`, 'utf8'),
    'prior QA grading',
  )
  assert.equal(readFileSync(sibling, 'utf8'), 'independent review')
  writeFileSync(report, 'fresh QA grading')
  writeJsonAtomic(`${report}.execution-request.json`, [
    { id: 'pivotal', reason: 'same claim' },
  ])
  prepareInvocation(root, runId)
  assert.equal(readFileSync(report, 'utf8'), 'fresh QA grading')
  assert.equal(existsSync(`${report}.execution-archive-2`), false)

  const finalFixture = prepared([
    operation('final-check', "console.log('spot check')", { required: false }),
  ])
  const output = path.join(
    finalFixture.root,
    finalFixture.invocation.output.path,
  )
  const original = readJson(output)
  assert.ok(isRecord(original))
  writeJsonAtomic(output, {
    ...original,
    summary: 'Preserved independent verifier work',
    data: {
      verification_execution_requests: [
        { id: 'final-check', reason: 'pivotal check' },
      ],
    },
  })
  prepareInvocation(finalFixture.root, finalFixture.runId)
  const archived = readJson(`${output}.execution-archive-1`)
  const scaffold = readJson(output)
  assert.ok(isRecord(archived) && isRecord(scaffold))
  assert.equal(archived.summary, 'Preserved independent verifier work')
  assert.notEqual(scaffold.summary, 'Preserved independent verifier work')
  writeJsonAtomic(output, {
    ...original,
    summary: 'Fresh verifier grading',
    data: {
      verification_execution_requests: [
        { id: 'final-check', reason: 'same check' },
      ],
    },
  })
  prepareInvocation(finalFixture.root, finalFixture.runId)
  const graded = readJson(output)
  assert.ok(isRecord(graded))
  assert.equal(graded.summary, 'Fresh verifier grading')
  assert.equal(existsSync(`${output}.execution-archive-2`), false)
})

test('source changes invalidate QA work through a source binding while preserving it in an archive', () => {
  const { root, invocation, runId } = prepared([
    operation('binding', "console.log('case')"),
  ])
  const qa = invocation.evidence_workers?.find((worker) => worker.role === 'qa')
  assert.ok(qa)
  const report = path.join(root, qa.evidence_path)
  writeFileSync(report, 'grading for previous source')
  writeFileSync(path.join(root, 'README.md'), '# New source\n')
  prepareInvocation(root, runId)
  assert.equal(existsSync(report), false)
  assert.equal(
    readFileSync(`${report}.execution-archive-1`, 'utf8'),
    'grading for previous source',
  )
})

test('dispatching one role leaves a sibling request for its own recovery boundary', () => {
  const { root, invocation, runId } = prepared([
    operation('sibling-request', "console.log('reproduction')", {
      required: false,
    }),
  ])
  const qa = invocation.evidence_workers?.find((worker) => worker.role === 'qa')
  assert.ok(qa)
  const report = path.join(root, qa.evidence_path)
  writeFileSync(report, 'QA is still recording its cases')
  writeJsonAtomic(`${report}.execution-request.json`, [
    { id: 'sibling-request', reason: 'own role recovery' },
  ])
  delegateEvidenceWorkers(root, runId, { roles: ['review'] })
  assert.equal(readFileSync(report, 'utf8'), 'QA is still recording its cases')
  assert.ok(existsSync(`${report}.execution-request.json`))
  assert.equal(existsSync(`${report}.execution-archive-1`), false)
  prepareInvocation(root, runId)
  assert.equal(existsSync(report), false)
  assert.equal(
    readFileSync(`${report}.execution-archive-1`, 'utf8'),
    'QA is still recording its cases',
  )
})

test('dispatch collects before shellless QA, independently grades stdout, and reruns only its requesting consumer', () => {
  const { root, invocation, runId } = prepared(
    [
      operation('mandatory', "console.log('product defect')"),
      operation(
        'browser-terminal',
        "console.log('UI appears healthy from terminal')",
        { criterion: 'AC-02' },
      ),
      operation('disputed', "console.log('reproduction')", { required: false }),
    ],
    {
      key: 'verification-execution-claude-qa',
      run: { requestPath: 'runtime/qa-browser-request.md' },
      fixture: (root) => {
        installClaudeCodeFixture(root, ['qa-tester'])
        writeFileSync(
          path.join(root, 'runtime/qa-browser-request.md'),
          '# Request\n\n## Acceptance criteria\n\n1. AC-01 [proof: live] Inspect terminal behavior.\n2. AC-02 [proof: live] Inspect the browser page in an isolated context.\n',
        )
      },
    },
  )
  const qa = invocation.evidence_workers?.find((worker) => worker.role === 'qa')
  const review = invocation.evidence_workers?.find(
    (worker) => worker.role === 'review',
  )
  assert.ok(qa && review)
  const report = path.join(root, qa.evidence_path)
  const sibling = path.join(root, review.evidence_path)
  const manifest = path.join(
    root,
    invocation.verification_execution!.manifest_path,
  )
  const output = path.join(root, invocation.output.path)
  writeFileSync(sibling, 'independent sibling report')
  const stub = path.join(root, 'runtime/verification-qa-stub.cjs')
  writeFileSync(
    stub,
    `#!/usr/bin/env node
const fs = require('node:fs')
if (process.argv.includes('--version')) { console.log('2.1.0'); process.exit(0) }
const args = process.argv.slice(2)
const index = args.indexOf('-p')
if (args[index + 1] && !args[index + 1].startsWith('--')) {
  console.log(JSON.stringify({type:'result',subtype:'success',result:'pong',is_error:false})); process.exit(0)
}
process.stdin.resume()
process.stdin.on('end', () => {
  if (!fs.existsSync(${JSON.stringify(output)})) throw new Error('missing pre-delegation scaffold')
  const manifest = JSON.parse(fs.readFileSync(${JSON.stringify(manifest)}, 'utf8'))
  const record = manifest.records.find(record => record.operation_id === 'mandatory')
  if (!record) throw new Error('missing pre-delegation observation')
  const browser = manifest.records.find(record => record.operation_id === 'browser-terminal')
  if (!browser) throw new Error('missing browser terminal observation')
  const report = ${JSON.stringify(report)}
  const count = fs.existsSync(report + '.launches') ? Number(fs.readFileSync(report + '.launches','utf8')) : 0
  fs.writeFileSync(report + '.launches', String(count + 1))
  const terminal = record.status === 'collected'
    ? 'Case fails: expected healthy output, observed ' + record.stdout
    : 'Environment blocked: ' + record.error
  fs.writeFileSync(report, JSON.stringify({
    terminal,
    browser: {
      id: 'TP-BROWSER',
      status: 'environment_blocked',
      missing_evidence: ['Genuine browser observation in an isolated context'],
      terminal_observation: browser.stdout,
      reason: 'Terminal output cannot establish a browser verdict; this fixture has no browser tool.'
    }
  }))
  if (!manifest.records.some(record => record.operation_id === 'disputed')) {
    fs.writeFileSync(report + '.execution-request.json', JSON.stringify([{id:'disputed', reason:'conflicting claim'}]))
  }
  console.log(JSON.stringify({type:'result',subtype:'success',result:'graded raw evidence',is_error:false,session_id:'qa-session'}))
})
`,
  )
  chmodSync(stub, 0o755)
  const priorOutput = readFileSync(output, 'utf8')
  writeFileSync(
    path.join(root, 'README.md'),
    'Changed before direct QA dispatch\n',
  )
  const result = withStub(stub, null, () =>
    delegateEvidenceWorkers(root, runId, { roles: ['qa'] }),
  )
  assert.equal(result.length, 1)
  assert.equal(result[0].ok, true, JSON.stringify(result))
  assert.equal(
    readFileSync(`${output}.execution-archive-1`, 'utf8'),
    priorOutput,
  )
  assert.equal(existsSync(output), true)
  assert.equal(readFileSync(`${report}.launches`, 'utf8'), '2')
  assert.equal(existsSync(`${report}.execution-archive-1`), true)
  assert.equal(readFileSync(sibling, 'utf8'), 'independent sibling report')
  assert.match(
    readFileSync(report, 'utf8'),
    enforced(root) ? /Case fails.*product defect/u : /Environment blocked/u,
  )
  const graded = readJson(report)
  assert.ok(isRecord(graded) && isRecord(graded.browser))
  assert.equal(graded.browser.status, 'environment_blocked')
  assert.deepEqual(graded.browser.missing_evidence, [
    'Genuine browser observation in an isolated context',
  ])
  assert.equal('verdict' in graded.browser, false)
  assert.equal('result' in graded.browser, false)
  if (enforced(root)) {
    assert.equal(
      graded.browser.terminal_observation,
      'UI appears healthy from terminal\n',
    )
  }
  const log = readFileSync(path.join(root, result[0].stdout_path!), 'utf8')
  assert.ok(log.includes('graded raw evidence'))
})

test('final verifier dispatch collects a requested reproduction and preserves its prior grading', () => {
  const { root, invocation, runId } = prepared(
    [
      operation('final-mandatory', "console.log('product defect')"),
      operation('final-optional', "console.log('reproduction')", {
        required: false,
      }),
    ],
    {
      key: 'verification-execution-claude-verifier',
      fixture: (root) => installClaudeCodeFixture(root, ['verifier']),
    },
  )
  const output = path.join(root, invocation.output.path)
  const manifest = path.join(
    root,
    invocation.verification_execution!.manifest_path,
  )
  const stub = path.join(root, 'runtime/verification-final-stub.cjs')
  writeFileSync(
    stub,
    `#!/usr/bin/env node
const fs = require('node:fs')
if (process.argv.includes('--version')) { console.log('2.1.0'); process.exit(0) }
const args = process.argv.slice(2)
const index = args.indexOf('-p')
if (args[index + 1] && !args[index + 1].startsWith('--')) {
  console.log(JSON.stringify({type:'result',subtype:'success',result:'pong',is_error:false})); process.exit(0)
}
process.stdin.resume()
process.stdin.on('end', () => {
  const output = ${JSON.stringify(output)}
  if (!fs.existsSync(output)) throw new Error('missing verifier scaffold')
  const current = JSON.parse(fs.readFileSync(${JSON.stringify(manifest)}, 'utf8'))
  if (!current.records.some(record => record.operation_id === 'final-mandatory')) {
    throw new Error('missing pre-delegation observation')
  }
  const count = fs.existsSync(output + '.launches') ? Number(fs.readFileSync(output + '.launches','utf8')) : 0
  fs.writeFileSync(output + '.launches', String(count + 1))
  const result = JSON.parse(fs.readFileSync(output, 'utf8'))
  result.summary = count ? 'Independent final grading' : 'Preserve pivotal reasoning'
  result.data.verification_execution_requests = [{id:'final-optional',reason:'disputed observation'}]
  result.data.verify = {verdict:'fail_remedial'}
  fs.writeFileSync(output, JSON.stringify(result))
  console.log(JSON.stringify({type:'result',subtype:'success',result:'independent verifier grading',is_error:false,session_id:'verify-session'}))
})
`,
  )
  chmodSync(stub, 0o755)
  writeFileSync(
    path.join(root, 'README.md'),
    'Changed before direct verifier dispatch\n',
  )
  const priorOutput = readFileSync(output, 'utf8')
  const result = withStub(stub, null, () => delegateInvocation(root, runId))
  assert.equal(result.execution?.exit_code, 0)
  assert.equal(readFileSync(`${output}.launches`, 'utf8'), '2')
  assert.equal(
    readFileSync(`${output}.execution-archive-1`, 'utf8'),
    priorOutput,
  )
  const previous = readJson(`${output}.execution-archive-2`)
  const final = readJson(output)
  assert.ok(isRecord(previous) && isRecord(final) && isRecord(final.data))
  assert.equal(previous.summary, 'Preserve pivotal reasoning')
  assert.equal(final.summary, 'Independent final grading')
  assert.deepEqual(final.data.verify, { verdict: 'fail_remedial' })
  assert.equal(existsSync(`${output}.execution-archive-3`), false)
})

test('read-only scaffold ownership is reflected in the generated worker and supervisor contracts', () => {
  const { root, invocation } = prepared([])
  const requirement = invocation.requirements?.automation_requirements.find(
    (entry) => entry.registry_id === 'STAGE-SCAFFOLD-001',
  )
  assert.equal(requirement?.executor, 'harness')
  assert.equal(invocation.output.scaffold_command, undefined)
  assert.equal(existsSync(path.join(root, invocation.output.path)), true)
  const worker = renderInvocationMarkdown(invocation)
  assert.doesNotMatch(
    worker,
    /pan output scaffold|Prefill the output with the required scaffold automation/u,
  )
  assert.match(worker, /harness.*scaffold/iu)
  const supervisor = renderSupervisorProcedureMarkdown(invocation)
  assert.match(supervisor, /harness.*scaffold/iu)
  assert.doesNotMatch(supervisor, /requires the worker to.*scaffold/su)
  assert.ok(invocation.delegation)
  const preparedWorker = readFileSync(
    path.join(root, invocation.delegation.canonical_markdown_path),
    'utf8',
  )
  assert.equal(preparedWorker, worker)
  const authored = readJson(path.join(root, invocation.output.path))
  assert.ok(isRecord(authored))
  authored.summary = 'Preserve authored scaffold'
  writeJsonAtomic(path.join(root, invocation.output.path), authored)
  prepareInvocation(root, invocation.run_id)
  assert.deepEqual(readJson(path.join(root, invocation.output.path)), authored)

  const source = checkpoint('delivery@implement-prepared')
  const sourceInvocation = prepareInvocation(
    source.root,
    source.runId,
  ).invocation
  assert.ok(sourceInvocation?.output.scaffold_command)
  assert.equal(
    sourceInvocation.requirements?.automation_requirements.find(
      (entry) => entry.registry_id === 'STAGE-SCAFFOLD-001',
    )?.executor,
    'agent',
  )
  assert.match(
    renderInvocationMarkdown(sourceInvocation),
    /Prefill the output/u,
  )

  for (const workspacePolicy of ['source_allowed', 'read_only'] as const) {
    const requirements = resolveRequirements(root, {
      persona: 'coder',
      workflow: 'delivery',
      stage: 'implement',
      workspace_policy: workspacePolicy,
      invocation: { output_path: 'runtime/scaffold-control.json' },
    })
    assert.equal(
      requirements.automation_requirements.find(
        (entry) => entry.registry_id === 'STAGE-SCAFFOLD-001',
      )?.executor,
      workspacePolicy === 'source_allowed' ? 'agent' : 'harness',
    )
  }
})

test('initial verifier dispatch consumes a preselected request and retains the updated manifest', () => {
  const { root, invocation, runId } = prepared(
    [
      operation('preselected', "console.log('requested before launch')", {
        required: false,
      }),
    ],
    {
      key: 'verification-execution-preselected-verifier',
      fixture: (root) => installClaudeCodeFixture(root, ['verifier']),
    },
  )
  const output = path.join(root, invocation.output.path)
  const prior = readJson(output)
  assert.ok(isRecord(prior) && isRecord(prior.data))
  prior.summary = 'Preserve request reasoning'
  prior.data.verification_execution_requests = [
    { id: 'preselected', reason: 'pivotal observation' },
  ]
  writeJsonAtomic(output, prior)
  writeFileSync(
    path.join(root, 'README.md'),
    'Changed with a pending request\n',
  )
  const stub = path.join(root, 'runtime/preselected-verifier.cjs')
  writeFileSync(
    stub,
    `#!/usr/bin/env node
const fs = require('node:fs')
if (process.argv.includes('--version')) { console.log('2.1.0'); process.exit(0) }
const args = process.argv.slice(2)
const index = args.indexOf('-p')
if (args[index + 1] && !args[index + 1].startsWith('--')) {
  console.log(JSON.stringify({type:'result',subtype:'success',result:'pong',is_error:false})); process.exit(0)
}
process.stdin.resume()
process.stdin.on('end', () => {
  const output = ${JSON.stringify(output)}
  if (!fs.existsSync(output)) throw new Error('missing preselected scaffold')
  const manifest = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(root, invocation.verification_execution!.manifest_path))}, 'utf8'))
  if (!manifest.records.some(record => record.operation_id === 'preselected')) throw new Error('missing selected observation')
  const result = JSON.parse(fs.readFileSync(output, 'utf8'))
  result.summary = 'Graded selected observation'
  fs.writeFileSync(output, JSON.stringify(result))
  console.log(JSON.stringify({type:'result',subtype:'success',result:'graded',is_error:false}))
})
`,
  )
  chmodSync(stub, 0o755)
  const result = withStub(stub, null, () => delegateInvocation(root, runId))
  assert.equal(result.execution?.exit_code, 0)
  assert.deepEqual(readJson(`${output}.execution-archive-1`), prior)
  const final = readJson(output)
  assert.ok(isRecord(final))
  assert.equal(final.summary, 'Graded selected observation')
})
