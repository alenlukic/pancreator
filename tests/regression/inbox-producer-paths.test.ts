import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

/**
 * Every harness producer of an inbox item MUST write it under the queue
 * lifecycle directory.
 *
 * A producer that writes to `runtime/inbox/` directly leaves an item no
 * lifecycle command can claim, finish, or restore, and the finalization
 * rewrite used to miss it entirely. The earlier version of this regression
 * asserted only that the queue helper existed, which every producer satisfied
 * whether or not it called the helper. This one reads the write sites.
 */
const SOURCE_ROOT = path.join(process.cwd(), 'src')

const WRITE_CALL =
  /\b(?:writeTextAtomic|writeFileSync|writeJsonAtomic|renameSync|copyFileSync)\(/gu

/** A path literal that resolves the inbox root instead of a lifecycle directory. */
const INBOX_ROOT_LITERAL = /['"`](?:\.\/)?runtime\/inbox['"`]/u

/**
 * The argument list of a call that starts at `open`, the index just past its
 * opening parenthesis. Bounding the window at the matching close keeps the
 * next statement's inbox literal from being read as this call's target.
 */
function argumentList(source: string, open: number): string {
  let depth = 1

  for (let index = open; index < source.length; index += 1) {
    const character = source[index]

    if (character === '(') {
      depth += 1
      continue
    }

    if (character === ')') {
      depth -= 1

      if (depth === 0) {
        return source.slice(open, index)
      }
    }
  }

  return source.slice(open)
}

/**
 * Report every inbox write in one source file that does not resolve its path
 * through the queue helper.
 */
export function inboxRootWrites(source: string): string[] {
  const lines = source.split('\n')

  return [...source.matchAll(WRITE_CALL)].flatMap((match) => {
    const window = argumentList(source, (match.index ?? 0) + match[0].length)

    if (
      !INBOX_ROOT_LITERAL.test(window) ||
      window.includes('queueInboxRelativePath')
    ) {
      return []
    }

    const index = source.slice(0, match.index).split('\n').length - 1

    return [`${index + 1}: ${lines[index].trim()}`]
  })
}

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry)

    if (statSync(absolute).isDirectory()) {
      return typescriptFiles(absolute)
    }

    return absolute.endsWith('.ts') ? [absolute] : []
  })
}

test('no harness producer writes an inbox item to the inbox root', () => {
  const violations = typescriptFiles(SOURCE_ROOT).flatMap((file) =>
    inboxRootWrites(readFileSync(file, 'utf8')).map(
      (violation) => `${path.relative(process.cwd(), file)}:${violation}`,
    ),
  )

  assert.deepEqual(
    violations,
    [],
    `Inbox items MUST be written through queueInboxRelativePath:\n${violations.join('\n')}`,
  )
})

// The detector is the regression. A detector that reports nothing would pass
// the case above no matter what the producers do, so both verdicts are pinned.
test('the producer detector fails a root write and passes a queue write', () => {
  const rootWriter = [
    "const target = path.join(root, 'runtime/inbox', fileName)",
    '',
    'writeTextAtomic(',
    "  resolveInside(root, path.join('runtime/inbox', fileName)),",
    '  body,',
    ')',
  ].join('\n')
  const queueWriter = [
    'writeTextAtomic(',
    '  resolveInside(root, queueInboxRelativePath(fileName)),',
    '  body,',
    ')',
  ].join('\n')

  assert.equal(inboxRootWrites(rootWriter).length, 1)
  assert.deepEqual(inboxRootWrites(queueWriter), [])
})
