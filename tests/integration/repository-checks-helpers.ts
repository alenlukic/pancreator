import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { createTestTempDirectory } from '../helpers.js'

export function makeInstallation(): { root: string; workspace: string } {
  const parent = createTestTempDirectory('checks-')
  const root = path.join(parent, '.pancreator')
  const workspace = path.join(parent, 'workspace')

  mkdirSync(path.join(root, 'runtime'), { recursive: true })
  mkdirSync(workspace, { recursive: true })
  writeFileSync(
    path.join(root, 'config.json'),
    `${JSON.stringify(
      {
        schema_version: 1,
        installation_mode: 'embedded',
        workspace_root: '../workspace',
        state_root: 'runtime',
      },
      null,
      2,
    )}\n`,
  )

  return { root, workspace }
}

export function writeChecks(
  root: string,
  profiles: Record<string, unknown>,
): void {
  writeFileSync(
    path.join(root, 'runtime', 'repository-checks.json'),
    `${JSON.stringify({ schema_version: 1, profiles }, null, 2)}\n`,
  )
}
