import { readdirSync } from 'node:fs'
import path from 'node:path'

import { fileExists, isRecord, readJson, readText } from '../io.js'
import type { HandlerInput, HandlerResult } from '../requirements/types.js'

const AGENTS_DIR = 'library/cursor/agents'
const HOOKS_SOURCE = 'library/cursor/hooks.json'
const DENIED_TOOL = 'AwaitShell'
const DENY_HOOK_COMMAND = 'pan-hook-deny-await-shell'

/**
 * Parse the `disallowedTools` value from YAML frontmatter in a Markdown file.
 *
 * Returns the array of tool entries, or `null` when no frontmatter is present
 * or the key is missing.
 */
function parseDisallowedTools(content: string): string[] | null {
  const frontmatterMatch = /^---\n([\s\S]*?)\n---/u.exec(content)

  if (!frontmatterMatch) {
    return null
  }

  const frontmatter = frontmatterMatch[1] ?? ''
  const lineMatch = /^disallowedTools:\s*(.*)/mu.exec(frontmatter)

  if (!lineMatch) {
    return null
  }

  const rawValue = (lineMatch[1] ?? '').trim()

  if (rawValue === '') {
    return []
  }

  // Parse YAML inline array: [a, b, 'Bash(git push:*)']
  // Strip outer brackets.
  const inner = rawValue.replace(/^\[|\]$/gu, '').trim()

  if (inner === '') {
    return []
  }

  const entries: string[] = []
  // Split on commas while respecting single-quoted values.
  const tokenRe = /'[^']*'|[^,]+/gu
  let match: RegExpExecArray | null

  while ((match = tokenRe.exec(inner)) !== null) {
    const token = match[0].trim().replace(/^'|'$/gu, '')

    if (token.length > 0) {
      entries.push(token)
    }
  }

  return entries
}

/**
 * Validate that the AwaitShell ban is in place:
 *  - Every agent file in `library/cursor/agents/` lists `AwaitShell` in its
 *    `disallowedTools` frontmatter field and does not list it under `tools`.
 *  - `library/cursor/hooks.json` declares a `preToolUse` entry whose command
 *    contains `pan-hook-deny-await-shell`.
 *
 * The `targetPath` is ignored; the validator scans relative to `root`.
 */
export function validateAwaitShellBan(input: HandlerInput): HandlerResult {
  const { root } = input
  const issues: HandlerResult['issues'] = []

  // --- Check agent frontmatter ---
  const agentsAbsolute = path.join(root, AGENTS_DIR)

  if (!fileExists(agentsAbsolute)) {
    issues.push({
      code: 'await_shell_ban.agents_dir_missing',
      message: `${AGENTS_DIR} directory is missing; cannot verify the ban.`,
    })
  } else {
    let agentFiles: string[]

    try {
      agentFiles = readdirSync(agentsAbsolute)
        .filter((name) => name.endsWith('.md'))
        .sort()
    } catch {
      agentFiles = []
      issues.push({
        code: 'await_shell_ban.agents_dir_unreadable',
        message: `${AGENTS_DIR} could not be listed.`,
      })
    }

    for (const name of agentFiles) {
      const relativePath = path.join(AGENTS_DIR, name)
      const absolutePath = path.join(root, relativePath)
      let content: string

      try {
        content = readText(absolutePath)
      } catch {
        issues.push({
          code: 'await_shell_ban.agent_unreadable',
          message: `${relativePath}: could not be read.`,
          pointer: relativePath,
        })
        continue
      }

      const disallowed = parseDisallowedTools(content)

      if (disallowed === null) {
        issues.push({
          code: 'await_shell_ban.frontmatter_missing',
          message: `${relativePath}: no YAML frontmatter or disallowedTools key found.`,
          pointer: relativePath,
        })
        continue
      }

      if (!disallowed.includes(DENIED_TOOL)) {
        issues.push({
          code: 'await_shell_ban.missing_from_disallowed_tools',
          message: `${relativePath}: '${DENIED_TOOL}' is missing from disallowedTools.`,
          pointer: relativePath,
        })
      }

      // Also verify AwaitShell does not appear in the `tools` allow-list.
      const toolsLineMatch = /^tools:\s*(.*)/mu.exec(
        /^---\n([\s\S]*?)\n---/u.exec(content)?.[1] ?? '',
      )

      if (toolsLineMatch) {
        const toolsRaw = (toolsLineMatch[1] ?? '').trim()
        const tokenRe = /'[^']*'|[^,\[\]]+/gu
        let m: RegExpExecArray | null

        while ((m = tokenRe.exec(toolsRaw)) !== null) {
          const t = m[0].trim().replace(/^'|'$/gu, '')

          if (t === DENIED_TOOL) {
            issues.push({
              code: 'await_shell_ban.in_tools_allow_list',
              message: `${relativePath}: '${DENIED_TOOL}' appears in the tools allow-list.`,
              pointer: relativePath,
            })
            break
          }
        }
      }
    }
  }

  // --- Check hooks.json ---
  const hooksAbsolute = path.join(root, HOOKS_SOURCE)

  if (!fileExists(hooksAbsolute)) {
    issues.push({
      code: 'await_shell_ban.hooks_source_missing',
      message: `${HOOKS_SOURCE} is missing; cannot verify the preToolUse hook.`,
      pointer: HOOKS_SOURCE,
    })
  } else {
    let hooks: unknown

    try {
      hooks = readJson(hooksAbsolute)
    } catch {
      hooks = null
      issues.push({
        code: 'await_shell_ban.hooks_source_unreadable',
        message: `${HOOKS_SOURCE}: could not be read or parsed.`,
        pointer: HOOKS_SOURCE,
      })
    }

    if (isRecord(hooks)) {
      const hooksObj = hooks.hooks

      if (!isRecord(hooksObj)) {
        issues.push({
          code: 'await_shell_ban.hooks_object_missing',
          message: `${HOOKS_SOURCE}: missing or non-object 'hooks' field.`,
          pointer: HOOKS_SOURCE,
        })
      } else {
        const preToolUse = hooksObj.preToolUse

        const hasDenyEntry =
          Array.isArray(preToolUse) &&
          preToolUse.some(
            (entry) =>
              isRecord(entry) &&
              typeof entry.command === 'string' &&
              entry.command.includes(DENY_HOOK_COMMAND),
          )

        if (!hasDenyEntry) {
          issues.push({
            code: 'await_shell_ban.pre_tool_use_hook_missing',
            message:
              `${HOOKS_SOURCE}: no preToolUse entry found whose command ` +
              `contains '${DENY_HOOK_COMMAND}'. Add the hook to enforce ` +
              `the AwaitShell ban at the platform level.`,
            pointer: HOOKS_SOURCE,
          })
        }
      }
    }
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}
