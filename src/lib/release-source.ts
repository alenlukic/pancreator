import path from 'node:path'

import { gitSourceContentFingerprint } from './git/core.js'
import { fileExists, isRecord, readJson, readText, sha256 } from './io.js'
import { RELEASE_LANDING_METADATA_PATHS } from './versioning.js'

/** Fingerprint release source while allowing only version fields and release notes to change. */
export function releaseSourceFingerprint(workspace: string): string | null {
  const source = gitSourceContentFingerprint(
    workspace,
    RELEASE_LANDING_METADATA_PATHS,
  )
  if (source === null) return null
  const manifests: unknown[] = []
  for (const name of ['package.json', 'package-lock.json']) {
    const file = path.join(workspace, name)
    if (!fileExists(file)) {
      manifests.push(null)
      continue
    }
    const value = readJson(file)
    if (!isRecord(value)) return null
    delete value.version
    if (
      name === 'package-lock.json' &&
      isRecord(value.packages) &&
      isRecord(value.packages[''])
    ) {
      delete value.packages[''].version
    }
    manifests.push(value)
  }
  const versionFile = path.join(workspace, 'VERSION')
  const version = fileExists(versionFile) ? readText(versionFile).trim() : ''
  const documentationFile = path.join(
    workspace,
    'docs/embedded-installation.md',
  )
  const documentation = fileExists(documentationFile)
    ? readText(documentationFile).replaceAll(
        `currently agree on \`${version}\``,
        'currently agree on `<release-version>`',
      )
    : null
  return sha256(JSON.stringify({ source, manifests, documentation }))
}
