import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
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
import { pathToFileURL } from 'node:url'

import {
  getRunState,
  getRunStatus,
  pauseRun,
  prepareInvocation,
  probeRunInvocationModel,
  recordPendingWorkerModelProbe,
  recordSupervisorModelEvidence,
  setRunStage,
} from '../../src/lib/engine.js'
import { PanError } from '../../src/lib/errors.js'
import { runCursorAgentJson } from '../../src/lib/executors/cursor-agent.js'
import {
  expectedCursorModelForSpec,
  probeCursorModelSpec,
  resetCursorAgentCapabilities,
} from '../../src/lib/executors/cursor-probe.js'
import {
  loadPipelineConfig,
  resolvePersonaModel,
} from '../../src/lib/pipeline-config.js'
import { operationMutexPath, statePath } from '../../src/lib/state.js'
import { stageBySlug, loadWorkflow } from '../../src/lib/workflow.js'
import {
  createFixture,
  createTestTempDirectory,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
  writeFixtureCursorCatalog,
} from '../helpers.js'
import { submitAsSupervisor } from '../run-helpers.js'
import { claudeStubPath, checkpoint, withStub } from './delivery-helpers.js'
import type { CheckpointVariant } from './delivery-helpers.js'

function createdRunCheckpoint(name: 'delivery@created' | 'planning@created') {
  const created = checkpoint(name)

  return { root: created.root, run: created.state }
}

const MODEL_EVIDENCE_VARIANT: CheckpointVariant = {
  key: 'model-evidence',
  fixture: writeFixtureCursorCatalog,
  afterCreate: (root, runId) => {
    recordSupervisorModelEvidence(root, runId, 'GPT 5.6 Sol', 'metadata')
  },
}

const VERIFY_MODEL_EVIDENCE_VARIANT: CheckpointVariant = {
  ...MODEL_EVIDENCE_VARIANT,
  key: 'verify-model-evidence',
  afterCreate: (root, runId) => {
    recordSupervisorModelEvidence(root, runId, 'GPT 5.6 Sol', 'metadata')
    setRunStage(root, runId, 'verify', 'Verify the current workspace.')
  },
}

const CATALOGLESS_MODEL_EVIDENCE_VARIANT: CheckpointVariant = {
  key: 'catalogless-model-evidence',
  fixture: (root) => {
    rmSync(path.join(root, 'governance/registries/cursor_model_catalog.json'), {
      force: true,
    })
  },
  afterCreate: (root, runId) => {
    recordSupervisorModelEvidence(
      root,
      runId,
      'GPT 5.6 Sol',
      'Cursor session metadata',
    )
  },
}

function preparedRunCheckpoint(variant?: CheckpointVariant) {
  const prepared = checkpoint('delivery@implement-prepared', variant)

  assert.ok(prepared.invocation)

  return {
    root: prepared.root,
    run: prepared.state,
    invocation: prepared.invocation,
  }
}

function withFakeCursorAgent<T>(
  root: string,
  model: string | null,
  operation: () => T,
): T {
  const bin = path.join(root, 'fake-bin')
  const executable = path.join(bin, 'cursor-agent')
  const priorPath = process.env.PATH

  mkdirSync(bin, { recursive: true })
  writeFileSync(
    executable,
    model
      ? `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({
          type: 'system',
          subtype: 'init',
          model,
        })}'\n`
      : '#!/bin/sh\nexit 0\n',
  )
  chmodSync(executable, 0o755)
  process.env.PATH = `${bin}${path.delimiter}${priorPath ?? ''}`
  // The capability read is cached per process, so each installed fake CLI
  // must start from a clean read.
  resetCursorAgentCapabilities()

  try {
    return operation()
  } finally {
    process.env.PATH = priorPath
    resetCursorAgentCapabilities()
  }
}

/**
 * A cursor-agent that rejects unknown options the way the real one does.
 * `--mode` was removed from the CLI, and run 63310 genre-label lost every
 * worker model probe to `unknown option '--mode'`.
 */
function withStrictCursorAgent<T>(
  root: string,
  supportedFlags: string[],
  model: string,
  operation: () => T,
): T {
  const bin = path.join(root, 'strict-bin')
  const executable = path.join(bin, 'cursor-agent')
  const priorPath = process.env.PATH

  mkdirSync(bin, { recursive: true })
  writeFileSync(
    executable,
    [
      '#!/bin/sh',
      'if [ "$1" = "--help" ]; then',
      `  printf '%s\n' "Usage: cursor-agent${supportedFlags
        .map((flag) => ` ${flag}`)
        .join('')}"`,
      '  exit 0',
      'fi',
      'for arg in "$@"; do',
      '  case "$arg" in',
      '    --*)',
      `      case " ${supportedFlags.join(' ')} " in`,
      '        *" $arg "*) ;;',
      '        *)',
      '          echo "error: unknown option \'$arg\'" >&2',
      '          exit 1',
      '          ;;',
      '      esac',
      '      ;;',
      '  esac',
      'done',
      `printf '%s\n' '${JSON.stringify({
        type: 'system',
        subtype: 'init',
        model,
      })}'`,
      '',
    ].join('\n'),
  )
  chmodSync(executable, 0o755)
  process.env.PATH = `${bin}${path.delimiter}${priorPath ?? ''}`
  resetCursorAgentCapabilities()

  try {
    return operation()
  } finally {
    process.env.PATH = priorPath
    resetCursorAgentCapabilities()
  }
}

