/**
 * The daily quality surfaces registry is the one list the landing check and
 * the installer accept. It must cover every surface the conform and style
 * passes can repair, or a legitimate daily repair would be refused.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  EDITABLE_INSTRUCTION_DIRECTORIES,
  EDITABLE_INSTRUCTION_FILES,
  HARNESS_ISSUES_DIRECTORY,
} from '../../src/lib/conform.js'
import { CODE_STYLE_EXTENSIONS } from '../../src/lib/validators/code-style.js'

const SURFACES = JSON.parse(
  readFileSync(
    path.join(
      process.cwd(),
      'governance',
      'registries',
      'daily_quality_surfaces.json',
    ),
    'utf8',
  ),
) as { conform_paths: string[]; style_extensions: string[] }

test('the surfaces registry covers every editable conform surface', () => {
  const expected = [
    ...EDITABLE_INSTRUCTION_FILES,
    ...EDITABLE_INSTRUCTION_DIRECTORIES.map(
      (entry) => `${entry.directory}/*${entry.extension}`,
    ),
    `${HARNESS_ISSUES_DIRECTORY}/**/*.md`,
  ]

  for (const pattern of expected) {
    assert.ok(
      SURFACES.conform_paths.includes(pattern),
      `conform surface '${pattern}' is missing from the surfaces registry`,
    )
  }
})

test('the surfaces registry covers every extension the style pass scans', () => {
  for (const extension of CODE_STYLE_EXTENSIONS) {
    assert.ok(
      SURFACES.style_extensions.includes(extension),
      `style extension '${extension}' is missing from the surfaces registry`,
    )
  }
})
