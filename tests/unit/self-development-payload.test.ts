import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const ROOT = process.cwd()

const HARNESS_LINEUP = 'library/skills/review-squad-pancreator.md'
const TARGET_REQUIRED_FILE = 'library/templates/launchd-schedule.plist'

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

function baseRequiredPaths(validationSource: string): string[] {
  const block =
    /const required = \[\n([\s\S]*?)\n  \]\n\n  if \(selfDevelopment\)/u.exec(
      validationSource,
    )

  assert.ok(block, 'validation declares its base required-file list')

  return [...block[1].matchAll(/['"]([^'"]+)['"]/gu)].map(
    (match) => match[1] as string,
  )
}

function selfDevelopmentRequiredPaths(validationSource: string): string[] {
  const block =
    /if \(selfDevelopment\) \{\n    required\.push\(\n([\s\S]*?)\n    \)/u.exec(
      validationSource,
    )

  assert.ok(block, 'validation declares its self-development required list')

  return [...block[1].matchAll(/['"]([^'"]+)['"]/gu)].map(
    (match) => match[1] as string,
  )
}

test('a file repository validation always requires ships to a target', () => {
  const paths = selfDevelopmentOnlyPaths()
  const validationSource = readRepositoryFile('src/lib/validation.ts')

  // The launch agent template belongs to the base required list. Searching the
  // whole file would also match a path moved into the self-development branch.
  assert.ok(baseRequiredPaths(validationSource).includes(TARGET_REQUIRED_FILE))
  assert.equal(existsSync(path.join(ROOT, TARGET_REQUIRED_FILE)), true)
  assert.equal(paths.includes(TARGET_REQUIRED_FILE), false)

  // Reproduce the pre-change defect: move the same literal into the
  // self-development-only branch. The guard must lose the required base path.
  const removed = validationSource.replace(
    `    '${TARGET_REQUIRED_FILE}',\n`,
    '',
  )
  const movedToSelfDevelopment = removed.replace(
    'if (selfDevelopment) {\n    required.push(\n',
    `if (selfDevelopment) {\n    required.push(\n      '${TARGET_REQUIRED_FILE}',\n`,
  )

  // Both halves of the mutation must land. Asserting the base list alone
  // would still pass if the insertion matched nothing, which proves that a
  // removal is detected rather than that a move is.
  assert.notEqual(removed, validationSource, 'the base entry was removed')
  assert.ok(
    selfDevelopmentRequiredPaths(movedToSelfDevelopment).includes(
      TARGET_REQUIRED_FILE,
    ),
    'the entry landed in the self-development-only branch',
  )
  assert.equal(
    baseRequiredPaths(movedToSelfDevelopment).includes(TARGET_REQUIRED_FILE),
    false,
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