test('supervisor evidence activates future worker-card enforcement', () => {
  const { root: legacyRoot, run: legacyRun } =
    createdRunCheckpoint('delivery@created')
  const legacyInvocation = prepareInvocation(
    legacyRoot,
    legacyRun.run_id,
  ).invocation

  assert.ok(legacyInvocation)
  assert.equal(legacyInvocation.model_evidence_required, undefined)
  const legacyStage = stageBySlug(
    loadWorkflow(legacyRoot, 'delivery'),
    legacyInvocation.stage.slug,
  )

  writeJson(
    path.join(legacyRoot, legacyInvocation.output.path),
    makeOutput(legacyRoot, legacyInvocation, legacyStage),
  )
  writeCanonicalDelegation(legacyRoot, legacyInvocation)
  submitAsSupervisor(legacyRoot, legacyRun.run_id, legacyInvocation.output.path)
  recordSupervisorModelEvidence(
    legacyRoot,
    legacyRun.run_id,
    'GPT 5.6 Sol',
    'Cursor session metadata',
  )

  const laterLegacyInvocation = prepareInvocation(
    legacyRoot,
    legacyRun.run_id,
  ).invocation

  assert.ok(laterLegacyInvocation)
  assert.equal(laterLegacyInvocation.model_evidence_required, undefined)

  const { root, run } = createdRunCheckpoint('planning@created')
  const recorded = recordSupervisorModelEvidence(
    root,
    run.run_id,
    'GPT 5.6 Sol',
    'Cursor session metadata',
  )

  assert.equal(recorded.evidence.role, 'supervisor')
  assert.equal(recorded.evidence.result, 'recorded')
  assert.ok(recorded.evidence.evidence_path.endsWith('.json'))
  assert.deepEqual(recorded.advisories, [])
  assert.equal(getRunState(root, run.run_id).model_evidence?.length, 1)
  assert.equal(getRunState(root, run.run_id).advisories, undefined)

  const superseded = recordSupervisorModelEvidence(
    root,
    run.run_id,
    'Different Model',
    'Cursor session metadata',
  )

  assert.equal(superseded.evidence.effective_model, 'Different Model')
  assert.equal(superseded.advisories.length, 1)
  assert.equal(superseded.advisories[0]?.kind, 'model_evidence')
  assert.equal(superseded.advisories[0]?.source, 'supervisor_evidence')
  assert.match(
    superseded.advisories[0]?.message ?? '',
    /changed from 'GPT 5.6 Sol' to 'Different Model'/u,
  )

  const supersededState = getRunState(root, run.run_id)

  assert.equal(supersededState.model_evidence?.length, 1)
  assert.deepEqual(supersededState.advisories, superseded.advisories)
  assert.match(
    getRunStatus(root, run.run_id) as string,
    /## Advisories\n\n- supervisor_evidence: The supervisor model changed/u,
  )

  const prepared = prepareInvocation(root, run.run_id)
  const invocation = prepared.invocation

  assert.ok(invocation)
  assert.equal(invocation.model_evidence_required, true)

  const stage = stageBySlug(loadWorkflow(root, 'planning'), 'plan')

  writeJson(
    path.join(root, invocation.output.path),
    makeOutput(root, invocation, stage),
  )
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, run.run_id, invocation.output.path)

  assert.ok(
    submitted.state.stage_history.some(
      (item) => item.invocation_id === invocation.invocation_id,
    ),
  )
  assert.match(
    readFileSync(
      path.join(
        root,
        'runtime/logs/workflows',
        run.run_id,
        'agent/events.jsonl',
      ),
      'utf8',
    ),
    /"type":"model_evidence_advisory"/u,
  )

  // A marked invocation carries the labeled default its prepare recorded, so
  // the missing probe is no longer a gap the operator has to read past.
  const submittedState = getRunState(root, run.run_id)
  const workerRecord = submittedState.model_evidence?.find(
    (item) => item.invocation_id === invocation.invocation_id,
  )

  assert.equal(workerRecord?.result, 'default')
  assert.equal(workerRecord?.effective_model, invocation.stage.model)
  assert.deepEqual(submitted.advisories, [])
  assert.deepEqual(submittedState.advisories, superseded.advisories)
})

