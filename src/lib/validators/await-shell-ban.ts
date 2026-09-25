import { readdirSync } from 'node:fs'
import path from 'node:path'

import { fileExists, isRecord, readJson, readText } from '../io.js'
import type { HandlerInput, HandlerResult } from '../requirements/types.js'

const AGENTS_DIR = 'library/cursor/agents'
const HOOKS_SOURCE = 'library/cursor/hooks.json'
const DENIED_TOOL = 'AwaitShell'
const DENY_HOOK_COMMAND = 'pan-hook-deny-await-shell'
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u
const TOP_LEVEL_KEY_PATTERN = /^([A-Za-z][\w-]*):(?:[ \t]+(.*))?$/u

type Issue = HandlerResult['issues'][number]

interface Frontmatter {
  values: Map<string, string[]>
  errors: string[]
}

/**
 * Split frontmatter into top-level keys and the raw lines of each value.
 *
 * This reads the YAML subset canonical agent files use: `key: value` lines at
 * column 0 with indented continuation lines. A line outside that shape, and a
 * plain scalar that holds `: `, is an error because a YAML parser rejects the
 * whole document and the platform then drops every declared field.
 */
function readFrontmatter(frontmatter: string): Frontmatter {
  const values = new Map<string, string[]>()
  const errors: string[] = []
  let current: string[] | null = null

  for (const [index, line] of frontmatter.split(/\r?\n/u).entries()) {
    if (line.trim() === '') {
      continue
    }

    if (/^\s/u.test(line)) {
      if (current === null) {
        errors.push(`line ${index + 1} is indented before any key`)
      } else {
        current.push(line.trim())
      }
      continue
    }

    const match = TOP_LEVEL_KEY_PATTERN.exec(line)

    if (!match) {
      errors.push(`line ${index + 1} is not a 'key: value' entry`)
      current = null
      continue
    }

    const key = match[1] ?? ''
    const inline = (match[2] ?? '').trim()

    if (values.has(key)) {
      errors.push(`key '${key}' appears more than once`)
    }

    if (inline !== '' && !/^['"[{|>-]/u.test(inline) && inline.includes(': ')) {
      errors.push(`plain scalar for '${key}' contains ': ' and must be quoted`)
    }

    current = inline === '' ? [] : [inline]
    values.set(key, current)
  }

  return { values, errors }
}

/** Parse one YAML flow sequence of scalars, or return null when it is not one. */
function parseFlowSequence(text: string): string[] | null {
  if (!text.startsWith('[') || !text.endsWith(']')) {
    return null
  }

  const inner = text.slice(1, -1)
  const entries: string[] = []
  let token = ''
  let quote: string | null = null
  let quoted = false

  const close = (final: boolean): boolean => {
    const value = quoted ? token : token.trim()

    if (value === '' && !quoted) {
      return final
    }

    entries.push(value)
    token = ''
    quoted = false
    return true
  }

  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index] ?? ''

    if (quote !== null) {
      if (char === quote && quote === "'" && inner[index + 1] === "'") {
        token += "'"
        index += 1
      } else if (char === quote) {
        quote = null
      } else {
        token += char
      }
      continue
    }

    if (char === "'" || char === '"') {
      if (token.trim() !== '' || quoted) {
        return null
      }
      token = ''
      quote = char
      quoted = true
    } else if (char === ',') {
      if (!close(false)) {
        return null
      }
    } else if ('[]{}'.includes(char)) {
      return null
    } else if (quoted) {
      if (char.trim() !== '') {
        return null
      }
    } else {
      token += char
    }
  }

  if (quote !== null || !close(true)) {
    return null
  }

  return entries
}

/** Parse a flow or block sequence value, or return null when it is neither. */
function parseSequence(lines: string[]): string[] | null {
  if (lines.length === 0) {
    return null
  }

  if (lines.every((line) => line.startsWith('- '))) {
    return lines.map((line) =>
      line
        .slice(2)
        .trim()
        .replace(/^'(.*)'$|^"(.*)"$/u, '$1$2'),
    )
  }

  return parseFlowSequence(lines.join(' '))
}

