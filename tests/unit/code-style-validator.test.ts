import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  analyzeCodeStyle,
  codeStyleLanguage,
  codeStylePolicyId,
  MAX_REPORTED_ISSUES,
  validateCodeStyle,
} from '../../src/lib/validators/code-style.js'
import { createTestTempDirectory } from '../temp.js'

function codes(relativePath: string, content: string): string[] {
  return analyzeCodeStyle(relativePath, content).map((issue) => issue.code)
}

function scratchRoot(): string {
  return createTestTempDirectory('pan-style-')
}

function writeArtifact(root: string, relative: string, content: string): void {
  const absolute = path.join(root, relative)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
}

function input(root: string, targetPath: string) {
  return {
    root,
    targetPath,
    requirement: {
      policy_id: 'TSTYLE-001',
      requirement_id: 'standalone-style-code-style-validate',
      registry_id: 'CODE-STYLE-VALIDATE-001',
      arguments: {},
    },
  }
}

test('a style handbook owns every scanned extension and nothing else', () => {
  assert.equal(codeStyleLanguage('src/cli.ts'), 'typescript')
  assert.equal(codeStyleLanguage('src/App.tsx'), 'typescript')
  assert.equal(codeStyleLanguage('prettier.config.js'), 'javascript')
  assert.equal(codeStyleLanguage('scripts/build.mjs'), 'javascript')
  assert.equal(codeStyleLanguage('tools/legacy.cjs'), 'javascript')
  assert.equal(codeStyleLanguage('tools/report.py'), 'python')
  assert.equal(codeStyleLanguage('docs/guide.md'), null)
  assert.equal(codeStyleLanguage('Makefile'), null)
})

// Run 63300 finding V-2: a scan of a TypeScript file reported under
// PYSTYLE-001, because one site hardcoded an identifier and another collapsed
// the field that distinguishes the two. VALID-001 requires the evidence to
// name the policy that governs what was scanned.
test('the governing style policy follows the scanned language', () => {
  assert.equal(codeStylePolicyId('src/cli.ts'), 'TSTYLE-001')
  assert.equal(codeStylePolicyId('src/App.tsx'), 'TSTYLE-001')
  assert.equal(codeStylePolicyId('tools/report.py'), 'PYSTYLE-001')
  assert.equal(codeStylePolicyId('docs/guide.md'), null)

  // No policy claims the JavaScript extensions, and the checker applies the
  // TypeScript handbook's script rules to them. The catalog entry and the
  // style command card state that ownership where an operator reads them.
  assert.equal(codeStylePolicyId('prettier.config.js'), 'TSTYLE-001')
  assert.equal(codeStylePolicyId('scripts/build.mjs'), 'TSTYLE-001')
})

test('each TypeScript rule reports the construct its handbook section forbids', () => {
  const cases: Array<[string, string, string]> = [
    ['style.any_type', 'const value: any = load()', 'annotation'],
    ['style.any_type', 'const value = load() as any', 'assertion'],
    ['style.any_type', 'const values: Array<any> = []', 'type argument'],
    ['style.any_type', 'const values: any[] = []', 'array shorthand'],
    ['style.non_null_assertion', 'const size = value!.length', 'member access'],
    ['style.non_null_assertion', 'use(entries[0]!)', 'call argument'],
    ['style.loose_equality', 'if (left == right) {', 'loose equal'],
    ['style.loose_equality', 'if (left != right) {', 'loose not equal'],
    ['style.var_declaration', 'var total = 0', 'var binding'],
    ['style.legacy_module', "const fs = require('node:fs')", 'require call'],
    ['style.legacy_module', 'namespace Legacy {', 'namespace'],
    ['style.legacy_module', "import fs = require('node:fs')", 'import assign'],
    ['style.legacy_module', '/// <reference types="node" />', 'reference'],
    ['style.const_enum', 'const enum Mode { On }', 'const enum'],
    ['style.default_export', 'export default function run() {}', 'default'],
    ['style.mutable_export', 'export let counter = 0', 'mutable export'],
    ['style.function_expression', 'const run = function () {}', 'expression'],
    ['style.function_expression', 'run({ load: function () {} })', 'method'],
    ['style.private_field', 'class Box { #value = 1 }', 'hash field'],
    ['style.debugger', 'debugger', 'debugger'],
    ['style.restricted_feature', "eval('1 + 1')", 'eval'],
    ['style.restricted_feature', "new Function('return 1')", 'Function'],
    ['style.wrapper_constructor', 'const items = new Array(3)', 'Array'],
    ['style.wrapper_constructor', 'const items = Array(3)', 'bare Array'],
    ['style.wrapper_constructor', 'const bag = new Object()', 'Object'],
    ['style.wrapper_constructor', "const name = new String('x')", 'String'],
    ['style.arguments_object', 'const first = arguments[0]', 'arguments'],
    ['style.ts_suppression', ['// @ts-', 'ignore'].join(''), 'ts-ignore'],
    ['style.ts_suppression', ['/* @ts-', 'nocheck */'].join(''), 'nocheck'],
    ['style.unbraced_body', 'if (ready) return', 'unbraced if'],
    ['style.unbraced_body', 'for (const x of xs) use(x)', 'unbraced for'],
    ['style.unbraced_body', 'while (busy) wait()', 'unbraced while'],
    ['style.switch_default', 'switch (x) {\n  case 1:\n    break\n}', 'switch'],
  ]

  for (const [code, line, label] of cases) {
    assert.deepEqual(codes('src/example.ts', `${line}\n`), [code], label)
  }
})

