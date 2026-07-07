#!/usr/bin/env node
import path from 'node:path'

import { PanError } from './lib/errors.js'
import { maintainWorkflowRuntime } from './lib/workflow-artifacts.js'

function option(name: string): string | null {
  const index = process.argv.indexOf(name)

  if (index === -1) {
    return null
  }

  const value = process.argv[index + 1]

  if (!value || value.startsWith('--')) {
    throw new PanError(`${name} requires a value.`, {
      code: 'INVALID_ARGUMENT',
    })
  }

  return value
}

function main(): void {
  const root = path.resolve(option('--root') ?? process.cwd())
  const retentionValue = option('--days')
  const retentionDays = retentionValue === null ? 7 : Number(retentionValue)

  const summary = maintainWorkflowRuntime(root, { retentionDays })

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

try {
  main()
} catch (error) {
  if (error instanceof PanError) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = error.exitCode
  } else {
    throw error
  }
}