function agentIssues(relativePath: string, content: string): Issue[] {
  const block = FRONTMATTER_PATTERN.exec(content)?.[1]

  if (block === undefined) {
    return [
      {
        code: 'await_shell_ban.frontmatter_missing',
        message: `${relativePath}: no YAML frontmatter found.`,
        pointer: relativePath,
      },
    ]
  }

  const { values, errors } = readFrontmatter(block)
  const issues: Issue[] = errors.map((error) => ({
    code: 'await_shell_ban.frontmatter_invalid',
    message: `${relativePath}: frontmatter is not valid YAML (${error}).`,
    pointer: relativePath,
  }))
  const disallowedLines = values.get('disallowedTools')

  if (disallowedLines === undefined) {
    issues.push({
      code: 'await_shell_ban.frontmatter_missing',
      message: `${relativePath}: frontmatter has no disallowedTools key.`,
      pointer: relativePath,
    })
    return issues
  }

  const disallowed = parseSequence(disallowedLines)

  if (disallowed === null) {
    issues.push({
      code: 'await_shell_ban.frontmatter_invalid',
      message: `${relativePath}: disallowedTools is not one YAML sequence.`,
      pointer: relativePath,
    })
  } else if (!disallowed.includes(DENIED_TOOL)) {
    issues.push({
      code: 'await_shell_ban.missing_from_disallowed_tools',
      message: `${relativePath}: '${DENIED_TOOL}' is missing from disallowedTools.`,
      pointer: relativePath,
    })
  }

  const toolsLines = values.get('tools')

  if (toolsLines !== undefined) {
    const tools = parseSequence(toolsLines)

    if (tools === null) {
      issues.push({
        code: 'await_shell_ban.frontmatter_invalid',
        message: `${relativePath}: tools is not one YAML sequence.`,
        pointer: relativePath,
      })
    } else if (tools.includes(DENIED_TOOL)) {
      issues.push({
        code: 'await_shell_ban.in_tools_allow_list',
        message: `${relativePath}: '${DENIED_TOOL}' appears in the tools allow-list.`,
        pointer: relativePath,
      })
    }
  }

  return issues
}

function agentDirectoryIssues(root: string): Issue[] {
  const agentsAbsolute = path.join(root, AGENTS_DIR)

  if (!fileExists(agentsAbsolute)) {
    return [
      {
        code: 'await_shell_ban.agents_dir_missing',
        message: `${AGENTS_DIR} directory is missing; cannot verify the ban.`,
      },
    ]
  }

  let agentFiles: string[]

  try {
    agentFiles = readdirSync(agentsAbsolute)
      .filter((name) => name.endsWith('.md'))
      .sort()
  } catch {
    return [
      {
        code: 'await_shell_ban.agents_dir_unreadable',
        message: `${AGENTS_DIR} could not be listed.`,
      },
    ]
  }

  const issues: Issue[] = []

  for (const name of agentFiles) {
    const relativePath = path.posix.join(AGENTS_DIR, name)

    try {
      issues.push(
        ...agentIssues(relativePath, readText(path.join(root, relativePath))),
      )
    } catch {
      issues.push({
        code: 'await_shell_ban.agent_unreadable',
        message: `${relativePath}: could not be read.`,
        pointer: relativePath,
      })
    }
  }

  return issues
}

function hooksIssues(root: string): Issue[] {
  const hooksAbsolute = path.join(root, HOOKS_SOURCE)

  if (!fileExists(hooksAbsolute)) {
    return [
      {
        code: 'await_shell_ban.hooks_source_missing',
        message: `${HOOKS_SOURCE} is missing; cannot verify the preToolUse hook.`,
        pointer: HOOKS_SOURCE,
      },
    ]
  }

  let hooks: unknown

  try {
    hooks = readJson(hooksAbsolute)
  } catch {
    return [
      {
        code: 'await_shell_ban.hooks_source_unreadable',
        message: `${HOOKS_SOURCE}: could not be read or parsed.`,
        pointer: HOOKS_SOURCE,
      },
    ]
  }

  if (!isRecord(hooks) || !isRecord(hooks.hooks)) {
    return [
      {
        code: 'await_shell_ban.hooks_object_missing',
        message: `${HOOKS_SOURCE}: missing or non-object 'hooks' field.`,
        pointer: HOOKS_SOURCE,
      },
    ]
  }

  const preToolUse = hooks.hooks.preToolUse
  const hasDenyEntry =
    Array.isArray(preToolUse) &&
    preToolUse.some(
      (entry) =>
        isRecord(entry) &&
        typeof entry.command === 'string' &&
        entry.command.includes(DENY_HOOK_COMMAND),
    )

  if (hasDenyEntry) {
    return []
  }

  return [
    {
      code: 'await_shell_ban.pre_tool_use_hook_missing',
      message:
        `${HOOKS_SOURCE}: no preToolUse entry found whose command ` +
        `contains '${DENY_HOOK_COMMAND}'. Add the hook to enforce ` +
        `the AwaitShell ban at the platform level.`,
      pointer: HOOKS_SOURCE,
    },
  ]
}

/**
 * Collect every AwaitShell ban violation under `root`:
 *  - Every agent file in `library/cursor/agents/` has parsable frontmatter,
 *    lists `AwaitShell` in `disallowedTools`, and does not list it in `tools`.
 *  - `library/cursor/hooks.json` declares a `preToolUse` entry whose command
 *    contains `pan-hook-deny-await-shell`.
 */
export function collectAwaitShellBanIssues(root: string): Issue[] {
  return [...agentDirectoryIssues(root), ...hooksIssues(root)]
}

/** Registry handler for `AWAIT-SHELL-BAN-VALIDATE-001`; `targetPath` is unused. */
export function awaitShellBanValidateHandler(
  input: HandlerInput,
): HandlerResult {
  const issues = collectAwaitShellBanIssues(input.root)

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}
