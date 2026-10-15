import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applyCustomizations,
  loadCustomizationBundle,
  planCustomizations,
  revertCustomizations,
} from './lib/vscode-customizations.js'

const help = `Optional VS Code machine customizations. Installation never applies them.

Usage: bin/vscode-customizations [--check | --apply | --revert] [options]
  --check              Read-only inspection (default); exit 1 means pending
  --apply              Preflight, back up, patch, and pin governance settings
  --revert             Restore this bundle; refuse to overwrite later changes
  --app <path>         VS Code .app bundle or Resources/app directory
  --user-data-dir <dir> Code/User directory containing settings.json and profiles
  --skip-settings      Inspect or patch only the app
  --state-dir <dir>    Private backup directory
  --help               Show this help

Supported app build is pinned in library/vscode/customizations.json.
Quit VS Code fully after apply or revert, then reopen it.
Patching breaks the Microsoft signature seal; an update replaces app patches.
`

type Operation = 'check' | 'apply' | 'revert'

function main(): void {
  let operation: Operation = 'check'
  let explicitOperation = false
  let app = '/Applications/Visual Studio Code.app'
  let userDataDir: string | undefined = path.join(
    homedir(),
    'Library/Application Support/Code/User',
  )
  let stateDir = path.join(
    homedir(),
    '.local/state/pancreator/vscode-customizations',
  )

  for (let index = 2; index < process.argv.length; index++) {
    const argument = process.argv[index]!

    if (argument === '--help' || argument === '-h') {
      console.log(help)
      return
    } else if (['--check', '--apply', '--revert'].includes(argument)) {
      if (explicitOperation) {
        throw new Error('Choose one operation')
      }

      explicitOperation = true
      operation = argument.slice(2) as Operation
    } else if (argument === '--skip-settings') {
      userDataDir = undefined
    } else if (['--app', '--user-data-dir', '--state-dir'].includes(argument)) {
      const value = process.argv[++index]

      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a path`)
      }

      if (argument === '--app') {
        app = value
      } else if (argument === '--user-data-dir') {
        userDataDir = value
      } else {
        stateDir = value
      }
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }

  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..',
  )
  const resolvedApp = realpathSync(app)
  const appRoot = existsSync(path.join(resolvedApp, 'package.json'))
    ? resolvedApp
    : path.join(resolvedApp, 'Contents/Resources/app')
  const metadata: unknown = JSON.parse(
    readFileSync(path.join(appRoot, 'package.json'), 'utf8'),
  )

  if (
    !metadata ||
    typeof metadata !== 'object' ||
    !('version' in metadata) ||
    typeof metadata.version !== 'string'
  ) {
    throw new Error('Invalid VS Code package metadata')
  }

  const bundle = loadCustomizationBundle(
    path.join(root, 'library/vscode'),
    metadata.version,
  )
  const options = {
    appRoot,
    userDataDir: userDataDir ? realpathSync(userDataDir) : undefined,
    stateDir: path.resolve(stateDir),
  }

  if (operation === 'revert') {
    revertCustomizations(bundle, options)
    console.log(
      'Restored recorded app files and settings. Quit VS Code fully and reopen it.',
    )
    return
  }

  const plan =
    operation === 'apply'
      ? applyCustomizations(bundle, options)
      : planCustomizations(bundle, options)

  for (const row of plan.rows) {
    console.log(`${row.state}: ${row.id} (${row.target})`)
  }

  console.log(
    `VS Code ${plan.version}: ${plan.state}; ${bundle.settings.size} governance settings per selected profile.`,
  )

  if (operation === 'check') {
    process.exitCode = plan.state === 'pending' ? 1 : 0
  } else {
    console.log(
      'Private backups retained. Quit VS Code fully and reopen it to load the changes.',
    )
  }
}

try {
  main()
} catch (error) {
  console.error(
    `Refused: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 2
}
