import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collectProfileExecutions,
  loadRunRecords,
} from '../../src/lib/evals/index.js'
import { RUN_ID, SyntheticRun, grade } from './eval-graders-helpers.js'

test('profile-executions counts one agent execution per ledger entry', () => {
  // The ledger is the record of what an agent executed, so two runs of one
  // profile count as two even when no output names a command at all.
  const run = new SyntheticRun()
    .addHistory({ stage: 'implement', attempt: 1, invocationId: 'i1' })
    .output('i1', 'success', {
      implementation: { notes: ['The change is complete.'] },
    })
    .ledger([
      { profile: 'fast', invocationId: 'i1', evidenceLog: 'log-1' },
      { profile: 'fast', invocationId: 'i1' },
    ])
    .write()

  try {
    const { executions } = collectProfileExecutions(
      loadRunRecords(run.root, RUN_ID),
    )

    assert.deepEqual(
      executions.map(
        (execution) =>
          `${execution.stage}/${execution.attempt}/${execution.profile}/${execution.source}/${execution.basis}/${execution.evidence}`,
      ),
      [
        'implement/1/fast/agent/agent_ledger/log-1',
        `implement/1/fast/agent/agent_ledger/${run.relative('evidence', 'repository-check-runs.jsonl')}`,
      ],
    )

    const verdict = grade(run, { id: 'profile-executions' })

    assert.equal(verdict.passed, false)
    assert.match(
      String((verdict.details.violations as string[])[0]),
      /fast\/agent\/attempt:implement#1: 2 execution\(s\), max 1/u,
    )
    assert.deepEqual(verdict.details.counts_by_basis, { agent_ledger: 2 })
  } finally {
    run.dispose()
  }
})

test('profile-executions grades one ledger the same however the worker worded its summary', () => {
  // The defect this replaces graded a release steward's citation of the full
  // profile as an execution of it, so two runs of identical harness behavior
  // reached opposite verdicts on wording alone.
  const wordings = [
    'Final validation passed.',
    'Final validation passed. The harness ran the full profile ' +
      '(`pan repository-check full`) as the ship release gate, and ' +
      '`npm run check` and `npm run test:coverage` are its commands.',
  ]

  const verdicts = wordings.map((notes) => {
    const run = new SyntheticRun()
      .addHistory({ stage: 'implement', attempt: 1, invocationId: 'i1' })
      .output('i1', 'success', { implementation: { notes: [notes] } })
      .ledger([{ profile: 'fast', invocationId: 'i1' }])
      .write()

    try {
      const { executions } = collectProfileExecutions(
        loadRunRecords(run.root, RUN_ID),
      )

      assert.deepEqual(
        executions.filter((execution) => execution.profile === 'full'),
        [],
        'a cited command is not an execution of it',
      )

      return grade(run, { id: 'profile-executions' })
    } finally {
      run.dispose()
    }
  })

  assert.equal(verdicts[0].passed, true, verdicts[0].summary)
  assert.equal(verdicts[1].passed, true, verdicts[1].summary)
  assert.deepEqual(verdicts[0].details.counts_by_basis, { agent_ledger: 1 })
  assert.deepEqual(verdicts[1].details.counts_by_basis, { agent_ledger: 1 })

  // The graded outcome still decides: a second recorded fast run fails.
  const repeated = new SyntheticRun()
    .addHistory({ stage: 'implement', attempt: 1, invocationId: 'i1' })
    .output('i1', 'success', { implementation: { notes: [wordings[0]] } })
    .ledger([
      { profile: 'fast', invocationId: 'i1' },
      { profile: 'fast', invocationId: 'i1' },
    ])
    .write()

  try {
    assert.equal(grade(repeated, { id: 'profile-executions' }).passed, false)
  } finally {
    repeated.dispose()
  }
})

test('profile-executions ignores a harness-initiated ledger entry', () => {
  // The release-profile prefetch is harness work recorded in the same file.
  // Counting it as agent-side would fail every run that reached ship.
  const run = new SyntheticRun()
    .addHistory({ stage: 'implement', attempt: 1, invocationId: 'i1' })
    .output('i1', 'success', { implementation: { notes: ['done'] } })
    .ledger([
      { profile: 'full', invocationId: 'i1', invokedBy: 'harness' },
      { profile: 'fast', invocationId: 'i1', invokedBy: 'agent' },
    ])
    .write()

  try {
    const { executions } = collectProfileExecutions(
      loadRunRecords(run.root, RUN_ID),
    )

    assert.deepEqual(
      executions.map((execution) => execution.profile),
      ['fast'],
    )
    assert.equal(grade(run, { id: 'profile-executions' }).passed, true)
  } finally {
    run.dispose()
  }
})

