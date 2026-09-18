import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { LOCAL_CATALOG_RELATIVE_PATH } from '../../src/lib/executors/cursor-catalog.js'
import {
  createCursorAgentAdapter,
  resetCursorAgentCapabilities,
} from '../../src/lib/executors/cursor-agent.js'
import { expectedCursorModelForSpec } from '../../src/lib/executors/cursor-probe.js'
import { driveRun } from '../../src/lib/headless-driver.js'
import {
  delegateEvidenceWorkers,
  delegateInvocation,
  getRunState,
  prepareInvocation,
} from '../../src/lib/engine.js'
import {
  loadPipelineConfigSnapshot,
  resolvePersonaMapping,
} from '../../src/lib/pipeline-config.js'
import { loadDelegationExecutionRecord } from '../../src/lib/validation.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import {
  attachTargetInstructionEvidence,
  createFixture,
  makeOutput,
  writeFixtureCursorCatalog,
  writeJson,
} from '../helpers.js'
import { checkpoint } from './delivery-helpers.js'

/** Flags the installed CLI declares. A case may drop one to fail preflight. */
const HELP_FLAGS =
  '--output-format --trust --model --resume --workspace --add-dir'

function withCursorFixture<T>(
  root: string,
  reportedModel: string,
  run: (binary: string, promptPath: string) => T,
  helpFlags: string = HELP_FLAGS,
): T {
  const binary = path.join(root, 'runtime', 'fake-cursor-agent')
  const promptPath = path.join(root, 'runtime', 'cursor-prompt.txt')

  const originalBinary = process.env.PANCREATOR_CURSOR_AGENT_BIN
  const originalKey = process.env.CURSOR_API_KEY

  const originalModel = process.env.FAKE_CURSOR_MODEL
  const originalPrompt = process.env.FAKE_CURSOR_PROMPT_PATH
  const originalOutputSource = process.env.FAKE_CURSOR_OUTPUT_SOURCE
  const originalOutputPath = process.env.FAKE_CURSOR_OUTPUT_PATH

  // An evidence worker is told where to write its report in its own prompt,
  // and a stage worker is not, so the one fake binary serves both by reading
  // the destination back out of the prompt it was given.
  writeFileSync(
    binary,
    '#!/bin/sh\n' +
      'if [ "$1" = "--help" ]; then\n' +
      `  echo 'Usage: cursor-agent ${helpFlags}'\n` +
      '  exit 0\n' +
      'fi\n' +
      'cat > "$FAKE_CURSOR_PROMPT_PATH"\n' +
      'EVIDENCE=$(sed -n \'s/^Write your complete evidence report as Markdown to `\\([^`]*\\)`.*$/\\1/p\' "$FAKE_CURSOR_PROMPT_PATH" | head -1)\n' +
      'if [ -n "$EVIDENCE" ]; then\n' +
      '  printf \'# evidence\\n\\nFixture report.\\n\' > "$EVIDENCE"\n' +
      'elif [ -n "$FAKE_CURSOR_OUTPUT_SOURCE" ]; then\n' +
      '  cp "$FAKE_CURSOR_OUTPUT_SOURCE" "$FAKE_CURSOR_OUTPUT_PATH"\n' +
      'fi\n' +
      'printf \'{"type":"system","subtype":"init","session_id":"cursor-session","model":"%s"}\\n\' "$FAKE_CURSOR_MODEL"\n',
  )
  chmodSync(binary, 0o755)
  process.env.PANCREATOR_CURSOR_AGENT_BIN = binary
  process.env.CURSOR_API_KEY = 'test-key'
  process.env.FAKE_CURSOR_MODEL = reportedModel
  process.env.FAKE_CURSOR_PROMPT_PATH = promptPath
  resetCursorAgentCapabilities()

  try {
    return run(binary, promptPath)
  } finally {
    for (const [key, value] of [
      ['PANCREATOR_CURSOR_AGENT_BIN', originalBinary],
      ['CURSOR_API_KEY', originalKey],
      ['FAKE_CURSOR_MODEL', originalModel],
      ['FAKE_CURSOR_PROMPT_PATH', originalPrompt],
      ['FAKE_CURSOR_OUTPUT_SOURCE', originalOutputSource],
      ['FAKE_CURSOR_OUTPUT_PATH', originalOutputPath],
    ] as const) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    resetCursorAgentCapabilities()
  }
}

