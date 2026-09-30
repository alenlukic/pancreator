/**
 * The scanned languages and their governing style policy, and the maskers that
 * blank strings, template text, regular expressions, and comments so a rule
 * reads code alone.
 */

import path from 'node:path'

/** Reported-issue ceiling, so one long source file cannot flood a stage record. */
export const MAX_REPORTED_ISSUES = 50

export type CodeStyleLanguage = 'javascript' | 'python' | 'typescript'

export interface CodeStyleIssue {
  code: string
  message: string
  line: number
}

const LANGUAGE_BY_EXTENSION = new Map<string, CodeStyleLanguage>([
  ['.cjs', 'javascript'],
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.mjs', 'javascript'],
  ['.py', 'python'],
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
])

/** Every file extension the code style scan and checker cover. */
export const CODE_STYLE_EXTENSIONS: readonly string[] = [
  ...LANGUAGE_BY_EXTENSION.keys(),
]

export const JAVASCRIPT_EXTENSIONS: readonly string[] = [
  ...LANGUAGE_BY_EXTENSION.entries(),
]
  .filter(([, language]) => language === 'javascript')
  .map(([extension]) => extension)

/**
 * The language whose style guide governs a path, or `null` when no handbook
 * covers it. One owner of the extension map keeps the scan's eligible set and
 * the checker's rule selection from drifting apart.
 */
export function codeStyleLanguage(
  relativePath: string,
): CodeStyleLanguage | null {
  return (
    LANGUAGE_BY_EXTENSION.get(path.extname(relativePath).toLowerCase()) ?? null
  )
}

/**
 * The policy that governs each scanned language. Resolved where the language
 * is already detected, so validation evidence names the handbook a repair must
 * read instead of one identifier chosen for every file.
 *
 * JavaScript reports under `TSTYLE-001`. No policy claims the four JavaScript
 * extensions, and the checker applies the script rules of the TypeScript
 * handbook to them, so naming that handbook states what the scan did. The
 * style command card says so where an operator reads it.
 */
const POLICY_BY_LANGUAGE: Record<CodeStyleLanguage, string> = {
  javascript: 'TSTYLE-001',
  python: 'PYSTYLE-001',
  typescript: 'TSTYLE-001',
}

/** Every policy this validator can name, for a caller selecting among them. */
export const CODE_STYLE_POLICY_IDS: readonly string[] = [
  ...new Set(Object.values(POLICY_BY_LANGUAGE)),
]

/**
 * The policy governing a path, or `null` when no handbook covers it. The
 * governing policy follows the file, so a Python target cannot report under
 * the TypeScript handbook.
 */
export function codeStylePolicyId(relativePath: string): string | null {
  const language = codeStyleLanguage(relativePath)

  return language ? POLICY_BY_LANGUAGE[language] : null
}

/**
 * Characters that leave the parser in expression position, so a following
 * slash opens a regular expression rather than a division.
 */
const REGEX_OPENS_AFTER = new Set([
  '',
  '!',
  '%',
  '&',
  '(',
  '*',
  '+',
  ',',
  '-',
  ':',
  ';',
  '<',
  '=',
  '>',
  '?',
  '[',
  '^',
  '{',
  '|',
  '}',
  '~',
])

const REGEX_OPENS_AFTER_KEYWORD = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
])

function blankOut(text: string): string {
  return text.replaceAll(/[^\n]/gu, ' ')
}

/**
 * The offset after the quote closing the string opened at `start`. A quoted
 * string runs to its closing quote; an unterminated one runs to the end.
 */
function quotedStringEnd(source: string, start: number): number {
  const quote = source[start]
  let cursor = start + 1

  while (cursor < source.length) {
    const inner = source[cursor]

    if (inner === '\\') {
      cursor += 2
      continue
    }

    if (inner === quote) {
      return cursor + 1
    }

    cursor += 1
  }

  return source.length
}

/**
 * The offset after the backtick closing the template opened at `start`. A
 * `${}` substitution may hold strings and nested templates, so it is walked
 * to its own closing brace before the outer template continues.
 */
