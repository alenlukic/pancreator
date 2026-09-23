import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  HELP_BODY,
  panCommandFamilies,
  panInvocationsInText,
  panProseInvocationError,
  validatePanInvocation,
} from '../../src/lib/pan-command-grammar.js'
import { STANDALONE_MODES } from '../../src/lib/governance-card.js'

test('pan option grammar names the accepted set for an invalid option', () => {
  const invalid = validatePanInvocation([
    'governance',
    'card',
    '--mode',
    'harden',
    '--output-path',
    'card.md',
  ])

  assert.equal(invalid.valid, false)
  assert.equal(invalid.unknown_option, '--output-path')
  assert.ok(invalid.accepted_options.includes('--out'))
  assert.equal(invalid.accepted_options.includes('--output-path'), false)
  assert.match(invalid.error ?? '', /Accepted:.*--out/u)

  assert.equal(
    validatePanInvocation([
      'governance',
      'card',
      '--mode',
      'harden',
      '--out',
      'card.md',
    ]).valid,
    true,
  )
})

test('plan prose extraction finds bin and bare pan command lines', () => {
  assert.deepEqual(
    panInvocationsInText(
      [
        'Run ./bin/pan governance card --mode harden --out card.md.',
        'Then pan tests impacted --list --json.',
      ].join('\n'),
    ),
    [
      ['governance', 'card', '--mode', 'harden', '--out', 'card.md'],
      ['tests', 'impacted', '--list', '--json'],
    ],
  )
})

test('prose extraction judges a command family and ignores English', () => {
  // The extractor reads running prose, so a sentence that merely mentions the
  // binary arrives looking like an invocation. Refusing it rejected ratified
  // plans for describing a command in words, and in an away decision it
  // rejected the entire decision.
  assert.equal(
    panProseInvocationError([
      'with',
      'no',
      'execution-root',
      'override',
      'set',
    ]),
    null,
  )

  // A documented family with an undocumented subcommand is still a defect:
  // the author meant a command and named one that does not exist.
  assert.match(
    panProseInvocationError(['schedule', 'install']) ?? '',
    /Unknown pan command surface/u,
  )
  assert.match(
    panProseInvocationError([
      'governance',
      'card',
      '--mode',
      'harden',
      '--output-path',
      'card.md',
    ]) ?? '',
    /Unknown option '--output-path'/u,
  )
})

test('the grammar accepts the surfaces and options the CLI really has', () => {
  for (const argv of [
    ['help'],
    // Documented only in the indented prose under its usage line.
    ['repository-check', 'fast', '--harness-initiated'],
    ['author', 'validate', '--worktree', 'named'],
    ['author', 'apply', '--input', 'draft.json', '--worktree', 'named'],
    ['governance', 'prompt-context'],
    ['init', '--request', 'request.md', '--json'],
    ['resume', 'run-1', '--json'],
    ['decide', 'run-1', 'approve', '--json'],
  ]) {
    assert.equal(
      validatePanInvocation(argv).valid,
      true,
      `pan ${argv.join(' ')}`,
    )
    assert.equal(panProseInvocationError(argv), null, `pan ${argv.join(' ')}`)
  }
})

/**
 * Options the harness passes to itself. `pan tests record-fast-wall` is
 * invoked by `bin/run-tests` and `--driver-child` by the worker driver, so no
 * operator or plan names them and the usage text stays about the operator
 * surface. Every other option a parser reads is documented, because this help
 * text is also the authority a plan, an away decision, and the shared
 * worktree gate are judged against.
 */
const UNDOCUMENTED_INTERNAL_OPTIONS = new Set([
  '--caller-class',
  '--cpu-count',
  '--driver-child',
  '--duration-record',
  '--exit-code',
  '--help',
  '--invoker',
  '--load-average',
  '--phase',
  '--run-id',
  '--series-root',
  '--worker-count',
  '--workspace-root',
  '--wrapper-wall-ms',
])

test('every option the CLI reads is documented or declared internal', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/cli.ts'), 'utf8')
  const read = new Set<string>()

  for (const match of source.matchAll(
    /(?:hasFlag|option|integerOption|numberOption|repeatedOption)\(\s*args\s*,\s*'(--[a-z][a-z0-9-]*)'/gu,
  )) {
    read.add(match[1] as string)
  }

  assert.ok(read.size > 50, 'the option scan found the CLI argument reads')

  const undocumented = [...read]
    .filter(
      (name) =>
        !HELP_BODY.includes(name) && !UNDOCUMENTED_INTERNAL_OPTIONS.has(name),
    )
    .sort()

  assert.deepEqual(undocumented, [])
})

test('the help text names the standalone modes the registry declares', () => {
  // The mode list moved from `Object.keys(STANDALONE_MODES)` into a literal,
  // so a new or renamed mode would otherwise drift into a wrong help line.
  const documented =
    /--mode <([a-z0-9|-]+)>/u.exec(HELP_BODY)?.[1]?.split('|') ?? []

  assert.deepEqual(documented, Object.keys(STANDALONE_MODES).sort())
})

test('every command family the grammar knows heads a real usage line', () => {
  for (const family of panCommandFamilies()) {
    assert.match(HELP_BODY, new RegExp(`^ {2}pan ${family}\\b`, 'mu'), family)
  }
})
