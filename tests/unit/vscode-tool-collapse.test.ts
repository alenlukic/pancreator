import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import { loadCustomizationBundle } from '../../src/lib/vscode-customizations.js'

const bundle = loadCustomizationBundle(
  path.join(process.cwd(), 'library/vscode'),
)

test('tool collapse keeps only the newest live call open and honors operator expansion', () => {
  const core = bundle.patches.find(
    (entry) => entry.id === 'VSC-TOOL-COLLAPSE-CORE',
  )!
  const sandbox: { globalThis?: unknown } = {}
  sandbox.globalThis = sandbox
  runInNewContext(
    `class Part{${core.replace}}`,
    sandbox,
  )
  const coordinator = (sandbox as { __panTC: Record<string, Function> })
    .__panTC
  const live = (id: string) => ({ kind: 'toolInvocation', toolCallId: id })
  const collapsed: string[] = []
  const register = (session: string, call: object) =>
    coordinator.reg!(session, call, () =>
      collapsed.push((call as { toolCallId: string }).toolCallId),
    ) as { dispose(): void }
  const first = live('one')
  const second = live('two')
  const third = live('three')

  coordinator.arrive!('session', first)
  register('session', first)
  assert.equal(coordinator.held!(first), false)

  coordinator.arrive!('session', second)
  register('session', second)
  assert.deepEqual(collapsed, ['one'])
  assert.equal(coordinator.held!(first), true)
  assert.equal(coordinator.held!(second), false)

  coordinator.arrive!('session', second)
  assert.deepEqual(collapsed, ['one'])

  coordinator.pin!(first, true)
  assert.equal(coordinator.held!(first), false)
  coordinator.arrive!('session', third)
  assert.deepEqual(collapsed, ['one', 'two'])
  assert.equal(coordinator.held!(first), false)

  coordinator.pin!(first, false)
  assert.equal(coordinator.held!(first), true)

  const other = live('elsewhere')
  coordinator.arrive!('other', other)
  register('other', other)
  assert.equal(coordinator.held!(third), false)
  assert.equal(coordinator.held!(other), false)

  coordinator.arrive!('session', { kind: 'toolInvocationSerialized', toolCallId: 'old' })
  assert.equal(coordinator.held!(third), false)

  assert.equal(coordinator.keep!(third), true)
  assert.equal(coordinator.keep!(second), false)
  assert.equal(coordinator.keep!({ kind: 'toolInvocationSerialized', toolCallId: 'old' }), false)
  coordinator.pin!(third, false)
  assert.equal(coordinator.keep!(third), false)
})

test('tool collapse anchors fire on every patched terminal and tool part path', () => {
  const ids = bundle.patches
    .filter((entry) => entry.id.startsWith('VSC-TOOL-COLLAPSE-'))
    .map((entry) => entry.id)
  assert.deepEqual(ids, [
    'VSC-TOOL-COLLAPSE-CORE',
    'VSC-TOOL-COLLAPSE-ARRIVE',
    'VSC-TOOL-COLLAPSE-REGISTER',
    'VSC-TOOL-COLLAPSE-WRAP',
    'VSC-TOOL-COLLAPSE-EXPAND',
    'VSC-TOOL-COLLAPSE-OUTPUT',
    'VSC-TOOL-COLLAPSE-PIN-ACTION',
    'VSC-TOOL-COLLAPSE-PIN-KEYBOARD',
  ])

  for (const version of ['1.139.1', '1.142.0']) {
    const selected = loadCustomizationBundle(
      path.join(process.cwd(), 'library/vscode'),
      version,
    )

    for (const id of ids) {
      const patch = selected.patches.find((entry) => entry.id === id)!
      assert.deepEqual(patch.targets, [
        'out/vs/workbench/workbench.desktop.main.js',
        'out/vs/sessions/sessions.desktop.main.js',
      ])
      assert.ok(patch.replace.includes('__panTC'))
    }
  }

  const output = bundle.patches.find(
    (entry) => entry.id === 'VSC-TOOL-COLLAPSE-OUTPUT',
  )!
  const run = (held: boolean, keep: boolean) => {
    const calls: boolean[] = []
    const part = runInNewContext(
      `({toolInvocation:{toolCallId:'x'},_outputView:{toggle:async e=>(calls.push(e),!0)},${output.replace}return this._outputView.toggle(e)}})`,
      {
        calls,
        globalThis: { __panTC: { held: () => held, keep: () => keep } },
      },
    ) as { _toggleOutput(expanded: boolean): Promise<boolean> }

    return Promise.all([
      part._toggleOutput(true),
      part._toggleOutput(false),
    ]).then((results) => ({ results, calls }))
  }

  return Promise.all([run(true, false), run(false, true)]).then(
    ([earlier, newest]) => {
      assert.deepEqual(earlier.results, [false, true])
      assert.deepEqual(earlier.calls, [false])
      assert.deepEqual(newest.results, [true, false])
      assert.deepEqual(newest.calls, [true])
    },
  )
})
