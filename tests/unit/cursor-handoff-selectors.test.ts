/**
 * Tests for AC-8, AC-9, AC-10: selector matching and capture-tree redaction.
 *
 * AC-8: HANDOFF_UI_BUSY when AXMenu/AXSheet present; HANDOFF_PICKER_AMBIGUOUS
 *       when two pickers exist in composer scope.
 * AC-9: One exported selector table; locate window, New Chat, busy state,
 *       composer, picker, and Send without pressing or writing.
 * AC-10: --capture-tree redacts non-selector labels, refuses path outside runtime/.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  descendantsOf,
  findComposers,
  findNewChat,
  findPickerInAncestorScope,
  findPickers,
  findSend,
  isBusy,
  missingPickerCode,
  redactSnapshot,
  rootOf,
  type SnapNode,
} from '../../src/lib/cursor-handoff/selectors.js'

const FIXTURES = path.resolve(process.cwd(), 'tests/fixtures/cursor-handoff')

function loadFixture(name: string): SnapNode[] {
  return JSON.parse(
    readFileSync(path.join(FIXTURES, name), 'utf8'),
  ) as SnapNode[]
}

// ---------------------------------------------------------------------------
// AC-9: Idle window locates all controls
// ---------------------------------------------------------------------------

test('idle-window fixture finds the root node', () => {
  const nodes = loadFixture('idle-window.json')
  const root = rootOf(nodes)
  assert.ok(root, 'should find root')
  assert.equal(root?.title, 'Cursor Agents')
})

test('idle-window fixture locates New Chat button', () => {
  const nodes = loadFixture('idle-window.json')
  const btn = findNewChat(nodes)
  assert.ok(btn, 'should find New Chat button')
  assert.equal(btn?.role, 'AXButton')
})

test('idle-window fixture locates composer (AXTextArea with Prompt label)', () => {
  const nodes = loadFixture('idle-window.json')
  const composers = findComposers(nodes)
  assert.equal(composers.length, 1)
  assert.equal(composers[0]?.role, 'AXTextArea')
})

test('idle-window fixture locates picker in composer ancestor scope', () => {
  const nodes = loadFixture('idle-window.json')
  const composers = findComposers(nodes)
  assert.ok(composers.length > 0, 'should have a composer')
  const result = findPickerInAncestorScope(nodes, composers[0]!.id)
  assert.ok(result, 'should find picker in scope')
  assert.equal(result?.picker.role, 'AXPopUpButton')
})

test('idle-window fixture locates Send button in picker scope', () => {
  const nodes = loadFixture('idle-window.json')
  const composers = findComposers(nodes)
  const result = findPickerInAncestorScope(nodes, composers[0]!.id)
  assert.ok(result, 'scope found')
  const sendBtn = findSend(result!.scope)
  assert.ok(sendBtn, 'should find Send button')
  assert.equal(sendBtn?.title, 'Send message')
})

// ---------------------------------------------------------------------------
// AC-8: Busy detection
// ---------------------------------------------------------------------------

test('busy-window fixture reports isBusy', () => {
  const nodes = loadFixture('busy-window.json')
  assert.ok(isBusy(nodes), 'should detect AXMenu as busy')
})

test('idle-window fixture is not busy', () => {
  const nodes = loadFixture('idle-window.json')
  assert.ok(!isBusy(nodes), 'idle window must not be busy')
})

// ---------------------------------------------------------------------------
// AC-8: Two-picker detection yields HANDOFF_PICKER_AMBIGUOUS
// ---------------------------------------------------------------------------

test('two-picker-window fixture has two pickers in root scope', () => {
  const nodes = loadFixture('two-picker-window.json')
  const root = rootOf(nodes)
  assert.ok(root, 'should have root')
  const scope = [root!, ...descendantsOf(nodes, root!.id)]
  const pickers = findPickers(scope)
  assert.equal(pickers.length, 2)
})

test('two-picker-window fixture findPickerInAncestorScope returns undefined (no single-picker scope)', () => {
  const nodes = loadFixture('two-picker-window.json')
  const composers = findComposers(nodes)
  assert.ok(composers.length > 0, 'should have composer')
  const result = findPickerInAncestorScope(nodes, composers[0]!.id)
  // A scope with two pickers never satisfies the single-picker condition
  assert.equal(result, undefined)
})

// ---------------------------------------------------------------------------
// AC-9: Removed-control yields distinct code
// ---------------------------------------------------------------------------

test('snapshot without New Chat button returns undefined from findNewChat', () => {
  const nodes = loadFixture('idle-window.json').filter(
    (n) => n.title !== 'New Chat',
  )
  const btn = findNewChat(nodes)
  assert.equal(btn, undefined)
})

test('snapshot without Send button returns undefined from findSend', () => {
  const nodes = loadFixture('idle-window.json')
  const composers = findComposers(nodes)
  const result = findPickerInAncestorScope(nodes, composers[0]!.id)
  assert.ok(result)
  const noSend = result!.scope.filter((n) => n.title !== 'Send message')
  assert.equal(findSend(noSend), undefined)
})

// ---------------------------------------------------------------------------
// AC-10: Capture-tree redaction
// ---------------------------------------------------------------------------

test('redactSnapshot replaces non-selector values with <redacted>', () => {
  const nodes: SnapNode[] = [
    {
      id: 'a',
      role: 'AXTextArea',
      title: 'Prompt Editor',
      value: 'my secret chat',
    },
    { id: 'b', role: 'AXButton', title: 'New Chat' },
    { id: 'c', role: 'AXGroup', title: 'arbitrary text' },
  ]
  const redacted = redactSnapshot(nodes)

  // The composer label starts with "Prompt" — kept
  assert.equal(redacted[0]?.title, 'Prompt Editor')
  // The value is always redacted
  assert.equal(redacted[0]?.value, '<redacted>')
  // New Chat label is kept
  assert.equal(redacted[1]?.title, 'New Chat')
  // Arbitrary text is redacted
  assert.equal(redacted[2]?.title, '<redacted>')
})

test('redactSnapshot keeps picker labels that match the model pattern', () => {
  const nodes: SnapNode[] = [
    { id: 'a', role: 'AXPopUpButton', title: 'claude sonnet High' },
    { id: 'b', role: 'AXPopUpButton', title: 'gpt High' },
  ]
  const redacted = redactSnapshot(nodes)

  assert.equal(redacted[0]?.title, 'claude sonnet High')
  assert.equal(redacted[1]?.title, 'gpt High')
})

test('redactSnapshot redacts a model-like or Prompt-like chat title off its selector role', () => {
  const nodes: SnapNode[] = [
    {
      id: 'a',
      role: 'AXStaticText',
      title: 'Ask claude about the auto deploy',
    },
    { id: 'b', role: 'AXButton', description: 'Prompt ideas for Q3' },
  ]
  const redacted = redactSnapshot(nodes)

  assert.equal(redacted[0]?.title, '<redacted>')
  assert.equal(redacted[1]?.description, '<redacted>')
})

test('missingPickerCode names ambiguity only when a scope holds two pickers', () => {
  const nodes: SnapNode[] = [
    { id: 'win', role: 'AXWindow', title: 'Cursor Agents' },
    { id: 'grp', parent_id: 'win', role: 'AXGroup' },
    { id: 'composer', parent_id: 'grp', role: 'AXTextArea', title: 'Prompt' },
    { id: 'p1', parent_id: 'grp', role: 'AXPopUpButton', title: 'Opus High' },
    { id: 'p2', parent_id: 'grp', role: 'AXPopUpButton', title: 'GPT Low' },
  ]

  assert.equal(missingPickerCode(nodes, 'composer'), 'HANDOFF_PICKER_AMBIGUOUS')
  assert.equal(
    missingPickerCode(
      nodes.filter((n) => n.role !== 'AXPopUpButton'),
      'composer',
    ),
    'HANDOFF_PICKER_MISSING',
  )
})

test('redactSnapshot keeps Send message label', () => {
  const nodes: SnapNode[] = [
    { id: 'a', role: 'AXButton', title: 'Send message' },
    { id: 'b', role: 'AXButton', title: 'Close' },
  ]
  const redacted = redactSnapshot(nodes)

  assert.equal(redacted[0]?.title, 'Send message')
  assert.equal(redacted[1]?.title, '<redacted>')
})

test('redactSnapshot keeps Model and Effort menu item labels', () => {
  const nodes: SnapNode[] = [
    { id: 'a', role: 'AXMenuItem', title: 'Model' },
    { id: 'b', role: 'AXMenuItem', title: 'Effort' },
    { id: 'c', role: 'AXMenuItem', title: 'Other setting' },
  ]
  const redacted = redactSnapshot(nodes)

  assert.equal(redacted[0]?.title, 'Model')
  assert.equal(redacted[1]?.title, 'Effort')
  assert.equal(redacted[2]?.title, '<redacted>')
})

test('redactSnapshot preserves roles for all nodes', () => {
  const nodes: SnapNode[] = [
    { id: 'a', role: 'AXButton', title: 'Something else' },
  ]
  const redacted = redactSnapshot(nodes)
  assert.equal(redacted[0]?.role, 'AXButton')
})