test('a bare model spec accepts any resolved Cursor variant', () => {
  const root = createFixture()

  writeFixtureCursorCatalog(root)

  // A bare spec has no catalog prediction, but a bracketed spec of the same
  // model does.
  assert.equal(expectedCursorModelForSpec(root, 'auto-smart'), null)
  assert.notEqual(expectedCursorModelForSpec(root, 'auto-smart[]'), null)

  const resolved = withFakeCursorAgent(root, 'Auto Balance', () =>
    probeCursorModelSpec('auto-smart'),
  )

  assert.equal(resolved.resolved, 'Auto Balance')
  assert.equal(resolved.error, undefined)

  // A bare spec is permissive about the variant, not about missing evidence.
  const missing = withFakeCursorAgent(root, null, () =>
    probeCursorModelSpec('auto-smart'),
  )

  assert.equal(missing.resolved, null)
  assert.match(missing.error ?? '', /no system\/init event/u)
})

test('worker probes persist matches, mismatches, and missing metadata alike', () => {
  const { root, run, invocation } = preparedRunCheckpoint(
    MODEL_EVIDENCE_VARIANT,
  )

  const expected = expectedCursorModelForSpec(root, invocation.stage.model)

  assert.ok(expected)

  const matching = withFakeCursorAgent(root, expected, () =>
    probeRunInvocationModel(root, run.run_id, invocation.invocation_id),
  )

  assert.equal(matching.result, 'match')
  assert.equal(matching.effective_model, expected)

  const mismatched = withFakeCursorAgent(root, 'Unexpected Model', () =>
    probeRunInvocationModel(root, run.run_id, invocation.invocation_id),
  )

  assert.equal(mismatched.result, 'mismatch')
  assert.match(String(mismatched.error), /run snapshot expects/u)

  const unavailable = withFakeCursorAgent(root, null, () =>
    probeRunInvocationModel(root, run.run_id, invocation.invocation_id),
  )

  assert.equal(unavailable.result, 'unavailable')
  assert.match(String(unavailable.error), /no system\/init event/u)

  // A repaired probe supersedes the failed evidence, so the marked card
  // submits once the recorded worker model matches the run snapshot.
  assert.equal(invocation.model_evidence_required, true)

  const repaired = withFakeCursorAgent(root, expected, () =>
    probeRunInvocationModel(root, run.run_id, invocation.invocation_id),
  )

  assert.equal(repaired.result, 'match')

  const stage = stageBySlug(
    loadWorkflow(root, 'delivery'),
    invocation.stage.slug,
  )

  writeJson(
    path.join(root, invocation.output.path),
    makeOutput(root, invocation, stage),
  )
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, run.run_id, invocation.output.path)

  assert.ok(
    submitted.state.stage_history.some(
      (item) => item.invocation_id === invocation.invocation_id,
    ),
  )
})

test('the run-scoped probe returns a pending marker and a detached child records the answer', () => {
  // Every worker launch paid for a live model round trip before the worker
  // started, and only submission reads the answer. The command now records
  // that a probe is in flight and returns; the child lands the evidence.
  const { root, run, invocation } = preparedRunCheckpoint(
    MODEL_EVIDENCE_VARIANT,
  )

  const expected = expectedCursorModelForSpec(root, invocation.stage.model)

  assert.ok(expected)

  const pending = recordPendingWorkerModelProbe(
    root,
    run.run_id,
    invocation.invocation_id,
  )

  // A marker is a claim that an answer is coming, never an answer.
  assert.equal(pending.result, 'pending')
  assert.equal(pending.effective_model, null)
  assert.equal(
    getRunState(root, run.run_id).model_evidence?.find(
      (item) => item.role === 'worker',
    )?.result,
    'pending',
  )

  // The detached child performs the live call and replaces the marker.
  withFakeCursorAgent(root, expected, () =>
    probeRunInvocationModel(root, run.run_id, invocation.invocation_id),
  )

  const landed = getRunState(root, run.run_id).model_evidence?.find(
    (item) => item.role === 'worker',
  )

  assert.equal(landed?.result, 'match')
  assert.equal(landed?.effective_model, expected)
})

