export type CursorInstallationMode = 'self_development' | 'embedded'

/** Render a canonical Cursor projection for the selected installation mode. */
export function projectCursorContent(
  content: string,
  relativePath: string,
  installationMode: CursorInstallationMode,
): string {
  if (installationMode !== 'embedded') {
    return content
  }

  let projected = content
    .replaceAll('./bin/pan', './.pancreator/bin/pan')
    .replaceAll('`library/', '`.pancreator/library/')
    .replaceAll('`governance/', '`.pancreator/governance/')
    .replaceAll('npm run validate', 'npm --prefix .pancreator run validate')
    .replaceAll('npm run check', 'npm --prefix .pancreator run check')
    .replaceAll(
      'Read `AGENTS.md`',
      "Read the target repository's `AGENTS.md` when present and `.pancreator/AGENTS.md`",
    )
    .replaceAll(
      'read `AGENTS.md`',
      "read the target repository's `AGENTS.md` when present and `.pancreator/AGENTS.md`",
    )

  if (
    relativePath.startsWith('.cursor/agents/') ||
    relativePath === '.cursor/commands/pan-write-pr.md' ||
    relativePath === '.cursor/commands/pan-release.md' ||
    relativePath === '.cursor/commands/pan-build-briefs.md'
  ) {
    projected = projected.replaceAll('`docs/', '`.pancreator/docs/')
  }

  if (relativePath === '.cursor/commands/pan-release.md') {
    projected = projected.replaceAll(
      '`project.json`',
      '`.pancreator/project.json`',
    )
  }

  if (relativePath.startsWith('.cursor/agents/')) {
    projected = projected
      .replaceAll('`runtime/', '`.pancreator/runtime/')
      .replaceAll(' under `runtime/', ' under `.pancreator/runtime/')
      .replaceAll(' to `runtime/', ' to `.pancreator/runtime/')
  }

  if (relativePath === '.cursor/commands/pan-start.md') {
    projected = projected
      .replace('under `runtime/inbox/`.', 'under `.pancreator/runtime/inbox/`.')
      .replace(
        'write that object to a uniquely named JSON file under `runtime/inbox/`',
        'write that object to a uniquely named JSON file under `.pancreator/runtime/inbox/`',
      )
  }

  if (relativePath === '.cursor/commands/pan-decompose.md') {
    projected = projected.replace(
      'output path under `runtime/inbox/`',
      'output path under `.pancreator/runtime/inbox/`',
    )
  }

  if (relativePath === '.cursor/commands/pan-repair.md') {
    projected = projected.replace(
      'output path under `runtime/inbox/`',
      'output path under `.pancreator/runtime/inbox/`',
    )
  }

  return projected
}
