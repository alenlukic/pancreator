import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { computeClosure } from '../../src/lib/debloat/closure.js'
import { buildReferenceGraph } from '../../src/lib/debloat/graph.js'
import { collectFacilities } from '../../src/lib/debloat/inventory.js'
import { PanError } from '../../src/lib/errors.js'
import { createTestTempDirectory } from '../temp.js'

function write(root: string, relative: string, content: string): void {
  const absolute = path.join(root, relative)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content, 'utf8')
}

function policy(id: string, guidance?: string): string {
  return `${JSON.stringify(
    {
      id,
      title: id,
      severity: 'hard',
      summary: `${id} summary.`,
      instructions: [`Agents MUST follow ${id}.`],
      ...(guidance
        ? {
            guidance_sources: [
              { path: guidance, read_trigger: `Read before ${id}.` },
            ],
          }
        : {}),
    },
    null,
    2,
  )}\n`
}

/**
 * A minimal harness tree.
 *
 * `widget` is the facility under test and nothing outside its own cluster
 * references it. `staple` is referenced from surviving content, so every test
 * that expects a survivor can point at the same one.
 */
function createWorkspace(): string {
  const root = createTestTempDirectory('debloat-graph')

  write(root, 'AGENTS.md', '# Card\n')
  write(
    root,
    'config.json',
    `${JSON.stringify({ defaults: { widgeteer: '', stapler: '' } }, null, 2)}\n`,
  )
  write(
    root,
    'governance/policies/WIDGET-001.json',
    policy('WIDGET-001', 'library/skills/widget-craft.md'),
  )
  write(root, 'governance/policies/STAPLE-001.json', policy('STAPLE-001'))
  write(
    root,
    'governance/registries/policy_lookup_table.json',
    `${JSON.stringify(
      {
        schema_version: 1,
        rows: [
          {
            persona: 'widgeteer',
            workflow: '*',
            stage: '*',
            policies: ['WIDGET-001'],
          },
          {
            persona: 'stapler',
            workflow: '*',
            stage: '*',
            policies: ['STAPLE-001'],
          },
        ],
      },
      null,
      2,
    )}\n`,
  )
  write(
    root,
    'governance/registries/command_governance.json',
    `${JSON.stringify(
      {
        schema_version: 4,
        read_only_commands: [],
        card_commands: [{ command: 'pan-widget', card_mode: 'widget' }],
        supervisor_commands: [],
        target_mutating_commands: [],
        pending_card_steps: [],
      },
      null,
      2,
    )}\n`,
  )
  write(root, 'library/personas/widgeteer.md', '# Widgeteer\n')
  write(root, 'library/personas/stapler.md', '# Stapler\n')
  write(root, 'library/cursor/agents/widgeteer.md', '# Agent\n')
  write(
    root,
    'library/cursor/commands/pan-widget.md',
    'Run `pan-widgeteer` and read `library/skills/widget-craft.md`.\n',
  )
  write(root, 'library/skills/widget-craft.md', '# Widget craft\n')
  write(
    root,
    'library/skills/index.md',
    '- [`widget-craft.md`](widget-craft.md)\n- [`shared.md`](shared.md)\n',
  )
  // Nothing references `shared.md` in the base tree, so the cascade never
  // reaches it. The test that needs a spared facility wires it up itself.
  write(root, 'library/skills/shared.md', '# Shared technique\n')

  return root
}

test('the graph reads typed registry edges and prose references alike', () => {
  const root = createWorkspace()
  const graph = buildReferenceGraph(root, collectFacilities(root))
  const edge = (from: string, to: string): boolean =>
    graph.references.some(
      (reference) => reference.from === from && reference.to === to,
    )

  // Policy guidance, a lookup row, and a command's card mode are structure.
  assert.ok(
    edge('governance/policies/WIDGET-001.json', 'skill:widget-craft'),
    'policy guidance reaches its skill',
  )
  assert.ok(
    edge('governance/registries/policy_lookup_table.json', 'policy:WIDGET-001'),
    'a lookup row reaches its policy',
  )

  // Prose in the command file is not structure, and still has to be read.
  assert.ok(
    edge('library/cursor/commands/pan-widget.md', 'persona:widgeteer'),
    'command prose reaches the persona it delegates',
  )

  // A registry that names a facility by bare name is recorded so the closure
  // can repair the row. The bare name is deliberately not a scan token.
  assert.ok(
    edge('config.json', 'persona:widgeteer'),
    'the model mapping is recorded as a registry reference',
  )
})

