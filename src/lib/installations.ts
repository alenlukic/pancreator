import { readdirSync } from 'node:fs'
import path from 'node:path'

import { errorMessage, invariant } from './errors.js'
import { archiveInboxRequest, inboxStatusOf } from './inbox.js'
import { fileExists, isFile, readText, resolveInside } from './io.js'
import {
  harnessConfigName,
  readInstallationIdentity,
  readProjectConfig,
  registeredInstallations,
  resolveRegisteredInstallation,
} from './project-config.js'
import type { RegisteredInstallation } from './types.js'

export interface InstallationDescription extends RegisteredInstallation {
  exists: boolean
  installation_mode: 'self_development' | 'embedded' | 'detached' | null
  version: string | null
  /** The version of the harness checkout that lists the installation. */
  harness_version: string | null
  /** True when the installation's version differs from the harness version, null when either is unknown. */
  stale: boolean | null
  pan_command: string
  queued_items: number
  error: string | null
}

export interface ArchiveInstallationInboxItemsOptions {
  installId: string
  intakePath: string
  items: string[]
}

export interface ArchivedInstallationInboxItems {
  installation: string
  path: string
  archived: Array<{ from: string; to: string }>
}

function queuedItemCount(root: string): number {
  const queuePath = path.join(root, 'runtime', 'inbox', 'queue')

  if (!fileExists(queuePath)) {
    return 0
  }

  // Matches the eligibility rule `listInboxStatus` (src/lib/inbox.ts) applies
  // to every inbox status directory: every regular file, not just `.md`.
  return readdirSync(queuePath, { withFileTypes: true }).filter((entry) =>
    entry.isFile(),
  ).length
}

function installationVersion(root: string): string | null {
  const versionPath = path.join(root, 'VERSION')

  return fileExists(versionPath) ? readText(versionPath).trim() || null : null
}

function staleVersion(
  installed: string | null,
  harness: string | null,
): boolean | null {
  return installed !== null && harness !== null ? installed !== harness : null
}

/**
 * Describes each registered target installation: whether its harness config
 * exists, its installation mode, installed version against this harness's
 * version (and whether it is stale), queued inbox items, and any identity or
 * config-schema error as a diagnostic. A config that fails the current schema
 * still reports version and queue depth.
 */
export function describeInstallations(root: string): InstallationDescription[] {
  const harnessVersion = installationVersion(root)

  return registeredInstallations(root).map((entry) => {
    const configName = harnessConfigName(entry.path)
    const base = {
      id: entry.id,
      path: entry.path,
      pan_command: path.join(entry.path, 'bin', 'pan'),
    }

    if (!configName) {
      return {
        ...base,
        exists: false,
        installation_mode: null,
        version: null,
        harness_version: harnessVersion,
        stale: null,
        queued_items: 0,
        error: null,
      }
    }

    // Version and queue depth need no config schema, so a config that fails
    // the harness's current schema (an older installation behind a required
    // field this checkout added since) must not blank them. The full-schema
    // read still runs, and its message, when any, becomes `error`: it is a
    // diagnostic the operator can act on, not a reason to hide the row.
    const version = installationVersion(entry.path)
    const queuedItems = queuedItemCount(entry.path)

    let installationMode: InstallationDescription['installation_mode'] = null
    let identityError: string | null = null

    try {
      const identity = readInstallationIdentity(entry.path)

      installationMode = identity?.installation_mode ?? null
    } catch (error) {
      identityError = errorMessage(error)
    }

    let schemaError: string | null = null

    try {
      readProjectConfig(entry.path)
    } catch (error) {
      schemaError = errorMessage(error)
    }

    return {
      ...base,
      exists: true,
      installation_mode: installationMode,
      version,
      harness_version: harnessVersion,
      stale: staleVersion(version, harnessVersion),
      queued_items: queuedItems,
      error: identityError ?? schemaError,
    }
  })
}

const NAME_CHARACTER = /[A-Za-z0-9._-]/u
const NAME_CONTINUATION = /^(?:[A-Za-z0-9_-]|\.[A-Za-z0-9_-])/u

/**
 * Inbox file names share long suffixes by construction, so a raw substring
 * test would read a citation of `<run-id>_chunk-run-friction.md` as a citation
 * of an unrelated `chunk-run-friction.md`. The name must appear as a whole
 * path segment.
 */
function intakeCitesFileName(intake: string, fileName: string): boolean {
  for (
    let index = intake.indexOf(fileName);
    index !== -1;
    index = intake.indexOf(fileName, index + 1)
  ) {
    const end = index + fileName.length

    if (
      !NAME_CHARACTER.test(index === 0 ? '' : intake.charAt(index - 1)) &&
      !NAME_CONTINUATION.test(intake.slice(end, end + 2))
    ) {
      return true
    }
  }

  return false
}

/**
 * Archives inbox items of a registered installation into that installation's
 * inbox archive, after checking that each item exists, is in queue, complete,
 * canceled, or legacy status, and is cited by name in the given intake.
 * Throws `INSTALLATION_NOT_FOUND`, `INTAKE_NOT_FOUND`, `INVALID_ARGUMENT`,
 * `INVALID_INBOX_TRANSITION`, `INBOX_ITEM_NOT_FOUND`, or
 * `INTAKE_DOES_NOT_CITE_ITEM` before moving anything.
 */
export function archiveInstallationInboxItems(
  root: string,
  options: ArchiveInstallationInboxItemsOptions,
): ArchivedInstallationInboxItems {
  const installation = resolveRegisteredInstallation(root, options.installId)

  invariant(
    harnessConfigName(installation.path) !== null,
    `Registered installation '${installation.id}' has no harness configuration at ${installation.path}.`,
    {
      code: 'INSTALLATION_NOT_FOUND',
      details: { id: installation.id, path: installation.path },
    },
  )

  const intakePath = resolveInside(root, options.intakePath)

  invariant(
    isFile(intakePath),
    `Intake does not exist: ${options.intakePath}`,
    {
      code: 'INTAKE_NOT_FOUND',
      details: { path: options.intakePath },
    },
  )
  invariant(options.items.length > 0, 'At least one --item is required.', {
    code: 'INVALID_ARGUMENT',
  })

  const intake = readText(intakePath)
  const items = options.items.map((item) => item.split(path.sep).join('/'))

  invariant(
    new Set(items).size === items.length,
    'Each installation inbox item may be archived only once per command.',
    { code: 'INVALID_ARGUMENT' },
  )

  for (const item of items) {
    const status = inboxStatusOf(item)

    invariant(
      status === 'queue' ||
        status === 'complete' ||
        status === 'canceled' ||
        status === 'legacy',
      `Inbox item '${item}' is in status '${status ?? 'invalid'}' and cannot be archived.`,
      { code: 'INVALID_INBOX_TRANSITION', details: { item, status } },
    )
    invariant(
      isFile(resolveInside(installation.path, item)),
      `Inbox item does not exist: ${item}`,
      { code: 'INBOX_ITEM_NOT_FOUND', details: { item } },
    )
    invariant(
      intakeCitesFileName(intake, path.basename(item)),
      `Intake '${options.intakePath}' does not cite '${path.basename(item)}'.`,
      {
        code: 'INTAKE_DOES_NOT_CITE_ITEM',
        details: { intake: options.intakePath, item },
      },
    )
  }

  return {
    installation: installation.id,
    path: installation.path,
    archived: items.map((item) => archiveInboxRequest(installation.path, item)),
  }
}
