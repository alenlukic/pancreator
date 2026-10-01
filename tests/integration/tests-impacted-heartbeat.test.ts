import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { runTestsImpacted } from '../../src/lib/test-impact.js'
import { createTestTempDirectory } from '../temp.js'

const REPORTER = path.join(
  process.cwd(),
  'dist/tests/reporters/failures-only.js',
)

test('AC-12: pan tests impacted in summary mode forwards each heartbeat line to its progress stream before the summary', async () => {
  const root = createTestTempDirectory('tests-impacted-heartbeat-')
  const seen = path.join(root, 'heartbeat-seen')
  const write = (relative: string, content: string): void => {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
    writeFileSync(path.join(root, relative), content)
  }

  write('src/lib/feature.ts', 'export const feature = 1\n')
  write(
    'tests/unit/feature.test.ts',
    "import { feature } from '../../src/lib/feature.js'\ntest(feature)\n",
  )
  // The selected test finishes only once the forwarded heartbeat reached the
  // progress stream, so a copy made after the run ends cannot pass.
  write(
    'fixture/slow.test.mjs',
    [
      "import { existsSync } from 'node:fs'",
      "import test from 'node:test'",
      "test('waits for the forwarded heartbeat', async () => {",
      '  const deadline = Date.now() + 20000',
      `  while (!existsSync(${JSON.stringify(seen)})) {`,
      "    if (Date.now() > deadline) throw new Error('no forwarded heartbeat')",
      '    await new Promise((resolve) => setTimeout(resolve, 25))',
      '  }',
      '})',
      '',
    ].join('\n'),
  )
  // A stand-in for bin/run-built that runs the real failures-only reporter
  // over the slow fixture instead of compiling the synthetic tree.
  write(
    'bin/run-built',
    [
      '#!/usr/bin/env bash',
      'unset NODE_TEST_CONTEXT',
      "echo 'build chatter'",
      `PAN_TEST_HEARTBEAT_SECONDS=1 exec ${JSON.stringify(process.execPath)} --test ` +
        `--test-reporter=${JSON.stringify(REPORTER)} --test-reporter-destination=stdout ` +
        JSON.stringify(path.join(root, 'fixture', 'slow.test.mjs')),
      '',
    ].join('\n'),
  )
  chmodSync(path.join(root, 'bin', 'run-built'), 0o755)

  const transcript: Array<{ stream: 'progress' | 'write'; text: string }> = []
  const result = await runTestsImpacted(
    root,
    ['--file', 'src/lib/feature.ts'],
    {
      output: 'summary',
      write: (text) => {
        transcript.push({ stream: 'write', text })
      },
      progress: (text) => {
        transcript.push({ stream: 'progress', text })

        if (text.startsWith('[tests impacted] # heartbeat ')) {
          writeFileSync(seen, '')
        }
      },
    },
  )

  assert.equal(result.exit_code, 0)

  const beats = transcript.filter(
    (entry) =>
      entry.stream === 'progress' &&
      entry.text.startsWith('[tests impacted] # heartbeat '),
  )
  const summary = transcript.findIndex(
    (entry) =>
      entry.stream === 'write' &&
      /\[tests impacted\] passed: /u.test(entry.text),
  )

  assert.ok(beats.length > 0, JSON.stringify(transcript))
  assert.ok(
    beats.every((entry) =>
      /^\[tests impacted\] # heartbeat \d+s: \d+ passed, \d+ failed, \d+ files done\n$/u.test(
        entry.text,
      ),
    ),
  )
  assert.ok(
    summary > transcript.indexOf(beats[0] as (typeof transcript)[number]),
  )
  assert.ok(
    transcript.every(
      (entry) =>
        entry.stream !== 'progress' || !entry.text.includes('build chatter'),
    ),
  )
})
