/** Style analysis of one source file, and the requirement handler that runs it. */

import path from 'node:path'

import { fileExists, readText } from '../../io.js'
import type { HandlerInput, HandlerResult } from '../../requirements/types.js'
import {
  MAX_REPORTED_ISSUES,
  codeStyleLanguage,
  maskPythonNonCode,
  type CodeStyleIssue,
} from './source.js'
import {
  PYTHON_RULES,
  RAW_SCRIPT_RULES,
  SCRIPT_RULES,
  ScriptSource,
  collectBlockSpacing,
  collectDeclarationGroups,
  collectMutableDefaults,
  collectSwitchDefaults,
  collectUnbracedBodies,
  isWaived,
  matchLineRules,
} from './rules.js'

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

/**
 * Check one source file against the code style rules for its language and
 * report at most 50 issues with line numbers, plus a `style.issues_elided`
 * entry naming how many more were found. Fails with `artifact.missing` when the
 * file does not exist.
 */
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
