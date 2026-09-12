import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { getRunState, prepareInvocation } from '../../src/lib/engine.js'
import { referenceContentSha256 } from '../../src/lib/io.js'
import type { RunModelEvidence } from '../../src/lib/types.js'
import {
  attestRunCard,
  createFixture,
  createRun,
  writeFixtureCursorCatalog,
} from '../helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

test('workflow help does not create a run named --help', () => {
  const root = createFixture()

  execFileSync(process.execPath, [CLI, 'prepare', '--help'], {
    cwd: root,
    encoding: 'utf8',
  })

  assert.equal(
    existsSync(path.join(root, 'runtime/logs/workflows/--help')),
    false,
  )
})

test('CLI artifact options persist run-wide and stage selections', () => {
  const root = createFixture()
  const runWide = JSON.parse(
    execFileSync(
      process.execPath,
      [
        CLI,
        'init',
        '--workflow',
        'preflight',
        '--request',
        'request.md',
        '--operator-artifacts',
        '--json',
      ],
      { cwd: root, encoding: 'utf8' },
    ),
  ) as {
    operator_artifacts: {
      mode: string
      requested_stages: string[]
    }
  }

  assert.deepEqual(runWide.operator_artifacts, {
    mode: 'requested',
    requested_stages: [],
  })

  const stageOnly = JSON.parse(
    execFileSync(
      process.execPath,
      [
        CLI,
        'init',
        '--workflow',
        'preflight',
        '--request',
        'request.md',
        '--json',
      ],
      { cwd: root, encoding: 'utf8' },
    ),
  ) as { run_id: string; state_path: string }

  // The CLI drove init, so the test carries the supervisor's attestation duty
  // before prepare, exactly as a supervisor session does.
  attestRunCard(root, stageOnly.run_id)

  execFileSync(
    process.execPath,
    [CLI, 'prepare', stageOnly.run_id, '--operator-artifacts', '--json'],
    { cwd: root, encoding: 'utf8' },
  )

  const state = JSON.parse(
    readFileSync(path.join(root, stageOnly.state_path), 'utf8'),
  ) as {
    operator_artifacts: {
      mode: string
      requested_stages: string[]
    }
  }

  assert.deepEqual(state.operator_artifacts, {
    mode: 'suppressed',
    requested_stages: ['inspect'],
  })
})

test('pan init defaults to the planning workflow and routes on approval', () => {
  const root = createFixture()
  const init = (...args: string[]): Record<string, unknown> =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [CLI, 'init', '--request', 'request.md', ...args, '--json'],
        { cwd: root, encoding: 'utf8' },
      ),
    ) as Record<string, unknown>

  // An operator who names no workflow starts a planning run whose approval
  // routes into delivery; nothing about the request text is inspected.
  const routed = init()

  assert.equal(routed.workflow, 'planning')
  assert.equal(routed.autostart_delivery, true)

  // `--autostart` is the explicit spelling of that default.
  assert.equal(init('--autostart').autostart_delivery, true)

  // `--no-autostart` stops the run at the ratified plan.
  const stopped = init('--no-autostart')

  assert.equal(stopped.workflow, 'planning')
  assert.equal(stopped.autostart_delivery, false)

  // The explicit escape hatch still creates a delivery run.
  const delivery = init('--workflow', 'delivery')

  assert.equal(delivery.workflow, 'delivery')
  assert.equal(delivery.autostart_delivery, false)

  // The two spellings cannot be combined.
  assert.throws(
    () => init('--autostart', '--no-autostart'),
    (error: unknown) =>
      /INVALID_ARGUMENT/u.test(String((error as { stderr?: unknown }).stderr)),
  )
})

test('governance card --dimensions reaches the review selection and refuses a bad one', () => {
  const root = createFixture()
  const card = (dimensions: string) =>
    spawnSync(
      process.execPath,
      [
        CLI,
        'governance',
        'card',
        '--mode',
        'review',
        '--request',
        'request.md',
        '--dimensions',
        dimensions,
        '--json',
      ],
      { cwd: root, encoding: 'utf8' },
    )

  // The flag travels from argv to the resolved selection the card reports.
  const selected = card('security')

  assert.equal(selected.status, 0, selected.stderr)
  assert.deepEqual(
    (
      JSON.parse(selected.stdout) as {
        review_dimensions: { selected: string[] }
      }
    ).review_dimensions.selected,
    ['security'],
  )

  const unknown = card('security,maintainability')

  assert.notEqual(unknown.status, 0)
  assert.match(unknown.stderr, /UNKNOWN_REVIEW_DIMENSION/u)

  // A present flag that names nothing is refused, not read as "no selection"
  // and so as the full default lineup.
  const empty = card(',')

  assert.notEqual(empty.status, 0)
  assert.match(empty.stderr, /INVALID_ARGUMENT/u)
  assert.match(
    empty.stderr,
    /security/u,
    'the refusal lists the accepted slugs',
  )

  // `--dimensions security, performance` shell-splits to `security,`; the
  // dangling comma is refused rather than read as the single slug it names.
  for (const dangling of ['security,', 'security,,performance']) {
    const refused = card(dangling)

    assert.notEqual(refused.status, 0, dangling)
    assert.match(refused.stderr, /INVALID_ARGUMENT/u)
    assert.match(refused.stderr, /security/u)
  }
})

