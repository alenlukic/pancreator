import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const ROOT = process.cwd()

const HARNESS_LINEUP = 'library/skills/review-squad-pancreator.md'

function readRepositoryFile(relative: string): string {
  return readFileSync(path.join(ROOT, relative), 'utf8')
}

/** Parse the installer's self-development-only payload array. */
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
})

test('the installer removes every self-development-only path from staging', () => {
  const installer = readRepositoryFile('bin/install')
  const staging = /prepare_staging_payload\(\) \{\n([\s\S]*?)\n\}\n/u.exec(
    installer,
  )?.[1]

  assert.ok(staging, 'bin/install defines prepare_staging_payload')
  assert.match(
    staging,
    /for self_development_only in "\$\{SELF_DEVELOPMENT_ONLY_PAYLOAD_PATHS\[@\]\}"; do\n\s*rm -f "\$staging\/\$self_development_only"/u,
  )
})

test('the harness review lineup is excluded and the core squad is not', () => {
  const paths = selfDevelopmentOnlyPaths()

  assert.ok(paths.includes(HARNESS_LINEUP))
  assert.equal(paths.includes('library/skills/review-squad.md'), false)
})

test('the harness review lineup covers its declared dimensions', () => {
  const lineup = readRepositoryFile(HARNESS_LINEUP)

  for (const heading of [
    '### Correctness & consistency',
    '### Agentic practice',
    '### Performance',
  ]) {
    assert.ok(lineup.includes(heading), `${HARNESS_LINEUP} defines ${heading}`)
  }
})

test('the core squad guards its harness-lineup reference on presence', () => {
  const squad = readRepositoryFile('library/skills/review-squad.md')

  assert.ok(squad.includes(HARNESS_LINEUP))
  // The file is absent in a target installation, so the reference has to be
  // conditional rather than a flat instruction to read it.
  assert.match(
    squad,
    /When `library\/skills\/review-squad-pancreator\.md` is\s+present/u,
  )
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