test('the structural rules follow a construct across its lines', () => {
  // A wrapped condition is followed to its closing parenthesis before the
  // body is inspected, and `else if` is one chain rather than a bare `else`.
  const wrapped = [
    'if (',
    '  first &&',
    '  second',
    ')',
    '  run()',
    'else if (third) {',
    '  other()',
    '} else',
    '  fallback()',
    '',
  ].join('\n')

  assert.deepEqual(
    analyzeCodeStyle('src/wrapped.ts', wrapped).map((issue) => [
      issue.code,
      issue.line,
    ]),
    [
      ['style.unbraced_body', 1],
      ['style.unbraced_body', 8],
    ],
  )

  // A `do` loop's tail `while` is not a statement header.
  assert.deepEqual(codes('src/tail.ts', 'do {\n  step()\n} while (busy)\n'), [])

  // An independent block needs a blank line unless it opens its body. A
  // comment above the block belongs to it, so the blank line sits above the
  // comment. A `case` label and an `else` also open a body.
  const spacing = [
    'function run(items: string[]): void {',
    '  prepare()',
    '  if (items.length === 0) {',
    '    return',
    '  }',
    '',
    '  // The blank line above this comment satisfies the rule.',
    '  for (const item of items) {',
    '    use(item)',
    '  }',
    '  // This comment is attached to a block with no blank line above.',
    '  while (pending()) {',
    '    drain()',
    '  }',
    '',
    '  switch (items.length) {',
    '    case 1:',
    '      if (items[0]) {',
    '        single()',
    '      }',
    '      break',
    '    default:',
    '      break',
    '  }',
    '}',
    '',
  ].join('\n')

  assert.deepEqual(
    analyzeCodeStyle('src/spacing.ts', spacing).map((issue) => [
      issue.code,
      issue.line,
    ]),
    [
      ['style.block_spacing', 3],
      ['style.block_spacing', 12],
    ],
  )

  // A local declaration group holds four declarations. A wrapped
  // declaration's continuation lines and a comment inside the group do not
  // count, a blank line ends the group, and module-level constants are
  // outside the section.
  const groups = [
    'export const a = 1',
    'export const b = 2',
    'export const c = 3',
    'export const d = 4',
    'export const e = 5',
    '',
    'function build(): number {',
    '  const first = 1',
    '  const second = load(',
    '    first,',
    '  )',
    '  // A comment does not break the group.',
    '  const { third } = second',
    '  const fourth = [third]',
    '    .map((value) => value)',
    '  const fifth = 5',
    '',
    '  const sixth = 6',
    '  const seventh = 7',
    '  const eighth = 8',
    '  const ninth = 9',
    '  let tenth = 10',
    '',
    '  return first + fifth + sixth + tenth',
    '}',
    '',
  ].join('\n')

  assert.deepEqual(
    analyzeCodeStyle('src/groups.ts', groups).map((issue) => [
      issue.code,
      issue.line,
    ]),
    [
      ['style.declaration_group', 16],
      ['style.declaration_group', 22],
    ],
  )

  // The `default` label is found at the switch's own depth, so a nested
  // switch cannot lend its label to the outer one.
  const nested = [
    'switch (outer) {',
    '  case 1: {',
    '    switch (inner) {',
    '      default:',
    '        break',
    '    }',
    '    break',
    '  }',
    '}',
    '',
  ].join('\n')

  assert.deepEqual(codes('src/nested.ts', nested), ['style.switch_default'])
})

test('a documented exception waives one rule on the construct below it', () => {
  const waived = [
    '// style: allow style.default_export Node loads a reporter through it.',
    'export default async function* report() {}',
    '',
  ].join('\n')
  const undocumented = [
    '// style: allow style.default_export',
    'export default async function* report() {}',
    '',
  ].join('\n')
  const otherRule = [
    '// style: allow style.debugger Not the rule that fires below.',
    'export default async function* report() {}',
    '',
  ].join('\n')

  assert.deepEqual(codes('src/reporter.ts', waived), [])
  assert.deepEqual(codes('src/reporter.ts', undocumented), [
    'style.default_export',
  ])
  assert.deepEqual(codes('src/reporter.ts', otherRule), [
    'style.default_export',
  ])
  assert.deepEqual(
    codes(
      'tools/report.py',
      [
        'try:',
        '    run()',
        '# style: allow style.bare_except The wrapped API raises bare.',
        'except:',
        '    pass',
        '',
      ].join('\n'),
    ),
    [],
  )
})

