import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { readAgentRegistry } from '../../src/lib/hypervisor.js'
import { operationMutexPath } from '../../src/lib/state.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import {
  checkpoint,
  submitStageOutput,
} from '../integration/delivery-helpers.js'

const REPO_ROOT = process.cwd()
const ENGINE_SOURCE = path.join('src', 'lib', 'engine.ts')

/**
 * The source of one exported top-level function, from its declaration to the
 * closing brace at column zero.
 */
function functionSource(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}(`)

  assert.ok(start >= 0, `${ENGINE_SOURCE} declares no ${name}`)

  const end = source.indexOf('\n}\n', start)

  assert.ok(
    end > start,
    `${name} has no closing brace at column zero in ${ENGINE_SOURCE}`,
  )

  return source.slice(start, end)
}

/** Every index at which `body` calls `name`. */
function callSites(body: string, name: string): number[] {
  const sites: number[] = []

  for (
    let index = body.indexOf(`${name}(`);
    index >= 0;
    index = body.indexOf(`${name}(`, index + 1)
  ) {
    sites.push(index)
  }

  return sites
}

/**
 * Assert that `name` calls `call` exactly once, after the run mutex callback
 * has closed.
 *
 * This contract has no runtime observable. Both orderings leave the same
 * durable state, release the mutex through the same `finally`, and surface a
 * failing registry write the same way, so only the source itself records
 * whether the write waits on the lock. The `\n  })` anchor is the callback
 * closing at the function's own indentation, which Prettier fixes.
 */
function assertBookkeepingLeavesTheMutex(
  source: string,
  name: string,
  call: string,
): void {
  const body = functionSource(source, name)
  const mutexStart = body.indexOf(
    'withOperationMutex(operationMutexPath(root, runId)',
  )

  assert.ok(mutexStart >= 0, `${name} no longer takes the run mutex`)

  const mutexEnd = body.indexOf('\n  })', mutexStart)

  assert.ok(
    mutexEnd > mutexStart,
    `${name}: the run mutex callback does not close at the function's own ` +
      `indentation, so this proof can no longer locate it`,
  )

  const sites = callSites(body, call)

  assert.equal(
    sites.length,
    1,
    `${name} calls ${call} ${sites.length} times; the bookkeeping must ` +
      `happen exactly once`,
  )
  assert.ok(
    (sites[0] ?? -1) > mutexEnd,
    `${name} calls ${call} inside the run mutex callback. The registry ` +
      `write must happen after the lock is released, so the command returns ` +
      `as soon as the run state is durable. Move the call below the ` +
      `withOperationMutex(...) result, as the deferred holder does.`,
  )
}

test('prepare and submit write the agent registry after the run mutex closes', () => {
  const source = readFileSync(path.join(REPO_ROOT, ENGINE_SOURCE), 'utf8')

  assertBookkeepingLeavesTheMutex(
    source,
    'prepareInvocation',
    'registerPreparedInvocation',
  )
  assertBookkeepingLeavesTheMutex(
    source,
    'submitOutput',
    'completeInvocationAgent',
  )
})

test('deferring the registry write still records every prepared and completed invocation', () => {
  // Deferral must not become omission: the hypervisor reconciles agent health
  // from these records, so a bookkeeping write that moved out of the mutex
  // and then got dropped would leave every agent invisible to recovery.
  const { root, runId, state, workflow } = checkpoint(
    'delivery@implement-prepared',
  )
  const invocationId = state.current_invocation?.id

  assert.ok(invocationId)

  const prepared = readAgentRegistry(root).agents.find(
    (agent) => agent.invocation_id === invocationId,
  )

  assert.ok(prepared, 'prepare registered no agent for the invocation it made')
  assert.equal(prepared.run_id, runId)
  assert.notEqual(prepared.health, 'completed')
  assert.equal(existsSync(operationMutexPath(root, runId)), false)

  const submitted = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'implement'),
    'success',
  )

  assert.equal(
    submitted.record.outcome,
    'success',
    JSON.stringify(submitted.record.evaluation),
  )

  const completed = readAgentRegistry(root).agents.find(
    (agent) => agent.invocation_id === invocationId,
  )

  assert.ok(completed, 'submit dropped the agent record prepare had written')
  assert.equal(completed.health, 'completed')
  assert.equal(existsSync(operationMutexPath(root, runId)), false)
})