test('the Cursor adapter delivers stdin, records roots, and rejects model drift', () => {
  const root = createFixture()
  const workspace = path.join(root, 'workspace')
  const runtime = path.join(root, 'runtime')
  const modelSpec = 'claude-opus-5[context=1m,effort=high]'

  mkdirSync(workspace, { recursive: true })

  withCursorFixture(root, 'Expected Variant', (_binary, promptPath) => {
    const adapter = createCursorAgentAdapter({
      workspaceDir: workspace,
      installationRoot: root,
      runtimeDir: runtime,
      modelSpec,
      modelVerification: {
        status: 'compared',
        expected_model: 'Expected Variant',
      },
    })
    const passed = adapter.run('canonical prompt')

    assert.equal(passed.ok, true, passed.error ?? 'adapter failed')
    assert.equal(readFileSync(promptPath, 'utf8'), 'canonical prompt')
    assert.equal(passed.session_id, 'cursor-session')
    assert.equal(passed.reported_model, 'Expected Variant')
    assert.deepEqual(passed.model_verification, {
      status: 'compared',
      expected_model: 'Expected Variant',
    })
    assert.deepEqual(passed.tool_policy, {
      granted_roots: [workspace, runtime],
      per_path_write_policy: false,
      scope_gate: 'scope.no_unapproved_changes',
    })
    assert.ok(passed.argv.includes(modelSpec))
    assert.ok(passed.argv.includes('--workspace'))
    assert.ok(passed.argv.includes('--add-dir'))

    const drifted = createCursorAgentAdapter({
      workspaceDir: workspace,
      installationRoot: root,
      runtimeDir: runtime,
      modelSpec,
      modelVerification: {
        status: 'compared',
        expected_model: 'Different Variant',
      },
    }).run('canonical prompt')

    assert.equal(drifted.ok, false)
    assert.match(drifted.error ?? '', /local catalog predicts/u)

    // Without a prediction the delegation still runs, and the record says so
    // rather than looking like a comparison that matched.
    const unpredicted = createCursorAgentAdapter({
      workspaceDir: workspace,
      installationRoot: root,
      runtimeDir: runtime,
      modelSpec,
      modelVerification: {
        status: 'unverifiable',
        reason: 'fixture reason',
      },
    }).run('canonical prompt')

    assert.equal(unpredicted.ok, true, unpredicted.error ?? 'adapter failed')
    assert.deepEqual(unpredicted.model_verification, {
      status: 'unverifiable',
      reason: 'fixture reason',
    })
  })
})

