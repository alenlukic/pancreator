import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { createTestTempDirectory } from '../temp.js'

/**
 * A synthetic tree: two source modules, a shared test helper, a bin script,
 * a fixture directory, and one test per lane. Nothing here depends on the
 * repository's own graph.
 */
export function createSyntheticTree(): string {
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
  // Operator-facing text that names the CLI is not a spawn.
  write(
    'src/lib/message.ts',
    `export const hint = 'Run ./bin/pan status to inspect the run.'\n`,
  )
  write(
    'tests/unit/message.test.ts',
    `import { hint } from '../../src/lib/message.js'\ntest(hint)\n`,
  )
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
    'tests/regression/cli-helpers.ts',
    `export const CLI = path.join(root, 'dist', 'src', 'cli.js')\nexport const lint = path.join(root, 'bin', 'lint')\nexport const sample = 'tests/fixtures/sample/case.json'\n`,
  )
  write(
    'tests/regression/via-helper.test.ts',
    `import { CLI, lint, sample } from './cli-helpers.js'\ntest(CLI, lint, sample)\n`,
  )
  write(
    'tests/regression/cli.test.ts',
    `const CLI = path.join(root, 'dist', 'src', 'cli.js')\nspawn('/bin/bash', [path.join(root, 'bin', 'pan')])\n`,
  )
  write(
    'tests/regression/lint-script.test.ts',
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
  write(
    'tests/integration/pre-release.test.ts',
    `import { core } from '../../src/lib/core.js'\ntest(core)\n`,
  )
  write('tests/fixtures/sample/case.json', `{}\n`)
  write('bin/pan', `#!/usr/bin/env bash\n`)
  write('bin/lint', `#!/usr/bin/env bash\n`)

  return root
}