test('preparing with an agent writes the labeled card and lands the probe', async () => {
  // One prepare replaces the three commands a supervisor ran by hand before
  // every Cursor worker launch: prepare, write the delegation file, probe.
  const { root, run } = createdRunCheckpoint('delivery@created')

  writeFixtureCursorCatalog(root)

  recordSupervisorModelEvidence(root, run.run_id, 'GPT 5.6 Sol', 'metadata')

  const stage = stageBySlug(
    loadWorkflow(root, 'delivery'),
    getRunState(root, run.run_id).current_stage ?? '',
  )
  const expected = expectedCursorModelForSpec(
    root,
    resolvePersonaModel(loadPipelineConfig(root).config, stage.persona),
  )

  assert.ok(expected)

  const prepared = withFakeCursorAgent(root, expected, () =>
    prepareInvocation(root, run.run_id, { agent: 'pan-coder' }),
  )
  const invocation = prepared.invocation
  const delegation = prepared.prepared_delegation

  assert.ok(invocation)
  assert.ok(delegation)
  assert.equal(delegation.skipped, null)
  assert.equal(
    delegation.artifact_path,
    invocation.delegation?.delegation_artifact_path,
  )

  const artifact = readFileSync(
    path.join(root, delegation.artifact_path ?? ''),
    'utf8',
  )
  const body = readFileSync(
    path.join(root, invocation.delegation?.delivery_prompt_path ?? ''),
    'utf8',
  )

  // The label the operator reads, above the card the harness rendered.
  assert.equal(artifact, `Agent: pan-coder\n\n${body}`)

  // The probe is in flight, not waited on.
  assert.equal(delegation.model_evidence?.result, 'pending')
  assert.equal(typeof delegation.probe_pid, 'number')

  const deadline = Date.now() + 30_000
  let landed = delegation.model_evidence

  while (Date.now() < deadline) {
    landed =
      getRunState(root, run.run_id).model_evidence?.find(
        (item) => item.role === 'worker',
      ) ?? landed

    if (landed && landed.result !== 'pending') {
      break
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  assert.equal(landed?.effective_model, expected)
  assert.notEqual(landed?.result, 'pending')

  // The landed record is what clears the submit advisory for this invocation.
  writeJson(
    path.join(root, invocation.output.path),
    makeOutput(root, invocation, stage),
  )

  const submitted = submitAsSupervisor(root, run.run_id, invocation.output.path)

  assert.equal(
    submitted.advisories.find((advisory) =>
      advisory.message.includes('no usable worker model evidence'),
    ),
    undefined,
  )
  assert.ok(
    submitted.state.stage_history.some(
      (item) => item.invocation_id === invocation.invocation_id,
    ),
  )
})

test('preparing without an agent, and an external-executor stage, are unchanged', () => {
  const { root, run } = createdRunCheckpoint('delivery@created')

  writeFixtureCursorCatalog(root)
  const prepared = prepareInvocation(root, run.run_id)
  const invocation = prepared.invocation

  assert.ok(invocation)
  assert.equal(prepared.prepared_delegation, undefined)
  assert.equal(
    existsSync(
      path.join(root, invocation.delegation?.delegation_artifact_path ?? ''),
    ),
    false,
    'the supervisor still writes the delegation artifact itself',
  )
  assert.equal(
    getRunState(root, run.run_id).model_evidence?.some(
      (item) => item.role === 'worker',
    ),
    undefined,
  )

  // An external-executor stage authors its own evidence at `pan delegate`,
  // so the option writes nothing and starts nothing there.
  const externalCreated = checkpoint('planning[claude-code:planner]@created')
  const externalRoot = externalCreated.root
  const external = externalCreated.state

  const stubPath = claudeStubPath(externalRoot)
  const externalPrepared = withStub(stubPath, null, () =>
    prepareInvocation(externalRoot, external.run_id, { agent: 'pan-planner' }),
  )

  assert.ok(externalPrepared.invocation)
  assert.equal(
    externalPrepared.invocation.stage.persona_executor,
    'claude-code',
  )

  const externalDelegation = externalPrepared.prepared_delegation

  assert.ok(externalDelegation)
  assert.equal(externalDelegation.artifact_path, null)
  assert.match(externalDelegation.skipped ?? '', /claude-code/u)
  assert.equal(externalDelegation.model_evidence, null)
  assert.equal(externalDelegation.probe_pid, null)
  assert.equal(
    getRunState(externalRoot, external.run_id).model_evidence?.some(
      (item) => item.role === 'worker',
    ),
    undefined,
  )
})

test('a probe that never lands settles into a labeled default at submit', () => {
  // The deferral must not invent a new failure mode. A marker with no answer
  // behind it says nothing the run snapshot does not already say, so
  // submission records the projected spec as a default instead of an
  // advisory the supervisor can only ignore.
  const { root, run, invocation } = preparedRunCheckpoint(
    MODEL_EVIDENCE_VARIANT,
  )
  recordPendingWorkerModelProbe(root, run.run_id, invocation.invocation_id)

  const stage = stageBySlug(
    loadWorkflow(root, 'delivery'),
    invocation.stage.slug,
  )

  writeJson(
    path.join(root, invocation.output.path),
    makeOutput(root, invocation, stage),
  )
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, run.run_id, invocation.output.path)
  const settled = getRunState(root, run.run_id).model_evidence?.find(
    (item) => item.role === 'worker',
  )

  assert.equal(settled?.result, 'default')
  assert.equal(settled?.effective_model, invocation.stage.model)
  assert.match(settled?.source ?? '', /the detached probe did not land/u)
  assert.deepEqual(submitted.advisories, [])
  assert.ok(
    submitted.state.stage_history.some(
      (item) => item.invocation_id === invocation.invocation_id,
    ),
  )
})

/** A marked run standing at the verify stage, which declares two workers. */
function verifyRun() {
  const { root, run, invocation } = preparedRunCheckpoint(
    VERIFY_MODEL_EVIDENCE_VARIANT,
  )
  assert.equal(invocation.stage.slug, 'verify')
  assert.deepEqual(
    (invocation.evidence_workers ?? []).map((worker) => worker.role),
    ['review', 'qa'],
  )

  return { root, runId: run.run_id, invocation }
}

// A verify stage runs three models and recorded one. The stage verdict then
// named a model that produced a third of the work behind it.
test('every declared worker carries its own evidence, defaulted then probed', () => {
  const { root, runId, invocation } = verifyRun()
  const recordsFor = (state = getRunState(root, runId)) =>
    (state.model_evidence ?? []).filter(
      (item) => item.invocation_id === invocation.invocation_id,
    )
  const prepared = recordsFor()

  // Prepare records what the run snapshot projects, for every declared spec.
  assert.deepEqual(
    prepared.map((item) => [item.role, item.worker_role ?? null, item.result]),
    [
      ['worker', null, 'default'],
      ['evidence_worker', 'review', 'default'],
      ['evidence_worker', 'qa', 'default'],
    ],
  )
  assert.deepEqual(
    prepared.map((item) => item.effective_model),
    prepared.map((item) => item.declared_spec),
  )
  assert.equal(
    new Set(prepared.map((item) => item.evidence_path)).size,
    3,
    'each role owns its own evidence file',
  )

  // A probe answers each declared role, not the stage persona alone.
  const probed = withFakeCursorAgent(root, 'Probed Variant', () =>
    probeRunInvocationModel(root, runId, invocation.invocation_id),
  )

  assert.deepEqual(
    probed.evidence_workers.map((item) => item.worker_role),
    ['review', 'qa'],
  )
  assert.deepEqual(
    recordsFor().map((item) => [
      item.worker_role ?? null,
      item.effective_model,
      item.source,
    ]),
    [
      [null, 'Probed Variant', 'cursor-agent system/init event'],
      ['review', 'Probed Variant', 'cursor-agent system/init event'],
      ['qa', 'Probed Variant', 'cursor-agent system/init event'],
    ],
  )
})

test('a worker with no evidence earns a named advisory; a defaulted one earns none', () => {
  const { root, runId, invocation } = verifyRun()
  const state = getRunState(root, runId)
  const runStatePath = statePath(root, runId)

  // The gap this criterion names: a declared worker whose evidence never
  // reached run state at all.
  writeJson(runStatePath, {
    ...state,
    model_evidence: (state.model_evidence ?? []).filter(
      (item) => item.worker_role !== 'review',
    ),
  })

  const stage = stageBySlug(loadWorkflow(root, 'delivery'), 'verify')

  writeJson(
    path.join(root, invocation.output.path),
    makeOutput(root, invocation, stage, 'success', getRunState(root, runId)),
  )
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)
  const gap = submitted.advisories.filter(
    (advisory) => advisory.kind === 'model_evidence',
  )

  assert.equal(gap.length, 1, 'only the unrecorded role is a gap')
  assert.match(gap[0]?.message ?? '', /evidence worker role 'review'/u)
  assert.ok(
    submitted.state.stage_history.some(
      (item) => item.invocation_id === invocation.invocation_id,
    ),
    'a missing probe never stops a submission',
  )
})

