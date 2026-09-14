import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { checkpoint } from './delivery-helpers.js'

// A self-development release executes whichever build `bin/pan` dispatched,
// which need not be the build of the workspace under release. The run records
// both identities so the question is answered from the record instead of from
// an assumption, and the disagreement stays an advisory: the redirection that
// closes it is read from the executing build, so a gate here would refuse the
// first release that carries the mechanism.
test('a self-development ship stage records which build released which workspace', () => {
  const { state } = checkpoint('delivery@ship-awaiting-operator')
  const ship = state.stage_history
    .filter((item) => item.stage === 'ship')
    .at(-1)

  assert.ok(ship)
  assert.equal(ship.outcome, 'success')

  const currency = ship.build_currency

  assert.ok(currency, 'the ship stage record must carry the build identities')
  assert.equal(currency.executing_build.root, path.resolve(process.cwd()))
  assert.match(currency.executing_build.head ?? '', /^[0-9a-f]{40}$/u)
  // The workspace the stage released is the run's own tree, which a
  // self-development release reaches through a worktree rather than through
  // the checkout that supplies the build.
  assert.notEqual(currency.workspace.root, currency.executing_build.root)
  assert.match(currency.workspace.head ?? '', /^[0-9a-f]{40}$/u)
  assert.notEqual(currency.executing_build.head, currency.workspace.head)
  assert.equal(currency.current, false)
})

test('a build that is not the workspace under release raises one run advisory', () => {
  const { state } = checkpoint('delivery@ship-awaiting-operator')
  const advisories = (state.advisories ?? []).filter(
    (item) => item.kind === 'build_currency',
  )

  assert.equal(advisories.length, 1)

  const advisory = advisories[0]

  assert.ok(advisory)
  assert.equal(advisory.stage, 'ship')
  assert.equal(advisory.source, 'submit')

  const currency = state.stage_history
    .filter((item) => item.stage === 'ship')
    .at(-1)?.build_currency

  assert.ok(currency)
  assert.ok(advisory.message.includes(currency.executing_build.root))
  assert.ok(advisory.message.includes(currency.workspace.root))
  assert.ok(advisory.message.includes(currency.workspace.head ?? 'missing'))
})