test('each Python rule reports the construct its handbook section forbids', () => {
  const cases: Array<[string, string, string]> = [
    ['style.wildcard_import', 'from os.path import *\n', 'wildcard import'],
    [
      'style.bare_except',
      'try:\n    run()\nexcept:\n    pass\n',
      'bare except',
    ],
    [
      'style.mutable_default_argument',
      'def collect(items=[]):\n    return items\n',
      'mutable default',
    ],
    [
      'style.mutable_default_argument',
      'def collect(\n    first,\n    options={},\n):\n    return first\n',
      'multi-line signature',
    ],
  ]

  for (const [code, source, label] of cases) {
    assert.deepEqual(codes('tools/report.py', source), [code], label)
  }
})

test('the handbook exceptions and the formatter boundary stay unreported', () => {
  // `== null` is the one loose comparison the guide permits, `require` is
  // correct in CommonJS, and a comment or a string is not code.
  assert.deepEqual(codes('src/example.ts', 'if (value == null) {\n'), [])
  assert.deepEqual(codes('src/example.ts', 'if (value != null) {\n'), [])
  assert.deepEqual(codes('tools/legacy.cjs', "require('node:fs')\n"), [])
  assert.deepEqual(codes('src/example.ts', '// var total: any = 0\n'), [])
  assert.deepEqual(codes('src/example.ts', '/* value! */\n'), [])
  assert.deepEqual(codes('src/example.ts', "const text = 'var x == y'\n"), [])
  assert.deepEqual(codes('src/example.ts', 'const pattern = /a==b/u\n'), [])
  assert.deepEqual(codes('src/example.ts', 'const flag = !(value)\n'), [])
  // A template nested in a substitution does not end the outer template, so
  // the `#` inside it is text rather than a private field.
  assert.deepEqual(
    codes('src/example.ts', "const label = `${a}${b === 1 ? '' : `#${b}`}`\n"),
    [],
  )
  assert.deepEqual(codes('src/example.ts', 'const same = left === right\n'), [])
  assert.deepEqual(codes('tools/report.py', '# from os import *\n'), [])
  assert.deepEqual(
    codes('tools/report.py', 'def collect(items=None):\n    return items\n'),
    [],
  )

  const clean = [
    "import fs from 'node:fs'",
    '',
    'export function total(values: readonly number[]): number {',
    '  let sum = 0',
    '',
    '  for (const value of values) {',
    '    sum += value',
    '  }',
    '',
    '  return sum',
    '}',
    '',
  ].join('\n')

  assert.deepEqual(codes('src/total.ts', clean), [])
  assert.deepEqual(codes('src/empty.ts', ''), [])
})

test('unparsable content is reported without a crash', () => {
  // The checker is line-based, so a truncated or binary-looking file yields a
  // verdict instead of an exception.
  const truncated = 'export function open(value: any) {\n  return value\n'
  const binary = `\u0000\u0001var total = 0\u0000\n`

  assert.deepEqual(codes('src/truncated.ts', truncated), ['style.any_type'])
  assert.deepEqual(codes('src/binary.ts', binary), ['style.var_declaration'])
  assert.deepEqual(codes('src/unterminated.ts', "const text = 'open\n"), [])
})

test('the validator caps its report and states the elided count', () => {
  const root = scratchRoot()
  const lines = Array.from(
    { length: MAX_REPORTED_ISSUES + 5 },
    (_, index) => `const value${index}: any = ${index}`,
  )

  writeArtifact(root, 'src/wide.ts', `${lines.join('\n')}\n`)

  const result = validateCodeStyle(input(root, 'src/wide.ts'))

  assert.equal(result.status, 'failed')
  assert.equal(result.issues.length, MAX_REPORTED_ISSUES + 1)
  assert.equal(
    result.issues.filter((issue) => issue.code === 'style.any_type').length,
    MAX_REPORTED_ISSUES,
  )
  assert.equal(
    result.issues.at(-1)?.code,
    'style.issues_elided',
    'the tail issue states that the report is truncated',
  )
  assert.match(String(result.issues.at(-1)?.message), /^5 more code style/u)
})

test('the validator reports a line number, a pass, and a missing artifact', () => {
  const root = scratchRoot()

  writeArtifact(
    root,
    'src/late.ts',
    ['export const first = 1', '', 'var second = 2', ''].join('\n'),
  )
  writeArtifact(root, 'src/clean.ts', 'export const first = 1\n')

  const failed = validateCodeStyle(input(root, 'src/late.ts'))

  assert.equal(failed.status, 'failed')
  assert.deepEqual(
    failed.issues.map((issue) => [issue.code, issue.line]),
    [['style.var_declaration', 3]],
  )

  assert.equal(validateCodeStyle(input(root, 'src/clean.ts')).status, 'passed')

  const missing = validateCodeStyle(input(root, 'src/absent.ts'))

  assert.equal(missing.status, 'failed')
  assert.deepEqual(
    missing.issues.map((issue) => issue.code),
    ['artifact.missing'],
  )
})
