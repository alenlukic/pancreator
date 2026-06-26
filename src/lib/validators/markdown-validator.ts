import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export interface MarkdownValidationIssue {
  line: number
  id: string
  message: string
}

function readInput(inputPath?: string): string {
  return inputPath ? readFileSync(inputPath, 'utf8') : readFileSync(0, 'utf8')
}

export function validateChatMarkdown(
  markdown: string,
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

  return issues
}

export function runMarkdownValidator(inputPath?: string): number {
  const issues = validateChatMarkdown(readInput(inputPath))

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

const directEntry = process.argv[1]

if (directEntry && import.meta.url === pathToFileURL(directEntry).href) {
  process.exitCode = runMarkdownValidator(process.argv[2])
}
