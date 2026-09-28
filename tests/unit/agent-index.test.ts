/**
 * Tests for the hook-fed agent activity index (AC-004, AC-009, AC-011).
 */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  AGENTS_DIR,
  agentActivitySignature,
  getAgentEntry,
  getLatestEvent,
  getOpenCall,
  getStopRecord,
  handlePostToolUse,
  handlePreToolUse,
  handleSubagentStart,
  handleSubagentStop,
  readAgentIndex,
  resolveCanonicalId,
} from '../../src/lib/agent-index.js'
import { CLEANUP_ARTIFACT_CLASSES } from '../../src/lib/cleanup.js'
import { createTestTempDirectory } from '../temp.js'

// ── helpers ──────────────────────────────────────────────────────────────────

function makeRoot(): string {
  const root = createTestTempDirectory('agent-index-')
  mkdirSync(path.join(root, AGENTS_DIR), { recursive: true })
  return root
}

// ── AC-004: index correctness ─────────────────────────────────────────────

test('AC-004: handleSubagentStart registers agent and writes index entry', () => {
  const root = makeRoot()
  handleSubagentStart(root, {
    event: 'subagentStart' as const,
    subagent_id: 'agent-test-001',
    parent_conversation_id: 'parent-001',
    tool_call_id: 'tc-001',
    task_text: 'A short task',
    subagent_type: 'generalPurpose',
  })

  const index = readAgentIndex(root)
  assert.equal(index.agents.length, 1)
  const entry = index.agents[0]
  assert.ok(entry, 'entry present')
  assert.equal(entry.agent_id, 'agent-test-001')
  assert.equal(entry.status, 'running')
  assert.equal(entry.parent_agent_id, 'parent-001')
  assert.ok(entry.registered_at)
})

test('AC-004: handleSubagentStop marks agent completed and sets stop record', () => {
  const root = makeRoot()
  handleSubagentStart(root, {
    event: 'subagentStart' as const,
    subagent_id: 'agent-stop-001',
  })

  handleSubagentStop(root, {
    event: 'subagentStop' as const,
    subagent_id: 'agent-stop-001',
    status: 'completed' as const,
    tool_call_count: 5,
    modified_file_count: 2,
    duration_seconds: 30,
  })

  const stop = getStopRecord(root, 'agent-stop-001')
  assert.ok(stop, 'stop record present')
  assert.equal(stop.status, 'completed')
  assert.equal(stop.tool_call_count, 5)
  assert.equal(stop.modified_file_count, 2)
})

test('AC-004: handlePreToolUse appends call_started event', () => {
  const root = makeRoot()
  handleSubagentStart(root, {
    event: 'subagentStart' as const,
    subagent_id: 'agent-call-001',
  })

  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: 'agent-call-001',
    tool_name: 'Bash',
    tool_use_id: 'tu-001',
  })

  const latest = getLatestEvent(root, 'agent-call-001')
  assert.ok(latest, 'event present')
  assert.equal(latest.kind, 'call_started')
  assert.equal(latest.tool_name, 'Bash')
})

test('AC-004: handlePostToolUse closes open call and appends call_finished', () => {
  const root = makeRoot()
  handleSubagentStart(root, {
    event: 'subagentStart' as const,
    subagent_id: 'agent-finish-001',
  })
  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: 'agent-finish-001',
    tool_name: 'Bash',
    tool_use_id: 'tu-finish-001',
  })
  handlePostToolUse(root, {
    event: 'postToolUse',
    conversation_id: 'agent-finish-001',
    tool_name: 'Bash',
    tool_use_id: 'tu-finish-001',
  })

  const openCall = getOpenCall(root, 'agent-finish-001')
  assert.equal(openCall, null, 'no open call after postToolUse')
})

test('AC-004: resolveCanonicalId resolves agent id to itself', () => {
  const root = makeRoot()
  handleSubagentStart(root, {
    event: 'subagentStart' as const,
    subagent_id: 'canonical-001',
    tool_call_id: 'tc-alias-001',
  })

  const index = readAgentIndex(root)
  const canonical = resolveCanonicalId(index, 'canonical-001')
  assert.equal(canonical, 'canonical-001')
})

test('AC-004: agentActivitySignature changes when events are appended', () => {
  const root = makeRoot()
  handleSubagentStart(root, {
    event: 'subagentStart' as const,
    subagent_id: 'agent-sig-001',
  })

  const sig1 = agentActivitySignature(root, 'agent-sig-001')

  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: 'agent-sig-001',
    tool_name: 'Read',
    tool_use_id: 'tu-sig-001',
  })

  const sig2 = agentActivitySignature(root, 'agent-sig-001')
  assert.notEqual(sig1, sig2, 'signature changed after new event')
})

// ── AC-009: hook safety ───────────────────────────────────────────────────

test('AC-009: getAgentEntry returns null for unknown agent (no crash)', () => {
  const root = makeRoot()
  const entry = getAgentEntry(root, 'nonexistent-agent')
  assert.equal(entry, null)
})

test('AC-009: getStopRecord returns null for unknown agent (no crash)', () => {
  const root = makeRoot()
  const stop = getStopRecord(root, 'nonexistent-agent')
  assert.equal(stop, null)
})

test('AC-009: getOpenCall returns null when no events exist', () => {
  const root = makeRoot()
  const openCall = getOpenCall(root, 'nonexistent-agent')
  assert.equal(openCall, null)
})

test('AC-009: handleSubagentStart does not record secrets from task text', () => {
  const root = makeRoot()
  handleSubagentStart(root, {
    event: 'subagentStart' as const,
    subagent_id: 'agent-secret-001',
    task_text: 'Do the task with API_KEY=super_secret_value',
  })

  const entry = getAgentEntry(root, 'agent-secret-001')
  assert.ok(entry, 'entry exists')
  const index = readAgentIndex(root)
  const json = JSON.stringify(index)
  assert.ok(
    !json.includes('super_secret_value'),
    'secret value not present in index',
  )
})

// ── AC-011: cleanup retention ─────────────────────────────────────────────

test('AC-011: cleanup artifact classes include agent-index', () => {
  const agentIndexClass = CLEANUP_ARTIFACT_CLASSES.find(
    (c) => c.name === 'agent-index',
  )
  assert.ok(agentIndexClass, 'agent-index class present')
  assert.ok(
    agentIndexClass.paths.includes('runtime/logs/agents'),
    'paths includes runtime/logs/agents',
  )
  assert.equal(agentIndexClass.disposal, 'delete')
})
