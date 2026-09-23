import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import type { ReferenceGraph } from '../../src/lib/debloat/graph.js'
import { loadIntentClassifier } from '../../src/lib/debloat/intent.js'
import type { Facility } from '../../src/lib/debloat/inventory.js'
import { scanUsage } from '../../src/lib/debloat/usage.js'
import { createTestTempDirectory } from '../temp.js'

const REPO_ROOT = process.cwd()

function write(root: string, relative: string, content: string): void {
  const absolute = path.join(root, relative)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content, 'utf8')
}

function facility(
  category: Facility['category'],
  name: string,
  ownedPath: string | null,
): Facility {
  return {
    id: `${category}:${name}`,
    category,
    name,
    path: ownedPath,
    owned_paths: ownedPath ? [ownedPath] : [],
    selectable: true,
    node_kind: 'facility',
    protected: false,
  }
}

function emptyGraph(facilities: readonly Facility[]): ReferenceGraph {
  return {
    references: [],
    incoming: new Map(facilities.map((entry) => [entry.id, []])),
    outgoing: new Map(facilities.map((entry) => [entry.id, new Set()])),
  }
}

/** One operator turn, wrapped the way Cursor writes it. */
function userTurn(text: string, injected = ''): string {
  return JSON.stringify({
    role: 'user',
    message: {
      content: [
        {
          type: 'text',
          text: `${injected}<timestamp>now</timestamp>\n<user_query>\n${text}\n</user_query>`,
        },
      ],
    },
  })
}

function assistantText(text: string): string {
  return JSON.stringify({
    role: 'assistant',
    message: { content: [{ type: 'text', text }] },
  })
}

function toolUse(name: string, input: Record<string, unknown>): string {
  return JSON.stringify({
    role: 'assistant',
    message: { content: [{ type: 'tool_use', name, input }] },
  })
}

function commandMarker(command: string): string {
  return `<cursor_commands>\n\n--- Cursor Command: ${command} ---\nBody.\n--- End Command ---\n</cursor_commands>\n`
}