test('context digest prints the audited content digest of a file inside the root', () => {
  const root = createFixture()
  const digest = (...args: string[]) =>
    spawnSync(process.execPath, [CLI, 'context', 'digest', ...args], {
      cwd: root,
      encoding: 'utf8',
    })
  const expected = referenceContentSha256(
    readFileSync(path.join(root, 'request.md'), 'utf8'),
  )

  // The plain form prints only the digest, the JSON form names its basis.
  const plain = digest('request.md')

  assert.equal(plain.status, 0, plain.stderr)
  assert.equal(plain.stdout.trim(), expected)

  const json = digest('request.md', '--json')

  assert.equal(json.status, 0, json.stderr)
  assert.deepEqual(JSON.parse(json.stdout), {
    source_path: 'request.md',
    content_sha256: expected,
    basis:
      'sha256 of the text after leading and trailing whitespace is trimmed',
  })

  // A path outside the root is refused, and so is a file that does not exist.
  const outside = digest('../outside.md')

  assert.notEqual(outside.status, 0)
  assert.match(outside.stderr, /PATH_ESCAPE/u)

  const missing = digest('missing.md')

  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /CONTEXT_REFERENCE_NOT_FOUND/u)

  // A flag in the positional slot is a missing path, not a file named `--json`.
  const flagOnly = digest('--json')

  assert.notEqual(flagOnly.status, 0)
  assert.match(flagOnly.stderr, /INVALID_ARGUMENT/u)
  assert.match(flagOnly.stderr, /repo-relative-file is required/u)
  assert.doesNotMatch(flagOnly.stderr, /CONTEXT_REFERENCE_NOT_FOUND/u)

  // A directory is not a file to digest; the refusal names the repo-relative
  // path and never the absolute root.
  const directory = digest('runtime')

  assert.notEqual(directory.status, 0)
  assert.match(directory.stderr, /CONTEXT_REFERENCE_NOT_FOUND/u)
  assert.match(directory.stderr, /File does not exist: runtime/u)
  assert.doesNotMatch(directory.stderr, /EISDIR|READ_FAILED/u)
  assert.ok(!directory.stderr.includes(root), directory.stderr)
})

test('the run-scoped model probe returns without waiting for the model', async () => {
  // Every Cursor worker launch ran this command first and blocked on a live
  // model round trip. Only submission reads the answer, so the command
  // records the in-flight marker, detaches the call, and returns.
  const root = createFixture()
  const agentDirectory = path.join(root, 'slow-bin')
  const agentDelaySeconds = 5

  writeFixtureCursorCatalog(root)
  mkdirSync(agentDirectory, { recursive: true })
  writeFileSync(
    path.join(agentDirectory, 'cursor-agent'),
    [
      '#!/bin/sh',
      'cat >/dev/null',
      `sleep ${agentDelaySeconds}`,
      `printf '%s\\n' '${JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: 'Detached Variant',
      })}'`,
      '',
    ].join('\n'),
  )
  chmodSync(path.join(agentDirectory, 'cursor-agent'), 0o755)

  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Detached probe CLI run',
  })
  const invocation = prepareInvocation(root, run.run_id).invocation

  assert.ok(invocation)

  const startedAt = Date.now()
  const probe = spawnSync(
    process.execPath,
    [
      CLI,
      'models',
      '--probe',
      '--run',
      run.run_id,
      '--invocation',
      invocation.invocation_id,
      '--json',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${agentDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
      },
    },
  )
  const elapsed = Date.now() - startedAt

  assert.equal(probe.status, 0, probe.stderr)

  const printed = JSON.parse(probe.stdout) as Record<string, unknown>

  assert.equal(printed.result, 'pending')
  assert.equal(printed.effective_model, null)
  assert.equal(typeof printed.probe_pid, 'number')
  assert.ok(
    elapsed < agentDelaySeconds * 1_000,
    `the command waited ${elapsed}ms for the model`,
  )

  // The detached child lands the answer on the run, replacing the marker.
  const deadline = Date.now() + 30_000
  let landed: RunModelEvidence | undefined

  while (Date.now() < deadline) {
    landed = getRunState(root, run.run_id).model_evidence?.find(
      (item) => item.role === 'worker',
    )

    if (landed && landed.result !== 'pending') {
      break
    }

    await delay(100)
  }

  assert.equal(landed?.effective_model, 'Detached Variant')
  assert.notEqual(landed?.result, 'pending')
})

test('a cohort subcommand refuses a flag in its cohort-id slot as a missing positional', () => {
  const root = createFixture()

  // `pan cohort release --json` names no cohort: the flag is not a cohort id
  // to validate, it is the absence of one.
  for (const sub of ['status', 'start', 'integrate', 'release', 'clean']) {
    const flagOnly = spawnSync(
      process.execPath,
      [CLI, 'cohort', sub, '--json'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )

    assert.notEqual(flagOnly.status, 0, sub)
    assert.match(flagOnly.stderr, /INVALID_ARGUMENT/u, sub)
    assert.match(flagOnly.stderr, /cohort-id is required\./u, sub)
    assert.doesNotMatch(flagOnly.stderr, /INVALID_COHORT_ID/u, sub)
  }

  const abandon = spawnSync(
    process.execPath,
    [CLI, 'cohort', 'abandon', '--chunk', 'alpha', '--note', 'why', '--json'],
    { cwd: root, encoding: 'utf8' },
  )

  assert.notEqual(abandon.status, 0)
  assert.match(abandon.stderr, /INVALID_ARGUMENT/u)
  assert.match(abandon.stderr, /cohort-id is required\./u)
})
