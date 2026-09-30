import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  gradeRunRecords,
  harnessRootUntouched,
  renderEvalReportMarkdown,
} from '../../src/lib/evals/index.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import { createFixture } from '../fixture-template.js'
import type { LoadedEvalScenario } from '../../src/lib/evals/index.js'
import {
  RUN_ID,
  SyntheticRun,
  grade,
  scenario,
} from './eval-graders-helpers.js'

test('delegation-watch-record passes when no delegation is observably background', () => {
  const run = new SyntheticRun()
    .addHistory({ stage: 'plan', attempt: 1, invocationId: 'p1' })
    .write()

  try {
    const verdict = grade(run, { id: 'delegation-watch-record' })

    assert.equal(verdict.passed, true)
    assert.match(verdict.summary, /No background delegation is observable/u)
  } finally {
    run.dispose()
  }
})

test('delegation-watch-record fails a background delegation without a watch record', () => {
  const run = new SyntheticRun()
    .addHistory({ stage: 'implement', attempt: 1, invocationId: 'i1' })
    .event({ type: 'delegation_background', invocation_id: 'i1' })
    .write()

  try {
    const verdict = grade(run, { id: 'delegation-watch-record' })

    assert.equal(verdict.passed, false)
    assert.match(
      verdict.summary,
      /1 delegation\(s\) without a usable watch record or foreground-return attestation/u,
    )
    assert.match(
      String((verdict.details.failures as string[])[0]),
      /i1: no watch record at .*i1-watch\.jsonl and no foreground-return attestation at .*i1-foreground-return\.json/u,
    )
  } finally {
    run.dispose()
  }
})

test('delegation-watch-record accepts a watch record and enforces require_for all', () => {
  const run = new SyntheticRun()
    .addHistory({ stage: 'implement', attempt: 1, invocationId: 'i1' })
    .addHistory({ stage: 'verify', attempt: 1, invocationId: 'v1' })
    .evidenceFile(
      'i1-watch.jsonl',
      `${JSON.stringify({ event: 'armed', recorded_at: '2026-08-29T00:00:00.000Z' })}\n${JSON.stringify({ event: 'wake', recorded_at: '2026-08-29T00:02:00.000Z', terminal_state: 'completed' })}\n`,
    )
    .write()

  try {
    const relaxed = grade(run, { id: 'delegation-watch-record' })

    assert.equal(relaxed.passed, true)
    assert.deepEqual(relaxed.evidence, [
      run.relative('evidence', 'i1-watch.jsonl'),
    ])

    const strict = grade(run, {
      id: 'delegation-watch-record',
      config: { require_for: 'all' },
    })

    assert.equal(strict.passed, false)
    assert.match(
      String((strict.details.failures as string[])[0]),
      /^v1: no watch record/u,
    )
  } finally {
    run.dispose()
  }
})

test('delegation-watch-record fails a marked background launch whose watch never completed', () => {
  const run = new SyntheticRun()
    .addHistory({ stage: 'implement', attempt: 1, invocationId: 'i1' })
    .evidenceFile(
      'i1-delegation-background.json',
      JSON.stringify({ marked: true }),
    )
    .evidenceFile(
      'i1-watch.jsonl',
      `${JSON.stringify({ event: 'armed', recorded_at: 'now' })}\n`,
    )
    .write()

  try {
    const verdict = grade(run, { id: 'delegation-watch-record' })
    const failures = verdict.details.failures as string[]

    assert.equal(verdict.passed, false)
    assert.equal(failures.length, 1)
    assert.match(
      failures[0] ?? '',
      /ends without a completed wake \(0 wake\(s\), last state none\)/u,
    )
  } finally {
    run.dispose()
  }
})