test('submission refuses evidence that contradicts the run snapshot', () => {
  const { root, run, invocation } = preparedRunCheckpoint(
    MODEL_EVIDENCE_VARIANT,
  )

  const probed = withFakeCursorAgent(root, 'Unexpected Model', () =>
    probeRunInvocationModel(root, run.run_id, invocation.invocation_id),
  )

  assert.equal(probed.result, 'mismatch')

  const stage = stageBySlug(
    loadWorkflow(root, 'delivery'),
    invocation.stage.slug,
  )

  writeJson(
    path.join(root, invocation.output.path),
    makeOutput(root, invocation, stage),
  )
  writeCanonicalDelegation(root, invocation)

  // The stage ran on a model this run did not declare, so its verdict is not
  // the verdict the run asked for.
  assert.throws(
    () => submitAsSupervisor(root, run.run_id, invocation.output.path),
    (error: unknown) =>
      error instanceof PanError && error.code === 'MODEL_EVIDENCE_MISMATCH',
  )

  // A repaired probe clears the refusal without an operator override.
  const expected = expectedCursorModelForSpec(root, invocation.stage.model)

  assert.ok(expected)
  withFakeCursorAgent(root, expected, () =>
    probeRunInvocationModel(root, run.run_id, invocation.invocation_id),
  )

  const submitted = submitAsSupervisor(root, run.run_id, invocation.output.path)

  assert.ok(
    submitted.state.stage_history.some(
      (item) => item.invocation_id === invocation.invocation_id,
    ),
  )
})

