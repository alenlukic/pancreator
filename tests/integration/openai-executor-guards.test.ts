import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  delegateInvocation,
  createRun as engineCreateRun,
  prepareInvocation,
} from '../../src/lib/engine.js'
import { createFixture } from '../helpers.js'
import { createRun } from '../run-helpers.js'
import {
  installOpenAiFixture,
  OPENAI_SPEC,
  routePersonas,
} from './delivery-helpers.js'
import { OPENAI_SENTINEL_KEY, withFakeOpenAi } from './fake-openai-endpoint.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

function pan(
  root: string,
  args: string[],
  env: Record<string, string | undefined> = {},
): { status: number; stdout: string; stderr: string } {
  try {
    return {
      status: 0,
      stdout: execFileSync(process.execPath, [CLI, ...args], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, PANCREATOR_ROOT: root, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      stderr: '',
    }
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

/** Run a block with no OpenAI credential reachable from the environment. */
function withoutOpenAiKey<T>(block: () => T): T {
  const saved = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    PANCREATOR_OPENAI_API_KEY: process.env.PANCREATOR_OPENAI_API_KEY,
  }

  delete process.env.OPENAI_API_KEY
  delete process.env.PANCREATOR_OPENAI_API_KEY

  try {
    return block()
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
  }
}

test('a run whose workflow uses openai refuses to start without a credential', () => {
  const root = createFixture()

  installOpenAiFixture(root, ['planner'])

  const failure = withoutOpenAiKey(() => {
    try {
      engineCreateRun(root, {
        workflowSlug: 'planning',
        requestPath: 'request.md',
      })
    } catch (error) {
      return error as Error
    }

    return undefined
  })

  assert.ok(failure, 'the run must refuse to start')
  // The refusal names the executor, the missing credential, and the fix.
  assert.match(failure.message, /preflight failed for 'openai'/u)
  assert.match(failure.message, /OPENAI_API_KEY/u)
  assert.match(failure.message, /\.env/u)

  // A workflow with no openai persona is unaffected by the missing key.
  const untouched = createFixture()

  withoutOpenAiKey(() =>
    createRun(untouched, {
      workflowSlug: 'planning',
      requestPath: 'request.md',
    }),
  )
})

test('a delegate-time credential loss pauses the run for the operator', () => {
  const root = createFixture()

  installOpenAiFixture(root, ['planner'])

  // The run starts with a credential and loses it before delegating, which is
  // what a rotated or unexported key looks like mid-run.
  const runId = withFakeOpenAi('http://127.0.0.1:1/unused', () => {
    const created = createRun(root, {
      workflowSlug: 'planning',
      requestPath: 'request.md',
    }).run_id

    assert.ok(prepareInvocation(root, created).invocation)

    return created
  })
  const delegated = withoutOpenAiKey(() => delegateInvocation(root, runId))

  // The harness stops visibly rather than substituting a Cursor subagent,
  // which would falsify the model the card names.
  assert.equal(delegated.execution, null)
  assert.equal(delegated.state.status, 'paused')
  assert.equal(delegated.state.pending_action.type, 'operator_decision')
  assert.match(delegated.state.pause_reason ?? '', /preflight failed/u)
  assert.match(delegated.state.pause_reason ?? '', /OPENAI_API_KEY/u)
  assert.match(delegated.state.pause_reason ?? '', /falsify/u)
})

test('pan delegate still refuses a cursor stage after openai is registered', () => {
  const root = createFixture()
  const runId = createRun(root, {
    workflowSlug: 'planning',
    requestPath: 'request.md',
  }).run_id

  assert.ok(prepareInvocation(root, runId).invocation)

  const failure = (() => {
    try {
      delegateInvocation(root, runId)
    } catch (error) {
      return error as Error & { code?: string }
    }

    return undefined
  })()

  assert.ok(failure, 'a cursor persona belongs to the supervisor')
  assert.equal(failure.code, 'EXECUTOR_UNSUPPORTED')
})

test('pan doctor reports openai readiness only when a mapping needs it', () => {
  const root = createFixture()

  // No openai mapping: doctor stays silent about the executor but still lists
  // it as a supported integration.
  const quiet = pan(root, ['doctor', '--json'])
  const quietReport = JSON.parse(quiet.stdout) as {
    openai?: unknown
    constraints: { supported_integrations: string[] }
  }

  assert.equal(quietReport.openai, undefined)
  assert.ok(
    quietReport.constraints.supported_integrations.some((entry) =>
      entry.includes('OpenAI Responses API'),
    ),
  )

  installOpenAiFixture(root, ['planner'])

  const ready = pan(root, ['doctor', '--json'], {
    OPENAI_API_KEY: OPENAI_SENTINEL_KEY,
  })
  const readyReport = JSON.parse(ready.stdout) as {
    openai?: {
      ok: boolean
      key_source?: string
      runtime?: { ok: boolean }
      error?: string
    }
  }

  assert.equal(readyReport.openai?.ok, true)
  assert.equal(readyReport.openai?.runtime?.ok, true)
  assert.equal(readyReport.openai?.key_source, 'process_environment')
  // Readiness is reported without ever echoing the credential.
  assert.equal(ready.stdout.includes(OPENAI_SENTINEL_KEY), false)

  // The unready case names the variable and the repair, and never prints a
  // credential value.
  const unready = pan(root, ['doctor', '--json'], {
    OPENAI_API_KEY: undefined,
    PANCREATOR_OPENAI_API_KEY: undefined,
  })
  const unreadyReport = JSON.parse(unready.stdout) as {
    openai?: { ok: boolean; error?: string }
  }

  assert.equal(unreadyReport.openai?.ok, false)
  assert.match(unreadyReport.openai?.error ?? '', /OPENAI_API_KEY/u)
})

test('an invalid openai mapping is rejected before a run starts', () => {
  const root = createFixture()

  routePersonas(root, ['planner'], 'openai:gpt-6-astra[effort=extreme]')

  const validated = pan(root, ['validate'])

  assert.equal(validated.status, 1)

  const message = `${validated.stdout}${validated.stderr}`

  // The operator learns the offending value and every supported option.
  assert.match(message, /planner/u)
  assert.match(message, /effort/u)
  assert.match(message, /session-resume/u)
  assert.match(message, /max-tool-rounds/u)
})

test('an alias family value may not carry the openai prefix', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    oai: Record<string, string>
  }

  // An alias family names a tier, never a runtime. Allowing a prefix here
  // would let one tier silently move a persona onto another executor.
  config.oai.balanced = 'openai:gpt-6-astra'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const validated = pan(root, ['validate'])

  assert.equal(validated.status, 1)
  assert.match(`${validated.stdout}${validated.stderr}`, /oai/u)
})

test('an orchestrator persona is still refused on an external executor', () => {
  const root = createFixture()

  routePersonas(root, ['orchestrator'], OPENAI_SPEC)

  const failure = (() => {
    try {
      withFakeOpenAi('http://127.0.0.1:1/unused', () =>
        engineCreateRun(root, {
          workflowSlug: 'planning',
          requestPath: 'request.md',
        }),
      )
    } catch (error) {
      return error as Error & { code?: string }
    }

    return undefined
  })()

  assert.ok(failure, 'the supervisor persona must stay on cursor')
  assert.equal(failure.code, 'INVALID_PIPELINE_CONFIG')
  assert.match(failure.message, /orchestrator/u)
})
