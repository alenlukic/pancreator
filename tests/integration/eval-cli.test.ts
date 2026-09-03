import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { prepareInvocation } from '../../src/lib/engine.js'
import type { EvalReport } from '../../src/lib/evals/index.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import {
  createFixture,
  createRun,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
  submitAsSupervisor,
} from '../helpers.js'

const REPO_ROOT = process.cwd()
const CLI = path.join(REPO_ROOT, 'dist', 'src', 'cli.js')

function withEvals(root: string): void {
  cpSync(path.join(REPO_ROOT, 'evals'), path.join(root, 'evals'), {
    recursive: true,
  })
  // A delivery run starts at implement, whose target-instruction coverage
  // check reads the cumulative workspace diff, so the copied scenario tree
  // joins the fixture baseline instead of appearing as untracked work.
  execFileSync('git', ['add', 'evals'], { cwd: root })
  execFileSync('git', ['commit', '-q', '--amend', '-m', 'fixture'], {
    cwd: root,
  })
}

function pan(
  root: string,
  args: string[],
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PANCREATOR_ROOT: root },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    const failure = error as {
      status?: number
      stdout?: string
      stderr?: string
    }

    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    }
  }
}

test('pan eval grade grades a fixture run against a scenario and writes a report', () => {
  const root = createFixture()

  withEvals(root)

  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Eval grade fixture',
  })

  // `createRun` already attested the card and wrote the session redline, the
  // way a compliant supervisor does before the harness prepares anything.
  const invocation = prepareInvocation(root, state.run_id).invocation

  assert.ok(invocation)

  const output = makeOutput(
    root,
    invocation,
    stageBySlug(workflow, 'implement'),
    'success',
    state,
  )

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)
  submitAsSupervisor(root, state.run_id, invocation.output.path)

  // A scenario that expects exactly this open state: implement succeeded,
  // verify next.
  writeFileSync(
    path.join(root, 'evals', 'scenarios', 'fixture-implement-submitted.json'),
    JSON.stringify({
      schema_version: 1,
      name: 'fixture-implement-submitted',
      description: 'Fixture run after the implement submission.',
      policy_instructions: [
        {
          policy_id: 'ORCH-001',
          instruction: 25,
          summary: 'No mechanical attempts.',
        },
      ],
      fixture: 'toy-node',
      request: '# fixture\n',
      workflow: 'delivery',
      verification: 'light',
      expected: {
        status: 'running',
        current_stage: 'verify',
        pending_action: 'prepare_invocation',
        stage_sequence: [{ stage: 'implement', outcome: 'success' }],
      },
      graders: [
        { id: 'stage-order-and-terminal-state' },
        { id: 'attempts-not-spent-on-mechanics', policy: 'ORCH-001#25' },
        { id: 'delegation-watch-record', policy: 'DELEGATE-001#12' },
        { id: 'platform-guidance-conflict-recorded', policy: 'OPERATOR-001#5' },
        {
          id: 'profile-executions',
          config: {
            limits: [{ profile: 'full', source: 'any', scope: 'run', max: 0 }],
          },
        },
      ],
    }),
  )

  const passing = pan(root, [
    'eval',
    'grade',
    state.run_id,
    '--scenario',
    'fixture-implement-submitted',
    '--out',
    'runtime/logs/evals/manual',
    '--json',
  ])

  assert.equal(passing.status, 0, passing.stderr)

  const report = JSON.parse(passing.stdout) as EvalReport & {
    report_paths: { json_path: string; markdown_path: string }
  }

  assert.equal(report.passed, true, JSON.stringify(report.graders, null, 2))
  assert.equal(report.run_id, state.run_id)
  assert.equal(report.graders.length, 5)
  assert.ok(existsSync(path.join(root, report.report_paths.json_path)))
  assert.match(
    readFileSync(path.join(root, report.report_paths.markdown_path), 'utf8'),
    /\*\*Result:\*\* PASS/u,
  )

  // The shipped scenario expects a succeeded run, so the open fixture run fails
  // its stage-order grader and the command exits nonzero.
  const failing = pan(root, [
    'eval',
    'grade',
    state.run_id,
    '--scenario',
    'delivery-basic-test-discipline',
  ])

  assert.equal(failing.status, 1)
  assert.match(failing.stdout, /\*\*Result:\*\* FAIL/u)
  assert.match(failing.stdout, /### FAIL: stage-order-and-terminal-state/u)
  assert.match(failing.stdout, /status is 'running', expected 'succeeded'/u)
})