test('usage coverage reads every evidence root and streams oversized transcripts', () => {
  const root = createTestTempDirectory('debloat-usage')
  const transcripts = path.join(root, 'transcripts')
  const widget = facility(
    'command',
    'pan-widget',
    'library/cursor/commands/pan-widget.md',
  )

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

  const result = scanUsage(root, [widget], {
    windowStart: new Date(Date.now() - 60_000),
    graph: emptyGraph([widget]),
    classifier: loadIntentClassifier(REPO_ROOT),
    transcriptsRoot: transcripts,
  })
  const usage = result.usage.find((entry) => entry.facility_id === widget.id)

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

test('chat evidence counts invocations, directions, and work-time lookups, and ignores questions, pastes, and debloat sessions', () => {
  const root = createTestTempDirectory('debloat-usage-chat')
  const transcripts = path.join(root, 'transcripts')
  const facilities = [
    facility('command', 'pan-widget', 'library/cursor/commands/pan-widget.md'),
    facility('persona', 'gadget', 'library/personas/gadget.md'),
    facility('cli-subcommand', 'widgetize', null),
    facility('mode', 'tinker', null),
    facility('skill', 'gizmo', 'library/skills/gizmo.md'),
    facility('skill', 'asked-about', 'library/skills/asked-about.md'),
    facility('skill', 'directed', 'library/skills/directed.md'),
    facility('skill', 'edited', 'library/skills/edited.md'),
    facility('policy', 'PASTE-001', 'governance/policies/PASTE-001.json'),
    facility('policy', 'ASKED-001', 'governance/policies/ASKED-001.json'),
    facility(
      'policy',
      'DEBLOAT-ONLY-001',
      'governance/policies/DEBLOAT-ONLY-001.json',
    ),
    facility('policy', 'INBOX-001', 'governance/policies/INBOX-001.json'),
    facility(
      'policy',
      'INBOX-LISTED-001',
      'governance/policies/INBOX-LISTED-001.json',
    ),
  ]
  const pastedLine =
    '- `PASTE-001`: 5 added instructions. A single-shot timer replaces the ticks.'

  write(
    transcripts,
    'work/work.jsonl',
    [
      // The operator invokes a command; Cursor writes the marker and the
      // operator's own slash line.
      userTurn('/pan-widget tidy the widgets', commandMarker('pan-widget')),
      // The agent launches a persona, runs a subcommand under a mode, and
      // reads a skill while doing that work.
      toolUse('Task', { subagent_type: 'pan-gadget', prompt: 'go' }),
      toolUse('Shell', {
        command: './bin/pan widgetize --mode tinker --json',
      }),
      toolUse('Read', { path: `${root}/library/skills/gizmo.md` }),
      // A read followed by an edit of the same file is development.
      toolUse('Read', { path: `${root}/library/skills/edited.md` }),
      toolUse('StrReplace', {
        path: `${root}/library/skills/edited.md`,
        old_string: 'a',
        new_string: 'b',
      }),
      // The agent reports, and the operator pastes that report back later.
      assistantText(`Summary:\n${pastedLine}\nDone.`),
      // A direction to apply a skill is functional usage.
      userTurn(
        'Read `library/skills/directed.md` and apply it before you finish.',
      ),
      // A question is not, and neither is a lookup made to answer it.
      userTurn(
        'what does `library/skills/asked-about.md` say about ASKED-001?',
      ),
      toolUse('Read', { path: `${root}/library/skills/asked-about.md` }),
      toolUse('Grep', { pattern: 'ASKED-001', path: root }),
    ].join('\n'),
  )
  write(
    transcripts,
    'paste/paste.jsonl',
    [userTurn(`Here is what the other chat said:\n${pastedLine}`)].join('\n'),
  )
  write(
    transcripts,
    'debloat/debloat.jsonl',
    [
      userTurn('/pan-debloat', commandMarker('pan-debloat')),
      userTurn(
        'Run `pan-widget`, apply `DEBLOAT-ONLY-001`, and read `library/skills/gizmo.md`.',
      ),
      toolUse('Shell', { command: './bin/pan debloat scan --days 30 --json' }),
    ].join('\n'),
  )
  write(
    root,
    'runtime/inbox/queue/request.md',
    [
      '# Request',
      '',
      'Apply `INBOX-001` to every durable artifact this run writes.',
      '',
      '## Files touched',
      '',
      '- `governance/policies/INBOX-LISTED-001.json`',
      '',
    ].join('\n'),
  )

  const result = scanUsage(root, facilities, {
    windowStart: new Date(Date.now() - 60_000),
    graph: emptyGraph(facilities),
    classifier: loadIntentClassifier(REPO_ROOT),
    transcriptsRoot: transcripts,
  })
  const tier = (id: string): string | undefined =>
    result.usage.find((entry) => entry.facility_id === id)?.evidence_tier
  const incidental = (id: string): number | undefined =>
    result.usage.find((entry) => entry.facility_id === id)
      ?.incidental_mention_count

  assert.equal(tier('command:pan-widget'), 'execution', 'command marker')
  assert.equal(tier('persona:gadget'), 'execution', 'subagent launch')
  assert.equal(tier('cli-subcommand:widgetize'), 'execution', 'pan invocation')
  assert.equal(tier('mode:tinker'), 'execution', '--mode option')
  assert.equal(tier('skill:gizmo'), 'direction', 'lookup during work')
  assert.equal(tier('skill:directed'), 'direction', 'operator direction')
  assert.equal(tier('policy:INBOX-001'), 'direction', 'inbox direction')

  assert.equal(tier('skill:asked-about'), 'none', 'lookup under a question')
  assert.equal(tier('skill:edited'), 'none', 'read before an edit')
  assert.equal(tier('policy:ASKED-001'), 'none', 'question mention')
  assert.equal(tier('policy:PASTE-001'), 'none', 'pasted agent report')
  assert.equal(tier('policy:DEBLOAT-ONLY-001'), 'none', 'debloat session')
  assert.equal(tier('policy:INBOX-LISTED-001'), 'none', 'inbox list entry')

  assert.equal(incidental('policy:PASTE-001'), 1, 'paste counted once')
  assert.ok((incidental('policy:ASKED-001') ?? 0) >= 1)
  assert.equal(incidental('policy:DEBLOAT-ONLY-001'), 0)

  assert.equal(result.sources.debloat_sessions_excluded, 1)
  assert.equal(result.sources.transcript_files, 3)
  assert.equal(result.sources.command_invocations, 1)
  assert.equal(result.sources.agent_invocations, 3)
  assert.equal(result.sources.agent_lookups, 1)
  assert.ok(result.sources.incidental_mentions >= 4)
})

test('a functional direction in AGENTS.md anchors reachability, and a non-functional prose edge does not', () => {
  const root = createTestTempDirectory('debloat-usage-anchor')
  const anchored = facility('skill', 'anchored', 'library/skills/anchored.md')
  const listed = facility('skill', 'listed', 'library/skills/listed.md')
  const graph: ReferenceGraph = {
    references: [
      {
        from: 'AGENTS.md',
        referrer_class: 'doc',
        owner_facility: null,
        to: anchored.id,
        token: 'library/skills/anchored.md',
        functional: true,
      },
      {
        from: 'AGENTS.md',
        referrer_class: 'doc',
        owner_facility: null,
        to: listed.id,
        token: 'library/skills/listed.md',
        functional: false,
      },
    ],
    incoming: new Map([
      [anchored.id, []],
      [listed.id, []],
    ]),
    outgoing: new Map([
      [anchored.id, new Set()],
      [listed.id, new Set()],
    ]),
  }

  const result = scanUsage(root, [anchored, listed], {
    windowStart: new Date(Date.now() - 60_000),
    graph,
    classifier: loadIntentClassifier(REPO_ROOT),
    transcriptsRoot: null,
  })
  const tier = (id: string): string | undefined =>
    result.usage.find((entry) => entry.facility_id === id)?.evidence_tier

  assert.equal(tier(anchored.id), 'reachable')
  assert.equal(tier(listed.id), 'none')
})
