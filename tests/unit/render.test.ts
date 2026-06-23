import assert from 'node:assert/strict'
import test from 'node:test'

import { renderStatus, renderTaskRecord } from '../../src/lib/render.js'
import type { TaskRecord } from '../../src/lib/types.js'

function baseRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    schema_version: 1,
    run_id: 'run-1',
    invocation_id: 'implement-1-abcd',
    stage: {
      slug: 'implement',
      title: 'Implementation',
      persona: 'coder',
    },
    outcome: 'success',
    summary: 'Implemented the feature and mapped evidence to each criterion.',
    artifacts: [
      {
        path: 'runtime/logs/workflows/run-1/artifacts/implement.md',
        description: 'Implementation summary',
      },
    ],
    risks: [],
    unknowns: [],
    evaluation: {
      validation_errors: [],
      deterministic: [
        {
          id: 'implement.lint',
          type: 'shell',
          hard: true,
          passed: true,
          evidence_path: 'runtime/.../lint.log',
          explanation: 'Lint passed.',
          workspace_fingerprint: 'abc123',
        },
      ],
      self: [],
    },
    workspace_fingerprint: 'abc123',
    next_state: 'review',
    timestamp: '2026-06-22T00:00:00.000Z',
    ...overrides,
  }
}

test('task record is markdown-primary with outcome emoji and technical appendix', () => {
  const markdown = renderTaskRecord(baseRecord())

  assert.match(markdown, /^# ✅ Implementation: success/m)
  assert.match(markdown, /## 📦 Work completed/)
  assert.match(markdown, /## 🔍 Checks/)
  assert.match(markdown, /## Technical appendix/)
  assert.match(markdown, /"workspace_fingerprint": "abc123"/)
  assert.match(markdown, /- None declared\./)
})

test('task record surfaces validation issues and a failure outcome', () => {
  const markdown = renderTaskRecord(
    baseRecord({
      outcome: 'failure',
      risks: ['Coverage may dip on edge cases.'],
      unknowns: ['Behavior under concurrent runs is unverified.'],
      evaluation: {
        validation_errors: ['data.implementation MUST be object'],
        deterministic: [],
        self: [],
      },
    }),
  )

  assert.match(markdown, /^# ❌ Implementation: failure/m)
  assert.match(markdown, /## ❌ Output validation issues/)
  assert.match(markdown, /- data\.implementation MUST be object/)
  assert.match(markdown, /⚠️ Risk: Coverage may dip/)
  assert.match(markdown, /❓ Unknown: Behavior under concurrent runs/)
  assert.match(markdown, /No deterministic checks were declared/)
})

test('status summary includes the pause reason when present', () => {
  const status = renderStatus({
    schema_version: 1,
    run_id: 'run-1',
    workflow_slug: 'dev',
    workflow_snapshot: { path: 'workflow.json', sha256: 'abc' },
    workspace_root: '.',
    title: 'Run',
    status: 'paused',
    current_stage: 'implement',
    pending_action: { type: 'operator_decision' },
    current_invocation: null,
    request: {
      source_path: 'request.md',
      stored_path: 'runtime/request.md',
      sha256: 'abc',
    },
    revision: 4,
    transition_count: 2,
    consecutive_failures: 0,
    attempts: {},
    stage_history: [],
    created_at: '2026-06-22T00:00:00.000Z',
    updated_at: '2026-06-22T00:00:00.000Z',
    limits: {
      max_total_transitions: 18,
      max_stage_attempts: 3,
      max_consecutive_failures: 3,
    },
    pause_reason: 'Maximum consecutive failures exceeded.',
  })

  assert.match(status, /Status: paused/)
  assert.match(status, /Pause reason: Maximum consecutive failures exceeded\./)
})
