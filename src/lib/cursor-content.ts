import { invariant } from './errors.js'
import { renderGuidanceBlock } from './policy-guidance.js'
import {
  projectedDeferredClauseGroups,
  renderDeferredIndex,
} from './policy-deferred.js'
import {
  policyInstructionAppliesToCard,
  policyInstructionLoad,
} from './policy-instructions.js'
import type { PolicyGuidance, PolicyInstruction } from './types.js'

export type CursorInstallationMode =
  | 'self_development'
  | 'embedded'
  | 'detached'

interface PolicyRuleSource {
  id: string
  title: string
  summary: string
  instructions: PolicyInstruction[]
  guidance?: PolicyGuidance[]
}

/**
 * Render a governance policy as an always-apply Cursor rule.
 *
 * Policies reach workflow agents through their invocation card. Work that runs
 * outside the card machinery — command-driven subagents, ad-hoc operator
 * requests — has no card, so the same policy is generated into a rule instead of
 * restated by hand. Generating it keeps the policy the single source of truth.
 *
 * Kept in sync with the equivalent renderer in `bin/install-support`, which
 * cannot import this module during an embedded install.
 */
export function renderPolicyCursorRule(policy: PolicyRuleSource): string {
  // A deferred clause stays out of the always-apply rule. One index line per
  // trigger points at the command and hook that deliver it.
  const deferred = projectedDeferredClauseGroups(policy)
  const instructions = policy.instructions
    .filter(
      (instruction) =>
        policyInstructionLoad(instruction) === 'invocation' &&
        policyInstructionAppliesToCard(instruction, 'agent'),
    )
    .map((instruction) => {
      const predicates = Object.entries(instruction.capabilities ?? {})
      return predicates.length === 0
        ? instruction.text
        : `When ${predicates.map(([key, value]) => `${key} capability is ${value ? 'authorized' : 'absent'}`).join(' and ')}: ${instruction.text}`
    })

  return [
    '---',
    `description: ${policy.id} — ${policy.title}`,
    'alwaysApply: true',
    '---',
    '',
    `<!-- Generated from governance/policies/${policy.id}.json. Edit the policy, not this file. -->`,
    '',
    'The terms MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY use RFC 2119 meanings.',
    '',
    `# ${policy.id} · ${policy.title}`,
    '',
    policy.summary,
    '',
    ...(policy.instructions.some((instruction) => instruction.capabilities)
      ? [
          'Invocation-bound stage and evidence workers have no delegation capability. Shell capability follows the actual offered tools; conditional clauses apply only when their predicates match.',
          '',
        ]
      : []),
    ...instructions.map((instruction) => `- ${instruction}`),
    ...(deferred.length > 0
      ? [
          '',
          ...renderDeferredIndex(
            deferred,
            2,
            CURSOR_PROJECTION_TOKENS.panCommand,
          ).slice(0, 1),
        ]
      : []),
    ...(policy.guidance ?? []).flatMap((guidance) =>
      renderGuidanceBlock(2, guidance),
    ),
    '',
  ].join('\n')
}

/** Harness prefix used by an embedded installation, relative to the target. */
export const EMBEDDED_HARNESS_PREFIX = '.pancreator'

/** Explicit path tokens accepted in canonical Cursor projection sources. */
export const CURSOR_PROJECTION_TOKENS = {
  harnessPath: '{{PANCREATOR_HARNESS_PATH}}',
  panCommand: '{{PANCREATOR_PAN_COMMAND}}',
  npmPrefix: '{{PANCREATOR_NPM_PREFIX}}',
  cliPath: '{{PANCREATOR_CLI_PATH}}',
} as const

const UNRESOLVED_PROJECTION_TOKEN = /\{\{PANCREATOR_[A-Z_]+\}\}/gu
const HOOK_EXECUTABLE_TOKEN =
  /\{\{PANCREATOR_HARNESS_PATH\}\}bin\/(pan-hook-[a-z-]+)/gu

/** Quote an executable or command argument, not a path shown as documentation. */
export function shellQuoteCommandPath(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)
    ? value
    : `'${value.replaceAll("'", `'"'"'`)}'`
}

/**
 * Render a canonical Cursor projection for the selected installation mode.
 *
 * Canonical sources mark each path by semantic role. This keeps filesystem
 * paths distinct from CLI arguments and removes file-specific rewrites.
 */
export function projectCursorContent(
  content: string,
  relativePath: string,
  installationMode: CursorInstallationMode,
  harnessPrefix: string = EMBEDDED_HARNESS_PREFIX,
): string {
  const targetInstallation = installationMode !== 'self_development'
  const harnessPath = targetInstallation ? `${harnessPrefix}/` : ''
  const panCommand = shellQuoteCommandPath(
    targetInstallation
      ? harnessPrefix === EMBEDDED_HARNESS_PREFIX
        ? `./${harnessPrefix}/bin/pan`
        : `${harnessPrefix}/bin/pan`
      : './bin/pan',
  )
  const npmPrefix = targetInstallation
    ? ` --prefix ${shellQuoteCommandPath(harnessPrefix)}`
    : ''
  // Hook fields are shell command strings. Quote the executable as a whole;
  // quoting only the path prefix would still leave the command vulnerable to
  // whitespace and shell metacharacters in a detached WSL/Linux install path.
  // Ordinary {{PANCREATOR_HARNESS_PATH}} references are filesystem paths,
  // not commands, and must remain unquoted.
  const hooks =
    relativePath === '.cursor/hooks.json' ||
    relativePath.startsWith('.github/hooks/')
  const source = hooks
    ? content.replaceAll(HOOK_EXECUTABLE_TOKEN, (_, name: string) =>
        JSON.stringify(
          shellQuoteCommandPath(`${harnessPath}bin/${name}`),
        ).slice(1, -1),
      )
    : content

  const projected = source
    .replaceAll(CURSOR_PROJECTION_TOKENS.harnessPath, harnessPath)
    .replaceAll(CURSOR_PROJECTION_TOKENS.panCommand, panCommand)
    .replaceAll(CURSOR_PROJECTION_TOKENS.npmPrefix, npmPrefix)
    .replaceAll(CURSOR_PROJECTION_TOKENS.cliPath, '')
  const unresolved = projected.match(UNRESOLVED_PROJECTION_TOKEN) ?? []

  invariant(
    unresolved.length === 0,
    `${relativePath} contains unresolved projection tokens: ${[
      ...new Set(unresolved),
    ].join(', ')}`,
    { code: 'UNRESOLVED_PROJECTION_TOKEN' },
  )

  return projected
}