// `bin/install` omits the catalog from a target payload because the catalog
// covers one Cursor account.
test('a bracketed spec without an installed catalog records rather than blocks', () => {
  const { root, run, invocation } = preparedRunCheckpoint(
    CATALOGLESS_MODEL_EVIDENCE_VARIANT,
  )

  assert.ok(
    invocation.stage.model.includes('['),
    `expected a bracketed spec, got '${invocation.stage.model}'`,
  )

  const evidence = withFakeCursorAgent(root, 'GPT-5.6 Sol 272K High', () =>
    probeRunInvocationModel(root, run.run_id, invocation.invocation_id),
  )

  assert.equal(evidence.result, 'recorded')
  assert.equal(evidence.effective_model, 'GPT-5.6 Sol 272K High')
  assert.equal(evidence.error, undefined)

  const stage = stageBySlug(
    loadWorkflow(root, 'delivery'),
    invocation.stage.slug,
  )

  writeJson(
    path.join(root, invocation.output.path),
    makeOutput(root, invocation, stage),
  )
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, run.run_id, invocation.output.path)

  assert.ok(
    submitted.state.stage_history.some(
      (item) => item.invocation_id === invocation.invocation_id,
    ),
  )
  // An absent catalog is not a gap, so it earns no advisory.
  assert.doesNotMatch(
    readFileSync(
      path.join(
        root,
        'runtime/logs/workflows',
        run.run_id,
        'agent/events.jsonl',
      ),
      'utf8',
    ),
    /"type":"model_evidence_advisory"/u,
  )
})

// Run 63310 genre-label: every one of four worker probes failed with
// `unknown option '--mode'`, so every submission carried an unverified-model
// advisory. The probe hard-coded an option the installed CLI had dropped.
test('the probe adapts to the flags the installed cursor-agent accepts', () => {
  const root = createTestTempDirectory('strict-cursor-agent-')

  // Run 63310_Aug-30-0872: guarding only --mode moved the failure to
  // `unknown option '--trust'`. Every optional flag has to be asked for.
  assert.deepEqual(
    withStrictCursorAgent(
      root,
      ['--output-format', '--model'],
      'Current Variant',
      () => probeCursorModelSpec('example-model'),
    ),
    { resolved: 'Current Variant' },
  )

  // A CLI that still declares both keeps receiving both.
  assert.deepEqual(
    withStrictCursorAgent(
      root,
      ['--output-format', '--mode', '--trust', '--model'],
      'Legacy Variant',
      () => probeCursorModelSpec('example-model'),
    ),
    { resolved: 'Legacy Variant' },
  )

  // One flag present and the other gone is the shape a partial upgrade takes.
  assert.deepEqual(
    withStrictCursorAgent(
      root,
      ['--output-format', '--trust', '--model'],
      'Mixed Variant',
      () => probeCursorModelSpec('example-model'),
    ),
    { resolved: 'Mixed Variant' },
  )
})

// The away evaluator and every external stage run through the executor, not
// the probe. Run 63310_Aug-30-0872 lost the plan-gate away evaluation to the
// same rejected flag, so an operator-owned ratification became a supervisor
// stand-in.
test('the executor sends only the flags the installed cursor-agent declares', () => {
  const root = createTestTempDirectory('cursor-agent-argv-')
  const bin = path.join(root, 'argv-bin')
  const executable = path.join(bin, 'cursor-agent')
  const argvLog = path.join(root, 'argv.txt')

  mkdirSync(bin, { recursive: true })
  writeFileSync(
    executable,
    [
      '#!/bin/sh',
      'if [ "$1" = "--help" ]; then',
      '  printf "%s\\n" "Usage: cursor-agent --output-format --model"',
      '  exit 0',
      'fi',
      `printf '%s\\n' "$@" > ${argvLog}`,
      `printf '%s\\n' '${JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: 'Executor Variant',
      })}'`,
      '',
    ].join('\n'),
  )
  chmodSync(executable, 0o755)

  const priorBin = process.env.PANCREATOR_CURSOR_AGENT_BIN

  process.env.PANCREATOR_CURSOR_AGENT_BIN = executable
  resetCursorAgentCapabilities()

  try {
    runCursorAgentJson({
      prompt: 'probe',
      cwd: root,
      installationRoot: root,
      timeoutMs: 20_000,
    })

    const argv = readFileSync(argvLog, 'utf8')

    assert.ok(
      !argv.includes('--trust'),
      'an undeclared --trust MUST be dropped',
    )
    assert.ok(!argv.includes('--mode'), 'an undeclared --mode MUST be dropped')
    assert.ok(argv.includes('--output-format'))
  } finally {
    if (priorBin === undefined) {
      delete process.env.PANCREATOR_CURSOR_AGENT_BIN
    } else {
      process.env.PANCREATOR_CURSOR_AGENT_BIN = priorBin
    }
    resetCursorAgentCapabilities()
  }
})

