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

const JAVASCRIPT_EXTENSIONS: readonly string[] = [
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
  {
    code: 'style.default_export',
    message:
      'TypeScript style guide, Exports — do not use default exports. Use a named export.',
    pattern: /^\s*export\s+default(?![\w$])/gu,
    // A tool configuration file such as `prettier.config.js` exports its
    // default because the tool demands it, so the script extensions are exempt.
    skipExtensions: JAVASCRIPT_EXTENSIONS,
  },
  {
    code: 'style.mutable_export',
    message:
      'TypeScript style guide, Exports — do not use a mutable export. Export a `const`, or an accessor function for mutable module state.',
    pattern: /^\s*export\s+(?:let|var)(?![\w$])/gu,
  },
  {
    code: 'style.function_expression',
    message:
      'TypeScript style guide, Declarations and expressions — do not use `function` expressions. Use a function declaration or an arrow function.',
    pattern: /(?<![\w$.])function(?![\w$])/gu,
    // A declaration starts its statement, optionally after `export` and
    // `async`. Every other position is an expression.
    permitted: (line, match) =>
      /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?$/u.test(
        line.slice(0, match.index),
      ),
  },
  {
    code: 'style.private_field',
    message:
      'TypeScript style guide, Visibility — use TypeScript `private`, not ECMAScript `#private` fields.',
    pattern: /(?<![\w$])#[A-Za-z_$][\w$]*/gu,
  },
  {
    code: 'style.debugger',
    message:
      'TypeScript style guide, Restricted features — do not leave a `debugger` statement in durable code.',
    pattern: /^\s*debugger(?![\w$])/gu,
  },
  {
    code: 'style.restricted_feature',
    message:
      'TypeScript style guide, Restricted features — do not use `eval` or the `Function` string constructor.',
    pattern: /(?<![\w$.])(?:eval\s*\(|new\s+Function\s*\()/gu,
  },
  {
    code: 'style.wrapper_constructor',
    message:
      'TypeScript style guide, Arrays, objects, and discouraged types — use literals, not the `Array` or `Object` constructor, and never a primitive wrapper constructor.',
    pattern:
      /(?<![\w$.])(?:new\s+(?:Array|Object|String|Number|Boolean)|Array)\s*(?:<[^>]*>)?\(/gu,
  },
  {
    code: 'style.arguments_object',
    message:
      'TypeScript style guide, Parameters — use rest parameters instead of `arguments`.',
    // A property or interface member named `arguments` is followed by `:`,
    // and a member access is preceded by `.`; neither is the implicit object.
    pattern: /(?<![\w$.])arguments(?![\w$])(?!\s*\??\s*:)/gu,
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
  {
    code: 'style.ts_suppression',
    message:
      'TypeScript style guide, Toolchain and validation — do not use `@ts-ignore` or `@ts-nocheck`. Fix the diagnostic, or use a described `@ts-expect-error` in a type-level test.',
    pattern: /\/[/*]\s*@ts-(?:ignore|nocheck)(?![\w-])/gu,
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
 * The masked source with its line boundaries, so a structural rule can match
 * across lines and still report the line a construct starts on.
 */
class ScriptSource {
  readonly raw: readonly string[]
  readonly masked: readonly string[]
  readonly text: string
  private readonly lineStarts: number[]

  constructor(content: string) {
    this.raw = content.split('\n')
    this.text = maskScriptNonCode(content)
    this.masked = this.text.split('\n')
    this.lineStarts = [0]

    for (const [index, line] of this.masked.entries()) {
      if (index < this.masked.length - 1) {
        this.lineStarts.push(
          (this.lineStarts[index] ?? 0) + line.length + '\n'.length,
        )
      }
    }
  }

  /** The zero-based line holding a character offset of the masked text. */
  lineAt(offset: number): number {
    let low = 0
    let high = this.lineStarts.length - 1

    while (low < high) {
      const middle = Math.ceil((low + high) / 2)

      if ((this.lineStarts[middle] ?? 0) <= offset) {
        low = middle
      } else {
        high = middle - 1
      }
    }

    return low
  }

  /** The masked text of a line before an offset on that line. */
  lineBefore(offset: number): string {
    return this.text.slice(this.lineStarts[this.lineAt(offset)] ?? 0, offset)
  }

  /** The offset of the next non-whitespace character, or `-1` at the end. */
  nextSignificant(offset: number): number {
    const match = /\S/u.exec(this.text.slice(offset))

    return match ? offset + match.index : -1
  }

  /** The offset of the bracket closing the one at `open`, or `-1`. */
  matchingClose(open: number): number {
    const opener = this.text[open] ?? ''
    const closer = opener === '(' ? ')' : '}'
    let depth = 0

    for (let cursor = open; cursor < this.text.length; cursor += 1) {
      const character = this.text[cursor]

      if (character === opener) {
        depth += 1
      } else if (character === closer) {
        depth -= 1

        if (depth === 0) {
          return cursor
        }
      }
    }

    return -1
  }

  /**
   * The nearest earlier line that is blank or holds code. A comment line, or
   * the inside of a masked template literal, belongs to the statement below
   * it, so the walk passes over it.
   */
  precedingCodeLine(line: number): number {
    let cursor = line - 1

    while (
      cursor >= 0 &&
      (this.raw[cursor] ?? '').trim() !== '' &&
      (this.masked[cursor] ?? '').trim() === ''
    ) {
      cursor -= 1
    }

    return cursor
  }
}

const STATEMENT_HEADER_PATTERN = /(?<![\w$.])(if|for|while)\s*\(/gu
const BARE_KEYWORD_PATTERN = /(?<![\w$.])(else|do)(?![\w$])/gu

/**
 * Control flow, Blocks: every `if`, `else`, `for`, `while`, and `do` body uses
 * braces. The header's parentheses are balanced across lines so a wrapped
 * condition is followed to its close before the body is inspected.
 */
function collectUnbracedBodies(
  source: ScriptSource,
  issues: CodeStyleIssue[],
): void {
  function report(offset: number): void {
    issues.push({
      code: 'style.unbraced_body',
      message:
        'TypeScript style guide, Blocks — every `if`, `else`, `for`, `while`, and `do` body MUST use braces.',
      line: source.lineAt(offset) + 1,
    })
  }

  for (const match of source.text.matchAll(STATEMENT_HEADER_PATTERN)) {
    const open = match.index + match[0].length - 1
    const isLoopTail =
      match[1] === 'while' && /\}\s*$/u.test(source.lineBefore(match.index))

    if (isLoopTail) {
      continue
    }

    const close = source.matchingClose(open)
    const body = close === -1 ? -1 : source.nextSignificant(close + 1)

    if (body !== -1 && source.text[body] !== '{') {
      report(match.index)
    }
  }

  for (const match of source.text.matchAll(BARE_KEYWORD_PATTERN)) {
    const body = source.nextSignificant(match.index + match[0].length)

    if (body === -1 || source.text[body] === '{') {
      continue
    }

    if (match[1] === 'else' && /^if(?![\w$])/u.test(source.text.slice(body))) {
      continue
    }

    report(match.index)
  }
}

const BLOCK_START_PATTERN = /^\s*(?:if|for|while|do|switch|try)(?![\w$])/u
const FIRST_STATEMENT_PATTERN =
  /\{$|^\s*(?:case(?![\w$]).*|default)\s*:$|(?<![\w$])(?:else|do|try|finally)$/u

/**
 * Whitespace and logical grouping: an independent `if`, loop, `switch`, or
 * `try` is preceded by one blank line unless it opens its enclosing body. A
 * comment directly above the block belongs to it, so the blank line is
 * expected above the comment.
 */
function collectBlockSpacing(
  source: ScriptSource,
  issues: CodeStyleIssue[],
): void {
  for (const [index, line] of source.masked.entries()) {
    if (!BLOCK_START_PATTERN.test(line)) {
      continue
    }

    const preceding = source.precedingCodeLine(index)

    if (preceding < 0 || (source.raw[preceding] ?? '').trim() === '') {
      continue
    }

    if (
      FIRST_STATEMENT_PATTERN.test((source.masked[preceding] ?? '').trimEnd())
    ) {
      continue
    }

    issues.push({
      code: 'style.block_spacing',
      message:
        'TypeScript style guide, Conditionals and Loops — an independent `if`, loop, `switch`, or `try` MUST be preceded by one blank line unless it is the first statement in its body.',
      line: index + 1,
    })
  }
}

const LOCAL_DECLARATION_PATTERN = /^(\s+)(?:const|let)\s/u
const CONTINUATION_PATTERN = /^[)\]}.?:]/u
const MAX_DECLARATION_GROUP = 4

/**
 * Local declarations, Declaration groups: contiguous local `const` and `let`
 * declarations form a group of at most four. A deeper-indented line, or one
 * that closes or chains the previous declaration, continues that declaration.
 * Module-level constants are outside the section, so a group starts only at
 * an indented declaration.
 */
function collectDeclarationGroups(
  source: ScriptSource,
  issues: CodeStyleIssue[],
): void {
  let group: { indent: number; count: number } | null = null

  for (const [index, line] of source.masked.entries()) {
    if ((source.raw[index] ?? '').trim() === '') {
      group = null
      continue
    }

    const declaration = LOCAL_DECLARATION_PATTERN.exec(line)

    if (declaration) {
      const indent = declaration[1]?.length ?? 0

      if (group && group.indent === indent) {
        group.count += 1
      } else {
        group = { indent, count: 1 }
      }

      if (group.count === MAX_DECLARATION_GROUP + 1) {
        issues.push({
          code: 'style.declaration_group',
          message:
            'TypeScript style guide, Declaration groups — a declaration group MUST contain no more than four declarations. Split the group at its strongest logical boundary.',
          line: index + 1,
        })
      }

      continue
    }

    if (!group || line.trim() === '') {
      continue
    }

    const indent = line.length - line.trimStart().length

    if (
      indent > group.indent ||
      (indent === group.indent && CONTINUATION_PATTERN.test(line.trimStart()))
    ) {
      continue
    }

    group = null
  }
}

const SWITCH_PATTERN = /(?<![\w$.])switch\s*\(/gu
const DEFAULT_LABEL_PATTERN = /^default\s*:/u

/**
 * Switch statements: every `switch` contains a `default` branch. The label is
 * searched at the switch's own brace depth, so a nested switch or an object
 * literal inside a case cannot supply it.
 */
function collectSwitchDefaults(
  source: ScriptSource,
  issues: CodeStyleIssue[],
): void {
  for (const match of source.text.matchAll(SWITCH_PATTERN)) {
    const close = source.matchingClose(match.index + match[0].length - 1)
    const open = close === -1 ? -1 : source.nextSignificant(close + 1)

    if (open === -1 || source.text[open] !== '{') {
      continue
    }

    const end = source.matchingClose(open)

    if (end === -1) {
      continue
    }

    let depth = 0
    let found = false

    for (let cursor = open + 1; cursor < end && !found; cursor += 1) {
      const character = source.text[cursor]

      if (character === '{') {
        depth += 1
      } else if (character === '}') {
        depth -= 1
      } else if (
        depth === 0 &&
        !/[\w$]/u.test(source.text[cursor - 1] ?? '') &&
        DEFAULT_LABEL_PATTERN.test(source.text.slice(cursor, cursor + 16))
      ) {
        found = true
      }
    }

    if (!found) {
      issues.push({
        code: 'style.switch_default',
        message:
          'TypeScript style guide, Switch statements — every `switch` MUST contain a `default` branch, and it MUST be last.',
        line: source.lineAt(match.index) + 1,
      })
    }
  }
}

const WAIVER_PATTERN =
  /^\s*(?:\/\/|#)\s*style:\s*allow\s+(style\.[a-z_]+)\s+\S.*$/u

/**
 * A rule the handbook lets a documented exception satisfy is waived by a
 * comment directly above the construct: `// style: allow <code> <reason>`,
 * or `# style: allow` in Python. The reason is mandatory, so the exception
 * is documented where the reader meets it, as the handbooks require.
 */
function isWaived(
  raw: readonly string[],
  masked: readonly string[],
  issue: CodeStyleIssue,
): boolean {
  let cursor = issue.line - 2

  while (
    cursor >= 0 &&
    (raw[cursor] ?? '').trim() !== '' &&
    (masked[cursor] ?? '').trim() === ''
  ) {
    const waiver = WAIVER_PATTERN.exec(raw[cursor] ?? '')

    if (waiver?.[1] === issue.code) {
      return true
    }

    cursor -= 1
  }

  return false
}

/**
 * Report the style rules the handbooks state normatively, the formatter does
 * not own, and a scanner can decide from the source. Rules that need the
 * reader's judgment, such as just-in-time declarations or the coherence of a
 * declaration group, stay with the agent that reads the style card.
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
  let raw: readonly string[]
  let masked: readonly string[]

  if (language === 'python') {
    raw = content.split('\n')
    masked = maskPythonNonCode(content).split('\n')

    matchLineRules(masked, PYTHON_RULES, extension, issues)
    collectMutableDefaults(masked, issues)
  } else {
    const source = new ScriptSource(content)

    raw = source.raw
    masked = source.masked

    matchLineRules(raw, RAW_SCRIPT_RULES, extension, issues)
    matchLineRules(masked, SCRIPT_RULES, extension, issues)
    collectUnbracedBodies(source, issues)
    collectBlockSpacing(source, issues)
    collectDeclarationGroups(source, issues)
    collectSwitchDefaults(source, issues)
  }

  return issues
    .filter((issue) => !isWaived(raw, masked, issue))
    .sort((first, second) => first.line - second.line)
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
