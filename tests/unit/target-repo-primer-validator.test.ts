import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validateTargetRepoPrimer } from '../../src/lib/validators/target-repo-primer.js'
import { createFixture } from '../helpers.js'

function validate(content: string) {
  const root = createFixture()
  const targetPath = 'runtime/target-repo-primer.md'

  writeFileSync(path.join(root, targetPath), content)

  return validateTargetRepoPrimer({
    root,
    targetPath,
    requirement: {
      policy_id: 'PRIMER-001',
      requirement_id: 'target-repo-primer-validate',
      registry_id: 'TARGET-REPO-PRIMER-VALIDATE-001',
      arguments: {},
    },
  })
}

const VALID_PRIMER = `# Target repository primer

<!-- pancreator-primer-status: ready -->
<!-- generated-at: 2026-06-28T12:00:00Z -->
<!-- source-head: 0123456789abcdef -->

## Summary

A small service with a command-line interface.

## Administrative commands

### Install

Run \`npm ci\`.

### Build

Run \`npm run build\`.

### Test

Run \`npm test\`.

### Other

None identified.

## Architecture

\`\`\`mermaid
flowchart LR
  CLI --> Service
  Service --> Store
\`\`\`

## Project structure

- \`src/cli.ts\`: public command entry point
- \`src/service.ts\`: application service

## Public interfaces

- CLI commands exposed by \`src/cli.ts\`.

## Gotchas

None identified.
`

test('target repository primer validator accepts a complete primer', () => {
  const result = validate(VALID_PRIMER)

  assert.equal(result.status, 'passed')
  assert.deepEqual(result.issues, [])
})

test('target repository primer validator rejects the bootstrap primer', () => {
  const result = validate(
    VALID_PRIMER.replace(
      'pancreator-primer-status: ready',
      'pancreator-primer-status: unbuilt',
    ),
  )

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some((item) => item.code === 'primer.status_not_ready'),
  )
})

test('target repository primer validator requires commands and Mermaid architecture', () => {
  const result = validate(
    VALID_PRIMER.replace('### Test\n\nRun `npm test`.\n\n', '').replace(
      '```mermaid\nflowchart LR\n  CLI --> Service\n  Service --> Store\n```',
      'Architecture is undocumented.',
    ),
  )

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (item) => item.code === 'primer.admin_subsection_missing',
    ),
  )
  assert.ok(
    result.issues.some((item) => item.code === 'primer.architecture_mermaid'),
  )
})
