import { invariant } from './errors.js'
import { renderGuidanceBlock } from './policy-guidance.js'
import type { PolicyGuidance } from './types.js'

export type CursorInstallationMode =
  | 'self_development'
  | 'embedded'
  | 'detached'

interface PolicyRuleSource {
  id: string
  title: string
  summary: string
  instructions: string[]
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
    ...policy.instructions.map((instruction) => `- ${instruction}`),
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
  const panCommand = targetInstallation
    ? harnessPrefix === EMBEDDED_HARNESS_PREFIX
      ? `./${harnessPrefix}/bin/pan`
      : `${harnessPrefix}/bin/pan`
    : './bin/pan'
  const npmPrefix = targetInstallation ? ` --prefix ${harnessPrefix}` : ''
  const projected = content
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
