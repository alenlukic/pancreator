import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { PanError } from '../../src/lib/errors.js'
import {
  HARNESS_TESTS_SELF_DEVELOPMENT_ONLY,
  buildModuleGraph,
  dataSeedKeys,
  extractSpecialReferences,
  isDataReference,
  laneTests,
  parseImpactArgs,
  parseSpecifiersByRegex,
  resolveSpecifier,
  reverseClosure,
  runTestsImpacted,
  selectImpactedTests,
  testCommandArgs,
} from '../../src/lib/test-impact.js'
import { createTestTempDirectory } from '../temp.js'

const REPO_ROOT = process.cwd()

/**
 * A synthetic tree: two source modules, a shared test helper, a bin script,
 * a fixture directory, and one test per lane. Nothing here depends on the
 * repository's own graph.
 */
function createSyntheticTree(): string {
  const root = createTestTempDirectory('pan-test-impact-')
  const write = (relative: string, content: string): void => {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
    writeFileSync(path.join(root, relative), content)
  }

  write('src/lib/core.ts', `export const core = 1\n`)
  write(
    'src/lib/feature.ts',
    `import { core } from './core.js'\nexport const feature = core + 1\n`,
  )
  write('src/lib/types.ts', `export interface Shape { size: number }\n`)
  write(
    'src/lib/typed.ts',
    `import type { Shape } from './types.js'\nexport const typed = (shape: Shape) => shape.size\n`,
  )
  write('src/lib/lonely.ts', `export const lonely = true\n`)
  write(
    'src/cli.ts',
    `import { feature } from './lib/feature.js'\nconsole.log(feature)\n`,
  )
  write(
    'tests/helpers.ts',
    `export * from '../src/lib/core.js'\nexport const helper = () => import('../src/lib/typed.js')\n`,
  )
  write(
    'tests/unit/core.test.ts',
    `import { core } from '../../src/lib/core.js'\ntest(core)\n`,
  )
  write(
    'tests/unit/feature.test.ts',
    `import { feature } from '../../src/lib/feature.js'\ntest(feature)\n`,
  )
  write(
    'tests/unit/helper-user.test.ts',
    `import { helper } from '../helpers.js'\ntest(helper)\n`,
  )
  // A helper that spawns the CLI and reads a fixture on behalf of its tests.
  write(
    'tests/integration/cli-helpers.ts',
    `export const CLI = path.join(root, 'dist', 'src', 'cli.js')\nexport const lint = path.join(root, 'bin', 'lint')\nexport const sample = 'tests/fixtures/sample/case.json'\n`,
  )
  write(
    'tests/integration/via-helper.test.ts',
    `import { CLI, lint, sample } from './cli-helpers.js'\ntest(CLI, lint, sample)\n`,
  )
  write(
    'tests/integration/cli.test.ts',
    `const CLI = path.join(root, 'dist', 'src', 'cli.js')\nspawn('/bin/bash', [path.join(root, 'bin', 'pan')])\n`,
  )
  write(
    'tests/integration/lint-script.test.ts',
    `spawnSync('bash', ['bin/lint'])\n`,
  )
  write(
    'tests/regression/fixture-user.test.ts',
    `const fixture = 'tests/fixtures/sample/case.json'\ntest(fixture)\n`,
  )
  write(
    'tests/unit/only-types.test.ts',
    `import type { Shape } from '../../src/lib/types.js'\ntest({} as Shape)\n`,
  )
  write('tests/secondary/installer.test.ts', `import '../../src/lib/core.js'\n`)
  write('tests/fixtures/sample/case.json', `{}\n`)
  write('bin/pan', `#!/usr/bin/env bash\n`)
  write('bin/lint', `#!/usr/bin/env bash\n`)

  return root
}

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
        graph.dependents
          .get('src/cli.ts')
          ?.has('tests/integration/cli.test.ts'),
      )
      assert.deepEqual(
        [...(graph.binReferences.get('bin/pan') ?? [])],
        ['tests/integration/cli.test.ts'],
      )
      // References inside an imported helper reach the tests that import it.
      assert.deepEqual(
        [...(graph.binReferences.get('bin/lint') ?? [])].sort(),
        [
          'tests/integration/lint-script.test.ts',
          'tests/integration/via-helper.test.ts',
        ],
      )
      assert.deepEqual(
        [
          ...(graph.fixtureReferences.get('tests/fixtures/sample') ?? []),
        ].sort(),
        [
          'tests/integration/via-helper.test.ts',
          'tests/regression/fixture-user.test.ts',
        ],
      )
      assert.ok(
        graph.dependents
          .get('src/cli.ts')
          ?.has('tests/integration/via-helper.test.ts'),
        'a CLI reference in a helper makes its tests depend on src/cli.ts',
      )
      // The helper itself is not a lane test and gets no reference edge.
      assert.ok(
        ![...(graph.binReferences.get('bin/lint') ?? [])].includes(
          'tests/integration/cli-helpers.ts',
        ),
      )
      assert.deepEqual(laneTests(graph), [
        'tests/integration/cli.test.ts',
        'tests/integration/lint-script.test.ts',
        'tests/integration/via-helper.test.ts',
        'tests/regression/fixture-user.test.ts',
        'tests/unit/core.test.ts',
        'tests/unit/feature.test.ts',
        'tests/unit/helper-user.test.ts',
        'tests/unit/only-types.test.ts',
      ])
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
    assert.deepEqual(full.get('tests/integration/cli.test.ts'), {
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

test('selectImpactedTests selects the reverse closure, bin and fixture tests, and never the secondary lane', async () => {
  const root = createSyntheticTree()

  try {
    const graph = await buildModuleGraph(root)

    const feature = selectImpactedTests(graph, ['src/lib/feature.ts'])
    assert.deepEqual(feature.selected, [
      'tests/integration/cli.test.ts',
      'tests/integration/via-helper.test.ts',
      'tests/unit/feature.test.ts',
    ])
    assert.equal(feature.lane_count, 8)
    assert.deepEqual(feature.by_depth, { '1': 1, '2': 2 })
    assert.equal(feature.advisory, null)
    assert.deepEqual(feature.unreached, [])

    const core = selectImpactedTests(graph, ['src/lib/core.ts'])
    assert.deepEqual(core.selected, [
      'tests/integration/cli.test.ts',
      'tests/integration/via-helper.test.ts',
      'tests/unit/core.test.ts',
      'tests/unit/feature.test.ts',
      'tests/unit/helper-user.test.ts',
    ])
    assert.ok(!core.selected.includes('tests/secondary/installer.test.ts'))

    const direct = selectImpactedTests(graph, ['src/lib/core.ts'], { depth: 1 })
    assert.deepEqual(direct.selected, ['tests/unit/core.test.ts'])
    assert.equal(direct.depth_limit, 1)

    const bin = selectImpactedTests(graph, ['bin/lint'])
    assert.deepEqual(bin.selected, [
      'tests/integration/lint-script.test.ts',
      'tests/integration/via-helper.test.ts',
    ])
    assert.equal(
      bin.reasons['tests/integration/lint-script.test.ts'],
      'bin/lint',
    )
    // The helper indirection is the reason N3 exists: a bin change reaches a
    // test whose only reference to the script sits in an imported helper.
    assert.equal(
      bin.reasons['tests/integration/via-helper.test.ts'],
      'bin/lint',
    )

    const fixture = selectImpactedTests(graph, [
      'tests/fixtures/sample/case.json',
    ])
    assert.deepEqual(fixture.selected, [
      'tests/integration/via-helper.test.ts',
      'tests/regression/fixture-user.test.ts',
    ])

    const changedTest = selectImpactedTests(graph, [
      'tests/unit/only-types.test.ts',
    ])
    assert.deepEqual(changedTest.selected, ['tests/unit/only-types.test.ts'])

    const typesOnly = selectImpactedTests(graph, ['src/lib/types.ts'])
    assert.deepEqual(typesOnly.selected, [])
    assert.deepEqual(typesOnly.unreached, ['src/lib/types.ts'])
    assert.deepEqual(typesOnly.type_only, ['src/lib/types.ts'])

    const lonely = selectImpactedTests(graph, [
      'src/lib/lonely.ts',
      'docs/x.md',
    ])
    assert.deepEqual(lonely.selected, [])
    assert.deepEqual(lonely.unreached, ['docs/x.md', 'src/lib/lonely.ts'])
    assert.deepEqual(lonely.type_only, [])

    const included = selectImpactedTests(graph, ['src/lib/lonely.ts'], {
      include: ['tests/unit/*.test.ts'],
    })
    assert.equal(included.selected.length, 4)
    assert.equal(
      included.reasons['tests/unit/core.test.ts'],
      '--include tests/unit/*.test.ts',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a hub or global change selects most of the lane and raises the advisory', async () => {
  const root = createSyntheticTree()

  try {
    const graph = await buildModuleGraph(root)

    const global = selectImpactedTests(graph, ['package.json'])
    assert.equal(global.selected_count, global.lane_count)
    assert.equal(global.ratio, 1)
    assert.match(global.advisory ?? '', /fast profile is the cheaper choice/u)
    assert.match(global.advisory ?? '', /--depth 1/u)
    assert.deepEqual(global.unreached, [])

    const core = selectImpactedTests(graph, ['src/lib/core.ts'], {
      advisoryRatio: 0.5,
    })
    assert.ok(core.ratio >= 0.5)
    assert.ok(core.advisory)

    const quiet = selectImpactedTests(graph, ['src/lib/core.ts'], {
      advisoryRatio: 0.9,
    })
    assert.equal(quiet.advisory, null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('parseImpactArgs reads every option and rejects conflicts', () => {
  assert.deepEqual(
    parseImpactArgs([
      '--changed',
      'main',
      '--file',
      './src/lib/a.ts',
      '--include',
      'tests/unit/a*.test.ts',
      '--depth',
      '2',
      '--list',
      '--json',
      '--advisory-ratio',
      '0.5',
    ]),
    {
      changed: 'main',
      files: ['src/lib/a.ts'],
      include: ['tests/unit/a*.test.ts'],
      depth: 2,
      list: true,
      json: true,
      advisoryRatio: 0.5,
    },
  )
  assert.throws(
    () => parseImpactArgs(['--staged', '--changed', 'main']),
    /mutually exclusive/u,
  )
  assert.throws(() => parseImpactArgs(['--depth', '0']), /positive integer/u)
  assert.throws(
    () => parseImpactArgs(['--advisory-ratio', '2']),
    /between 0 and 1/u,
  )
  assert.throws(() => parseImpactArgs(['--bogus']), /Unknown option/u)
  assert.throws(() => parseImpactArgs(['--changed']), /requires a value/u)
})

test('testCommandArgs targets the compiled files with the failures-only reporter', () => {
  assert.deepEqual(
    testCommandArgs(['tests/unit/a.test.ts', 'tests/regression/b.test.ts']),
    [
      'node',
      '--test',
      '--test-reporter=./dist/tests/reporters/failures-only.js',
      '--test-reporter-destination=stdout',
      'dist/tests/unit/a.test.js',
      'dist/tests/regression/b.test.js',
    ],
  )
})

test('runTestsImpacted --list --json reports the selection on a synthetic tree and records the run', async () => {
  const root = createSyntheticTree()

  try {
    let output = ''
    const result = await runTestsImpacted(
      root,
      ['--list', '--json', '--file', 'src/lib/feature.ts'],
      (text) => {
        output += text
      },
    )

    assert.equal(result.status, 'listed')
    assert.equal(result.exit_code, 0)
    const parsed = JSON.parse(output) as typeof result
    assert.deepEqual(parsed.changed, ['src/lib/feature.ts'])
    assert.deepEqual(parsed.selected, [
      'tests/integration/cli.test.ts',
      'tests/integration/via-helper.test.ts',
      'tests/unit/feature.test.ts',
    ])
    assert.equal(parsed.selected_count, 3)
    assert.equal(parsed.lane_count, 8)
    assert.equal(parsed.advisory, null)
    assert.equal(typeof parsed.duration_ms, 'number')

    // A synthetic tree is not a Git repository, so the default change set is empty.
    let plain = ''
    const nothing = await runTestsImpacted(root, [], (text) => {
      plain += text
    })
    assert.equal(nothing.status, 'nothing_changed')
    assert.equal(nothing.exit_code, 0)
    assert.match(plain, /No changed files\. No test selected\./u)

    let unreached = ''
    const none = await runTestsImpacted(
      root,
      ['--file', 'src/lib/lonely.ts', '--file', 'src/lib/types.ts'],
      (text) => {
        unreached += text
      },
    )
    assert.equal(none.status, 'no_tests_reached')
    assert.equal(none.exit_code, 0)
    assert.match(unreached, /No lane test reaches the 2 changed file\(s\)/u)
    assert.match(unreached, /src\/lib\/lonely\.ts\n/u)
    assert.match(
      unreached,
      /src\/lib\/types\.ts {2}\(type-only imports; the build verifies it\)/u,
    )

    const ledger = await import('node:fs').then((fs) =>
      fs.readFileSync(
        path.join(root, 'runtime/cache/test-impact.jsonl'),
        'utf8',
      ),
    )
    const records = ledger
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    assert.equal(records.length, 3)
    assert.deepEqual(
      records.map((record) => record.status),
      ['listed', 'nothing_changed', 'no_tests_reached'],
    )
    assert.equal(records[0]?.selected_count, 3)
    assert.equal(records[0]?.result, 'none')
    assert.equal(typeof records[0]?.fingerprint, 'string')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('runTestsImpacted refuses in target installations', async () => {
  for (const mode of ['embedded', 'detached'] as const) {
    const root = createTestTempDirectory('pan-test-impact-target-')

    try {
      writeFileSync(
        path.join(root, 'config.json'),
        `${JSON.stringify(
          {
            schema_version: 1,
            installation_mode: mode,
            workspace_root: mode === 'detached' ? root : '.',
          },
          null,
          2,
        )}\n`,
      )

      await assert.rejects(
        () =>
          runTestsImpacted(root, ['--list', '--file', 'src/lib/feature.ts']),
        (error: unknown) => {
          assert.ok(error instanceof PanError)
          assert.equal(error.code, 'HARNESS_TESTS_SELF_DEVELOPMENT_ONLY')
          assert.equal(error.message, HARNESS_TESTS_SELF_DEVELOPMENT_ONLY)
          return true
        },
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
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

test('an unmapped change is reported as unreached and raises the advisory', async () => {
  const root = createTestTempDirectory('pan-test-impact-gap-')

  try {
    const write = (relative: string, content: string): void => {
      mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
      writeFileSync(path.join(root, relative), content)
    }

    write('src/lib/core.ts', `export const core = 1\n`)
    write(
      'tests/unit/core.test.ts',
      `import { core } from '../../src/lib/core.js'\ntest(core)\n`,
    )

    const graph = await buildModuleGraph(root)
    const orphan = selectImpactedTests(graph, [
      'library/workflows/delivery/prompts/ship.md',
    ])

    assert.deepEqual(orphan.selected, [])
    assert.deepEqual(orphan.unreached, [
      'library/workflows/delivery/prompts/ship.md',
    ])
    assert.match(String(orphan.advisory), /reach no test/u)
    assert.match(String(orphan.advisory), /judgment cohort/u)

    // Generated run state is not a change under test, so it stays quiet.
    const generated = selectImpactedTests(graph, [
      'runtime/logs/workflows/state.json',
      'runtime/cache/test-impact.jsonl',
    ])

    assert.deepEqual(generated.unreached, [])
    assert.equal(generated.advisory, null)

    // A hand-edited runtime file outside the generated trees still reports.
    const handEdited = selectImpactedTests(graph, [
      'runtime/repository-checks.json',
    ])

    assert.deepEqual(handEdited.unreached, ['runtime/repository-checks.json'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('self-test: a governance policy change selects its governance tests, not the lane', async () => {
  const graph = await buildModuleGraph(REPO_ROOT)
  const selected = selectImpactedTests(graph, [
    'governance/policies/SPOT-001.json',
  ])

  assert.ok(
    selected.selected.includes('tests/unit/policies.test.ts'),
    `selected ${selected.selected.join(', ')}`,
  )
  assert.deepEqual(selected.unreached, [])
  assert.ok(
    selected.selected.length <= selected.lane_count * 0.25,
    `selected ${selected.selected.length} of ${selected.lane_count}`,
  )
})
