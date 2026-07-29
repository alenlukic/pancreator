export type CursorInstallationMode =
  | 'self_development'
  | 'embedded'
  | 'detached'

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
    projected = projected
      .replace(
        'under `runtime/inbox/`.',
        `under \`${harnessPrefix}/runtime/inbox/\`.`,
      )
      .replace(
        'write that object to a uniquely named JSON file under `runtime/inbox/`',
        `write that object to a uniquely named JSON file under \`${harnessPrefix}/runtime/inbox/\``,
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
