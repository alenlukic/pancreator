export type CursorInstallationMode =
  | 'self_development'
  | 'embedded'
  | 'detached'

interface PolicyRuleSource {
  id: string
  title: string
  summary: string
  instructions: string[]
  guidance?: Array<{ source_path: string; content: string }>
}

/**
 * Render a governance policy as an always-apply Cursor rule.
 *
 * Policies reach workflow agents unrolled into their invocation card. Work that
 * runs outside the card machinery — command-driven subagents, ad-hoc operator
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
    ...(policy.guidance ?? []).flatMap((guidance) => [
      '',
      `## Unrolled guidance · \`${guidance.source_path}\``,
      '',
      guidance.content,
    ]),
    '',
  ].join('\n')
}

/** Harness prefix used by an embedded installation, relative to the target. */
export const EMBEDDED_HARNESS_PREFIX = '.pancreator'

/**
 * Render a canonical Cursor projection for the selected installation mode.
 *
 * Canonical sources are written harness-relative because that is how the CLI
 * emits paths. A target installation reads them from the target repository
 * instead, so every harness path is rewritten to point at the installation.
 * `harnessPrefix` is `.pancreator` for an embedded install and the absolute
 * installation root for a detached one, where no relative path from the target
 * can reach the harness.
 */
export function projectCursorContent(
  content: string,
  relativePath: string,
  installationMode: CursorInstallationMode,
  harnessPrefix: string = EMBEDDED_HARNESS_PREFIX,
): string {
  if (installationMode === 'self_development') {
    return content
  }

  // An embedded harness is reachable relative to the target repository; a
  // detached one MUST be addressed absolutely.
  const panCommandPath =
    harnessPrefix === EMBEDDED_HARNESS_PREFIX
      ? `./${harnessPrefix}/bin/pan`
      : `${harnessPrefix}/bin/pan`

  let projected = content
    .replaceAll('./bin/pan', panCommandPath)
    .replaceAll('`library/', `\`${harnessPrefix}/library/`)
    .replaceAll('`governance/', `\`${harnessPrefix}/governance/`)
    .replaceAll(
      'npm run validate',
      `npm --prefix ${harnessPrefix} run validate`,
    )
    .replaceAll('npm run check', `npm --prefix ${harnessPrefix} run check`)
    .replaceAll(
      'Read `AGENTS.md`',
      `Read the target repository's \`AGENTS.md\` when present and \`${harnessPrefix}/AGENTS.md\``,
    )
    .replaceAll(
      'read `AGENTS.md`',
      `read the target repository's \`AGENTS.md\` when present and \`${harnessPrefix}/AGENTS.md\``,
    )

  if (
    relativePath.startsWith('.cursor/agents/') ||
    relativePath === '.cursor/commands/pan-write-pr.md' ||
    relativePath === '.cursor/commands/pan-release.md' ||
    relativePath === '.cursor/commands/pan-build-briefs.md'
  ) {
    projected = projected.replaceAll('`docs/', `\`${harnessPrefix}/docs/`)
  }

  if (relativePath === '.cursor/commands/pan-release.md') {
    projected = projected.replaceAll(
      '`config.json`',
      `\`${harnessPrefix}/config.json\``,
    )
  }

  if (relativePath.startsWith('.cursor/agents/')) {
    projected = projected
      .replaceAll('`runtime/', `\`${harnessPrefix}/runtime/`)
      .replaceAll(' under `runtime/', ` under \`${harnessPrefix}/runtime/`)
      .replaceAll(' to `runtime/', ` to \`${harnessPrefix}/runtime/`)
  }

  if (relativePath === '.cursor/commands/pan-start.md') {
    projected = projected.replace(
      'under `runtime/inbox/`.',
      `under \`${harnessPrefix}/runtime/inbox/\`.`,
    )
  }

  if (
    relativePath === '.cursor/commands/pan-decompose.md' ||
    relativePath === '.cursor/commands/pan-repair.md'
  ) {
    projected = projected.replace(
      'output path under `runtime/inbox/`',
      `output path under \`${harnessPrefix}/runtime/inbox/\``,
    )
  }

  return projected
}
