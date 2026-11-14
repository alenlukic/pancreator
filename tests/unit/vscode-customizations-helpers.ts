import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  loadCustomizationBundle,
  type CustomizationBundle,
  type CustomizationOptions,
} from '../../src/lib/vscode-customizations.js'
import { createTestTempDirectory } from '../temp.js'

export const bundle = loadCustomizationBundle(
  path.join(process.cwd(), 'library/vscode'),
)

export const checksum = (source: string) =>
  createHash('sha256').update(source).digest('base64').replace(/=+$/, '')

export function fixture(
  full = false,
  version?: string,
): {
  bundle: CustomizationBundle
  options: CustomizationOptions
  original: Map<string, string>
} {
  const root = createTestTempDirectory('vscode-customizations-')
  const appRoot = path.join(root, 'app')
  const userDataDir = path.join(root, 'User')
  const versioned = version
    ? loadCustomizationBundle(
        path.join(process.cwd(), 'library/vscode'),
        version,
      )
    : bundle
  const selected = full
    ? versioned
    : {
        ...versioned,
        patches: [
          {
            id: 'fixture',
            targets: ['out/fixture.js'],
            find: 'const value = 1',
            replace: 'const value = 2',
            occurrences: 1,
          },
        ],
      }
  const original = new Map<string, string>()
  const sources = new Map<string, string[]>()
  mkdirSync(appRoot)
  mkdirSync(path.join(userDataDir, 'profiles', 'profile'), { recursive: true })

  for (const patch of selected.patches) {
    for (const target of patch.targets) {
      const parts = sources.get(target) ?? []
      parts.push(patch.find)
      sources.set(target, parts)
    }
  }

  const checksums: Record<string, string> = {}

  for (const [target, parts] of sources) {
    const file = path.join(appRoot, target)
    const source = parts.join('\n/* fixture boundary */\n')
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, source)
    original.set(file, source)

    if (target.startsWith('out/')) {
      checksums[target.slice(4)] = checksum(source)
    }
  }

  for (const [file, source] of [
    [
      path.join(appRoot, 'package.json'),
      JSON.stringify({ version: selected.version }),
    ],
    [
      path.join(appRoot, 'product.json'),
      JSON.stringify({
        commit: selected.commit,
        checksums,
        unrelated: 'retained',
      }),
    ],
    [
      path.join(userDataDir, 'settings.json'),
      '{\n// preserve comment\n"theme": "Custom",\n"chat.tools.terminal.idleSilenceTimeoutMs": 200,\n}\n',
    ],
    [
      path.join(userDataDir, 'profiles/profile/settings.json'),
      '{"theme":"Profile"}',
    ],
  ]) {
    writeFileSync(file!, source!)
    original.set(file!, source!)
  }

  return {
    bundle: selected,
    options: { appRoot, userDataDir, stateDir: path.join(root, 'state') },
    original,
  }
}

export function noSyntaxCheck(): void {}

export function backupDirectory(options: CustomizationOptions): string {
  const appDirectory = path.join(
    options.stateDir,
    readdirSync(options.stateDir)[0]!,
  )
  return path.join(appDirectory, readdirSync(appDirectory)[0]!)
}
