import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  analyzeCodeStyle,
  codeStyleLanguage,
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
  ]

  for (const [code, line, label] of cases) {
    assert.deepEqual(codes('src/example.ts', `${line}\n`), [code], label)
  }
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
  assert.deepEqual(codes('src/example.ts', 'const same = left === right\n'), [])
  assert.deepEqual(codes('tools/report.py', '# from os import *\n'), [])
  assert.deepEqual(
    codes('tools/report.py', 'def collect(items=None):\n    return items\n'),
    [],
  )
})

test('a clean file, an empty file, and an uncovered file report nothing', () => {
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
  assert.deepEqual(codes('docs/guide.md', 'var total = 0\n'), [])
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
