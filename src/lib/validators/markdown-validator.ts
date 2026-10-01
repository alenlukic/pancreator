import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export interface MarkdownValidationIssue {
  line: number
  id: string
  message: string
}

export interface ValidateChatMarkdownOptions {
  repoRoot?: string
}

function readInput(inputPath?: string): string {
  return inputPath ? readFileSync(inputPath, 'utf8') : readFileSync(0, 'utf8')
}

const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//iu
const TEMPLATE_CHAR_PATTERN = /[<>{}$]/u
const EXTENSION_PATTERN = /\.[A-Za-z0-9]+$/u

/** Strip a `#...` fragment from a link target, returning the bare path and the fragment. */
function stripFragment(target: string): { path: string; fragment: string } {
  const hashIndex = target.indexOf('#')

  if (hashIndex === -1) {
    return { path: target, fragment: '' }
  }

  return { path: target.slice(0, hashIndex), fragment: target.slice(hashIndex) }
}

/** Remove one optional surrounding pair of backticks from a link's display text. */
function unwrapCodeSpan(text: string): string {
  const trimmed = text.trim()

  if (trimmed.length >= 2 && trimmed.startsWith('`') && trimmed.endsWith('`')) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function hasFileExtension(token: string): boolean {
  const lastSegment = token.split('/').pop() ?? token
  return EXTENSION_PATTERN.test(lastSegment)
}

/**
 * A token is path-shaped when it has no whitespace, contains `/`, and its
 * last segment has a file extension; or when it starts with `./`, `../`,
 * `/`, or `~/` and has a file extension. URLs, directories, globs, and
 * templated paths are excluded.
 */
function isPathShaped(token: string): boolean {
  if (token.length === 0 || /\s/u.test(token)) {
    return false
  }

  if (URL_SCHEME_PATTERN.test(token)) {
    return false
  }

  if (TEMPLATE_CHAR_PATTERN.test(token)) {
    return false
  }

  if (token.includes('*') || token.includes('?')) {
    return false
  }

  if (token.endsWith('/')) {
    return false
  }

  if (
    token.startsWith('./') ||
    token.startsWith('../') ||
    token.startsWith('/') ||
    token.startsWith('~/')
  ) {
    return hasFileExtension(token)
  }

  return token.includes('/') && hasFileExtension(token)
}

/** Strip common sentence punctuation from the edges of a bare prose token. */
function trimPunctuation(token: string): string {
  return token.replace(/^[(),.;:'"]+/u, '').replace(/[(),.;:'"]+$/u, '')
}

/** Resolve the repository-relative display for an absolute path under `repoRoot`, or null when it is outside. */
function repoRelativeDisplay(
  targetPath: string,
  repoRoot: string | undefined,
): string | null {
  if (!repoRoot) {
    return null
  }

  const normalizedRoot = repoRoot.replace(/\/+$/u, '')

  if (normalizedRoot.length === 0) {
    return null
  }

  if (targetPath === normalizedRoot) {
    return ''
  }

  if (targetPath.startsWith(`${normalizedRoot}/`)) {
    return targetPath.slice(normalizedRoot.length + 1)
  }

  return null
}

/** Compute the boolean mask of lines that fall inside a fenced code block, including the fence delimiters. */
function computeFenceMask(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false)
  let fenceMarker: '`' | '~' | null = null

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trimStart()
    const listFenceMatch = /^\s*[-*+]\s+(`{3,}|~{3,})(.*)$/u.exec(line)
    const fenceMatch = listFenceMatch ?? /^(`{3,}|~{3,})(.*)$/u.exec(trimmed)

    if (fenceMatch) {
      const marker = fenceMatch[1][0] as '`' | '~'
      mask[index] = true

      if (fenceMarker === null) {
        fenceMarker = marker
      } else if (marker === fenceMarker) {
        fenceMarker = null
      }

      continue
    }

    if (fenceMarker !== null) {
      mask[index] = true
    }
  }

  return mask
}

function checkLinkTarget(
  rawTarget: string,
  displayText: string,
  lineNumber: number,
  repoRoot: string | undefined,
  issues: MarkdownValidationIssue[],
): void {
  if (rawTarget.length === 0) {
    return
  }

  if (URL_SCHEME_PATTERN.test(rawTarget)) {
    return
  }

  if (rawTarget.startsWith('#')) {
    return
  }

  const { path: targetPath } = stripFragment(rawTarget)

  if (targetPath.startsWith('/')) {
    const relative = repoRelativeDisplay(targetPath, repoRoot)
    const expectedDisplay = relative === null ? targetPath : relative
    const actualDisplay = unwrapCodeSpan(displayText)

    if (actualDisplay !== expectedDisplay) {
      issues.push({
        line: lineNumber,
        id: 'file_link.display',
        message: `Link display text MUST be '${expectedDisplay}' for target '${targetPath}'.`,
      })
    }

    return
  }

  if (isPathShaped(targetPath)) {
    issues.push({
      line: lineNumber,
      id: 'file_link.relative_target',
      message: `Link target '${rawTarget}' MUST be an absolute path, not a relative one.`,
    })
  }
}

function checkBareTokens(
  text: string,
  lineNumber: number,
  issues: MarkdownValidationIssue[],
): void {
  const codeSpanRegex = /`([^`]+)`/gu
  const ranges: Array<[number, number]> = []
  let codeSpanMatch: RegExpExecArray | null

  while ((codeSpanMatch = codeSpanRegex.exec(text)) !== null) {
    ranges.push([
      codeSpanMatch.index,
      codeSpanMatch.index + codeSpanMatch[0].length,
    ])
    const content = codeSpanMatch[1].trim()

    if (isPathShaped(content)) {
      issues.push({
        line: lineNumber,
        id: 'file_reference.unlinked',
        message: `Bare path '${content}' MUST be a Markdown link.`,
      })
    }
  }

  let plain = text

  for (const [start, end] of ranges.reverse()) {
    plain = plain.slice(0, start) + ' '.repeat(end - start) + plain.slice(end)
  }

  for (const rawWord of plain.split(/\s+/u)) {
    const token = trimPunctuation(rawWord)

    if (token.length === 0) {
      continue
    }

    if (isPathShaped(token)) {
      issues.push({
        line: lineNumber,
        id: 'file_reference.unlinked',
        message: `Bare path '${token}' MUST be a Markdown link.`,
      })
    }
  }
}

/** Check one non-fenced line for unlinked file references and malformed file links. */
function checkLineForFileReferences(
  line: string,
  lineNumber: number,
  repoRoot: string | undefined,
  issues: MarkdownValidationIssue[],
): void {
  const linkRegex = /(!?)\[([^\]]*)\]\(([^)]+)\)/gu
  const consumedRanges: Array<[number, number]> = []
  let linkMatch: RegExpExecArray | null

  while ((linkMatch = linkRegex.exec(line)) !== null) {
    consumedRanges.push([
      linkMatch.index,
      linkMatch.index + linkMatch[0].length,
    ])

    // An image embed renders its target rather than linking to it, so it is
    // neither a file link nor a bare file reference.
    if (linkMatch[1] === '!') {
      continue
    }

    const displayText = linkMatch[2]
    const rawTarget = linkMatch[3].trim().split(/\s+/u)[0] ?? ''
    checkLinkTarget(rawTarget, displayText, lineNumber, repoRoot, issues)
  }

  let remainder = line

  for (const [start, end] of consumedRanges.reverse()) {
    remainder =
      remainder.slice(0, start) + ' '.repeat(end - start) + remainder.slice(end)
  }

  checkBareTokens(remainder, lineNumber, issues)
}

/**
 * Check chat Markdown for code fence defects, unlinked file references, and
 * malformed file links, and return the issues with line numbers: a fence
 * opened after a list marker or indented, an unusual info string, an
 * unclosed or unbalanced fence, an opening and closing fence on one line, a
 * bare path-shaped token outside a fenced block and outside a Markdown link
 * (`file_reference.unlinked`), a relative link target that is path-shaped
 * (`file_link.relative_target`), and an absolute-target link whose display
 * text is not the repository-relative or full path (`file_link.display`).
 * `options.repoRoot` resolves the repository-relative display; without it,
 * every absolute target displays as its full path.
 */
export function validateChatMarkdown(
  markdown: string,
  options: ValidateChatMarkdownOptions = {},
): MarkdownValidationIssue[] {
  const issues: MarkdownValidationIssue[] = []
  const lines = markdown.split(/\r?\n/u)

  let fenceCount = 0
  let fenceMarker: '`' | '~' | null = null
  let fenceOpenerLine = 0

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trimStart()
    const listFenceMatch = /^\s*[-*+]\s+(`{3,}|~{3,})(.*)$/u.exec(line)
    const fenceMatch = listFenceMatch ?? /^(`{3,}|~{3,})(.*)$/u.exec(trimmed)

    if (!fenceMatch) {
      continue
    }

    const marker = fenceMatch[1][0] as '`' | '~'
    const rest = fenceMatch[2].trim()

    if (fenceMarker === null) {
      if (listFenceMatch) {
        issues.push({
          line: index + 1,
          id: 'fence.not_on_own_line',
          message:
            'Opening code fence MUST be on its own line, not prefixed by a list marker or other text.',
        })
      } else if (line !== trimmed) {
        issues.push({
          line: index + 1,
          id: 'fence.leading_whitespace',
          message:
            'Opening code fence SHOULD start at column 0; leading whitespace can break chat rendering.',
        })
      }

      fenceMarker = marker
      fenceOpenerLine = index + 1
      fenceCount += 1

      if (rest.length > 0 && !/^[\w-]+$/u.test(rest)) {
        issues.push({
          line: index + 1,
          id: 'fence.info_string',
          message:
            'Fence info string contains unexpected characters; keep language tags simple (e.g. ts, json).',
        })
      }

      continue
    }

    if (marker === fenceMarker) {
      fenceMarker = null
      fenceCount += 1
    }
  }

  if (fenceMarker !== null) {
    issues.push({
      line: fenceOpenerLine,
      id: 'fence.unclosed',
      message: 'Unclosed code fence: add a matching closing fence line.',
    })
  }

  if (fenceCount % 2 !== 0) {
    issues.push({
      line: fenceOpenerLine,
      id: 'fence.unbalanced',
      message:
        'Odd number of fence markers; every opening fence needs a matching close.',
    })
  }

  for (const [index, line] of lines.entries()) {
    if (/^```[^\n`]*```/u.test(line.trim())) {
      issues.push({
        line: index + 1,
        id: 'fence.inline',
        message:
          'Inline fence on one line often breaks chat blocks; use separate opening and closing fence lines.',
      })
    }
  }

  const fenceMask = computeFenceMask(lines)

  for (const [index, line] of lines.entries()) {
    if (fenceMask[index]) {
      continue
    }

    checkLineForFileReferences(line, index + 1, options.repoRoot, issues)
  }

  return issues
}

/**
 * Validate chat Markdown read from `inputPath`, or from standard input when
 * omitted, against `repoRoot`, print the verdict and each issue, and return
 * the process exit code: 0 on pass, 1 on failure.
 */
export function runMarkdownValidator(
  inputPath?: string,
  repoRoot?: string,
): number {
  const issues = validateChatMarkdown(readInput(inputPath), { repoRoot })

  if (issues.length === 0) {
    process.stdout.write('chat markdown validation passed\n')
    return 0
  }

  process.stderr.write('chat markdown validation failed:\n')

  for (const issue of issues) {
    process.stderr.write(
      `  line ${issue.line} [${issue.id}]: ${issue.message}\n`,
    )
  }

  return 1
}

export interface ParsedCliArgs {
  repoRoot?: string
  inputPath?: string
}

/** Parse `--repo-root <dir>` and the positional input path from CLI arguments. */
export function parseCliArgs(argv: string[]): ParsedCliArgs {
  let repoRoot: string | undefined
  let inputPath: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--repo-root') {
      index += 1
      repoRoot = argv[index]
      continue
    }

    if (inputPath === undefined) {
      inputPath = arg
    }
  }

  return { repoRoot, inputPath }
}

/** Resolve the default repository root: the Git top level of `cwd`, or `cwd` itself when Git cannot resolve one. */
export function resolveDefaultRepoRoot(cwd: string = process.cwd()): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  })

  if (result.status === 0 && typeof result.stdout === 'string') {
    const trimmed = result.stdout.trim()

    if (trimmed.length > 0) {
      return trimmed
    }
  }

  return cwd
}

const directEntry = process.argv[1]

if (directEntry && import.meta.url === pathToFileURL(directEntry).href) {
  const { repoRoot, inputPath } = parseCliArgs(process.argv.slice(2))
  process.exitCode = runMarkdownValidator(
    inputPath,
    repoRoot ?? resolveDefaultRepoRoot(),
  )
}
