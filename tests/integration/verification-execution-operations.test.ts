import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import {
  verificationExecutionOperationErrors,
  verificationExecutionRequests,
} from '../../src/lib/engine/verification-execution.js'
import { writeJsonAtomic } from '../../src/lib/io.js'
import { validatePlanTrace } from '../../src/lib/validators/stage/plan-trace.js'
import { createFixture, sharedFixture } from '../fixture-template.js'
import { operation } from './verification-execution-helpers.js'

test('definitions reject shell text, profiles, unbounded and escaping declarations', () => {
  const root = sharedFixture()
  const valid = operation('safe', 'console.log("raw")')
  assert.deepEqual(verificationExecutionOperationErrors(root, valid), [])
  for (const invalid of [
    'touch source.ts',
    { ...valid, argv: ['bash', '-c', 'touch source.ts'] },
    { ...valid, argv: ['env', 'sh', '-c', 'touch source.ts'] },
    { ...valid, argv: ['pan', 'repository-check', 'fast'] },
    { ...valid, argv: ['pnpm', '-s', 'test'] },
    { ...valid, timeout_ms: 0 },
    { ...valid, timeout_ms: 120001 },
    { ...valid, cwd: '../outside' },
    { ...valid, evidence_paths: ['/tmp/outside'] },
    { ...valid, shell: true },
    { ...valid, finding: 42 },
  ]) {
    assert.ok(
      verificationExecutionOperationErrors(root, invalid).length > 0,
      JSON.stringify(invalid),
    )
  }
  assert.deepEqual(
    verificationExecutionRequests([{ id: 'safe', reason: 'spot check' }]),
    [{ id: 'safe', reason: 'spot check' }],
  )
  assert.throws(
    () =>
      verificationExecutionRequests([
        { id: 'safe', reason: 'execute', argv: ['sh', '-c', 'false'] },
      ]),
    /only authorized/u,
  )
  assert.throws(
    () => verificationExecutionRequests('echo pass'),
    /only authorized/u,
  )
})

test('configured executable paths cannot disguise profiles and arguments retain boundaries', () => {
  const root = createFixture()
  writeJsonAtomic(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    setup: [],
    profiles: {
      impacted: { commands: ['./bin/pan tests impacted'] },
      integration: {
        commands: [
          './bin/pan tests impacted --lane integration --changed pan-dev',
        ],
      },
      smoke: { commands: ['./bin/install --smoke'] },
      fast: { commands: ['./checks/fast'] },
      quoted: { commands: ['"./checks/quoted runner" --case "all cases"'] },
    },
  })

  for (const argv of [
    ['./bin/pan', 'tests', 'impacted'],
    [
      path.join(root, 'bin/pan'),
      'tests',
      'impacted',
      '--lane',
      'integration',
      '--changed',
      'pan-dev',
    ],
    ['./bin/install', '--smoke'],
    [path.join(root, 'bin/install'), '--smoke'],
    ['./checks/fast'],
    [path.join(root, 'checks/fast')],
    ['./checks/quoted runner', '--case', 'all cases'],
  ]) {
    assert.ok(
      verificationExecutionOperationErrors(
        root,
        operation('path-profile', '', { argv }),
      ).some((error) => /profiles cannot substitute/u.test(error)),
      JSON.stringify(argv),
    )
  }

  const workspace = createFixture()
  assert.ok(
    verificationExecutionOperationErrors(
      root,
      operation('detached-root', '', {
        argv: [path.join(workspace, 'bin/pan'), 'tests', 'impacted'],
      }),
      workspace,
    ).some((error) => /profiles cannot substitute/u.test(error)),
  )

  for (const argv of [
    ['./bin/pan', 'tests impacted'],
    ['./checks/faster'],
    ['./bin/install', '--target', 'runtime/focused'],
    ['./bin/pan', 'tests', 'focused'],
    ['./checks/quoted runner', '--case', 'all', 'cases'],
  ]) {
    assert.deepEqual(
      verificationExecutionOperationErrors(
        root,
        operation('focused', '', { argv }),
      ),
      [],
    )
  }

  assert.ok(
    verificationExecutionOperationErrors(
      root,
      operation('relative-cwd', '', {
        argv: ['../bin/pan', 'tests', 'impacted'],
        cwd: 'checks',
      }),
    ).some((error) => /profiles cannot substitute/u.test(error)),
  )

  assert.deepEqual(
    verificationExecutionOperationErrors(
      root,
      operation('distinct-cwd', '', {
        argv: ['./checks/fast'],
        cwd: 'runtime',
      }),
    ),
    [],
  )
})

test('package-manager aliases cannot disguise a configured profile', () => {
  const root = createFixture()
  writeJsonAtomic(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    setup: [],
    profiles: { fast: { commands: ['npm test'] } },
  })

  for (const argv of [
    ['npm', 'run', 'test'],
    ['pnpm', 'test'],
    ['yarn', 'run', 'test'],
    ['bun', 'test'],
  ]) {
    assert.ok(
      verificationExecutionOperationErrors(
        root,
        operation('profile-alias', '', { argv }),
      ).some((error) => /profiles cannot substitute/u.test(error)),
      JSON.stringify(argv),
    )
  }
})

test('plan validation accepts optional structured declarations and refuses malformed or duplicate definitions', () => {
  const root = sharedFixture()
  const targetPath = 'runtime/execution-plan-validation.json'
  const check = (execution: unknown) => {
    writeJsonAtomic(path.join(root, targetPath), {
      data: { test_plan: [{ id: 'TP-01', criterion: 'AC-01', execution }] },
    })
    return validatePlanTrace({
      root,
      targetPath,
      requirement: {
        policy_id: 'PLAN-001',
        requirement_id: 'plan-trace',
        registry_id: 'PLAN-TRACE-VALIDATE-001',
        arguments: {},
      },
    }).issues.filter((issue) => issue.code.startsWith('plan.execution'))
  }
  const valid = operation('planned', "console.log('focused')")
  assert.deepEqual(check({ operations: [valid] }), [])
  assert.ok(
    check({ operations: [{ ...valid, required: false }] }).some(
      (issue) => issue.code === 'plan.execution_required',
    ),
  )
  assert.deepEqual(
    check({
      operations: [valid, { ...valid, id: 'optional-extra', required: false }],
    }),
    [],
  )
  assert.ok(
    check({ operations: [] }).some(
      (issue) => issue.code === 'plan.execution_shape',
    ),
  )
  assert.ok(
    check({ operations: [valid, valid] }).some((issue) =>
      /Duplicate/u.test(issue.message),
    ),
  )
  assert.ok(
    check({ operations: [{ ...valid, criterion: 'AC-OTHER' }] }).some((issue) =>
      /criterion/u.test(issue.message),
    ),
  )
})