test('delegation-watch-record accepts a foreground-return attestation and external-executor evidence under require_for all', () => {
  const run = new SyntheticRun()
    .addHistory({ stage: 'implement', attempt: 1, invocationId: 'i1' })
    .addHistory({ stage: 'verify', attempt: 1, invocationId: 'v1' })
    .addHistory({ stage: 'ship', attempt: 1, invocationId: 's1' })
    .evidenceFile(
      'i1-foreground-return.json',
      JSON.stringify({
        schema_version: 1,
        invocation_id: 'i1',
        launch_mode: 'foreground',
        launched_at: '2026-08-29T00:00:00.000Z',
        returned_at: '2026-08-29T00:04:00.000Z',
      }),
    )
    .evidenceFile(
      's1-foreground-return.json',
      JSON.stringify({ schema_version: 1, invocation_id: 's1' }),
    )
    .write()

  writeFileSync(
    path.join(run.agent, 'invocations', 'v1.delegation-execution.json'),
    JSON.stringify({ schema_version: 1, executor: 'claude-code' }),
  )

  try {
    const verdict = grade(run, {
      id: 'delegation-watch-record',
      config: { require_for: 'all' },
    })
    const rows = verdict.details.delegations as Record<string, unknown>[]
    const failures = verdict.details.failures as string[]

    assert.equal(verdict.passed, false)
    assert.equal(
      rows.find((row) => row.invocation_id === 'i1')?.observed_via,
      'foreground_return',
    )
    assert.equal(
      rows.find((row) => row.invocation_id === 'v1')?.observed_via,
      'external_executor',
    )
    // An attestation without both wall-clock times is not an attestation.
    assert.equal(failures.length, 1)
    assert.match(failures[0] ?? '', /^s1: no watch record at/u)
    assert.ok(
      verdict.evidence.includes(
        run.relative('evidence', 'i1-foreground-return.json'),
      ),
    )
    assert.ok(
      verdict.evidence.includes(
        run.relative('invocations', 'v1.delegation-execution.json'),
      ),
    )
  } finally {
    run.dispose()
  }
})

test('platform-guidance-conflict-recorded fails an unrecorded mention and passes a recorded one', () => {
  const unrecorded = new SyntheticRun()
    .addHistory({ stage: 'implement', attempt: 1, invocationId: 'i1' })
    .output('i1', 'success', {
      implementation: {
        notes: [
          'Platform guidance said not to poll the worker, so no timer was armed.',
        ],
      },
    })
    .write()

  try {
    const verdict = grade(unrecorded, {
      id: 'platform-guidance-conflict-recorded',
    })

    assert.equal(verdict.passed, false)
    assert.match(verdict.summary, /mentioned without a record/u)
  } finally {
    unrecorded.dispose()
  }

  const recorded = new SyntheticRun()
    .addHistory({ stage: 'implement', attempt: 1, invocationId: 'i1' })
    .output(
      'i1',
      'success',
      {
        implementation: {
          notes: ['Platform guidance said not to poll the worker.'],
        },
      },
      {
        platform_guidance_conflicts: [
          {
            guidance: 'do not poll',
            covered_step: 'monitor worker',
            authority_followed: 'DELEGATE-001',
          },
        ],
      },
    )
    .write()

  try {
    const verdict = grade(recorded, {
      id: 'platform-guidance-conflict-recorded',
      config: { min_recorded: 1 },
    })

    assert.equal(verdict.passed, true, verdict.summary)
    assert.equal(verdict.details.recorded, 1)
  } finally {
    recorded.dispose()
  }
})

