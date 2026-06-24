#!/usr/bin/env node
/**
 * Validate Markdown destined for Cursor chat emission.
 * Detects common fence and block-break issues that misrender in the UI.
 *
 * Usage:
 *   node scripts/validate-chat-markdown.mjs [file]
 *   echo '...' | node scripts/validate-chat-markdown.mjs
 *
 * Exit 0 when valid; exit 1 with diagnostics on stderr when invalid.
 */

import { readFileSync } from 'node:fs'

function readInput(path) {
  if (path) {
    return readFileSync(path, 'utf8')
  }
  return readFileSync(0, 'utf8')
}

function validateChatMarkdown(markdown) {
  const issues = []
  const lines = markdown.split(/\r?\n/)

  let fenceCount = 0
  let inFence = false
  let fenceOpenerLine = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trimStart()
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})(.*)$/)

    if (!fenceMatch) {
      continue
    }

    const marker = fenceMatch[1]
    const rest = fenceMatch[2].trim()

    if (!inFence) {
      if (/^\s*[-*+]\s/.test(line) && /`{3,}|~{3,}/.test(line)) {
        issues.push({
          line: index + 1,
          id: 'fence.not_on_own_line',
          message:
            'Opening code fence MUST be on its own line, not prefixed by a list marker or other text.',
        })
      } else if (line !== trimmed && trimmed.startsWith('```')) {
        issues.push({
          line: index + 1,
          id: 'fence.leading_whitespace',
          message:
            'Opening code fence SHOULD start at column 0; leading whitespace can break chat rendering.',
        })
      }

      inFence = true
      fenceOpenerLine = index + 1
      fenceCount += 1

      if (rest.length > 0 && !/^[\w-]+$/.test(rest)) {
        issues.push({
          line: index + 1,
          id: 'fence.info_string',
          message:
            'Fence info string contains unexpected characters; keep language tags simple (e.g. ts, json).',
        })
      }
      continue
    }

    if (marker[0] === lines[fenceOpenerLine - 1].trimStart()[0]) {
      inFence = false
      fenceCount += 1
    }
  }

  if (inFence) {
    issues.push({
      line: fenceOpenerLine,
      id: 'fence.unclosed',
      message: 'Unclosed code fence: add a closing ``` or ~~~ line.',
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

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^```[^\n`]*```/.test(line.trim())) {
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

const inputPath = process.argv[2]
const markdown = readInput(inputPath)
const issues = validateChatMarkdown(markdown)

if (issues.length === 0) {
  process.stdout.write('chat markdown validation passed\n')
  process.exit(0)
}

process.stderr.write('chat markdown validation failed:\n')
for (const issue of issues) {
  process.stderr.write(`  line ${issue.line} [${issue.id}]: ${issue.message}\n`)
}
process.exit(1)
