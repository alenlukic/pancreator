import assert from 'node:assert/strict'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import { loadCustomizationBundle } from '../../src/lib/vscode-customizations.js'
import { createTestTempDirectory } from '../temp.js'

const directory = path.join(process.cwd(), 'library/vscode')
const bundle = loadCustomizationBundle(directory, '1.145.2')

interface Row {
  kind?: string
  label?: string
  item?: { id: string; run: () => void; actions: unknown[] }
}

interface Destination {
  id: string
  label: string
  rows: Row[]
}

for (const surface of ['WORKBENCH', 'SESSIONS']) {
  test(`${surface} lists every native provider with original selection and configuration callbacks`, () => {
    const tabs = bundle.patches.find(
      (patch) => patch.id === `VSC-UNIFIED-TABS-${surface}`,
    )
    const list = bundle.patches.find(
      (patch) => patch.id === `VSC-UNIFIED-LIST-${surface}`,
    )
    assert.ok(tabs)
    assert.ok(list)

    const selected: string[] = []
    const actions = [{ id: 'effort' }, { id: 'context' }]
    const row = (id: string): Row => ({
      item: {
        id,
        run: () => {
          selected.push(id)
        },
        actions,
      },
    })
    const g: Destination[] = [
      { id: 'copilot', label: 'Copilot', rows: [row('hosted')] },
      { id: 'anthropic', label: 'Anthropic', rows: [row('claude')] },
      {
        id: 'openai',
        label: 'OpenAI',
        rows: [{ kind: 'separator', label: 'OpenAI' }, row('gpt')],
      },
      { id: 'local', label: 'On Device', rows: [row('local')] },
      { id: 'empty', label: 'Empty', rows: [] },
    ]
    const h = { configurationAccess: actions }
    const localCalls: unknown[] = []
    const receiver = {
      _buildSections: (destination: Destination, context: unknown) => {
        assert.equal(context, h)
        return destination
      },
      _buildItems: (
        destination: Destination,
        sections: Destination,
        context: unknown,
      ) => {
        assert.equal(destination, sections)
        assert.equal(context, h)
        return destination.rows
      },
      _buildSearchItems: (destination: Destination) =>
        destination.rows.filter((item) => item.item),
      _buildLocalModelItems: (context: unknown) => {
        localCalls.push(context)
        return g[3]!.rows
      },
      _hasBuiltInChoices: () => true,
      _activeDestination: 'openai',
    }
    const evaluate = (source: string, search: boolean): Row[] => {
      const implementation = runInNewContext(
        `({build(g,f,v,h,S){let b=false,y;${source};return y}})`,
        { GJe: 'local', jnt: 'local' },
      ) as { build: (this: unknown, ...args: unknown[]) => Row[] }
      return implementation.build.call(receiver, g, g[0], g[0], h, search)
    }
    const legacy = evaluate(list.find, false)
    assert.deepEqual(
      Array.from(legacy.flatMap((item) => (item.item ? [item.item.id] : []))),
      ['hosted'],
    )

    for (const search of [false, true]) {
      const rows = evaluate(list.replace, search)
      assert.deepEqual(
        Array.from(
          rows
            .filter((item) => item.kind === 'separator')
            .map((item) => item.label),
        ),
        ['Copilot', 'Anthropic', 'OpenAI', 'On Device'],
      )
      assert.deepEqual(
        Array.from(rows.flatMap((item) => (item.item ? [item.item.id] : []))),
        ['hosted', 'claude', 'gpt', 'local'],
      )

      for (const item of rows) {
        if (item.item) {
          assert.equal(item.item.actions, actions)
          item.item.run()
        }
      }
    }

    assert.deepEqual(selected, [
      'hosted',
      'claude',
      'gpt',
      'local',
      'hosted',
      'claude',
      'gpt',
      'local',
    ])
    assert.deepEqual(localCalls, [h])

    const options = runInNewContext(
      `({build(l,r){return{${tabs.replace}}}})`,
    ) as {
      build: (
        this: unknown,
        ...args: unknown[]
      ) => { tabs: { id: string }[]; initialTab: string; sizingTab: string }
    }
    const result = options.build.call(receiver, g, h)
    assert.equal(result.tabs.length, 1)
    assert.equal(result.initialTab, result.tabs[0]!.id)
    assert.equal(result.sizingTab, result.initialTab)
  })
}

