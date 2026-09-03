import assert from 'node:assert/strict'
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  getRunState,
  getRunStatus,
  prepareInvocation,
  probeRunInvocationModel,
  recordSupervisorModelEvidence,
} from '../../src/lib/engine.js'
import { runCursorAgentJson } from '../../src/lib/executors/cursor-agent.js'
import {
  expectedCursorModelForSpec,
  probeCursorModelSpec,
  resetCursorAgentCapabilities,
} from '../../src/lib/executors/cursor-probe.js'
import { stageBySlug, loadWorkflow } from '../../src/lib/workflow.js'
import {
  createFixture,
  createRun,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
  submitAsSupervisor,
  writeFixtureCursorCatalog,
} from '../helpers.js'

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
  const legacyRoot = createFixture()
  const legacyRun = createRun(legacyRoot, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Markerless compatibility run',
  })
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

  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'planning',
    requestPath: 'request.md',
    title: 'Model evidence run',
  })
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

  const workerGap = submitted.advisories.find((advisory) =>
    advisory.message.includes('no usable worker model evidence'),
  )

  assert.ok(workerGap)
  assert.equal(workerGap.kind, 'model_evidence')
  assert.equal(workerGap.source, 'submit')
  assert.equal(workerGap.stage, 'plan')
  assert.equal(workerGap.invocation_id, invocation.invocation_id)

  const submittedState = getRunState(root, run.run_id)

  assert.deepEqual(submittedState.advisories, [
    ...superseded.advisories,
    ...submitted.advisories,
  ])
  assert.match(
    getRunStatus(root, run.run_id) as string,
    /- plan \(submit\): Invocation '.*' records no usable worker/u,
  )
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
  const root = createFixture()

  writeFixtureCursorCatalog(root)

  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Worker probe run',
  })

  recordSupervisorModelEvidence(
    root,
    run.run_id,
    'GPT 5.6 Sol',
    'Cursor session metadata',
  )

  const invocation = prepareInvocation(root, run.run_id).invocation

  assert.ok(invocation)

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

// `bin/install` omits the catalog from a target payload because the catalog
// covers one Cursor account.
test('a bracketed spec without an installed catalog records rather than blocks', () => {
  const root = createFixture()

  rmSync(path.join(root, 'governance/registries/cursor_model_catalog.json'), {
    force: true,
  })

  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Catalog-less run',
  })

  recordSupervisorModelEvidence(
    root,
    run.run_id,
    'GPT 5.6 Sol',
    'Cursor session metadata',
  )

  const invocation = prepareInvocation(root, run.run_id).invocation

  assert.ok(invocation)
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
  const root = createFixture()

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
  const root = createFixture()
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
    runCursorAgentJson({ prompt: 'probe', cwd: root, timeoutMs: 20_000 })

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
