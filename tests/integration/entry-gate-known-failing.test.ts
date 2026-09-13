import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  getRunState,
  prepareInvocation,
  setRunStage,
} from '../../src/lib/engine.js'
import { createFixture, writeJson } from '../helpers.js'
import { createRun } from '../run-helpers.js'
import type { RunState } from '../../src/lib/types.js'

/**
 * One vitest-shaped failure headline plus the indented detail lines a runner
 * prints beneath it. The detail lines exist so the count assertions prove the
 * gate charges one diagnostic, not four.
 */
const FAILING_SUITE = `node -e "console.error(' FAIL  tests/unit/legacy.test.ts > legacy parser accepts an empty body'); console.error('   AssertionError: expected undefined to equal 1'); console.error('    at parse (src/legacy.ts:12:9)'); console.error('    at run (tests/unit/legacy.test.ts:4:3)'); process.exit(1)"`

const CHECKS = {
  schema_version: 1,
  profiles: {
    static: { probes: [], commands: [`node -e "process.exit(0)"`] },
    fast: { probes: [], commands: [`node -e "process.exit(0)"`] },
    full: { probes: [], commands: [FAILING_SUITE] },
    configuration: { probes: [], commands: [`node -e "process.exit(0)"`] },
  },
}

const REQUEST_BODY = '# Request\n\nShip the change.\n'

/** A run parked at ship, whose `full` entry gate reports one failing case. */
function shipEntryGate(
  declaration: string,
  fullCommands: string[] = [FAILING_SUITE],
): {
  root: string
  runId: string
  state: RunState
} {
  const root = createFixture()

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    ...CHECKS,
    profiles: {
      ...CHECKS.profiles,
      full: { probes: [], commands: fullCommands },
    },
  })
  writeFileSync(path.join(root, 'request.md'), REQUEST_BODY + declaration)

  const created = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Known-failing entry gate fixture',
  })
  const runId = created.run_id

  setRunStage(root, runId, 'ship', 'Checkpoint: enter ship.')
  prepareInvocation(root, runId)

  return { root, runId, state: getRunState(root, runId) }
}

/** The recorded result of the ship stage's entry gate. */
function gateResult(state: RunState) {
  const record = state.entry_gates?.ship

  assert.ok(record, 'the ship entry gate ran')

  return record.last_result
}

// AC-019. The run never baselined `full`, so the gate judged it absolutely.
// Read without that disclosure, the failure reads as a regression this run
// introduced, and the reader cannot tell an unbaselined profile from a
// missing baseline artifact.
test('a repository-check gate with no baseline discloses that it judged absolutely', () => {
  const { state } = shipEntryGate('')
  const result = gateResult(state)

  assert.equal(result.passed, false)
  assert.match(
    result.explanation ?? '',
    /No pre-implementation baseline covers repository-check profile 'full'/u,
  )
  assert.match(result.explanation ?? '', /judged the profile absolutely/u)
  // The profiles the run did baseline are named, so an unbaselined profile is
  // distinguishable from a baseline the harness lost.
  assert.match(result.explanation ?? '', /Profiles this run baselined: none\./u)
})

// AC-020. The declaration names one case and the reason it fails, so the gate
// reports it as baseline instead of charging this run for it.
test('the entry gate credits a declared known-failing case as baseline', () => {
  const { state } = shipEntryGate(
    '\n## Known-failing tests\n\n' +
      '- tests/unit/legacy.test.ts > legacy parser accepts an empty body — ' +
      'the legacy parser is scheduled for removal in the next chunk.\n',
  )
  const result = gateResult(state)

  assert.equal(result.passed, true)
  assert.equal(result.preexisting_failure, true)
  assert.match(result.explanation ?? '', /declared known-failing/u)
  assert.match(result.explanation ?? '', /legacy parser accepts an empty body/u)
})

// AC-021, first half: a second failing case the request never declared still
// fails the gate, and the credited one does not excuse it.
test('an undeclared failure still fails the gate beside a credited one', () => {
  const root = createFixture()

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    ...CHECKS,
    profiles: {
      ...CHECKS.profiles,
      full: {
        probes: [],
        commands: [
          `node -e "console.error(' FAIL  tests/unit/legacy.test.ts > legacy parser accepts an empty body'); console.error(' FAIL  tests/unit/fresh.test.ts > fresh parser rejects a trailing comma'); process.exit(1)"`,
        ],
      },
    },
  })
  writeFileSync(
    path.join(root, 'request.md'),
    REQUEST_BODY +
      '\n## Known-failing tests\n\n' +
      '- tests/unit/legacy.test.ts > legacy parser accepts an empty body — ' +
      'scheduled for removal.\n',
  )

  const created = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Undeclared failure fixture',
  })

  setRunStage(root, created.run_id, 'ship', 'Checkpoint: enter ship.')
  prepareInvocation(root, created.run_id)

  const result = gateResult(getRunState(root, created.run_id))

  assert.equal(result.passed, false)
  assert.match(result.explanation ?? '', /1 undeclared diagnostic/u)
  assert.match(
    result.explanation ?? '',
    /fresh parser rejects a trailing comma/u,
  )
})

// AC-021, second half: a bare file path is not a case. Crediting one would let
// a declaration excuse every future failure in that file, including one this
// run introduces.
test('a declaration naming only a file path credits nothing', () => {
  const { state } = shipEntryGate(
    '\n## Known-failing tests\n\n' +
      '- tests/unit/legacy.test.ts — the whole file is flaky.\n',
  )
  const result = gateResult(state)

  assert.equal(result.passed, false)
  assert.equal(result.preexisting_failure, undefined)
})

// AC-021, first half again, at the shape the matcher could not describe. The
// gate accepts a profile when nothing is undeclared, so a second command that
// genuinely failed while printing nothing contributed no diagnostic and the
// one credited case passed the whole gate. The explanation then told the
// reader every observed failure was declared, which was false.
test('a silent failing command beside a credited case still fails the gate', () => {
  const { state } = shipEntryGate(
    '\n## Known-failing tests\n\n' +
      '- tests/unit/legacy.test.ts > legacy parser accepts an empty body — ' +
      'scheduled for removal.\n',
    [FAILING_SUITE, `node -e "process.exit(1)"`],
  )
  const result = gateResult(state)

  assert.equal(result.passed, false)
  assert.equal(result.preexisting_failure, undefined)
  assert.match(result.explanation ?? '', /1 undeclared diagnostic/u)
  assert.match(result.explanation ?? '', /reported no diagnostic/u)
})

// AC-021, third half: a runner prints a stack beneath a failure. Counting each
// of those lines as its own diagnostic turned one credited failure into three
// undeclared ones, and the credit never took effect.
test('detail lines beneath a failure are not counted as separate diagnostics', () => {
  const { state } = shipEntryGate(
    '\n## Known-failing tests\n\n' +
      '- tests/unit/legacy.test.ts > legacy parser accepts an empty body — ' +
      'scheduled for removal.\n',
  )
  const result = gateResult(state)

  // The fixture command prints one headline and three detail lines.
  assert.equal(result.passed, true)
  assert.doesNotMatch(result.explanation ?? '', /undeclared/u)
  assert.doesNotMatch(result.explanation ?? '', /AssertionError/u)
})