function templateEnd(source: string, start: number): number {
  let cursor = start + 1

  while (cursor < source.length) {
    const inner = source[cursor]

    if (inner === '\\') {
      cursor += 2
      continue
    }

    if (inner === '`') {
      return cursor + 1
    }

    if (inner === '$' && source[cursor + 1] === '{') {
      cursor = substitutionEnd(source, cursor + 2)
      continue
    }

    cursor += 1
  }

  return source.length
}

function substitutionEnd(source: string, start: number): number {
  let depth = 0
  let cursor = start

  while (cursor < source.length) {
    const inner = source[cursor]

    if (inner === '`') {
      cursor = templateEnd(source, cursor)
      continue
    }

    if (inner === '"' || inner === "'") {
      cursor = quotedStringEnd(source, cursor)
      continue
    }

    if (inner === '{') {
      depth += 1
    } else if (inner === '}') {
      if (depth === 0) {
        return cursor + 1
      }

      depth -= 1
    }

    cursor += 1
  }

  return source.length
}

/**
 * Replace comments, string literals, and regular expressions with spaces so a
 * rule matches code alone. Line numbers survive because only non-newline
 * characters are blanked.
 */
export function maskScriptNonCode(source: string): string {
  let masked = ''
  let index = 0
  let previousToken = ''

  function lastWordBefore(position: number): string {
    const before = source.slice(0, position)
    const match = /([A-Za-z_$][\w$]*)\s*$/u.exec(before)

    return match?.[1] ?? ''
  }

  while (index < source.length) {
    const character = source[index] ?? ''
    const following = source[index + 1] ?? ''

    if (character === '/' && following === '/') {
      const end = source.indexOf('\n', index)
      const stop = end === -1 ? source.length : end

      masked += blankOut(source.slice(index, stop))
      index = stop
      continue
    }

    if (character === '/' && following === '*') {
      const end = source.indexOf('*/', index + 2)
      const stop = end === -1 ? source.length : end + 2

      masked += blankOut(source.slice(index, stop))
      index = stop
      continue
    }

    if (character === '"' || character === "'" || character === '`') {
      const cursor =
        character === '`'
          ? templateEnd(source, index)
          : quotedStringEnd(source, index)

      masked += character + blankOut(source.slice(index + 1, cursor))
      index = cursor
      continue
    }

    if (
      character === '/' &&
      (REGEX_OPENS_AFTER.has(previousToken) ||
        REGEX_OPENS_AFTER_KEYWORD.has(lastWordBefore(index)))
    ) {
      let cursor = index + 1
      let inClass = false
      let closed = false

      while (cursor < source.length) {
        const inner = source[cursor]

        if (inner === '\n') {
          break
        }

        if (inner === '\\') {
          cursor += 2
          continue
        }

        if (inner === '[') {
          inClass = true
        } else if (inner === ']') {
          inClass = false
        } else if (inner === '/' && !inClass) {
          cursor += 1
          closed = true
          break
        }

        cursor += 1
      }

      if (closed) {
        masked += blankOut(source.slice(index, cursor))
        index = cursor
        previousToken = ''
        continue
      }
    }

    masked += character
    index += 1

    if (character.trim().length > 0) {
      previousToken = character
    }
  }

  return masked
}

/** The Python counterpart: `#` comments plus short and triple-quoted strings. */
export function maskPythonNonCode(source: string): string {
  let masked = ''
  let index = 0

  while (index < source.length) {
    const character = source[index] ?? ''

    if (character === '#') {
      const end = source.indexOf('\n', index)
      const stop = end === -1 ? source.length : end

      masked += blankOut(source.slice(index, stop))
      index = stop
      continue
    }

    if (character === '"' || character === "'") {
      const triple = source.slice(index, index + 3)
      const delimiter =
        triple === character.repeat(3) ? character.repeat(3) : character
      let cursor = index + delimiter.length

      while (cursor < source.length) {
        const inner = source[cursor]

        if (inner === '\\') {
          cursor += 2
          continue
        }

        if (source.startsWith(delimiter, cursor)) {
          cursor += delimiter.length
          break
        }

        if (delimiter.length === 1 && inner === '\n') {
          break
        }

        cursor += 1
      }

      masked +=
        delimiter + blankOut(source.slice(index + delimiter.length, cursor))
      index = cursor
      continue
    }

    masked += character
    index += 1
  }

  return masked
}
