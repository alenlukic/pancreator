import path from 'node:path'

import { fileExists, readText } from '../io.js'
import type { HandlerInput, HandlerResult } from '../requirements/types.js'

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
      let cursor = index + 1

      while (cursor < source.length) {
        const inner = source[cursor]

        if (inner === '\\') {
          cursor += 2
          continue
        }

        if (inner === character) {
          cursor += 1
          break
        }

        cursor += 1
      }

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

interface LineRule {
  code: string
  message: string
  pattern: RegExp
  /** Skip the rule for a file whose extension makes the construct correct. */
  skipExtensions?: readonly string[]
  /** Drop a match the handbook explicitly permits. */
  permitted?: (line: string, match: RegExpExecArray) => boolean
}

const IMPORT_ASSIGNMENT_PATTERN = /^\s*import\s+[A-Za-z_$][\w$]*\s*=/u

const SCRIPT_RULES: readonly LineRule[] = [
  {
    code: 'style.any_type',
    message:
      'TypeScript style guide, `unknown` and `any` — avoid `any`. Use `unknown` and narrow it, or state a specific type.',
    pattern: /:\s*any\b|\bas\s+any\b|[<,]\s*any\s*[,>]|\bany\s*\[\]/gu,
  },
  {
    code: 'style.non_null_assertion',
    message:
      'TypeScript style guide, Assertions — avoid the non-null assertion. Narrow the value with a runtime check or an explicit annotation.',
    // The operand binds tight against `!`, which separates the assertion from
    // logical negation such as `return !(value)`. The formatter owns that gap.
    pattern: /[\w$)\]]!(?=\s*[.[(,;:)\]}]|\s*$)/gu,
  },
  {
    code: 'style.loose_equality',
    message:
      'TypeScript style guide, Equality — use `===` and `!==`. Only `== null` and `!= null` may test both `null` and `undefined`.',
    pattern: /(?<![=!<>])(?:==|!=)(?!=)/gu,
    permitted: (line, match) =>
      /^\s*null\b/u.test(line.slice(match.index + match[0].length)),
  },
  {
    code: 'style.var_declaration',
    message:
      'TypeScript style guide, Variables — never use `var`. Declare with `const`, or `let` when the binding is reassigned.',
    pattern: /(?<![\w$.])var(?=\s)/gu,
  },
  {
    code: 'style.legacy_module',
    message:
      'TypeScript style guide, Imports — do not use `require`. Use ES module syntax.',
    pattern: /(?<![\w$.])require\s*\(/gu,
    skipExtensions: ['.cjs'],
    // `import fs = require('node:fs')` is one construct, and the import
    // assignment rule below already names it.
    permitted: (line) => IMPORT_ASSIGNMENT_PATTERN.test(line),
  },
  {
    code: 'style.legacy_module',
    message:
      'TypeScript style guide, Imports — do not use TypeScript namespaces. Use ES modules.',
    pattern: /^\s*(?:export\s+|declare\s+)*namespace\s+[A-Za-z_$]/gu,
  },
  {
    code: 'style.legacy_module',
    message:
      'TypeScript style guide, Imports — do not use import assignment. Use ES module syntax.',
    pattern: new RegExp(IMPORT_ASSIGNMENT_PATTERN.source, 'gu'),
  },
  {
    code: 'style.const_enum',
    message:
      'TypeScript style guide, Restricted features — do not use `const enum`. Use a plain `enum` or a union of literals.',
    pattern: /(?<![\w$.])const\s+enum(?![\w$])/gu,
  },
]

/**
 * A triple-slash reference is a comment, so it is matched before masking
 * removes it.
 */
const RAW_SCRIPT_RULES: readonly LineRule[] = [
  {
    code: 'style.legacy_module',
    message:
      'TypeScript style guide, Imports — do not use triple-slash path references. Import the module instead.',
    pattern: /^\s*\/\/\/\s*<reference\b/gu,
  },
]

const PYTHON_RULES: readonly LineRule[] = [
  {
    code: 'style.wildcard_import',
    message:
      'Python style guide, Import behavior — wildcard imports MUST NOT be used in durable code. Import each name explicitly.',
    pattern: /^\s*from\s+[.\w]+\s+import\s+\*/gu,
  },
  {
    code: 'style.bare_except',
    message:
      'Python style guide, Exceptions and error handling — bare `except:` MUST NOT be used in durable code. Catch the narrowest meaningful exception type.',
    pattern: /^\s*except\s*:/gu,
  },
]

