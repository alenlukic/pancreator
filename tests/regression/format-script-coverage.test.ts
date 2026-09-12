import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { getFileInfo } from 'prettier'

const REPO_ROOT = process.cwd()

/**
 * The inputs one format script hands Prettier, with flags removed. The script
 * text is the authority: a narrowed list that drifts from the tracked tree is
 * the failure this file exists to catch.
 */
function formatScriptInputs(scriptName: string): string[] {
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> }
  const script = manifest.scripts[scriptName]

  assert.ok(script, `package.json declares no '${scriptName}' script.`)

  const tokens = script.split(/\s+/u)
  const prettierIndex = tokens.indexOf('prettier')

  assert.ok(prettierIndex >= 0, `'${scriptName}' does not invoke prettier.`)

  return tokens
    .slice(prettierIndex + 1)
    .filter((token) => !token.startsWith('-'))
    .map((token) => token.replace(/^["']|["']$/gu, ''))
}

/** Whether one repository-relative path is reached by a script input. */
function covered(inputs: string[], filePath: string): boolean {
  return inputs.some((input) => {
    if (input === '.') {
      return true
    }

    if (input.startsWith('*.')) {
      return !filePath.includes('/') && filePath.endsWith(input.slice(1))
    }

    return filePath === input || filePath.startsWith(`${input}/`)
  })
}

/**
 * Narrowing the formatter's input from the whole tree to an explicit list
 * trades a directory walk for a claim about the tree's shape. A new top-level
 * directory, or a new formattable root file, silently escapes the gate when
 * that claim goes stale, and the first evidence is a formatting diff nobody
 * asked for. Prettier itself decides what is formattable here, so the test
 * cannot disagree with the tool it guards.
 */
test('the format scripts reach every formattable tracked file', async () => {
  const inputs = formatScriptInputs('format:check')
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((entry) => entry.length > 0)
  const escaped: string[] = []

  for (const filePath of tracked) {
    if (covered(inputs, filePath)) {
      continue
    }

    const info = await getFileInfo(path.join(REPO_ROOT, filePath), {
      ignorePath: path.join(REPO_ROOT, '.prettierignore'),
    })

    if (!info.ignored && info.inferredParser !== null) {
      escaped.push(filePath)
    }
  }

  assert.deepEqual(
    escaped,
    [],
    `These tracked files are formattable but outside the format scripts: ` +
      `${escaped.join(', ')}. Add their top-level path to both scripts in ` +
      `package.json, or ignore them in .prettierignore.`,
  )
})

/**
 * A writer that formats less than the checker verifies leaves a repository
 * that cannot be brought into compliance by running the writer.
 */
test('the format writer and checker take the same inputs', () => {
  assert.deepEqual(
    formatScriptInputs('format'),
    formatScriptInputs('format:check'),
  )
})
