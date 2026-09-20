import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import type { ReferenceGraph } from '../../src/lib/debloat/graph.js'
import type { Facility } from '../../src/lib/debloat/inventory.js'
import { scanUsage } from '../../src/lib/debloat/usage.js'
import { createTestTempDirectory } from '../temp.js'

function write(root: string, relative: string, content: string): void {
  const absolute = path.join(root, relative)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content, 'utf8')
}

test('usage coverage reads every evidence root and streams oversized transcripts', () => {
  const root = createTestTempDirectory('debloat-usage')
  const transcripts = path.join(root, 'transcripts')
  const facility: Facility = {
    id: 'command:pan-widget',
    category: 'command',
    name: 'pan-widget',
    path: 'library/cursor/commands/pan-widget.md',
    owned_paths: ['library/cursor/commands/pan-widget.md'],
    selectable: true,
    node_kind: 'facility',
    protected: false,
  }
  const graph: ReferenceGraph = {
    references: [],
    incoming: new Map([[facility.id, []]]),
    outgoing: new Map([[facility.id, new Set()]]),
  }

  write(
    transcripts,
    'oversized.jsonl',
    `--- Cursor Command: pan-widget ---\n${'x'.repeat(32 * 1024 * 1024 + 1)}`,
  )

  for (const relative of [
    'runtime/logs/workflows/run/agent/state.json',
    'runtime/logs/cohorts/cohort/record.json',
    'runtime/logs/best-of-n/session/record.json',
    'runtime/logs/evals/eval/record.json',
    'runtime/logs/horizon/session/record.json',
    'runtime/logs/sessions/session/card.md',
    'runtime/inbox/queue/request.md',
  ]) {
    write(root, relative, '{}\n')
  }

  const result = scanUsage(root, [facility], {
    windowStart: new Date(Date.now() - 60_000),
    graph,
    transcriptsRoot: transcripts,
  })
  const usage = result.usage.find((entry) => entry.facility_id === facility.id)

  assert.equal(usage?.evidence_tier, 'execution')
  assert.equal(result.sources.transcript_files, 1)
  assert.deepEqual(result.sources.unread, [])

  for (const source of [
    'workflow_run_records',
    'cohort_records',
    'best_of_n_records',
    'eval_records',
    'horizon_records',
    'standalone_session_records',
    'operator_request_files',
    'transcript_files',
  ]) {
    assert.equal(result.sources.by_source[source], 1, source)
  }
})