test('a sibling TypeScript import resolves to the module it names', () => {
  const root = createWorkspace()

  write(root, 'src/lib/validators/gadget.ts', 'export const GADGET = 1\n')
  write(
    root,
    'src/lib/validators/stage-validators.ts',
    "import { GADGET } from './gadget.js'\n\nexport const USED = GADGET\n",
  )

  const graph = buildReferenceGraph(root, collectFacilities(root))

  assert.ok(
    graph.references.some(
      (reference) =>
        reference.from === 'src/lib/validators/stage-validators.ts' &&
        reference.to === 'validator:gadget',
    ),
    "`./gadget.js` shares no text with the module's repository path",
  )
})

test('the closure cascades to content nothing surviving references', () => {
  const root = createWorkspace()
  const facilities = collectFacilities(root)
  const closure = computeClosure(
    facilities,
    buildReferenceGraph(root, facilities),
    ['command:pan-widget'],
    { sessionId: '20260920-000000-abcdef' },
  )

  // The command exclusively owned the persona chain, so it leaves too.
  assert.deepEqual(closure.cascaded, [
    'persona:widgeteer',
    'policy:WIDGET-001',
    'skill:widget-craft',
  ])
  assert.deepEqual(closure.remove.map((entry) => entry.path).sort(), [
    'governance/policies/WIDGET-001.json',
    'library/cursor/agents/widgeteer.md',
    'library/cursor/commands/pan-widget.md',
    'library/personas/widgeteer.md',
    'library/skills/widget-craft.md',
  ])

  // An index and a registry lose a row rather than the whole file.
  const edits = new Map(closure.edit.map((entry) => [entry.path, entry]))

  assert.equal(edits.get('library/skills/index.md')?.referrer_class, 'registry')
  assert.equal(edits.get('config.json')?.referrer_class, 'registry')
  assert.ok(
    edits.has('governance/registries/policy_lookup_table.json'),
    'the lookup row that resolved the removed policy needs repair',
  )
  assert.equal(
    closure.remove.some((entry) => entry.path === 'library/skills/index.md'),
    false,
    'a file that enumerates survivors is never deleted',
  )
})

test('a surviving referrer spares a facility and says which one', () => {
  const root = createWorkspace()

  // Both personas read the shared skill, so removing one must not strand it.
  write(
    root,
    'library/personas/widgeteer.md',
    '# Widgeteer\n\nRead `library/skills/shared.md`.\n',
  )
  write(
    root,
    'library/personas/stapler.md',
    '# Stapler\n\nRead `library/skills/shared.md`.\n',
  )

  const facilities = collectFacilities(root)
  const closure = computeClosure(
    facilities,
    buildReferenceGraph(root, facilities),
    ['persona:widgeteer'],
    { sessionId: '20260920-000000-abcdef' },
  )
  const spared = closure.retained_because.find(
    (entry) => entry.facility_id === 'skill:shared',
  )

  assert.ok(spared, 'the shared skill is reported as spared')
  assert.deepEqual(
    spared?.retained_by.map((entry) => entry.path),
    ['library/personas/stapler.md'],
  )
  assert.equal(closure.cascaded.includes('skill:shared'), false)
})

test('a test dedicated to removed facilities leaves, a shared one is repaired', () => {
  const root = createWorkspace()

  write(
    root,
    'tests/unit/widget.test.ts',
    "import '../../library/personas/widgeteer.md'\n",
  )
  write(
    root,
    'tests/unit/both.test.ts',
    'covers `library/personas/widgeteer.md` and `library/personas/stapler.md`\n',
  )

  const facilities = collectFacilities(root)
  const closure = computeClosure(
    facilities,
    buildReferenceGraph(root, facilities),
    ['persona:widgeteer'],
    { sessionId: '20260920-000000-abcdef' },
  )

  assert.ok(
    closure.remove.some(
      (entry) =>
        entry.path === 'tests/unit/widget.test.ts' &&
        entry.kind === 'dedicated_test',
    ),
    'a test whose every reference is removed leaves with them',
  )
  assert.ok(
    closure.edit.some((entry) => entry.path === 'tests/unit/both.test.ts'),
    'a test that also covers a survivor is repaired, not deleted',
  )
})

test('the closure refuses a protected facility', () => {
  const root = createWorkspace()

  write(
    root,
    'governance/policies/PRINCIPLES-001.json',
    policy('PRINCIPLES-001'),
  )

  const facilities = collectFacilities(root)
  const graph = buildReferenceGraph(root, facilities)

  assert.ok(
    facilities.find((entry) => entry.id === 'policy:PRINCIPLES-001')?.protected,
  )
  assert.throws(
    () =>
      computeClosure(facilities, graph, ['policy:PRINCIPLES-001'], {
        sessionId: '20260920-000000-abcdef',
      }),
    (error: unknown) =>
      error instanceof PanError && error.code === 'DEBLOAT_FACILITY_PROTECTED',
  )
})
