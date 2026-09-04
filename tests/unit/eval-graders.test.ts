import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  collectProfileExecutions,
  gradeRunRecords,
  loadRunRecords,
  renderEvalReportMarkdown,
  runGrader,
} from '../../src/lib/evals/index.js'
import type {
  EvalGraderSpec,
  EvalScenario,
  LoadedEvalScenario,
} from '../../src/lib/evals/index.js'
import { createTestTempDirectory } from '../temp.js'

const RUN_ID = '63300_Aug-29-0100_synthetic'

interface HistoryOptions {
  stage: string
  attempt: number
  invocationId: string
  outcome?: 'success' | 'failure' | 'blocked'
  validationErrors?: string[]
  gates?: {
    id: string
    profile: string
    passed?: boolean
    cached?: boolean
    skipped?: boolean
    evidence?: string
  }[]
  selfCriteria?: { id: string; result: 'pass' | 'fail' }[]
}

/**
 * Build a synthetic layout-v2 run directory. Only the record shapes the
 * graders read are written, so each test states exactly what it exercises.
 */
class SyntheticRun {
  readonly root: string
  readonly agent: string
  private readonly history: Record<string, unknown>[] = []
  private status = 'running'
  private currentStage: string | null = 'implement'
  private pendingAction: Record<string, unknown> = {
    type: 'prepare_invocation',
  }
  private verificationGates: Record<string, string | false> = {
    'verify.full_suite': 'full',
  }
  private advisories: Record<string, unknown>[] = []
  private readonly events: Record<string, unknown>[] = []

  constructor() {
    this.root = createTestTempDirectory('pancreator-eval-graders-')
    this.agent = path.join(
      this.root,
      'runtime',
      'logs',
      'workflows',
      RUN_ID,
      'agent',
    )

    for (const child of [
      'outputs',
      'evidence',
      'validations',
      'invocations',
      'decisions',
      'artifacts/json',
    ]) {
      mkdirSync(path.join(this.agent, child), { recursive: true })
    }

    mkdirSync(path.join(this.root, 'runtime'), { recursive: true })
    writeFileSync(
      path.join(this.root, 'runtime', 'repository-checks.json'),
      JSON.stringify({
        schema_version: 1,
        profiles: {
          static: { probes: [], commands: ['npm run lint'] },
          fast: { probes: [], commands: ['npm test'] },
          full: {
            probes: [],
            commands: ['npm run check', 'npm run test:coverage'],
          },
        },
      }),
    )
  }

  relative(...segments: string[]): string {
    return path
      .relative(this.root, path.join(this.agent, ...segments))
      .split(path.sep)
      .join('/')
  }

  setState(options: {
    status?: string
    currentStage?: string | null
    pendingAction?: Record<string, unknown>
    verificationGates?: Record<string, string | false>
  }): this {
    this.status = options.status ?? this.status
    this.currentStage =
      options.currentStage === undefined
        ? this.currentStage
        : options.currentStage
    this.pendingAction = options.pendingAction ?? this.pendingAction
    this.verificationGates = options.verificationGates ?? this.verificationGates

    return this
  }

  baseline(profile: string, stage = 'implement'): this {
    writeFileSync(
      path.join(this.agent, 'evidence', `pre-implementation-${profile}.json`),
      JSON.stringify({ schema_version: 1, run_id: RUN_ID, stage, profile }),
    )

    return this
  }

  addHistory(options: HistoryOptions): this {
    const outcome = options.outcome ?? 'success'

    this.history.push({
      stage: options.stage,
      attempt: options.attempt,
      invocation_id: options.invocationId,
      output_path: this.relative('outputs', `${options.invocationId}.json`),
      record_path: this.relative(
        'artifacts',
        'json',
        `${options.invocationId}.json`,
      ),
      outcome,
      submitted_at: '2026-08-29T00:00:00.000Z',
      workspace_fingerprint: 'fp',
      validation_errors: options.validationErrors ?? [],
      deterministic: (options.gates ?? []).map((gate) => ({
        id: gate.id,
        type: 'shell',
        hard: true,
        passed: gate.passed ?? true,
        ...(gate.cached ? { cached: true } : {}),
        ...(gate.skipped ? { skipped: true } : {}),
        command: `pan repository-check ${gate.profile}`,
        evidence_path:
          gate.evidence ??
          this.relative('evidence', `${options.invocationId}-${gate.id}.log`),
        workspace_fingerprint: 'fp',
      })),
      self_criteria: options.selfCriteria ?? [],
    })

    return this
  }

