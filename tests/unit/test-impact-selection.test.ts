import assert from 'node:assert/strict'
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { PanError } from '../../src/lib/errors.js'
import {
  HARNESS_TESTS_SELF_DEVELOPMENT_ONLY,
  buildModuleGraph,
  laneTests,
  parseImpactArgs,
  runTestsImpacted,
  selectImpactedTests,
  testCommandArgs,
} from '../../src/lib/test-impact.js'
import { createTestTempDirectory } from '../temp.js'
import { createSyntheticTree } from './test-impact-helpers.js'

test('selectImpactedTests selects the reverse closure, bin and fixture tests, and never the integration or secondary lane', async () => {
  const root = createSyntheticTree()

  try {
    const graph = await buildModuleGraph(root)

    const feature = selectImpactedTests(graph, ['src/lib/feature.ts'])
    assert.deepEqual(feature.selected, [
      'tests/regression/cli.test.ts',
      'tests/regression/via-helper.test.ts',
      'tests/unit/feature.test.ts',
    ])
    assert.equal(feature.lane_count, 9)
    assert.deepEqual(feature.by_depth, { '1': 1, '2': 2 })
    assert.equal(feature.advisory, null)
    assert.deepEqual(feature.unreached, [])

    const core = selectImpactedTests(graph, ['src/lib/core.ts'])
    assert.deepEqual(core.selected, [
      'tests/regression/cli.test.ts',
      'tests/regression/via-helper.test.ts',
      'tests/unit/core.test.ts',
      'tests/unit/feature.test.ts',
      'tests/unit/helper-user.test.ts',
    ])
    assert.ok(!core.selected.includes('tests/secondary/installer.test.ts'))
    assert.ok(!core.selected.includes('tests/integration/pre-release.test.ts'))

    const direct = selectImpactedTests(graph, ['src/lib/core.ts'], { depth: 1 })
    assert.deepEqual(direct.selected, ['tests/unit/core.test.ts'])
    assert.equal(direct.depth_limit, 1)

    const bin = selectImpactedTests(graph, ['bin/lint'])
    assert.deepEqual(bin.selected, [
      'tests/regression/lint-script.test.ts',
      'tests/regression/via-helper.test.ts',
    ])
    assert.equal(
      bin.reasons['tests/regression/lint-script.test.ts'],
      'bin/lint',
    )
    // The helper indirection is the reason N3 exists: a bin change reaches a
    // test whose only reference to the script sits in an imported helper.
    assert.equal(bin.reasons['tests/regression/via-helper.test.ts'], 'bin/lint')

    const fixture = selectImpactedTests(graph, [
      'tests/fixtures/sample/case.json',
    ])
    assert.deepEqual(fixture.selected, [
      'tests/regression/fixture-user.test.ts',
      'tests/regression/via-helper.test.ts',
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
    assert.equal(included.selected.length, 5)
    assert.equal(
      included.reasons['tests/unit/core.test.ts'],
      '--include tests/unit/*.test.ts',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the integration lane selects the integration tests a change reaches and leaves the default selection unchanged', async () => {
  const root = createSyntheticTree()

  try {
    const graph = await buildModuleGraph(root)
    const integration = selectImpactedTests(graph, ['src/lib/core.ts'], {
      lanes: ['tests/integration'],
    })

    assert.deepEqual(integration.selected, [
      'tests/integration/pre-release.test.ts',
    ])
    assert.equal(integration.lane_count, 1)
    assert.deepEqual(integration.unreached, [])
    // The fast profile covers no integration test, so the ratio advisory
    // never recommends it for this selection.
    assert.equal(integration.advisory, null)
    assert.deepEqual(laneTests(graph, ['tests/integration']), [
      'tests/integration/pre-release.test.ts',
    ])

    const untouched = selectImpactedTests(graph, ['src/lib/lonely.ts'], {
      lanes: ['tests/integration'],
    })
    assert.deepEqual(untouched.selected, [])

    // A changed unit test is outside an integration selection, not a file
    // it failed to cover.
    const otherLane = selectImpactedTests(graph, ['tests/unit/core.test.ts'], {
      lanes: ['tests/integration'],
    })
    assert.deepEqual(otherLane.unreached, [])

    // A bin reference an integration test would carry never credits a
    // default-lane selection.
    const defaults = selectImpactedTests(graph, ['src/lib/core.ts'])
    assert.ok(
      !defaults.selected.includes('tests/integration/pre-release.test.ts'),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('parseImpactArgs maps --lane names to lane directories and rejects an unknown lane', () => {
  assert.deepEqual(
    parseImpactArgs(['--lane', 'integration', '--lane', 'unit']).lanes,
    ['tests/integration', 'tests/unit'],
  )
  assert.equal(parseImpactArgs([]).lanes, undefined)
  assert.throws(
    () => parseImpactArgs(['--lane', 'secondary']),
    /--lane must be one of: unit, regression, integration/u,
  )
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
      {
        write: (text) => {
          output += text
        },
      },
    )

    assert.equal(result.status, 'listed')
    assert.equal(result.exit_code, 0)
    const parsed = JSON.parse(output) as typeof result
    assert.deepEqual(parsed.changed, ['src/lib/feature.ts'])
    assert.deepEqual(parsed.selected, [
      'tests/regression/cli.test.ts',
      'tests/regression/via-helper.test.ts',
      'tests/unit/feature.test.ts',
    ])
    assert.equal(parsed.selected_count, 3)
    assert.equal(parsed.lane_count, 9)
    assert.equal(parsed.advisory, null)
    assert.equal(typeof parsed.duration_ms, 'number')

    // A synthetic tree is not a Git repository, so the default change set is empty.
    let plain = ''
    const nothing = await runTestsImpacted(root, [], {
      write: (text) => {
        plain += text
      },
    })
    assert.equal(nothing.status, 'nothing_changed')
    assert.equal(nothing.exit_code, 0)
    assert.match(plain, /No changed files\. No test selected\./u)

    let unreached = ''
    const none = await runTestsImpacted(
      root,
      ['--file', 'src/lib/lonely.ts', '--file', 'src/lib/types.ts'],
      {
        write: (text) => {
          unreached += text
        },
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

test('the graph build duration is a finite, non-negative number at every reporting site', async () => {
  // The flaky-gate repair removed the only assertions on this field, so a
  // regression that reported NaN or nothing passed everywhere. A measured
  // zero stays admissible by design, so nothing here rejects it.
  const assertDuration = (value: unknown, site: string): void => {
    assert.equal(typeof value, 'number', `${site} reports a number`)
    assert.equal(
      Number.isFinite(value as number),
      true,
      `${site} reports a finite duration`,
    )
    assert.equal((value as number) >= 0, true, `${site} is not negative`)
  }

  const root = createSyntheticTree()

  try {
    assertDuration((await buildModuleGraph(root)).build_ms, 'the module graph')

    let json = ''
    const listed = await runTestsImpacted(
      root,
      ['--list', '--json', '--file', 'src/lib/feature.ts'],
      {
        write: (text) => {
          json += text
        },
      },
    )

    assertDuration(listed.graph_build_ms, 'the returned result')
    assertDuration(
      (JSON.parse(json) as Record<string, unknown>).graph_build_ms,
      'the JSON report',
    )

    let rendered = ''
    await runTestsImpacted(root, ['--list', '--file', 'src/lib/feature.ts'], {
      write: (text) => {
        rendered += text
      },
    })

    const reported = /^Graph: \w+ parser, (\d+) ms\./mu.exec(rendered)

    assert.ok(reported, `the text report states the duration: ${rendered}`)
    assertDuration(Number(reported[1]), 'the text report')

    const records = readFileSync(
      path.join(root, 'runtime/cache/test-impact.jsonl'),
      'utf8',
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    assert.equal(records.length, 2)

    for (const record of records) {
      assertDuration(record.graph_build_ms, 'the impact ledger')
    }
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

test('a changed source is reached when the changed test that imports it is selected', async () => {
  const root = createTestTempDirectory('pan-test-impact-changed-pair-')

  try {
    const write = (relative: string, content: string): void => {
      mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
      writeFileSync(path.join(root, relative), content)
    }

    // The drill scenario: a chunk adds a source module together with its test.
    // Both files are seeds, so the test enters the closure at depth 0 and the
    // multi-source walk never credits it to the source it imports.
    write('src/lib/salutations/greeting.ts', `export const greeting = 'hi'\n`)
    write(
      'tests/unit/salutations-greeting.test.ts',
      `import { greeting } from '../../src/lib/salutations/greeting.js'\ntest(greeting)\n`,
    )
    write(
      'tests/unit/other.test.ts',
      `import { greeting } from '../../src/lib/salutations/greeting.js'\ntest(greeting)\n`,
    )

    const graph = await buildModuleGraph(root)
    const pair = selectImpactedTests(graph, [
      'src/lib/salutations/greeting.ts',
      'tests/unit/salutations-greeting.test.ts',
    ])

    assert.deepEqual(pair.selected, [
      'tests/unit/other.test.ts',
      'tests/unit/salutations-greeting.test.ts',
    ])
    assert.deepEqual(pair.unreached, [])
    assert.doesNotMatch(String(pair.advisory), /reach no test/u)

    // The bound applies from the source too: its own test is one hop away.
    const direct = selectImpactedTests(
      graph,
      [
        'src/lib/salutations/greeting.ts',
        'tests/unit/salutations-greeting.test.ts',
      ],
      { depth: 1 },
    )

    assert.deepEqual(direct.unreached, [])

    // A changed source that only a changed, unrelated test accompanies stays
    // unreached: the credit needs an import path, not mere co-selection.
    write('src/lib/salutations/farewell.ts', `export const farewell = 'bye'\n`)

    const unrelated = selectImpactedTests(await buildModuleGraph(root), [
      'src/lib/salutations/farewell.ts',
      'tests/unit/salutations-greeting.test.ts',
    ])

    assert.deepEqual(unrelated.selected, [
      'tests/unit/salutations-greeting.test.ts',
    ])
    assert.deepEqual(unrelated.unreached, ['src/lib/salutations/farewell.ts'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a selected workspace is where the impact runs, and the default is unchanged', async () => {
  const root = createSyntheticTree()
  const workspace = createSyntheticTree()
  // The two trees must differ, or a selection built from the installation
  // root and one built from the workspace cannot be told apart.
  const workspaceOnlyTest = 'tests/unit/workspace-only.test.ts'

  writeFileSync(
    path.join(workspace, workspaceOnlyTest),
    `import { feature } from '../../src/lib/feature.js'\ntest(feature)\n`,
  )

  try {
    // The option is consumed by the parser; the CLI resolves the name to a
    // path and hands the resolved workspace in.
    assert.deepEqual(
      parseImpactArgs(['--worktree', 'chunk-one', '--list']).files,
      [],
    )

    let selected = ''
    const scoped = await runTestsImpacted(
      workspace,
      ['--list', '--json', '--file', 'src/lib/feature.ts'],
      {
        workspace,
        write: (text) => {
          selected += text
        },
      },
    )

    // The selected workspace is the installation root here, so its label is
    // the root marker rather than a relative path.
    assert.equal(scoped.workspace, '.')
    assert.equal(scoped.status, 'listed')
    assert.deepEqual(JSON.parse(selected).selected, [
      'tests/regression/cli.test.ts',
      'tests/regression/via-helper.test.ts',
      'tests/unit/feature.test.ts',
      workspaceOnlyTest,
    ])

    let text = ''
    const labelled = await runTestsImpacted(
      root,
      ['--list', '--file', 'src/lib/feature.ts'],
      {
        workspace,
        write: (chunk) => {
          text += chunk
        },
      },
    )

    assert.match(text, /^Workspace: /mu)
    // The selection, not the report label, is what proves where the graph
    // was built: this test exists only in the selected workspace.
    assert.ok(labelled.selected.includes(workspaceOnlyTest))

    // Without the option the installation root stays the workspace and the
    // text report says nothing about one.
    let plain = ''
    const defaulted = await runTestsImpacted(
      root,
      ['--list', '--file', 'src/lib/feature.ts'],
      {
        write: (chunk) => {
          plain += chunk
        },
      },
    )

    assert.equal(defaulted.workspace, '.')
    assert.doesNotMatch(plain, /^Workspace: /mu)
    assert.deepEqual(defaulted.selected, [
      'tests/regression/cli.test.ts',
      'tests/regression/via-helper.test.ts',
      'tests/unit/feature.test.ts',
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('a selection that runs reports a pass line or its failing tests and keeps the output in a log', async () => {
  const root = createSyntheticTree()

  // A stand-in for bin/run-built that answers like the failures-only
  // reporter, so the report is judged without compiling or running a suite.
  writeFileSync(
    path.join(root, 'bin', 'run-built'),
    [
      '#!/usr/bin/env bash',
      "echo 'build chatter'",
      'if [[ -f "$PWD/fail" ]]; then',
      "  echo 'not ok - feature adds one (dist/tests/unit/feature.test.js:3)'",
      "  echo '    AssertionError: 2 !== 3'",
      "  echo '# tests 3'",
      '  exit 1',
      'fi',
      "echo '# tests 3'",
      '',
    ].join('\n'),
  )
  chmodSync(path.join(root, 'bin', 'run-built'), 0o755)

  const run = async () => {
    let written = ''
    let progress = ''
    const result = await runTestsImpacted(
      root,
      ['--file', 'src/lib/feature.ts'],
      {
        output: 'summary',
        write: (text) => {
          written += text
        },
        progress: (text) => {
          progress += text
        },
      },
    )

    return { result, written, progress }
  }

  try {
    const passed = await run()

    assert.equal(passed.result.exit_code, 0)
    assert.match(
      passed.progress,
      /^\[tests impacted\] running 3 of 9 lane test file\(s\) for 1 changed file\(s\) \(log: runtime\/logs\/repository-check\/\S+\.log\)\n$/u,
    )
    assert.match(
      passed.written,
      /^\[tests impacted\] passed: 3 of 9 lane test file\(s\), 3 tests in \d+\.\ds \(log: \S+\)$/mu,
    )
    assert.doesNotMatch(passed.written, /build chatter|<- /u)
    assert.deepEqual(passed.result.failing_tests, [])
    assert.match(
      readFileSync(path.join(root, passed.result.log_path ?? ''), 'utf8'),
      /build chatter/u,
    )

    writeFileSync(path.join(root, 'fail'), '')

    const failed = await run()

    assert.equal(failed.result.exit_code, 1)
    assert.match(
      failed.written,
      /^\[tests impacted\] FAILED: 3 of 9 lane test file\(s\) \(exit 1\) in /mu,
    )
    assert.match(
      failed.written,
      /^ {4}feature adds one \(dist\/tests\/unit\/feature\.test\.js:3\)$/mu,
    )
    assert.match(failed.written, /^log: runtime\/logs\/repository-check\//mu)
    assert.deepEqual(failed.result.failing_tests, [
      {
        name: 'feature adds one',
        location: 'dist/tests/unit/feature.test.js:3',
      },
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('parseImpactArgs accepts --verbose', () => {
  assert.equal(parseImpactArgs(['--verbose']).verbose, true)
})