const MUTABLE_DEFAULT_PATTERN =
  /=\s*(?:\[|\{|list\s*\(\s*\)|dict\s*\(\s*\)|set\s*\(\s*\))/u

function matchLineRules(
  lines: readonly string[],
  rules: readonly LineRule[],
  extension: string,
  issues: CodeStyleIssue[],
): void {
  for (const [offset, line] of lines.entries()) {
    for (const rule of rules) {
      if (rule.skipExtensions?.includes(extension)) {
        continue
      }

      for (const match of line.matchAll(rule.pattern)) {
        if (rule.permitted?.(line, match)) {
          continue
        }

        issues.push({
          code: rule.code,
          message: rule.message,
          line: offset + 1,
        })
      }
    }
  }
}

/**
 * A Python parameter list spans as many lines as its parentheses need, so the
 * signature is collected by balancing them before the default values are read.
 */
function collectMutableDefaults(
  lines: readonly string[],
  issues: CodeStyleIssue[],
): void {
  for (const [offset, line] of lines.entries()) {
    if (!/^\s*(?:async\s+)?def\s+[A-Za-z_]/u.test(line)) {
      continue
    }

    let depth = 0
    let signature = ''
    let cursor = offset

    while (cursor < lines.length) {
      const current = lines[cursor] ?? ''

      for (const character of current) {
        if (character === '(') {
          depth += 1
          continue
        }

        if (character === ')') {
          depth -= 1
        }
      }

      signature += `${current}\n`
      cursor += 1

      if (depth <= 0) {
        break
      }
    }

    const parameters = signature.slice(
      signature.indexOf('(') + 1,
      signature.lastIndexOf(')'),
    )

    if (MUTABLE_DEFAULT_PATTERN.test(parameters)) {
      issues.push({
        code: 'style.mutable_default_argument',
        message:
          'Python style guide, Responsibility and shape — mutable default arguments MUST NOT be used. Default to `None` and build the value inside the function.',
        line: offset + 1,
      })
    }
  }
}

/**
 * Report the countable style rules the handbooks state normatively and the
 * formatter does not own. Judgment-level rules stay with the agent that reads
 * the style card.
 */
export function analyzeCodeStyle(
  relativePath: string,
  content: string,
): CodeStyleIssue[] {
  const language = codeStyleLanguage(relativePath)

  if (!language) {
    return []
  }

  const extension = path.extname(relativePath).toLowerCase()
  const issues: CodeStyleIssue[] = []

  if (language === 'python') {
    const lines = maskPythonNonCode(content).split('\n')

    matchLineRules(lines, PYTHON_RULES, extension, issues)
    collectMutableDefaults(lines, issues)
  } else {
    matchLineRules(content.split('\n'), RAW_SCRIPT_RULES, extension, issues)
    matchLineRules(
      maskScriptNonCode(content).split('\n'),
      SCRIPT_RULES,
      extension,
      issues,
    )
  }

  return issues.sort((first, second) => first.line - second.line)
}

export function validateCodeStyle(input: HandlerInput): HandlerResult {
  const absolute = path.isAbsolute(input.targetPath)
    ? input.targetPath
    : path.join(input.root, input.targetPath)

  if (!fileExists(absolute)) {
    return {
      status: 'failed',
      issues: [
        {
          code: 'artifact.missing',
          message: `Artifact does not exist: ${input.targetPath}`,
        },
      ],
    }
  }

  const found = analyzeCodeStyle(input.targetPath, readText(absolute))
  const issues = found.slice(0, MAX_REPORTED_ISSUES).map((issue) => ({
    code: issue.code,
    message: issue.message,
    line: issue.line,
  }))

  if (found.length > issues.length) {
    issues.push({
      code: 'style.issues_elided',
      message: `${found.length - issues.length} more code style issues were found and are not listed. Repair the reported issues, then run the check again.`,
      line: 0,
    })
  }

  return {
    status: issues.length === 0 ? 'passed' : 'failed',
    issues,
  }
}
