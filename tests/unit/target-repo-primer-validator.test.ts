import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validateTargetRepoPrimer } from '../../src/lib/validators/target-repo-primer.js'
import { createFixture } from '../helpers.js'

interface ValidateOptions {
  installationMode?: 'embedded' | 'detached'
}

function validate(content: string, options?: ValidateOptions) {
  const root = createFixture()
  const targetPath = 'docs/target-repo-primer.md'

  if (options?.installationMode) {
    const config = JSON.parse(
      readFileSync(path.join(root, 'config.json'), 'utf8'),
    ) as Record<string, unknown>

    config.installation_mode = options.installationMode
    config.workspace_root =
      options.installationMode === 'detached' ? path.join(root, 'target') : '..'
    writeFileSync(
      path.join(root, 'config.json'),
      `${JSON.stringify(config, null, 2)}\n`,
    )
  }

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

const EXTERNAL_SECTIONS = `

## Frontend visual inspection

- **Startup:** \`npm run dev\`
- **Route/state:** \`/dashboard\`
- **Browser inspection:** chrome-devtools MCP with \`--isolated\`

## Major workflows and data flows

### Login flow

#### Step 1: Authenticate
- **Input shape:** \`{ email: string, password: string }\`
- **Logic excerpt:** \`validateCredentials(input)\`
- **Output shape:** \`{ token: string }\`
`

const VALID_EXTERNAL_PRIMER = `${VALID_PRIMER}${EXTERNAL_SECTIONS}`

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

test('target repository primer validator accepts external frontend and flow sections', () => {
  const result = validate(VALID_EXTERNAL_PRIMER, {
    installationMode: 'embedded',
  })

  assert.equal(result.status, 'passed')
  assert.deepEqual(result.issues, [])
})

test('target repository primer validator applies external sections to detached installations', () => {
  const result = validate(VALID_EXTERNAL_PRIMER, {
    installationMode: 'detached',
  })

  assert.equal(result.status, 'passed')
  assert.deepEqual(result.issues, [])
})

test('target repository primer validator accepts a verified frontend state without a route', () => {
  const result = validate(
    VALID_EXTERNAL_PRIMER.replace(
      '- **Route/state:** `/dashboard`',
      '- **State:** authenticated dashboard',
    ),
    { installationMode: 'embedded' },
  )

  assert.equal(result.status, 'passed')
  assert.deepEqual(result.issues, [])
})

test('target repository primer validator accepts explicit not-applicable frontend guidance', () => {
  const result = validate(
    VALID_EXTERNAL_PRIMER.replace(
      EXTERNAL_SECTIONS,
      `

## Frontend visual inspection

Not applicable — no client/frontend detected.

## Major workflows and data flows

None identified.
`,
    ),
    { installationMode: 'embedded' },
  )

  assert.equal(result.status, 'passed')
})

test('target repository primer validator rejects malformed external flow steps', () => {
  const result = validate(
    VALID_EXTERNAL_PRIMER.replace(
      '#### Step 1: Authenticate\n- **Input shape:** `{ email: string, password: string }`\n- **Logic excerpt:** `validateCredentials(input)`\n- **Output shape:** `{ token: string }`',
      '#### Step 1: Authenticate\n- **Input shape:** `{ email: string }`\n- **Output shape:** `{ token: string }`',
    ),
    { installationMode: 'embedded' },
  )

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (item) => item.code === 'primer.major_flow_logic_missing',
    ),
  )
})

test('target repository primer validator rejects empty external field values', () => {
  const result = validate(
    VALID_EXTERNAL_PRIMER.replace(
      '- **Startup:** `npm run dev`',
      '- **Startup:**',
    )
      .replace(
        '- **Logic excerpt:** `validateCredentials(input)`',
        '- **Logic excerpt:**',
      )
      .replace(
        '- **Output shape:** `{ token: string }`',
        '- **Output shape:**',
      ),
    { installationMode: 'embedded' },
  )

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some((item) => item.code === 'primer.frontend_startup_empty'),
  )
  assert.ok(
    result.issues.some((item) => item.code === 'primer.major_flow_logic_empty'),
  )
  assert.ok(
    result.issues.some(
      (item) => item.code === 'primer.major_flow_output_empty',
    ),
  )
})

test('target repository primer validator requires ordered flow step headings', () => {
  const result = validate(
    VALID_EXTERNAL_PRIMER.replace(
      '#### Step 1: Authenticate',
      '#### Authenticate',
    ),
    { installationMode: 'embedded' },
  )

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some((item) => item.code === 'primer.major_flow_step_order'),
  )
})

test('target repository primer validator rejects a named flow without steps', () => {
  const result = validate(
    VALID_EXTERNAL_PRIMER.replace(
      '### Login flow',
      '### Empty flow\n\nNo steps documented.\n\n### Login flow',
    ),
    { installationMode: 'embedded' },
  )

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (item) => item.code === 'primer.major_flow_steps_missing',
    ),
  )
})

test('self-development primer validation remains unchanged without external sections', () => {
  const result = validate(VALID_PRIMER)

  assert.equal(result.status, 'passed')
})
