import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import {
  applyCustomizations,
  loadCustomizationBundle,
  planCustomizations,
  revertCustomizations,
} from '../../src/lib/vscode-customizations.js'
import {
  bundle,
  fixture,
  noSyntaxCheck,
} from './vscode-customizations-helpers.js'

test('the 1.139.1 recipe data stays equivalent to its captured baseline', () => {
  const directory = path.join(process.cwd(), 'library/vscode')
  const ui = JSON.parse(
    readFileSync(path.join(directory, 'customizations.json'), 'utf8'),
  ) as { verified_against: unknown; patches: unknown[] }
  const governance = JSON.parse(
    readFileSync(path.join(directory, 'instruction-patches.json'), 'utf8'),
  ) as { patches: unknown[]; settings: unknown[] }
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((item: unknown) => canonical(item))
    } else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, canonical(record[key])]),
      )
    }

    return value
  }
  const captured = JSON.stringify(
    canonical({
      version: ui.verified_against,
      patches: [
        ...governance.patches,
        ...ui.patches.filter(
          (patch) =>
            !(patch as { id: string }).id.startsWith('VSC-TOOL-COLLAPSE-'),
        ),
      ],
      settings: governance.settings,
    }),
  ).replace(
    /[\u0080-\uffff]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
  assert.equal(
    createHash('sha256').update(captured).digest('hex'),
    '0b07f0d2ae2c2cef74a9292fefeef1cc996aa1c7254292d3bdc89f7a457175f2',
  )
  assert.deepEqual(loadCustomizationBundle(directory, '1.139.1'), bundle)
})

for (const [version, commit] of [
  ['1.142.0', '6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1'],
  ['1.144.0', '2c33b50b16c472efe58357d1d2a8a5414bc23fbf'],
  ['1.145.2', 'c4453f8ea430795f941c1b2ff6c9321135a74a02'],
] as const) {
  test(`${version} inherits common edits, pins its commit, and applies and restores using the shared engine`, () => {
    const work = fixture(true, version)
    assert.equal(work.bundle.version, version)
    assert.equal(work.bundle.commit, commit)
    assert.deepEqual(work.bundle.settings, bundle.settings)

    for (const original of bundle.patches.filter(
      (patch) =>
        patch.id.startsWith('VSP-') ||
        (version === '1.142.0' &&
          ['VSC-LUNA-EFFORT-2', 'VSC-LUNA-EFFORT-3'].includes(patch.id)),
    )) {
      assert.deepEqual(
        work.bundle.patches.find((patch) => patch.id === original.id),
        original,
      )
    }

    assert.equal(
      planCustomizations(work.bundle, work.options).rows.find(
        (row) => row.id === 'VSC-PICKER-HOST-1',
      )?.state,
      'applied',
    )
    assert.equal(
      applyCustomizations(work.bundle, work.options, noSyntaxCheck).state,
      'applied',
    )
    assert.equal(
      applyCustomizations(work.bundle, work.options, noSyntaxCheck).state,
      'applied',
    )
    revertCustomizations(work.bundle, work.options)

    for (const [file, source] of work.original) {
      assert.equal(readFileSync(file, 'utf8'), source)
    }

    writeFileSync(
      path.join(work.options.appRoot, 'product.json'),
      JSON.stringify({ commit: 'unknown', checksums: {} }),
    )
    assert.throws(
      () => planCustomizations(work.bundle, work.options),
      /Unsupported VS Code build/,
    )
    assert.throws(
      () =>
        loadCustomizationBundle(
          path.join(process.cwd(), 'library/vscode'),
          '../../other',
        ),
      /Unsupported VS Code build/,
    )
  })

  test(`the ${version} picker branch lifts provider rows through native callbacks and filters only upgrade rows`, () => {
    const selected = loadCustomizationBundle(
      path.join(process.cwd(), 'library/vscode'),
      version!,
    )

    for (const surface of ['WORKBENCH', 'SESSIONS']) {
      const prefix = `VSC-PICKER-${surface}-`
      const filter = selected.patches.find(
        (patch) => patch.id === `${prefix}1`,
      )!
      const lift = selected.patches.find((patch) => patch.id === `${prefix}2`)!
      const remaining = selected.patches.find(
        (patch) => patch.id === `${prefix}5`,
      )!
      const implementation = runInNewContext(
        `({build(t,i){let r=[];${filter.replace}{if(l)r.push({label:l});for(let h of u)r.push(this._createModelItem(h,i));for(let h of p)r.push({unavailable:this._getUnavailableReason(h,i)})}};a("Pinned",t.pinned);if(${lift.replace}let u;${remaining.replace}}return r}})`,
      ) as {
        build: (
          this: unknown,
          data: unknown,
          context: unknown,
        ) => { label?: string; model?: unknown; unavailable?: string }[]
      }
      const claude = Object.freeze({
        identifier: 'claude',
        metadata: {
          name: 'Claude',
          byokModelIdentifier: 'anthropic/claude',
          modelGroup: { id: 'anthropic' },
        },
      })
      const gpt = Object.freeze({
        identifier: 'gpt',
        metadata: { name: 'GPT', isBYOK: true, vendor: 'openai' },
      })
      const hosted = Object.freeze({
        identifier: 'hosted',
        metadata: { name: 'Hosted', vendor: 'copilotcli' },
      })
      const context = {
        _languageModelsService: {
          lookupLanguageModel: () => undefined,
          getVendors: () => [
            { vendor: 'anthropic', displayName: 'Anthropic' },
            { vendor: 'openai', displayName: 'OpenAI' },
          ],
        },
        _getUnavailableReason: (entry: {
          reason: string
          needsUpdate?: boolean
        }) => (entry.needsUpdate ? 'update' : entry.reason),
        _createModelItem: (model: unknown) => ({ model }),
      }
      const data = Object.freeze({
        pinned: [],
        suggested: [],
        other: Object.freeze([gpt, hosted, claude]),
        unavailable: [
          { reason: 'upgrade' },
          { reason: 'upgrade', needsUpdate: true },
        ],
      })
      const rows = implementation.build.call(context, data, {})
      assert.deepEqual(
        Array.from(rows.filter((row) => row.label).map((row) => row.label)),
        ['Anthropic', 'OpenAI'],
      )
      assert.equal(
        rows.some((row) => row.unavailable === 'upgrade'),
        false,
      )
      assert.equal(
        rows.some((row) => row.unavailable === 'update'),
        true,
      )
      const models = rows.filter((row) => row.model).map((row) => row.model)
      assert.equal(models[0], claude)
      assert.equal(models[1], gpt)
      assert.equal(models[2], hosted)
      assert.equal(data.other.length, 3)
    }
  })
}