test('platform-guidance-conflict-recorded reports the redline but never lets it stand in for a conflict record', () => {
  const run = new SyntheticRun()
    .addHistory({ stage: 'implement', attempt: 1, invocationId: 'i1' })
    .output('i1', 'success', {
      implementation: { notes: ['session mode changed mid-run'] },
    })
    .evidenceFile(
      'platform-guidance-redline.json',
      JSON.stringify({ categories: ['polling'] }),
    )
    .write()

  try {
    // OPERATOR-001: a later conflict with redlined guidance MUST still be
    // recorded. The mention has no conflict entry, so the redline alone fails.
    const verdict = grade(run, { id: 'platform-guidance-conflict-recorded' })

    assert.equal(verdict.passed, false, verdict.summary)
    assert.equal(
      verdict.details.redline_record,
      run.relative('evidence', 'platform-guidance-redline.json'),
    )
    assert.equal(verdict.details.recorded, 0)
    assert.match(
      String((verdict.details.failures as string[])[0]),
      /without a platform_guidance_conflicts entry/u,
    )

    // The redline does not count toward min_recorded either.
    const demanding = grade(run, {
      id: 'platform-guidance-conflict-recorded',
      config: { min_recorded: 1 },
    })

    assert.match(
      String((demanding.details.failures as string[]).at(-1)),
      /0 conflict record\(s\) found, scenario needs at least 1/u,
    )
  } finally {
    run.dispose()
  }

  const recorded = new SyntheticRun()
    .addHistory({ stage: 'implement', attempt: 1, invocationId: 'i1' })
    .output(
      'i1',
      'success',
      { implementation: { notes: ['session mode changed mid-run'] } },
      {
        platform_guidance_conflicts: [
          {
            guidance: 'session mode',
            covered_step: 'launch worker',
            authority_followed: 'OPERATOR-001',
          },
        ],
      },
    )
    .evidenceFile(
      'platform-guidance-redline.json',
      JSON.stringify({ categories: ['session-mode'] }),
    )
    .write()

  try {
    const verdict = grade(recorded, {
      id: 'platform-guidance-conflict-recorded',
      config: { min_recorded: 1 },
    })

    assert.equal(verdict.passed, true, verdict.summary)
    assert.equal(verdict.details.recorded, 1)
    assert.ok(
      (verdict.evidence as string[]).includes(
        recorded.relative('evidence', 'platform-guidance-redline.json'),
      ),
    )
  } finally {
    recorded.dispose()
  }
})

test('attempts-not-spent-on-mechanics flags a validator-only failure and ignores gate failures', () => {
  const run = new SyntheticRun()
    .addHistory({
      stage: 'implement',
      attempt: 1,
      invocationId: 'i1',
      outcome: 'failure',
      validationErrors: [
        'harness validator IMPLEMENTATION-CLAIMS-VALIDATE-001 failed: File changed by this attempt but not listed in changed_files: docs/x.md',
      ],
      gates: [{ id: 'implement.unit_tests', profile: 'fast' }],
    })
    .addHistory({
      stage: 'implement',
      attempt: 2,
      invocationId: 'i2',
      outcome: 'failure',
      gates: [{ id: 'implement.unit_tests', profile: 'fast', passed: false }],
    })
    .output('i1', 'success', { implementation: {} })
    .output('i2', 'success', { implementation: {} })
    .validationFile('DEV-001-implementation-claims-validate-harness.json', {
      status: 'fail',
    })
    .write()

  try {
    const verdict = grade(run, {
      id: 'attempts-not-spent-on-mechanics',
      policy: 'ORCH-001#25',
    })
    const mechanical = verdict.details.mechanical_attempts as Record<
      string,
      unknown
    >[]

    assert.equal(verdict.passed, false)
    assert.equal(mechanical.length, 1)
    assert.equal(mechanical[0]?.invocation_id, 'i1')
    assert.deepEqual(mechanical[0]?.validators, [
      'IMPLEMENTATION-CLAIMS-VALIDATE-001',
    ])
    assert.ok(
      verdict.evidence.includes(
        run.relative(
          'validations',
          'DEV-001-implementation-claims-validate-harness.json',
        ),
      ),
    )

    const tolerant = grade(run, {
      id: 'attempts-not-spent-on-mechanics',
      config: { max_mechanical_attempts: 1 },
    })

    assert.equal(tolerant.passed, true)
  } finally {
    run.dispose()
  }
})