test('terminal tool guidance preserves the native completion implementation and input schema', () => {
  const patch = bundle.patches.find(
    (entry) => entry.id === 'VSC-AUTOPILOT-TERMINAL',
  )
  assert.ok(patch)
  const native = Object.freeze({
    name: 'task_complete',
    description: 'Only complete verified work.',
  })
  const implementation = {
    ...native,
    input_schema: { type: 'object' },
    handler: () => ({ success: true }),
  }
  const tool = runInNewContext(`${patch.replace};px()`, {
    Ug: 'task_complete',
    d: { toolGetBuiltinDescriptor: () => native },
    Ie: () => implementation,
  }) as typeof implementation
  assert.match(tool.description, /plain final prose does not close/u)
  assert.match(tool.description, /all requested work is verified/u)
  assert.equal(tool.handler, implementation.handler)
  assert.equal(tool.input_schema, implementation.input_schema)
  assert.equal(native.description, 'Only complete verified work.')
})

test('installed collapse recipes keep manual expansion and isolate tool arrivals by session', () => {
  const patch = bundle.patches.find(
    (entry) => entry.id === 'VSC-TOOL-COLLAPSE-CORE',
  )
  assert.ok(patch)
  const state = runInNewContext(
    `class Wrapper{${patch.replace}};globalThis.__panTC`,
  ) as {
    arrive: (session: string, invocation: unknown) => void
    reg: (
      session: string,
      invocation: unknown,
      collapse: () => void,
    ) => { dispose: () => void }
    pin: (invocation: unknown, expanded: boolean) => void
    held: (invocation: unknown) => boolean
    keep: (invocation: unknown) => boolean
  }
  const first = { kind: 'toolInvocation', toolCallId: 'first' }
  const second = { kind: 'toolInvocation', toolCallId: 'second' }
  const other = { kind: 'toolInvocation', toolCallId: 'other' }
  const collapsed: string[] = []
  const registration = state.reg('one', first, () => {
    collapsed.push('first')
  })
  state.arrive('one', first)
  assert.equal(state.keep(first), true)
  state.arrive('two', other)
  assert.deepEqual(collapsed, [])
  state.arrive('one', second)
  assert.deepEqual(collapsed, ['first'])
  assert.equal(state.held(first), true)
  state.pin(first, true)
  state.arrive('one', { kind: 'toolInvocation', toolCallId: 'third' })
  assert.deepEqual(collapsed, ['first'])
  assert.equal(state.held(first), false)
  registration.dispose()
})

test('version additions reject malformed and duplicate patches before application', () => {
  const root = createTestTempDirectory('vscode-additions-')

  for (const file of ['customizations.json', 'instruction-patches.json']) {
    copyFileSync(path.join(directory, file), path.join(root, file))
  }

  const variant = JSON.parse(
    readFileSync(path.join(directory, 'customizations-1.145.2.json'), 'utf8'),
  ) as { additional_patches: unknown }

  for (const additions of [
    'invalid',
    [
      {
        id: 'VSC-DEFAULT-MODEL',
        targets: ['out/test.js'],
        find: 'x',
        replace: 'y',
        occurrences: 1,
      },
    ],
    [{ id: 'new', targets: [], find: 'x', replace: 'y', occurrences: 1 }],
    [
      {
        id: 'new',
        targets: ['out/test.js'],
        find: 'x',
        replace: 'y',
        occurrences: 2,
      },
    ],
  ]) {
    writeFileSync(
      path.join(root, 'customizations-1.145.2.json'),
      JSON.stringify({ ...variant, additional_patches: additions }),
    )
    assert.throws(
      () => loadCustomizationBundle(root, '1.145.2'),
      /Invalid|duplicate/u,
    )
  }
})
