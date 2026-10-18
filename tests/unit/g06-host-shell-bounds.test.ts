import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { parseHostToolRegistry } from '../../src/lib/host-tools.js'

const canonical = () =>
  JSON.parse(readFileSync('governance/registries/host_tools.json', 'utf8'))

test('G06: Copilot session tool contract independently bounds initial_wait to 30 to 600 seconds', () => {
  for (const ordinary of [29, 601, 0, -1]) {
    const registry = canonical()
    registry.terms.shell.bounds['copilot-cli'].ordinary = ordinary
    assert.throws(() => parseHostToolRegistry(registry), /bounds|range/u)
  }
  for (const ordinary of [30, 600]) {
    const registry = canonical()
    registry.terms.shell.bounds['copilot-cli'].ordinary = ordinary
    assert.equal(
      parseHostToolRegistry(registry).terms.shell.bounds!['copilot-cli']
        .ordinary,
      ordinary,
    )
  }
})

test('G06: unavailable Cursor and VS Code extrema stay unknown; supported ordinary calls stay conservative', () => {
  const bounds = parseHostToolRegistry(canonical()).terms.shell.bounds!
  assert.deepEqual(bounds.cursor, {
    argument: 'block_until_ms',
    unit: 'milliseconds',
    minimum: null,
    maximum: null,
    ordinary: 5000,
    watch: 330000,
  })
  assert.deepEqual(bounds.vscode, {
    argument: 'timeout',
    unit: 'milliseconds',
    minimum: null,
    maximum: null,
    ordinary: 5000,
    watch: 330000,
  })
  for (const host of ['cursor', 'vscode']) {
    for (const ordinary of [0, 1, 3600001]) {
      const registry = canonical()
      registry.terms.shell.bounds[host].ordinary = ordinary
      assert.throws(() => parseHostToolRegistry(registry), /bounds|range/u)
    }
    const guessed = canonical()
    guessed.terms.shell.bounds[host].maximum = 2147483647
    assert.throws(() => parseHostToolRegistry(guessed), /bounds|range/u)
  }
})

test('G06: every host rejects argument, unit and watch-bound mutations independently', () => {
  for (const host of ['cursor', 'vscode', 'copilot-cli']) {
    for (const [key, value] of [
      ['argument', 'unsupported'],
      ['unit', 'minutes'],
      ['watch', 5],
    ]) {
      const registry = canonical()
      registry.terms.shell.bounds[host][key!] = value
      assert.throws(() => parseHostToolRegistry(registry), /bounds|range/u)
    }
  }
  assert.equal(
    parseHostToolRegistry(canonical()).terms.shell.bounds!['copilot-cli'].watch,
    330,
  )
})
