import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { loadRunRecords, runGrader } from '../../src/lib/evals/index.js'
import type { EvalGraderSpec, EvalScenario } from '../../src/lib/evals/index.js'
import { createTestTempDirectory } from '../temp.js'

export const RUN_ID = '63300_Aug-29-0100_synthetic'

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
export class SyntheticRun {
  readonly root: string
  readonly agent: string
  private readonly history: Record<string, unknown>[] = []
  private status = 'running'
  private currentStage: string | null = 'implement'
  private pendingAction: Record<string, unknown> = {
    type: 'prepare_invocation',
  }
  private verificationGates: Record<string, string | false> = {
    'ship.full_suite': 'full',
  }
  private entryGates: Record<string, unknown> = {}
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

  /**
   * Record a stage entry gate the harness ran before delegation. Its result
   * lives on `state.entry_gates`, not in stage_history, until the stage
   * submission carries it.
   */
  entryGate(options: {
    stage: string
    id: string
    profile: string
    passed?: boolean
    evidence?: string
  }): this {
    this.entryGates[options.stage] = {
      criterion_id: options.id,
      executions: 1,
      failures: options.passed === false ? 1 : 0,
      last_result: {
        id: options.id,
        type: 'shell',
        hard: true,
        passed: options.passed ?? true,
        command: `pan repository-check ${options.profile}`,
        evidence_path:
          options.evidence ??
          this.relative(
            'evidence',
            `${options.stage}-entry-1-${options.id}.log`,
          ),
        workspace_fingerprint: 'fp',
      },
      ...(options.passed === false
        ? {}
        : { passed_at_history_length: this.history.length }),
    }

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

  /** Append executions to the run's agent profile ledger. */
  ledger(
    entries: {
      profile: string
      invocationId?: string
      status?: string
      invokedBy?: 'agent' | 'harness'
      evidenceLog?: string
    }[],
  ): this {
    writeFileSync(
      path.join(this.agent, 'evidence', 'repository-check-runs.jsonl'),
      `${entries
        .map((entry) =>
          JSON.stringify({
            profile: entry.profile,
            invocation_id: entry.invocationId ?? null,
            workspace_fingerprint: 'fp',
            status: entry.status ?? 'passed',
            duration_ms: 1,
            started_at: '2026-08-29T00:00:00.000Z',
            invoked_by: entry.invokedBy ?? 'agent',
            ...(entry.evidenceLog ? { evidence_log: entry.evidenceLog } : {}),
          }),
        )
        .join('\n')}\n`,
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
        ...(Object.keys(this.entryGates).length > 0
          ? { entry_gates: this.entryGates }
          : {}),
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

export function scenario(overrides: Partial<EvalScenario> = {}): EvalScenario {
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

export function grade(
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
