import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Give a fixture clone the workspace files repository validation audits beside
 * governance: a tests/ tree, the formatter config, the compiler config, and a
 * CLI entry point.
 */
export function prepareValidationFixture(root: string): void {
  mkdirSync(path.join(root, 'tests'), { recursive: true })
  writeFileSync(path.join(root, 'prettier.config.js'), 'export default {}\n')
  writeFileSync(path.join(root, 'tsconfig.json'), '{}\n')
  writeFileSync(path.join(root, 'src', 'cli.ts'), 'export {}\n')
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

export function writeJsonFile(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

/** Assert each expected diagnostic by label, so a miss names what is absent. */
export function assertEachDiagnostic(
  errors: string[],
  expected: Array<[string, RegExp]>,
): void {
  const joined = errors.join('\n')

  for (const [label, pattern] of expected) {
    assert.match(joined, pattern, `${label}: diagnostic missing`)
  }
}