  output(
    invocationId: string,
    result: 'success' | 'failure' | 'blocked',
    data: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ): this {
    writeFileSync(
      path.join(this.agent, 'outputs', `${invocationId}.json`),
      JSON.stringify({
        schema_version: 1,
        invocation_id: invocationId,
        result,
        summary: 'synthetic',
        artifacts: [],
        criteria: [],
        risks: [],
        unknowns: [],
        data,
        ...extra,
      }),
    )

    return this
  }

  evidenceFile(name: string, content: string): this {
    writeFileSync(path.join(this.agent, 'evidence', name), content)

    return this
  }

  validationFile(name: string, content: Record<string, unknown>): this {
    writeFileSync(
      path.join(this.agent, 'validations', name),
      JSON.stringify(content),
    )

    return this
  }

  decision(name: string, content: Record<string, unknown>): this {
    writeFileSync(
      path.join(this.agent, 'decisions', name),
      JSON.stringify(content),
    )

    return this
  }

  event(event: Record<string, unknown>): this {
    this.events.push(event)

    return this
  }

  advisory(advisory: Record<string, unknown>): this {
    this.advisories.push(advisory)

    return this
  }

  write(): this {
    writeFileSync(
      path.join(this.agent, 'state.json'),
      JSON.stringify({
        schema_version: 2,
        run_id: RUN_ID,
        workflow_slug: 'delivery',
        workflow_snapshot: { path: 'x', sha256: 'x' },
        workspace_root: '.',
        title: 'synthetic',
        status: this.status,
        current_stage: this.currentStage,
        pending_action: this.pendingAction,
        current_invocation: null,
        request: { source_path: 'r', stored_path: 'r', sha256: 'r' },
        limits: {},
        attempts: {},
        transition_count: this.history.length,
        consecutive_failures: 0,
        stage_history: this.history,
        advisories: this.advisories,
        verification: {
          level: 'light',
          summary: '',
          gates: this.verificationGates,
        },
        revision: 1,
        created_at: '2026-08-29T00:00:00.000Z',
        updated_at: '2026-08-29T00:00:00.000Z',
      }),
    )
    writeFileSync(
      path.join(this.agent, 'events.jsonl'),
      `${this.events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    )

    return this
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true })
  }
}

function scenario(overrides: Partial<EvalScenario> = {}): EvalScenario {
  return {
    schema_version: 1,
    name: 'synthetic',
    description: 'synthetic',
    policy_instructions: [
      { policy_id: 'DEV-001', instruction: 3, summary: 'baseline once' },
    ],
    fixture: 'toy-node',
    request: 'r',
    workflow: 'delivery',
    verification: 'light',
    expected: { status: 'succeeded' },
    graders: [{ id: 'stage-order-and-terminal-state' }],
    ...overrides,
  }
}

function grade(
  run: SyntheticRun,
  spec: EvalGraderSpec,
  expected?: EvalScenario['expected'],
) {
  const records = loadRunRecords(run.root, RUN_ID)

  return runGrader({
    records,
    scenario: scenario(expected ? { expected } : {}),
    spec,
  })
}

test('profile-executions counts baselines, live gates, and agent mentions', () => {
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

test('profile-executions default limits demand the full gate once on a succeeded run', () => {
  const run = new SyntheticRun()
    .setState({ status: 'succeeded', currentStage: null })
    .addHistory({ stage: 'verify', attempt: 1, invocationId: 'v1' })
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

// ---------------------------------------------------------------------------
// cohort-fanout
// ---------------------------------------------------------------------------

const COHORT_ID = '63300_Aug-29-0100_fanout'

interface ChunkRunOptions {
  runId: string
  chunk: string
  cohortIndex: number
  status?: string
  workflow?: string
  /** [prepared, submitted] ISO pairs, one per attempt. */
  attempts: [string, string | null][]
  bound?: boolean
}

/** Write one chunk run's state.json and events.jsonl under the synthetic root. */
function writeChunkRun(root: string, options: ChunkRunOptions): void {
  const agent = path.join(
    root,
    'runtime',
    'logs',
    'workflows',
    options.runId,
    'agent',
  )

  mkdirSync(agent, { recursive: true })
  writeFileSync(
    path.join(agent, 'state.json'),
    JSON.stringify({
      schema_version: 2,
      run_id: options.runId,
      workflow_slug: options.workflow ?? 'delivery-chunk',
      workflow_snapshot: { path: 'x', sha256: 'x' },
      workspace_root: `worktrees/operator/${options.chunk}`,
      ...(options.bound === false
        ? {}
        : {
            cohort: {
              cohort_id: COHORT_ID,
              cohort_index: options.cohortIndex,
              chunk: options.chunk,
            },
          }),
      title: options.chunk,
      status: options.status ?? 'succeeded',
      current_stage: null,
      pending_action: { type: 'none' },
      current_invocation: null,
      request: { source_path: 'r', stored_path: 'r', sha256: 'r' },
      limits: {},
      attempts: {},
      transition_count: options.attempts.length,
      consecutive_failures: 0,
      stage_history: [],
      advisories: [],
      revision: 1,
      created_at: '2026-08-29T00:00:00.000Z',
      updated_at: '2026-08-29T00:00:00.000Z',
    }),
  )

  const events: Record<string, unknown>[] = []

  options.attempts.forEach(([prepared, submitted], index) => {
    const invocationId = `${options.chunk}-implement-${index + 1}`

    events.push({
      type: 'invocation_prepared',
      timestamp: prepared,
      invocation_id: invocationId,
      stage: 'implement',
    })

    if (submitted) {
      events.push({
        type: 'stage_output_submitted',
        timestamp: submitted,
        invocation_id: invocationId,
        stage: 'implement',
      })
    }
  })

  writeFileSync(
    path.join(agent, 'events.jsonl'),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
  )
}

interface SessionOptions {
  maxParallel?: number
  chunks: {
    id: string
    cohortIndex: number
    runId?: string
    abandoned?: boolean
  }[]
  integratedCohorts?: number[]
}

/** Write the cohort session record and its integration evidence files. */
function writeCohortSession(root: string, options: SessionOptions): void {
  const directory = path.join(root, 'runtime', 'logs', 'cohorts', COHORT_ID)

  mkdirSync(directory, { recursive: true })

  const indexes = [...new Set(options.chunks.map((chunk) => chunk.cohortIndex))]
  const satisfaction = (options.integratedCohorts ?? []).map((index) => {
    const evidencePath = `runtime/logs/cohorts/${COHORT_ID}/integration-${index}.json`

    writeFileSync(
      path.join(root, evidencePath),
      JSON.stringify({ cohort_index: index, merge_commit: 'abc' }),
    )

    return {
      cohort_index: index,
      recorded_at: '2026-08-29T01:00:00.000Z',
      base_branch: 'main',
      merge_commit: 'abc',
      evidence_path: evidencePath,
    }
  })

  writeFileSync(
    path.join(directory, 'state.json'),
    JSON.stringify({
      schema_version: 1,
      cohort_id: COHORT_ID,
      plan_run_id: RUN_ID,
      parent_spec_path: 'spec.md',
      base_branch: 'main',
      ...(options.maxParallel ? { max_parallel: options.maxParallel } : {}),
      created_at: '2026-08-29T00:00:00.000Z',
      updated_at: '2026-08-29T00:00:00.000Z',
      chunks: options.chunks.map((chunk) => ({
        id: chunk.id,
        title: chunk.id,
        cohort_index: chunk.cohortIndex,
        child_spec_path: `${chunk.id}.md`,
        depends_on: [],
        ...(chunk.runId
          ? {
              worktree: `cohort-${chunk.id}`,
              branch: `cohort/${chunk.id}`,
              run_id: chunk.runId,
            }
          : {}),
        ...(chunk.abandoned
          ? { abandoned: { note: 'dropped', recorded_at: 'now' } }
          : {}),
      })),
      edges: [],
      cohorts: indexes.map((index) => ({
        index,
        chunks: options.chunks
          .filter((chunk) => chunk.cohortIndex === index)
          .map((chunk) => chunk.id),
      })),
      satisfaction,
    }),
  )
}

function planRun(): SyntheticRun {
  return new SyntheticRun()
    .setState({
      status: 'succeeded',
      currentStage: null,
      pendingAction: { type: 'none' },
    })
    .addHistory({ stage: 'plan', attempt: 1, invocationId: 'p1' })
    .write()
}

test('cohort-fanout fails when the plan run opened no cohort session', () => {
  const run = planRun()

  try {
    const verdict = grade(run, { id: 'cohort-fanout' })

    assert.equal(verdict.passed, false)
    assert.match(verdict.summary, /no cohort session/u)
  } finally {
    run.dispose()
  }
})

test('cohort-fanout passes a wide cohort that ran in parallel within the limit and integrated', () => {
  const run = planRun()

  try {
    writeCohortSession(run.root, {
      maxParallel: 2,
      chunks: [
        { id: 'a', cohortIndex: 1, runId: 'run-a' },
        { id: 'b', cohortIndex: 1, runId: 'run-b' },
        { id: 'c', cohortIndex: 1, runId: 'run-c' },
        { id: 'd', cohortIndex: 1, abandoned: true },
      ],
      integratedCohorts: [1],
    })
    // a and b overlap; c starts once a finished, so the peak is 2.
    writeChunkRun(run.root, {
      runId: 'run-a',
      chunk: 'a',
      cohortIndex: 1,
      attempts: [['2026-08-29T00:00:00Z', '2026-08-29T00:10:00Z']],
    })
    writeChunkRun(run.root, {
      runId: 'run-b',
      chunk: 'b',
      cohortIndex: 1,
      attempts: [['2026-08-29T00:00:05Z', '2026-08-29T00:20:00Z']],
    })
    writeChunkRun(run.root, {
      runId: 'run-c',
      chunk: 'c',
      cohortIndex: 1,
      attempts: [['2026-08-29T00:10:00Z', '2026-08-29T00:30:00Z']],
    })

    const verdict = grade(run, {
      id: 'cohort-fanout',
      policy: 'COHORT-001#15',
      config: { min_chunks: 3, max_cohorts: 1, min_concurrent: 2 },
    })

    assert.equal(verdict.passed, true, verdict.summary)
    assert.equal(verdict.policy, 'COHORT-001#15')

    const cohorts = verdict.details.cohorts as Record<string, unknown>[]

    assert.equal(cohorts[0]?.peak_concurrent_attempts, 2)
    assert.equal(cohorts[0]?.integrated, true)
    assert.ok(
      verdict.evidence.includes(
        `runtime/logs/cohorts/${COHORT_ID}/integration-1.json`,
      ),
    )
    assert.ok(
      verdict.evidence.some((item) => item.endsWith('run-b/agent/state.json')),
    )
  } finally {
    run.dispose()
  }
})

test('cohort-fanout reports serial execution, a breached limit, a wrong workflow, and a missing merge', () => {
  const run = planRun()

  try {
    writeCohortSession(run.root, {
      maxParallel: 2,
      chunks: [
        { id: 'a', cohortIndex: 1, runId: 'run-a' },
        { id: 'b', cohortIndex: 1, runId: 'run-b' },
        { id: 'c', cohortIndex: 2, runId: 'run-c' },
        { id: 'd', cohortIndex: 2, runId: 'run-d' },
        { id: 'e', cohortIndex: 2, runId: 'run-e' },
        { id: 'f', cohortIndex: 3 },
      ],
      integratedCohorts: [1],
    })
    // Cohort 1 ran strictly one after the other.
    writeChunkRun(run.root, {
      runId: 'run-a',
      chunk: 'a',
      cohortIndex: 1,
      attempts: [['2026-08-29T00:00:00Z', '2026-08-29T00:10:00Z']],
    })
    writeChunkRun(run.root, {
      runId: 'run-b',
      chunk: 'b',
      cohortIndex: 1,
      workflow: 'delivery',
      attempts: [['2026-08-29T00:10:00Z', '2026-08-29T00:20:00Z']],
    })
    // Cohort 2 ran three at once against a limit of two; e is still open.
    writeChunkRun(run.root, {
      runId: 'run-c',
      chunk: 'c',
      cohortIndex: 2,
      attempts: [['2026-08-29T01:00:00Z', '2026-08-29T01:10:00Z']],
    })
    writeChunkRun(run.root, {
      runId: 'run-d',
      chunk: 'd',
      cohortIndex: 2,
      attempts: [['2026-08-29T01:00:00Z', '2026-08-29T01:10:00Z']],
    })
    writeChunkRun(run.root, {
      runId: 'run-e',
      chunk: 'e',
      cohortIndex: 2,
      status: 'running',
      bound: false,
      attempts: [['2026-08-29T01:05:00Z', null]],
    })

    const verdict = grade(run, {
      id: 'cohort-fanout',
      config: { max_cohorts: 1 },
    })

    assert.equal(verdict.passed, false)

    const failures = verdict.details.failures as string[]

    assert.ok(
      failures.some((item) => /3 cohort\(s\), expected at most 1/u.test(item)),
    )
    assert.ok(
      failures.some((item) => /chunk f never received a run/u.test(item)),
    )
    assert.ok(
      failures.some((item) =>
        /chunk b ran workflow 'delivery', expected 'delivery-chunk'/u.test(
          item,
        ),
      ),
    )
    assert.ok(
      failures.some((item) =>
        /cohort 1 peaked at 1 concurrent attempt\(s\), expected at least 2/u.test(
          item,
        ),
      ),
    )
    assert.ok(
      failures.some((item) =>
        /cohort 2 peaked at 3 concurrent attempt\(s\), above the limit 2/u.test(
          item,
        ),
      ),
    )
    assert.ok(failures.some((item) => /chunk e run is 'running'/u.test(item)))
    assert.ok(
      failures.some((item) =>
        /chunk e run does not record membership/u.test(item),
      ),
    )
    assert.ok(
      failures.some((item) => /cohort 2 was never integrated/u.test(item)),
    )
  } finally {
    run.dispose()
  }
})
