import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  buildModuleGraph,
  dataSeedKeys,
  extractSpecialReferences,
  isDataReference,
  laneTests,
  parseSpecifiersByRegex,
  resolveSpecifier,
  isReExportFacade,
  reverseClosure,
  selectImpactedTests,
} from '../../src/lib/test-impact.js'
import type { ModuleGraph } from '../../src/lib/test-impact.js'
import { createTestTempDirectory } from '../temp.js'
import { createSyntheticTree } from './test-impact-helpers.js'

const REPO_ROOT = process.cwd()

function elapsedCpuMs(startedAt: NodeJS.CpuUsage): number {
  const elapsed = process.cpuUsage(startedAt)

  return (elapsed.user + elapsed.system) / 1_000
}

test('parseSpecifiersByRegex separates runtime and type-only specifiers', () => {
  const parsed = parseSpecifiersByRegex(
    [
      `import a from './a.js'`,
      `import { b, c } from "./b.js"`,
      `import type { D } from './d.js'`,
      `export * from './e.js'`,
      `export { f } from './f.js'`,
      `export type { G } from './g.js'`,
      `const h = await import('./h.js')`,
      `import 'node:fs'`,
    ].join('\n'),
  )

  assert.deepEqual(parsed.runtime, [
    './a.js',
    './b.js',
    './e.js',
    './f.js',
    './h.js',
    'node:fs',
  ])
  assert.deepEqual(parsed.typeOnly, ['./d.js', './g.js'])
})

test('resolveSpecifier maps relative .js specifiers to .ts files and ignores packages', () => {
  const files = new Set([
    'src/lib/a.ts',
    'src/lib/dir/index.ts',
    'tests/helpers.ts',
  ])

  assert.equal(
    resolveSpecifier('src/cli.ts', './lib/a.js', files),
    'src/lib/a.ts',
  )
  assert.equal(
    resolveSpecifier('tests/unit/x.test.ts', '../../src/lib/a.js', files),
    'src/lib/a.ts',
  )
  assert.equal(
    resolveSpecifier('src/cli.ts', './lib/dir', files),
    'src/lib/dir/index.ts',
  )
  assert.equal(resolveSpecifier('src/cli.ts', 'node:path', files), null)
  assert.equal(resolveSpecifier('src/cli.ts', 'typescript', files), null)
  assert.equal(resolveSpecifier('src/cli.ts', './missing.js', files), null)
})

