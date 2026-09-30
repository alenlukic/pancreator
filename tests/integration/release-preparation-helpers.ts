import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { finalizeLocalRelease } from '../../src/lib/release-preparation.js'
import { recordWorkspaceAttribution } from '../../src/lib/workspace-attribution.js'
import { nextSemanticVersion } from '../../src/lib/versioning.js'

export function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  }).trim()
}

export function errorCode(action: () => unknown): string | null {
  try {
    action()
    return null
  } catch (error) {
    return error instanceof Error && 'code' in error ? String(error.code) : null
  }
}

/**
 * Existing release tests isolate their original contracts from the quality
 * gate by finalizing with both operator overrides. The dedicated quality-pass
 * test below calls `finalizeLocalRelease` directly with the production default.
 */
export function finalizeWithQualityOverrides(
  root: string,
  worktreeName: string,
  fetchedMain: string,
  ownerRunId?: string,
) {
  return finalizeLocalRelease(root, worktreeName, fetchedMain, ownerRunId)
}

export function writeReleaseMetadata(root: string): string {
  const current = readFileSync(path.join(root, 'VERSION'), 'utf8').trim()
  const version = nextSemanticVersion(current, 'patch')

  assert.ok(version)
  writeFileSync(path.join(root, 'VERSION'), `${version}\n`)
  writeFileSync(
    path.join(root, 'CHANGELOG.md'),
    `# Changelog\n\n## [${version}] - 2026-08-31\n\n### Added\n\n- Validate local release finalization.\n`,
  )

  for (const filename of ['package.json', 'package-lock.json']) {
    const filePath = path.join(root, filename)
    const value = JSON.parse(readFileSync(filePath, 'utf8')) as Record<
      string,
      unknown
    >

    value.version = version

    if (filename === 'package-lock.json') {
      const packages = value.packages as Record<string, Record<string, unknown>>

      packages[''].version = version
    }

    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
  }

  const docsPath = path.join(root, 'docs', 'embedded-installation.md')
  const docs = readFileSync(docsPath, 'utf8').replace(
    /currently agree on `[^`]+`/u,
    `currently agree on \`${version}\``,
  )

  writeFileSync(docsPath, docs)

  return version
}

export const DESIGN_SOURCE = 'design-source.svg'

/** Record `DESIGN_SOURCE` as a read-only input of the release worktree. */
export function attributeReadOnlyInput(
  root: string,
  worktreePath: string,
  paths: string[] = [DESIGN_SOURCE],
): void {
  recordWorkspaceAttribution(root, {
    workspacePath: worktreePath,
    runId: 'run-fixture',
    actingRole: 'operator',
    directive: 'Keep the design source I exported out of the release.',
    disposition: 'read-only-input',
    paths,
    artifactPath: 'runtime/logs/workflows/run-fixture/evidence/directive-1.md',
  })
}