test('the run mutex spans the evidence write, not the live probe', () => {
  const { root, run, invocation } = preparedRunCheckpoint(
    MODEL_EVIDENCE_VARIANT,
  )

  const expected = expectedCursorModelForSpec(root, invocation.stage.model)

  assert.ok(expected)

  const mutexPath = operationMutexPath(root, run.run_id)
  const observationPath = path.join(root, 'probe-observation.json')
  const concurrentTitle = 'Retitled while the probe ran'

  const bin = path.join(root, 'probe-bin')
  const helperPath = path.join(bin, 'observe.mjs')
  const executable = path.join(bin, 'cursor-agent')

  const priorPath = process.env.PATH

  mkdirSync(bin, { recursive: true })
  // The probe used to run inside the run mutex, which held the lock for the
  // whole two-minute call. The observer proves the lock is free and makes a
  // concurrent state write the probe's own write must not lose.
  writeFileSync(
    helperPath,
    [
      "import { existsSync, readFileSync, writeFileSync } from 'node:fs'",
      `const mutexPath = ${JSON.stringify(mutexPath)}`,
      `const statePath = ${JSON.stringify(statePath(root, run.run_id))}`,
      `const observationPath = ${JSON.stringify(observationPath)}`,
      'const held = existsSync(mutexPath)',
      "const state = JSON.parse(readFileSync(statePath, 'utf8'))",
      `state.title = ${JSON.stringify(concurrentTitle)}`,
      'writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\\n`)',
      'writeFileSync(observationPath, JSON.stringify({ held }))',
      '',
    ].join('\n'),
  )
  writeFileSync(
    executable,
    [
      '#!/bin/sh',
      `node ${JSON.stringify(helperPath)} || exit 1`,
      `printf '%s\\n' '${JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: expected,
      })}'`,
      '',
    ].join('\n'),
  )
  chmodSync(executable, 0o755)
  process.env.PATH = `${bin}${path.delimiter}${priorPath ?? ''}`
  resetCursorAgentCapabilities()

  try {
    const evidence = probeRunInvocationModel(
      root,
      run.run_id,
      invocation.invocation_id,
    )

    assert.equal(evidence.result, 'match')

    const observed = JSON.parse(readFileSync(observationPath, 'utf8')) as {
      held: boolean
    }

    assert.equal(observed.held, false)

    // The second hold re-reads the state, so the concurrent write survives
    // beside the evidence the probe records.
    const state = getRunState(root, run.run_id)

    assert.equal(state.title, concurrentTitle)
    assert.equal(
      state.model_evidence?.some(
        (entry) => entry.invocation_id === invocation.invocation_id,
      ),
      true,
    )
  } finally {
    process.env.PATH = priorPath
    resetCursorAgentCapabilities()
  }
})

test('a lifecycle command succeeds while a probe is in its live call', async () => {
  const { root, run, invocation } = preparedRunCheckpoint(
    MODEL_EVIDENCE_VARIANT,
  )

  const expected = expectedCursorModelForSpec(root, invocation.stage.model)

  assert.ok(expected)

  const bin = path.join(root, 'window-bin')
  const barrier = path.join(root, 'probe-window')
  const inCall = path.join(barrier, 'in-call')
  const release = path.join(barrier, 'release')

  mkdirSync(bin, { recursive: true })
  mkdirSync(barrier, { recursive: true })
  // The live call is the whole point: the lock used to span it, so every
  // other command against the run failed for the length of the probe.
  writeFileSync(
    path.join(bin, 'cursor-agent'),
    [
      '#!/bin/sh',
      'if [ "$1" = "--help" ]; then',
      '  printf "%s\\n" "Usage: cursor-agent --output-format --model"',
      '  exit 0',
      'fi',
      `: > ${JSON.stringify(inCall)}`,
      'waited=0',
      `while [ ! -f ${JSON.stringify(release)} ] && [ "$waited" -lt 300 ]; do`,
      '  sleep 0.1',
      '  waited=$((waited + 1))',
      'done',
      `printf '%s\\n' '${JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: expected,
      })}'`,
      '',
    ].join('\n'),
  )
  chmodSync(path.join(bin, 'cursor-agent'), 0o755)

  const childPath = path.join(root, 'window-probe.mjs')

  writeFileSync(
    childPath,
    [
      `import { probeRunInvocationModel } from ${JSON.stringify(
        pathToFileURL(
          path.join(process.cwd(), 'dist', 'src', 'lib', 'engine.js'),
        ).href,
      )}`,
      '',
      'probeRunInvocationModel(',
      `  ${JSON.stringify(root)},`,
      `  ${JSON.stringify(run.run_id)},`,
      `  ${JSON.stringify(invocation.invocation_id)},`,
      ')',
      '',
    ].join('\n'),
  )

  const probed = new Promise<void>((resolve, reject) => {
    execFile(
      process.execPath,
      [childPath],
      {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
        },
        timeout: 120_000,
      },
      (error) => (error ? reject(error) : resolve()),
    )
  })

  for (let waited = 0; waited < 300 && !existsSync(inCall); waited += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  assert.equal(existsSync(inCall), true, 'the probe never reached its call')

  const paused = pauseRun(root, run.run_id, 'Paused inside the probe window')

  assert.equal(paused.status, 'paused')
  assert.equal(paused.pause_reason, 'Paused inside the probe window')

  writeFileSync(release, '')
  await probed

  const evidence = getRunState(root, run.run_id).model_evidence?.find(
    (entry) => entry.invocation_id === invocation.invocation_id,
  )

  // The pause must not cost the probe its answer either.
  assert.equal(evidence?.result, 'match')
  assert.equal(getRunState(root, run.run_id).pause_reason, paused.pause_reason)
})