test('buildModuleGraph records imports, dependents, bin and fixture references', async () => {
  const root = createSyntheticTree()

  try {
    for (const parser of ['typescript', 'regex'] as const) {
      const startedAt = process.cpuUsage()
      const graph = await buildModuleGraph(root, { parser })
      const cpuMs = elapsedCpuMs(startedAt)

      assert.equal(graph.parser, parser)
      assert.ok(cpuMs < 1_000, `graph build used ${cpuMs} ms of CPU`)
      assert.deepEqual(
        [...(graph.imports.get('src/lib/feature.ts') ?? [])],
        ['src/lib/core.ts'],
      )
      assert.deepEqual(
        [...(graph.dependents.get('src/lib/core.ts') ?? [])].sort(),
        [
          'src/lib/feature.ts',
          'tests/helpers.ts',
          'tests/integration/pre-release.test.ts',
          'tests/secondary/installer.test.ts',
          'tests/unit/core.test.ts',
        ],
      )
      // The dynamic import in the helper is a runtime edge.
      assert.ok(graph.imports.get('tests/helpers.ts')?.has('src/lib/typed.ts'))
      // A type-only import is not a runtime edge but is remembered.
      assert.equal(graph.dependents.get('src/lib/types.ts'), undefined)
      assert.ok(graph.typeOnlyTargets.has('src/lib/types.ts'))
      // A test that spawns the CLI depends on src/cli.ts.
      assert.ok(
        graph.dependents.get('src/cli.ts')?.has('tests/regression/cli.test.ts'),
      )
      // A change to the script itself still reaches a module that names it,
      // because some source modules do spawn bin scripts.
      assert.deepEqual([...(graph.binReferences.get('bin/pan') ?? [])].sort(), [
        'tests/regression/cli.test.ts',
        'tests/unit/message.test.ts',
      ])
      // References inside an imported helper reach the tests that import it.
      assert.deepEqual(
        [...(graph.binReferences.get('bin/lint') ?? [])].sort(),
        [
          'tests/regression/lint-script.test.ts',
          'tests/regression/via-helper.test.ts',
        ],
      )
      assert.deepEqual(
        [
          ...(graph.fixtureReferences.get('tests/fixtures/sample') ?? []),
        ].sort(),
        [
          'tests/regression/fixture-user.test.ts',
          'tests/regression/via-helper.test.ts',
        ],
      )
      assert.ok(
        graph.dependents
          .get('src/cli.ts')
          ?.has('tests/regression/via-helper.test.ts'),
        'a CLI reference in a helper makes its tests depend on src/cli.ts',
      )
      // The helper itself is not a lane test and gets no reference edge.
      assert.ok(
        ![...(graph.binReferences.get('bin/lint') ?? [])].includes(
          'tests/regression/cli-helpers.ts',
        ),
      )
      // Integration runs before release only, so it is never a lane test.
      assert.deepEqual(laneTests(graph), [
        'tests/regression/cli.test.ts',
        'tests/regression/fixture-user.test.ts',
        'tests/regression/lint-script.test.ts',
        'tests/regression/via-helper.test.ts',
        'tests/unit/core.test.ts',
        'tests/unit/feature.test.ts',
        'tests/unit/helper-user.test.ts',
        'tests/unit/message.test.ts',
        'tests/unit/only-types.test.ts',
      ])
      // A source module that names the CLI in text does not tie its
      // importers to the CLI closure.
      assert.ok(
        !graph.dependents.get('src/cli.ts')?.has('tests/unit/message.test.ts'),
      )
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('reverseClosure reports the seed and hop depth and honors a depth bound', async () => {
  const root = createSyntheticTree()

  try {
    const graph = await buildModuleGraph(root)
    const full = reverseClosure(graph, ['src/lib/core.ts'])

    assert.deepEqual(full.get('src/lib/core.ts'), {
      seed: 'src/lib/core.ts',
      depth: 0,
    })
    assert.deepEqual(full.get('tests/unit/core.test.ts'), {
      seed: 'src/lib/core.ts',
      depth: 1,
    })
    assert.deepEqual(full.get('tests/unit/feature.test.ts'), {
      seed: 'src/lib/core.ts',
      depth: 2,
    })
    assert.deepEqual(full.get('tests/regression/cli.test.ts'), {
      seed: 'src/lib/core.ts',
      depth: 3,
    })

    const direct = reverseClosure(graph, ['src/lib/core.ts'], 1)

    assert.ok(direct.has('tests/unit/core.test.ts'))
    assert.ok(!direct.has('tests/unit/feature.test.ts'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a re-export facade is transparent to the hop depth', async () => {
  const root = createTestTempDirectory('pan-test-impact-facade-')
  const write = (relative: string, content: string): void => {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
    writeFileSync(path.join(root, relative), content)
  }

  try {
    write('src/lib/split/part.ts', 'export const part = 1\n')
    write(
      'src/lib/split.ts',
      "// Facade kept for importers.\nexport { part } from './split/part.js'\nexport type { Shape } from './split/part.js'\n",
    )
    write(
      'tests/unit/split.test.ts',
      "import { part } from '../../src/lib/split.js'\ntest(String(part))\n",
    )

    const graph = await buildModuleGraph(root)
    const direct = reverseClosure(graph, ['src/lib/split/part.ts'], 1)

    assert.ok(graph.facades?.has('src/lib/split.ts'))
    assert.deepEqual(direct.get('tests/unit/split.test.ts'), {
      seed: 'src/lib/split/part.ts',
      depth: 1,
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('only a module of nothing but re-exports is a facade', () => {
  assert.equal(isReExportFacade("export * from './a.js'\n"), true)
  assert.equal(
    isReExportFacade("/** doc */\nexport { a, b } from './a.js'\n"),
    true,
  )
  assert.equal(
    isReExportFacade("export { a } from './a.js'\nexport const b = 1\n"),
    false,
  )
  assert.equal(isReExportFacade('export const b = 1\n'), false)
})

test('self-test: a change to src/lib/naming.ts selects the naming test and not the whole lane', async () => {
  const graph = await buildModuleGraph(REPO_ROOT)
  const selected = selectImpactedTests(graph, ['src/lib/naming.ts'], {
    depth: 1,
  })

  assert.ok(selected.selected.includes('tests/unit/naming.test.ts'))
  assert.equal(selected.depths['tests/unit/naming.test.ts'], 1)
  assert.ok(
    selected.selected.length < selected.lane_count,
    `selected ${selected.selected.length} of ${selected.lane_count}`,
  )
  assert.ok(
    selected.selected.length <= selected.lane_count * 0.25,
    `direct selection ${selected.selected.length} of ${selected.lane_count}`,
  )
  assert.ok(
    !selected.selected.some((file) => file.startsWith('tests/secondary/')),
  )

  // A governance policy is data rather than an import, and its seed reaches
  // the governance tests alone.
  const policy = selectImpactedTests(graph, [
    'governance/policies/SPOT-001.json',
  ])

  assert.ok(
    policy.selected.length > 0 &&
      policy.selected.every(
        (file) =>
          file.startsWith('tests/unit/') ||
          file.startsWith('tests/regression/'),
      ),
    `selected ${policy.selected.join(', ')}`,
  )
  assert.deepEqual(policy.unreached, [])
  assert.ok(
    policy.selected.length <= policy.lane_count * 0.25,
    `selected ${policy.selected.length} of ${policy.lane_count}`,
  )
})

// tests/helpers.ts imports the engine, so every test that wanted only a
// fixture was selected by any engine change and paid for the whole graph.
// The fixture builder was split out; this pins the property that made the
// split worth doing, which prose in the module cannot enforce.
function closureOf(graph: ModuleGraph, entry: string): Set<string> {
  const seen = new Set<string>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop() as string

    if (seen.has(file)) {
      continue
    }

    seen.add(file)
    queue.push(...(graph.imports.get(file) ?? []))
  }

  return seen
}

test('self-test: the fixture helper reaches no engine module', async () => {
  const graph = await buildModuleGraph(REPO_ROOT)
  const seen = closureOf(graph, 'tests/fixture-template.ts')

  // The run-execution stack. A fixture builder writes files and drives git;
  // it never needs to know how a run is laid out or advanced. The engine
  // facade re-exports `src/lib/engine/`, so every module there counts too.
  const engineModules = [
    'src/cli.ts',
    'src/lib/engine.ts',
    'src/lib/inbox.ts',
    'src/lib/run-layout.ts',
    'src/lib/state.ts',
    'src/lib/suite-profile.ts',
    'src/lib/verification.ts',
    'src/lib/workflow.ts',
  ]
  const engine = [...seen]
    .filter(
      (file) =>
        engineModules.includes(file) ||
        file.startsWith('src/lib/engine/') ||
        file.startsWith('src/lib/validators/') ||
        file.startsWith('src/lib/workflow/'),
    )
    .sort()

  assert.deepEqual(engine, [], `fixture helper reaches ${engine.join(', ')}`)
  assert.ok(seen.has('tests/shared-template.ts'))

  // tests/helpers.ts keeps the engine, because the tests that drive runs need
  // it. The point of the split is that the fixture side no longer carries it:
  // a fixture-only test now sits on a closure a fraction of the size.
  assert.ok(
    seen.size * 3 < closureOf(graph, 'tests/helpers.ts').size,
    `fixture ${seen.size}, helpers ${closureOf(graph, 'tests/helpers.ts').size}`,
  )
})

test('extractSpecialReferences finds every known bin, fixture, and CLI reference in one pass', () => {
  const source = [
    `spawn(path.join(root, 'bin', 'pan'))`,
    `spawnSync('bash', ['bin/lint'])`,
    `spawnSync('bash', ['bin/unknown-script'])`,
    `const a = 'tests/fixtures/sample/case.json'`,
    `const b = path.join('fixtures', 'other')`,
    `const c = 'tests/fixtures/sample-extended/x.json'`,
  ].join('\n')
  const refs = extractSpecialReferences(
    source,
    ['pan', 'lint'],
    ['sample', 'other'],
  )

  assert.deepEqual([...refs.bin].sort(), ['lint', 'pan'])
  // `sample-extended` is not `sample`, matching the one-name predicate.
  assert.deepEqual([...refs.fixtures].sort(), ['other', 'sample'])
  assert.equal(refs.cli, true)

  const plain = extractSpecialReferences(
    `const CLI = path.join(root, 'dist', 'src', 'cli.js')`,
    ['lint'],
    [],
  )

  assert.deepEqual([...plain.bin], [])
  assert.equal(plain.cli, true)
  assert.equal(extractSpecialReferences('nothing here', ['pan'], []).cli, false)
})

test('isDataReference accepts data paths, ids, and filenames, and nothing else', () => {
  for (const literal of [
    'governance',
    'governance/policies',
    'governance/policies/SPOT-001.json',
    'library/personas/spotfixer.md',
    'docs/operator-guide.md',
    'config.json',
    'SPOT-001',
    'HARNESS-REPAIR-VALIDATE-001',
    'implement.md',
  ]) {
    assert.equal(isDataReference(literal), true, literal)
  }

  for (const literal of [
    'src/lib/test-impact.ts',
    'tests/unit/policies.test.ts',
    'runtime/logs/workflows',
    'governanceish',
    'SPOT',
    'spotfixer',
    'a plain sentence',
  ]) {
    assert.equal(isDataReference(literal), false, literal)
  }
})

test('dataSeedKeys names the path, its filename, its id, and ancestors below the root', () => {
  assert.deepEqual(dataSeedKeys('governance/policies/SPOT-001.json'), [
    'governance/policies/SPOT-001.json',
    'governance/policies',
    'SPOT-001.json',
    'SPOT-001',
  ])

  // The bare root is absent on purpose: a `governance` literal appears in
  // almost every test, so seeding it would select the lane instead of narrowing
  // it.
  assert.ok(
    !dataSeedKeys('governance/policies/SPOT-001.json').includes('governance'),
  )

  assert.deepEqual(dataSeedKeys('library/workflows/delivery/prompts/ship.md'), [
    'library/workflows/delivery/prompts/ship.md',
    'library/workflows',
    'library/workflows/delivery',
    'library/workflows/delivery/prompts',
    'ship.md',
  ])

  assert.deepEqual(dataSeedKeys('config.json'), ['config.json'])
  assert.deepEqual(dataSeedKeys('src/lib/test-impact.ts'), [])
  assert.deepEqual(dataSeedKeys('runtime/logs/workflows/state.json'), [])
})

test('a src module naming a data path does not seed it; only the test side does', async () => {
  const root = createTestTempDirectory('pan-test-impact-data-')

  try {
    const write = (relative: string, content: string): void => {
      mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
      writeFileSync(path.join(root, relative), content)
    }

    // The loader names the directory, and nearly every test imports it. Were
    // the src side a seed, one policy edit would select the whole lane.
    write(
      'src/lib/loader.ts',
      `export const DIR = 'governance/policies'\nexport const load = () => DIR\n`,
    )
    write(
      'tests/unit/reader.test.ts',
      `import { load } from '../../src/lib/loader.js'\ntest(load)\n`,
    )
    write(
      'tests/unit/policies.test.ts',
      `const dir = 'governance/policies'\ntest(dir)\n`,
    )

    const graph = await buildModuleGraph(root)
    const selected = selectImpactedTests(graph, [
      'governance/policies/SPOT-001.json',
    ])

    assert.deepEqual(selected.selected, ['tests/unit/policies.test.ts'])
    assert.deepEqual(selected.unreached, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