test('headless delegation dispatches Cursor and needs no watch record', () => {
  const run = checkpoint('delivery@created')
  const root = run.root
  const snapshot = loadPipelineConfigSnapshot(
    root,
    run.state.pipeline_config?.path ?? '',
  )
  const mapping = resolvePersonaMapping(snapshot, 'coder')

  // The catalog is operator-local and gitignored, so a fixture that wants the
  // drift comparison exercised has to bring one. Without this the prediction
  // is null on every checkout and the comparison never runs.
  writeFixtureCursorCatalog(root)

  const expected = expectedCursorModelForSpec(root, mapping.model_spec)

  assert.ok(
    expected,
    'the fixture catalog must predict a variant for the coder spec',
  )

  withCursorFixture(root, expected, (_binary, promptPath) => {
    const prepared = prepareInvocation(root, run.runId)
    const invocation = prepared.invocation

    assert.ok(invocation)
    assert.throws(
      () => delegateInvocation(root, run.runId),
      (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'EXECUTOR_UNSUPPORTED',
    )

    const state = getRunState(root, run.runId)
    const stage = stageBySlug(loadWorkflow(root, 'delivery'), 'implement')
    const output = makeOutput(root, invocation, stage, 'success', state)
    const outputSource = path.join(root, 'runtime', 'cursor-output-source.json')

    attachTargetInstructionEvidence(root, output, ['AGENTS.md'])
    writeJson(outputSource, output)
    process.env.FAKE_CURSOR_OUTPUT_SOURCE = outputSource
    process.env.FAKE_CURSOR_OUTPUT_PATH = path.join(
      root,
      invocation.output.path,
    )

    const driven = driveRun(root, run.runId, { maxSteps: 1 })
    const execution = loadDelegationExecutionRecord(
      root,
      run.runId,
      invocation.invocation_id,
    )

    assert.ok(execution)
    assert.equal(execution.executor, 'cursor')
    assert.equal(execution.delegated_by, 'harness')
    assert.equal(execution.reported_model, expected)
    assert.deepEqual(execution.model_verification, {
      status: 'compared',
      expected_model: expected,
    })
    assert.deepEqual(execution.tool_policy?.granted_roots, [
      path.join(root, run.state.workspace_root),
      path.join(root, 'runtime'),
    ])
    assert.equal(
      readFileSync(promptPath, 'utf8'),
      readFileSync(
        path.join(root, invocation.delegation?.delivery_prompt_path ?? ''),
        'utf8',
      ),
    )
    assert.equal(
      driven.state.stage_history.at(-1)?.outcome,
      'success',
      JSON.stringify(driven.state.stage_history.at(-1)),
    )
    assert.equal(driven.state.delegated_workers?.length ?? 0, 0)
  })
})

test('the driver advances a verify stage whose evidence workers map to Cursor', () => {
  const run = checkpoint('delivery@verify-prepared')
  const root = run.root
  const invocation = run.invocation

  assert.ok(invocation)

  const workers = invocation.evidence_workers ?? []

  assert.ok(workers.length > 0, 'the verify stage declares evidence workers')

  // Without the harness-owned option a Cursor evidence worker stays skipped,
  // the way an operator session's own `pan delegate` refuses a Cursor stage.
  assert.deepEqual(
    delegateEvidenceWorkers(root, run.runId).map((worker) => worker.skipped),
    workers.map(() => 'cursor_persona'),
  )

  const stage = stageBySlug(loadWorkflow(root, 'delivery'), 'verify')
  const output = makeOutput(root, invocation, stage, 'success', run.state)
  const outputSource = path.join(root, 'runtime', 'verify-output-source.json')

  attachTargetInstructionEvidence(root, output, ['AGENTS.md'])
  writeJson(outputSource, output)

  // `makeOutput` leaves behind the reports a compliant supervisor would have
  // collected. Remove them so the drive has to collect them itself, and
  // remove any catalog so the unpredicted branch is the same on every host.
  for (const worker of workers) {
    rmSync(path.join(root, worker.evidence_path), { force: true })
  }

  rmSync(path.join(root, LOCAL_CATALOG_RELATIVE_PATH), { force: true })

  withCursorFixture(root, 'Cursor Test Variant', () => {
    process.env.FAKE_CURSOR_OUTPUT_SOURCE = outputSource
    process.env.FAKE_CURSOR_OUTPUT_PATH = path.join(
      root,
      invocation.output.path,
    )

    const driven = driveRun(root, run.runId, { maxSteps: 1 })

    for (const worker of workers) {
      assert.ok(
        existsSync(path.join(root, worker.evidence_path)),
        `${worker.role} evidence report was not collected`,
      )
    }

    assert.equal(
      driven.state.stage_history.at(-1)?.stage,
      'verify',
      JSON.stringify(driven.stop),
    )
    assert.equal(driven.state.stage_history.at(-1)?.outcome, 'success')
    assert.equal(driven.state.delegated_workers?.length ?? 0, 0)

    const execution = loadDelegationExecutionRecord(
      root,
      run.runId,
      invocation.invocation_id,
    )

    assert.ok(execution)
    assert.equal(execution.model_verification?.status, 'unverifiable')
    assert.match(
      execution.model_verification?.status === 'unverifiable'
        ? execution.model_verification.reason
        : '',
      /pan models --sync/u,
    )
  })
})

test('headless Cursor preflight pauses when the binary is missing', () => {
  const run = checkpoint('delivery@created')
  const root = run.root
  const originalBinary = process.env.PANCREATOR_CURSOR_AGENT_BIN
  const originalKey = process.env.CURSOR_API_KEY

  process.env.PANCREATOR_CURSOR_AGENT_BIN = path.join(
    root,
    'runtime',
    'missing-cursor-agent',
  )
  process.env.CURSOR_API_KEY = 'test-key'
  resetCursorAgentCapabilities()

  try {
    prepareInvocation(root, run.runId)
    const delegated = delegateInvocation(root, run.runId, { headless: true })

    assert.equal(delegated.execution, null)
    assert.equal(delegated.state.status, 'paused')
    assert.match(delegated.state.pause_reason ?? '', /not invocable/u)
    assert.ok(delegated.invocation)
    // "No substitution" is a state rather than a sentence: the paused run
    // still resolves its stage persona to Cursor, and no execution record
    // exists, so nothing else ran in its place.
    assert.equal(
      resolvePersonaMapping(
        loadPipelineConfigSnapshot(
          root,
          delegated.state.pipeline_config?.path ?? '',
        ),
        delegated.invocation.stage.persona,
      ).executor,
      'cursor',
    )
    assert.equal(
      loadDelegationExecutionRecord(
        root,
        run.runId,
        delegated.invocation.invocation_id,
      ),
      null,
    )
  } finally {
    if (originalBinary === undefined) {
      delete process.env.PANCREATOR_CURSOR_AGENT_BIN
    } else {
      process.env.PANCREATOR_CURSOR_AGENT_BIN = originalBinary
    }

    if (originalKey === undefined) {
      delete process.env.CURSOR_API_KEY
    } else {
      process.env.CURSOR_API_KEY = originalKey
    }

    resetCursorAgentCapabilities()
  }
})

test('headless Cursor preflight pauses when no credential resolves', () => {
  const run = checkpoint('delivery@created')
  const root = run.root

  withCursorFixture(root, 'Cursor Test Variant', () => {
    delete process.env.CURSOR_API_KEY
    prepareInvocation(root, run.runId)
    const delegated = delegateInvocation(root, run.runId, { headless: true })

    assert.equal(delegated.execution, null)
    assert.equal(delegated.state.status, 'paused')
    assert.match(delegated.state.pause_reason ?? '', /no CURSOR_API_KEY/u)
    // The operator-facing remedy sentence is itself a contract of AC-61, so
    // one prose assertion stays; the executor identity is asserted as state.
    assert.match(
      delegated.state.pause_reason ?? '',
      /Substituting another executor/u,
    )
    assert.ok(delegated.invocation)
    // "No substitution" is a state rather than a sentence: the paused run
    // still resolves its stage persona to Cursor, and no execution record
    // exists, so nothing else ran in its place.
    assert.equal(
      resolvePersonaMapping(
        loadPipelineConfigSnapshot(
          root,
          delegated.state.pipeline_config?.path ?? '',
        ),
        delegated.invocation.stage.persona,
      ).executor,
      'cursor',
    )
    assert.equal(
      loadDelegationExecutionRecord(
        root,
        run.runId,
        delegated.invocation.invocation_id,
      ),
      null,
    )
  })
})

test('headless Cursor preflight pauses when the CLI drops a required flag', () => {
  const run = checkpoint('delivery@created')
  const root = run.root

  withCursorFixture(
    root,
    'Cursor Test Variant',
    () => {
      prepareInvocation(root, run.runId)

      const delegated = delegateInvocation(root, run.runId, { headless: true })

      assert.equal(delegated.execution, null)
      assert.equal(delegated.state.status, 'paused')
      assert.match(
        delegated.state.pause_reason ?? '',
        /declares no --workspace/u,
      )
      assert.ok(delegated.invocation)
      assert.equal(
        resolvePersonaMapping(
          loadPipelineConfigSnapshot(
            root,
            delegated.state.pipeline_config?.path ?? '',
          ),
          delegated.invocation.stage.persona,
        ).executor,
        'cursor',
      )
    },
    '--output-format --trust --model --resume --add-dir',
  )
})

test('headless Cursor preflight pauses before an evidence worker launches', () => {
  const run = checkpoint('delivery@verify-prepared')
  const root = run.root
  const invocation = run.invocation

  assert.ok(invocation)

  const workers = invocation.evidence_workers ?? []

  assert.ok(workers.length > 0, 'the verify stage declares evidence workers')

  // `makeOutput` leaves behind the reports a compliant supervisor would have
  // collected. Remove them so the drive has to launch the workers itself.
  for (const worker of workers) {
    rmSync(path.join(root, worker.evidence_path), { force: true })
  }

  withCursorFixture(root, 'Cursor Test Variant', () => {
    // Evidence workers run before the stage delegation, so this drive never
    // reaches the stage worker's own preflight. A readiness gap has to stop
    // the run here, or it surfaces as a spawn error naming no remedy.
    process.env.PANCREATOR_CURSOR_AGENT_BIN = path.join(
      root,
      'runtime',
      'missing-cursor-agent',
    )
    resetCursorAgentCapabilities()

    const driven = driveRun(root, run.runId, { maxSteps: 1 })

    assert.equal(
      driven.stop.type,
      'operator_pause',
      JSON.stringify(driven.stop),
    )
    assert.equal(driven.state.status, 'paused')
    assert.match(driven.state.pause_reason ?? '', /not invocable/u)
    assert.match(
      driven.state.pause_reason ?? '',
      /Substituting another executor/u,
    )
    // AC-61 makes the remedy part of the stop, and the operator reads it from
    // the decision record the pause writes.
    assert.ok(driven.state.last_decision_path)
    assert.match(
      readFileSync(path.join(root, driven.state.last_decision_path), 'utf8'),
      /Install cursor-agent/u,
    )

    // No substitution and no partial work: neither report was collected, no
    // execution record exists, and the stage persona still resolves to Cursor.
    for (const worker of workers) {
      assert.equal(
        existsSync(path.join(root, worker.evidence_path)),
        false,
        `${worker.role} ran despite a failed preflight`,
      )
    }

    assert.equal(
      loadDelegationExecutionRecord(root, run.runId, invocation.invocation_id),
      null,
    )
    assert.equal(
      resolvePersonaMapping(
        loadPipelineConfigSnapshot(
          root,
          driven.state.pipeline_config?.path ?? '',
        ),
        invocation.stage.persona,
      ).executor,
      'cursor',
    )
  })
})
