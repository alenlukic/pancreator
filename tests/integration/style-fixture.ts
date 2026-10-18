import path from 'node:path'

import { CODE_STYLE_EXTENSIONS } from '../../src/lib/validators/code-style/source.js'
import { createFixture, fixtureGit } from '../fixture-template.js'

/** Keep harness configuration, but let each style test own its source set. */
export function createStyleFixture(): string {
  const root = createFixture()
  const options = { cwd: root, encoding: 'utf8' as const }
  const sources = fixtureGit(['ls-files', '-z'], options)
    .split('\0')
    .filter((file) =>
      CODE_STYLE_EXTENSIONS.includes(path.extname(file).toLowerCase()),
    )

  // Canonical TSX templates are application samples, not this test's inputs.
  if (sources.length > 0) {
    fixtureGit(['rm', '-q', '--', ...sources], options)
    fixtureGit(['commit', '-qm', 'isolate style fixture sources'], options)
  }

  return root
}