test('two concurrent probes serialize their evidence writes', async () => {
  const { root, run, invocation } = preparedRunCheckpoint(
    MODEL_EVIDENCE_VARIANT,
  )

  const expected = expectedCursorModelForSpec(root, invocation.stage.model)

  assert.ok(expected)

  const bin = path.join(root, 'concurrent-bin')
  const barrier = path.join(root, 'probe-barrier')
  const executable = path.join(bin, 'cursor-agent')
  const childPath = path.join(root, 'concurrent-probe.mjs')

  mkdirSync(bin, { recursive: true })
  mkdirSync(barrier, { recursive: true })
  // Both probes have to be inside the live call together, or they never
  // contend for the hold that records the answer.
  writeFileSync(
    executable,
    [
      '#!/bin/sh',
      'if [ "$1" = "--help" ]; then',
      '  printf "%s\\n" "Usage: cursor-agent --output-format --model"',
      '  exit 0',
      'fi',
      `: > ${JSON.stringify(barrier)}/$$`,
      'waited=0',
      `while [ "$(ls ${JSON.stringify(barrier)} | wc -l)" -lt 2 ] &&` +
        ' [ "$waited" -lt 100 ]; do',
      '  sleep 0.1',
      '  waited=$((waited + 1))',
      'done',
      `printf '%s\\n' '${JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: expected,
      })}'`,
      '',
    ].join('\n'),
  )
  chmodSync(executable, 0o755)
  writeFileSync(
    childPath,
    [
      `import { probeRunInvocationModel } from ${JSON.stringify(
        pathToFileURL(
          path.join(process.cwd(), 'dist', 'src', 'lib', 'engine.js'),
        ).href,
      )}`,
      '',
      'try {',
      '  const evidence = probeRunInvocationModel(',
      `    ${JSON.stringify(root)},`,
      `    ${JSON.stringify(run.run_id)},`,
      `    ${JSON.stringify(invocation.invocation_id)},`,
      '  )',
      '',
      '  process.stdout.write(',
      '    JSON.stringify({ ok: true, result: evidence.result }),',
      '  )',
      '} catch (error) {',
      '  process.stdout.write(',
      '    JSON.stringify({',
      '      ok: false,',
      '      code: error?.code ?? null,',
      '      message: String(error?.message ?? error),',
      '    }),',
      '  )',
      '}',
      '',
    ].join('\n'),
  )

  const probe = async (): Promise<{
    ok: boolean
    result?: string
    code?: string | null
    message?: string
  }> =>
    new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        [childPath],
        {
          cwd: root,
          env: {
            ...process.env,
            PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
          },
          timeout: 120_000,
        },
        (error, stdout) => {
          if (error) {
            reject(error)

            return
          }

          resolve(
            JSON.parse(stdout) as {
              ok: boolean
              result?: string
              code?: string | null
            },
          )
        },
      )
    })

  const [first, second] = await Promise.all([probe(), probe()])

  assert.deepEqual(
    [first, second].map((outcome) => ({
      ok: outcome.ok,
      result: outcome.result ?? outcome.code,
    })),
    [
      { ok: true, result: 'match' },
      { ok: true, result: 'match' },
    ],
  )

  const events = readFileSync(
    path.join(root, 'runtime/logs/workflows', run.run_id, 'agent/events.jsonl'),
    'utf8',
  )
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter(
      (event) =>
        event.type === 'model_evidence_recorded' &&
        event.invocation_id === invocation.invocation_id &&
        event.result === 'match',
    )

  // A lost write is the failure this criterion names: the queued probe must
  // record its own answer rather than die on the contended hold.
  assert.equal(events.length, 2)

  const state = getRunState(root, run.run_id)

  assert.equal(
    state.model_evidence?.filter(
      (entry) => entry.invocation_id === invocation.invocation_id,
    ).length,
    1,
  )
  assert.equal(state.title, 'Checkpoint fixture run')
})
