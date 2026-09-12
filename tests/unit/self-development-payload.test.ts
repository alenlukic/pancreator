import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const ROOT = process.cwd()

const HARNESS_LINEUP = 'library/skills/review-squad-pancreator.md'

function readRepositoryFile(relative: string): string {
  return readFileSync(path.join(ROOT, relative), 'utf8')
}

function selfDevelopmentOnlyPaths(): string[] {
  const installer = readRepositoryFile('bin/install')
  const block = /SELF_DEVELOPMENT_ONLY_PAYLOAD_PATHS=\(\n([\s\S]*?)\n\)/u.exec(
    installer,
  )

  assert.ok(block, 'bin/install declares SELF_DEVELOPMENT_ONLY_PAYLOAD_PATHS')

  return block[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

test('self-development-only payload paths exist in the source checkout', () => {
  const paths = selfDevelopmentOnlyPaths()

  assert.ok(paths.length > 0)

  for (const relative of paths) {
    // The catalog is operator-local and optional, so absence is expected.
    if (relative === 'governance/registries/cursor_model_catalog.json') {
      continue
    }

    assert.equal(
      existsSync(path.join(ROOT, relative)),
      true,
      `${relative} is declared self-development-only but does not exist`,
    )
  }

  // The harness lineup is self-development-only; the core squad ships.
  assert.ok(paths.includes(HARNESS_LINEUP))
  assert.equal(paths.includes('library/skills/review-squad.md'), false)
})

test('the skill index does not link a file the payload omits', () => {
  const index = readRepositoryFile('library/skills/index.md')
  const basename = path.basename(HARNESS_LINEUP)

  assert.ok(index.includes(basename))
  assert.equal(
    index.includes(`](${basename})`),
    false,
    'a linked entry would dangle in a target installation',
  )
})