test('profile-executions counts baselines, live gates, and agent mentions when the run holds no ledger', () => {
  const run = new SyntheticRun()
    .baseline('static')
    .baseline('fast')
    .addHistory({
      stage: 'implement',
      attempt: 1,
      invocationId: 'i1',
      gates: [
        { id: 'implement.lint', profile: 'static' },
        { id: 'implement.unit_tests', profile: 'fast' },
      ],
    })
    .addHistory({
      stage: 'implement',
      attempt: 2,
      invocationId: 'i2',
      gates: [
        { id: 'implement.lint', profile: 'static', cached: true },
        { id: 'implement.unit_tests', profile: 'fast', cached: true },
      ],
    })
    .output('i1', 'success', {
      implementation: {
        notes: ['command:npm test exited 0.', 'ran npm run lint'],
      },
    })
    .output('i2', 'success', {
      implementation: { notes: ['npm test passed twice: npm test again'] },
    })
    .write()

  try {
    const { executions } = collectProfileExecutions(
      loadRunRecords(run.root, RUN_ID),
    )
    const key = (execution: (typeof executions)[number]) =>
      `${execution.stage}/${execution.attempt ?? 'b'}/${execution.profile}/${execution.source}`

    assert.deepEqual(executions.map(key).sort(), [
      'implement/1/fast/agent',
      'implement/1/fast/harness',
      'implement/1/static/agent',
      'implement/1/static/harness',
      'implement/2/fast/agent',
      'implement/b/fast/baseline',
      'implement/b/static/baseline',
    ])

    assert.deepEqual(
      [
        ...new Set(
          executions
            .filter((execution) => execution.source === 'agent')
            .map((execution) => execution.basis),
        ),
      ],
      ['output_text'],
      'a run with no ledger falls back to the declared output-text scan',
    )

    // A string that names the command twice is one mention: the grader counts
    // strings, not substrings, so prose cannot inflate the count.
    const verdict = grade(run, { id: 'profile-executions' })

    assert.equal(verdict.passed, true, verdict.summary)
  } finally {
    run.dispose()
  }
})

test('profile-executions fails a configured limit and reports the evidence', () => {
  // One output counts once per profile however often it names the run, so
  // the violation needs two attempts that each ran the fast profile.
  const run = new SyntheticRun()
    .addHistory({ stage: 'implement', attempt: 1, invocationId: 'i1' })
    .addHistory({ stage: 'implement', attempt: 2, invocationId: 'i2' })
    .output('i1', 'failure', {
      implementation: {
        notes: ['npm test exited 0.', 'Re-ran npm test after the fix.'],
      },
    })
    .output('i2', 'success', {
      implementation: { notes: ['npm test exited 0.'] },
    })
    .write()

  try {
    const verdict = grade(run, {
      id: 'profile-executions',
      policy: 'DEV-001#7',
      config: {
        limits: [{ profile: 'fast', source: 'agent', scope: 'stage', max: 1 }],
      },
    })

    assert.equal(verdict.passed, false)
    assert.equal(verdict.policy, 'DEV-001#7')
    assert.match(
      String((verdict.details.violations as string[])[0]),
      /fast\/agent\/stage:implement: 2 execution\(s\), max 1/u,
    )
    assert.deepEqual(verdict.evidence, [
      run.relative('outputs', 'i1.json'),
      run.relative('outputs', 'i2.json'),
    ])
  } finally {
    run.dispose()
  }
})

test('profile-executions default limits demand the full release gate once on a succeeded run that shipped', () => {
  const run = new SyntheticRun()
    .setState({ status: 'succeeded', currentStage: null })
    .addHistory({ stage: 'verify', attempt: 1, invocationId: 'v1' })
    .addHistory({ stage: 'ship', attempt: 1, invocationId: 's1' })
    .write()

  try {
    const verdict = grade(run, { id: 'profile-executions' })

    assert.equal(verdict.passed, false)
    assert.match(verdict.summary, /1 profile limit violation/u)
    assert.match(
      String((verdict.details.violations as string[])[0]),
      /full\/harness\/run: 0 execution\(s\), min 1/u,
    )
  } finally {
    run.dispose()
  }
})

test('profile-executions default limits owe no full execution to a succeeded run without a ship stage', () => {
  // A chunk run ends at verify; the release run owns the full profile.
  const run = new SyntheticRun()
    .setState({ status: 'succeeded', currentStage: null })
    .addHistory({ stage: 'verify', attempt: 1, invocationId: 'v1' })
    .write()

  try {
    const verdict = grade(run, { id: 'profile-executions' })

    assert.equal(verdict.passed, true, verdict.summary)
  } finally {
    run.dispose()
  }
})

test('profile-executions counts the ship entry gate once when its result is carried into the ship submission', () => {
  const evidence =
    'runtime/logs/workflows/run/agent/evidence/ship-entry-1-ship.full_suite.log'
  const run = new SyntheticRun()
    .setState({ status: 'succeeded', currentStage: null })
    .addHistory({ stage: 'verify', attempt: 1, invocationId: 'v1' })
    .entryGate({
      stage: 'ship',
      id: 'ship.full_suite',
      profile: 'full',
      evidence,
    })
    .addHistory({
      stage: 'ship',
      attempt: 1,
      invocationId: 's1',
      gates: [{ id: 'ship.full_suite', profile: 'full', evidence }],
    })
    .write()

  try {
    const { executions } = collectProfileExecutions(
      loadRunRecords(run.root, RUN_ID),
    )
    const full = executions.filter((execution) => execution.profile === 'full')

    assert.equal(full.length, 1)
    assert.equal(full[0].source, 'harness')
    assert.equal(full[0].stage, 'ship')
    assert.equal(full[0].evidence, evidence)

    const verdict = grade(run, { id: 'profile-executions' })

    assert.equal(verdict.passed, true, verdict.summary)
  } finally {
    run.dispose()
  }
})

test('profile-executions counts a failed ship entry gate that never reached a submission', () => {
  const run = new SyntheticRun()
    .setState({ status: 'running', currentStage: 'remediate' })
    .addHistory({ stage: 'verify', attempt: 1, invocationId: 'v1' })
    .entryGate({
      stage: 'ship',
      id: 'ship.full_suite',
      profile: 'full',
      passed: false,
    })
    .write()

  try {
    const { executions } = collectProfileExecutions(
      loadRunRecords(run.root, RUN_ID),
    )
    const full = executions.filter((execution) => execution.profile === 'full')

    assert.equal(full.length, 1)
    assert.equal(full[0].stage, 'ship')
    assert.equal(full[0].attempt, null)
  } finally {
    run.dispose()
  }
})