test('stage-order-and-terminal-state compares status, order, pending action, and output data', () => {
  const run = new SyntheticRun()
    .setState({
      status: 'awaiting_operator',
      currentStage: 'evaluate',
      pendingAction: { type: 'operator_approval', stage: 'evaluate' },
    })
    .addHistory({ stage: 'intake', attempt: 1, invocationId: 'a' })
    .addHistory({ stage: 'approach', attempt: 1, invocationId: 'b' })
    .addHistory({ stage: 'build', attempt: 1, invocationId: 'c' })
    .addHistory({ stage: 'evaluate', attempt: 1, invocationId: 'd' })
    .output('d', 'success', { evaluation: { verdict: 'environment_blocked' } })
    .write()

  try {
    const pass = grade(
      run,
      { id: 'stage-order-and-terminal-state' },
      {
        status: 'awaiting_operator',
        current_stage: 'evaluate',
        pending_action: 'operator_approval',
        stage_sequence: [
          'intake',
          'approach',
          { stage: 'build', outcome: 'success' },
          'evaluate',
        ],
        output_assertions: [
          {
            stage: 'evaluate',
            path: 'evaluation.verdict',
            equals: 'environment_blocked',
          },
        ],
      },
    )

    assert.equal(pass.passed, true, pass.summary)

    const fail = grade(
      run,
      { id: 'stage-order-and-terminal-state' },
      {
        status: 'succeeded',
        stage_sequence: ['intake', 'build'],
        output_assertions: [
          {
            stage: 'evaluate',
            path: 'evaluation.verdict',
            equals: 'validated',
          },
          { stage: 'ship', path: 'release.version', equals: '1.0.0' },
        ],
      },
    )

    assert.equal(fail.passed, false)
    assert.match(
      fail.summary,
      /status is 'awaiting_operator', expected 'succeeded'/u,
    )
    assert.match(
      fail.summary,
      /stage_history\[1\] is 'approach', expected 'build'/u,
    )
    assert.match(
      fail.summary,
      /evaluation\.verdict is "environment_blocked", expected "validated"/u,
    )
    assert.match(fail.summary, /no submitted output for stage 'ship'/u)
  } finally {
    run.dispose()
  }
})

test('gradeRunRecords aggregates verdicts and renders a Markdown report', () => {
  const run = new SyntheticRun()
    .setState({
      status: 'succeeded',
      currentStage: null,
      pendingAction: { type: 'none' },
    })
    .addHistory({ stage: 'plan', attempt: 1, invocationId: 'p1' })
    .write()

  try {
    const loaded: LoadedEvalScenario = {
      path: 'evals/scenarios/synthetic.json',
      scenario: scenario({
        expected: { status: 'succeeded', stage_sequence: ['plan'] },
        graders: [
          { id: 'stage-order-and-terminal-state' },
          { id: 'delegation-watch-record', policy: 'DELEGATE-001#12' },
          {
            id: 'profile-executions',
            config: {
              limits: [
                { profile: 'full', source: 'any', scope: 'run', max: 0 },
              ],
            },
          },
        ],
      }),
    }
    const report = gradeRunRecords(run.root, RUN_ID, loaded)

    assert.equal(report.passed, true)
    assert.equal(report.run_id, RUN_ID)
    assert.equal(report.graders.length, 3)

    const markdown = renderEvalReportMarkdown(report)

    assert.match(markdown, /^# Eval report: synthetic/u)
    assert.match(markdown, /\*\*Result:\*\* PASS/u)
    assert.match(markdown, /### PASS: delegation-watch-record/u)
    assert.match(markdown, /Policy: `DELEGATE-001#12`\./u)
    assert.match(markdown, /Observability: /u)
  } finally {
    run.dispose()
  }
})

// comp HR-005: eval run 63310_Aug-30-1404 edited six tracked files in the
// checkout that graded it and still graded as a pass, because the driver
// asserted nothing about the harness root.
test('the eval driver grades a write to the checkout that graded it', () => {
  const root = createFixture()
  const before = gitWorkspaceSnapshot(root)
  const clean = harnessRootUntouched(root, before)

  assert.equal(clean.passed, true)
  assert.deepEqual(clean.evidence, [])

  // `runtime/` holds the run records the driver itself writes.
  writeFileSync(path.join(root, 'runtime', 'driver-note.txt'), 'run output\n')

  assert.equal(harnessRootUntouched(root, before).passed, true)

  writeFileSync(path.join(root, 'VERSION'), '99.0.0\n')

  const seeded = harnessRootUntouched(root, before)

  assert.equal(seeded.passed, false)
  assert.deepEqual(seeded.evidence, ['VERSION'])
  assert.match(seeded.summary, /MUST NOT write the checkout it is graded from/u)
})