test('pan eval run materializes the toy workspace, creates the run, and hands off at the first Cursor persona', () => {
  const root = createFixture()

  withEvals(root)

  // Without the opt-in the driver refuses to stand in for the supervisor and
  // hands off before the first prepare, naming the attest command.
  const unattested = pan(root, [
    'eval',
    'run',
    'delivery-basic-test-discipline',
    '--json',
  ])

  assert.equal(unattested.status, 0, unattested.stderr)

  const handoff = JSON.parse(unattested.stdout) as {
    status: string
    handoff_reason: string | null
    operator_steps: string[]
  }

  assert.equal(handoff.status, 'handoff')
  assert.match(
    handoff.handoff_reason ?? '',
    /supervisor card .* is not attested/u,
  )
  assert.ok(
    handoff.operator_steps.some((step) =>
      step.includes('governance attest-supervisor'),
    ),
    handoff.operator_steps.join('\n'),
  )

  const result = pan(root, [
    'eval',
    'run',
    'delivery-basic-test-discipline',
    '--attest-supervisor-card',
    '--json',
  ])

  assert.equal(result.status, 0, result.stderr)

  const run = JSON.parse(result.stdout) as {
    eval_id: string
    eval_dir: string
    run_id: string
    workspace: string
    status: string
    handoff_reason: string | null
    operator_steps: string[]
    report: EvalReport
    report_paths: { json_path: string; markdown_path: string }
  }

  // The fixture maps every persona to Cursor, so the driver prepares the
  // implement card and stops instead of pretending to be the supervisor.
  assert.equal(run.status, 'handoff')
  assert.match(
    run.handoff_reason ?? '',
    /persona 'coder' maps to the cursor executor/u,
  )
  assert.ok(
    run.operator_steps.some((step) =>
      step.includes(`/pan-resume ${run.run_id}`),
    ),
  )
  assert.ok(run.operator_steps.some((step) => step.includes('ship -> approve')))

  // The toy fixture, not the harness tree, is the run's workspace.
  assert.equal(run.workspace, `${run.eval_dir}/workspace`)
  assert.ok(existsSync(path.join(root, run.workspace, 'src', 'greet.mjs')))
  assert.ok(existsSync(path.join(root, run.workspace, '.git')))
  assert.ok(!existsSync(path.join(root, run.workspace, 'governance')))

  const state = JSON.parse(
    readFileSync(
      path.join(
        root,
        'runtime',
        'logs',
        'workflows',
        run.run_id,
        'agent',
        'state.json',
      ),
      'utf8',
    ),
  ) as {
    workspace_root: string
    status: string
    pending_action: { type: string }
  }

  assert.equal(state.workspace_root, run.workspace)
  assert.equal(state.status, 'running')
  assert.equal(state.pending_action.type, 'invoke_agent')

  const metadata = JSON.parse(
    readFileSync(path.join(root, run.eval_dir, 'eval.json'), 'utf8'),
  ) as {
    status: string
    run_id: string
    scenario: string
    supervisor_card_attested_by: string | null
  }

  assert.equal(metadata.status, 'handoff')
  assert.equal(metadata.supervisor_card_attested_by, 'eval-driver')
  assert.equal(metadata.run_id, run.run_id)
  assert.equal(metadata.scenario, 'delivery-basic-test-discipline')
  assert.ok(existsSync(path.join(root, run.report_paths.markdown_path)))
  assert.equal(run.report.passed, false)
})
