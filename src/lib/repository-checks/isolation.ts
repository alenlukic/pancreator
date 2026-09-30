import path from 'node:path'
import { fileExists, isRecord, readJson } from '../io.js'
import { isSelfDevelopmentInstallation } from '../project-config.js'
import { repositoryChecksSourcePath } from './paths.js'

/**
 * A single-test selector substitutes the failing test's file and name.
 *
 * `{test_pattern}` receives the name as an anchored regular expression, which
 * is what a runner whose filter is a pattern needs; `{test}` receives the
 * literal name for a runner that selects by node id. A template carrying
 * neither cannot select one test, so the gate keeps its failure instead.
 */
export function isIsolationCommand(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.includes('{file}') &&
    (value.includes('{test_pattern}') || value.includes('{test}'))
  )
}

/**
 * Isolation commands the tracked self-development template declares.
 *
 * The self-development runtime configuration is untracked per-installation
 * state that nothing regenerates, so a runner capability added to the tracked
 * template would otherwise never reach a live gate here. The adoption is
 * narrow on purpose: it applies only when the installed profile runs exactly
 * the template's commands, so a profile an operator rewrote never inherits a
 * selector for a runner it no longer invokes.
 */
export function templateIsolationCommands(
  root: string,
  filePath: string,
): Map<string, { commands: string[]; isolation_command: string }> {
  const adopted = new Map<
    string,
    { commands: string[]; isolation_command: string }
  >()
  const templatePath = path.join(
    root,
    'library',
    'templates',
    'repository-checks.self-development.json',
  )

  // The file check comes first and the installation mode second. Reading the
  // mode needs `config.json`, and a caller may hold a bare directory that has
  // a repository-check file and nothing else; loading its profiles must not
  // start depending on a harness configuration it never had.
  if (
    path.resolve(templatePath) === path.resolve(filePath) ||
    !fileExists(templatePath) ||
    !isSelfDevelopmentInstallation(root)
  ) {
    return adopted
  }

  const template = readJson(templatePath)

  if (!isRecord(template) || !isRecord(template.profiles)) {
    return adopted
  }

  for (const [name, profile] of Object.entries(template.profiles)) {
    if (
      !isRecord(profile) ||
      !isIsolationCommand(profile.isolation_command) ||
      !Array.isArray(profile.commands) ||
      !profile.commands.every((command) => typeof command === 'string')
    ) {
      continue
    }

    adopted.set(name, {
      commands: profile.commands as string[],
      isolation_command: profile.isolation_command,
    })
  }

  return adopted
}

/**
 * Profiles the tracked self-development template declares that the live
 * repository-check file lacks.
 *
 * The self-development runtime file is untracked per-installation state that
 * nothing regenerates. A stage gate that names a profile the file lacks is
 * skipped as `not_configured`, so a profile added to the tracked template
 * would silently never run. `pan validate` reports each gap as a warning so
 * the operator copies the profile from the template. An operator who wants a
 * profile off keeps it declared with an empty `commands` list.
 */
export function repositoryCheckTemplateGaps(root: string): string[] {
  const filePath = repositoryChecksSourcePath(root)
  const templatePath = path.join(
    root,
    'library',
    'templates',
    'repository-checks.self-development.json',
  )

  if (
    path.resolve(templatePath) === path.resolve(filePath) ||
    !fileExists(filePath) ||
    !fileExists(templatePath) ||
    !isSelfDevelopmentInstallation(root)
  ) {
    return []
  }

  const template = readJson(templatePath)
  const live = readJson(filePath)

  if (
    !isRecord(template) ||
    !isRecord(template.profiles) ||
    !isRecord(live) ||
    !isRecord(live.profiles)
  ) {
    return []
  }

  const liveProfiles = live.profiles

  return Object.keys(template.profiles)
    .filter((name) => !(name in liveProfiles))
    .map(
      (name) =>
        `${path.relative(root, filePath) || filePath} lacks profile '${name}' ` +
        'that library/templates/repository-checks.self-development.json ' +
        'declares, so every stage gate naming it is skipped as ' +
        'not_configured. Copy the profile from the template, or declare it ' +
        'with an empty commands list to keep it off.',
    )
}
