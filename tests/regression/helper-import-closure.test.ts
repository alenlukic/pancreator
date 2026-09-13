import assert from 'node:assert/strict'
import test from 'node:test'

import { buildModuleGraph } from '../../src/lib/test-impact.js'
import type { ModuleGraph } from '../../src/lib/test-impact.js'

/**
 * `perf HR-005`: `tests/helpers.ts` is imported by most of the suite, and it
 * statically imported `src/lib/engine.ts`. The engine then sat in every
 * importer's closure, so the impacted profile selected nearly the whole lane
 * for a change to any engine dependency. The two functions that drive a run
 * moved to `tests/run-helpers.ts`.
 *
 * The closure is measured against the real repository rather than a fixture,
 * because the claim is about this repository's own suite.
 */

const SHARED_HELPER = 'tests/helpers.ts'
const RUN_HELPER = 'tests/run-helpers.ts'
const ENGINE = 'src/lib/engine.ts'

/** Every file reachable from `entry` by following static imports. */
function importClosure(graph: ModuleGraph, entry: string): Set<string> {
  const seen = new Set<string>()
  const pending = [entry]

  while (pending.length > 0) {
    const file = pending.pop() as string

    for (const target of graph.imports.get(file) ?? []) {
      if (seen.has(target)) {
        continue
      }

      seen.add(target)
      pending.push(target)
    }
  }

  return seen
}

test('the shared test helper does not reach the engine', async () => {
  const graph = await buildModuleGraph(process.cwd())

  assert.ok(
    graph.files.includes(SHARED_HELPER),
    'the graph covers the shared helper',
  )
  assert.ok(graph.files.includes(ENGINE), 'the graph covers the engine')

  const shared = importClosure(graph, SHARED_HELPER)

  assert.equal(
    shared.has(ENGINE),
    false,
    `${SHARED_HELPER} still reaches ${ENGINE} through ${[...shared]
      .filter((file) => (graph.imports.get(file) ?? new Set()).has(ENGINE))
      .join(', ')}`,
  )

  // The engine did not vanish; it moved to the surface a run-driving test
  // imports on purpose.
  assert.equal(importClosure(graph, RUN_HELPER).has(ENGINE), true)
})
