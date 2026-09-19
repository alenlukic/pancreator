import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { gitHead, gitShowFile } from '../../src/lib/git.js'
import { validateRepository } from '../../src/lib/validation.js'
import {
  PRIMER_BODY_FRESHNESS_LIMIT,
  targetRepoPrimerFreshness,
  validateTargetRepoPrimer,
} from '../../src/lib/validators/target-repo-primer.js'
import { createFixture, fixtureGit } from '../fixture-template.js'

interface ValidateOptions {
  installationMode?: 'embedded' | 'detached'
}

let variantCounter = 0

function fixtureRoot(options?: ValidateOptions): string {
  const root = createFixture()

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

  return root
}

function validateIn(root: string, content: string) {
  variantCounter += 1
  const targetPath = `docs/target-repo-primer-${variantCounter}.md`

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

test('target repository primer validator requires commands and Mermaid architecture', () => {
  const root = fixtureRoot()
  const complete = validateIn(root, VALID_PRIMER)

  assert.equal(complete.status, 'passed')
  assert.deepEqual(complete.issues, [])

  const result = validateIn(
    root,
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

  const bootstrap = validateIn(
    root,
    VALID_PRIMER.replace(
      'pancreator-primer-status: ready',
      'pancreator-primer-status: unbuilt',
    ),
  )

  assert.equal(bootstrap.status, 'failed')
  assert.ok(
    bootstrap.issues.some((item) => item.code === 'primer.status_not_ready'),
  )
})

test('target repository primer validator accepts external frontend and flow sections', () => {
  const root = fixtureRoot({ installationMode: 'embedded' })
  const result = validateIn(root, VALID_EXTERNAL_PRIMER)

  assert.equal(result.status, 'passed')
  assert.deepEqual(result.issues, [])

  const withState = validateIn(
    root,
    VALID_EXTERNAL_PRIMER.replace(
      '- **Route/state:** `/dashboard`',
      '- **State:** authenticated dashboard',
    ),
  )

  assert.equal(withState.status, 'passed')
  assert.deepEqual(withState.issues, [])

  const notApplicable = validateIn(
    root,
    VALID_EXTERNAL_PRIMER.replace(
      EXTERNAL_SECTIONS,
      `

## Frontend visual inspection

Not applicable — no client/frontend detected.

## Major workflows and data flows

None identified.
`,
    ),
  )

  assert.equal(notApplicable.status, 'passed')
})

test('target repository primer validator rejects malformed external flow steps', () => {
  const root = fixtureRoot({ installationMode: 'embedded' })
  const result = validateIn(
    root,
    VALID_EXTERNAL_PRIMER.replace(
      '#### Step 1: Authenticate\n- **Input shape:** `{ email: string, password: string }`\n- **Logic excerpt:** `validateCredentials(input)`\n- **Output shape:** `{ token: string }`',
      '#### Step 1: Authenticate\n- **Input shape:** `{ email: string }`\n- **Output shape:** `{ token: string }`',
    ),
  )

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (item) => item.code === 'primer.major_flow_logic_missing',
    ),
  )

  const emptyValues = validateIn(
    root,
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
  )

  assert.equal(emptyValues.status, 'failed')
  assert.ok(
    emptyValues.issues.some(
      (item) => item.code === 'primer.frontend_startup_empty',
    ),
  )
  assert.ok(
    emptyValues.issues.some(
      (item) => item.code === 'primer.major_flow_logic_empty',
    ),
  )
  assert.ok(
    emptyValues.issues.some(
      (item) => item.code === 'primer.major_flow_output_empty',
    ),
  )

  const unordered = validateIn(
    root,
    VALID_EXTERNAL_PRIMER.replace(
      '#### Step 1: Authenticate',
      '#### Authenticate',
    ),
  )

  assert.equal(unordered.status, 'failed')
  assert.ok(
    unordered.issues.some(
      (item) => item.code === 'primer.major_flow_step_order',
    ),
  )

  const stepless = validateIn(
    root,
    VALID_EXTERNAL_PRIMER.replace(
      '### Login flow',
      '### Empty flow\n\nNo steps documented.\n\n### Login flow',
    ),
  )

  assert.equal(stepless.status, 'failed')
  assert.ok(
    stepless.issues.some(
      (item) => item.code === 'primer.major_flow_steps_missing',
    ),
  )
})

test('primer version matches VERSION at its stamped source commit', () => {
  const root = fixtureRoot()
  const head = gitHead(root)

  assert.ok(head)

  const version = gitShowFile(root, head, 'VERSION')?.trim()

  assert.ok(version)

  const stamped = VALID_PRIMER.replace(
    'source-head: 0123456789abcdef',
    `source-head: ${head}`,
  ).replace(
    'A small service with a command-line interface.',
    `A small service at version \`${version}\` with a command-line interface.`,
  )
  const passing = validateIn(root, stamped)

  assert.equal(passing.status, 'passed')

  const mismatch = validateIn(
    root,
    stamped.replace(`version \`${version}\``, 'version `0.0.0`'),
  )

  assert.equal(mismatch.status, 'failed')
  assert.ok(
    mismatch.issues.some((item) => item.code === 'primer.version_mismatch'),
  )
})

function primerPath(root: string): string {
  return path.join(root, 'docs', 'target-repo-primer.md')
}

function restamp(root: string, sourceHead: string, generatedAt: string): void {
  const content = readFileSync(primerPath(root), 'utf8')
    .replace(
      /<!-- source-head: [^>]*-->/u,
      `<!-- source-head: ${sourceHead} -->`,
    )
    .replace(
      /<!-- generated-at: [^>]*-->/u,
      `<!-- generated-at: ${generatedAt} -->`,
    )

  writeFileSync(primerPath(root), content)
}

test('primer drift reaches validation and doctor through the shared report', () => {
  const root = fixtureRoot()
  const freshness = targetRepoPrimerFreshness(root)

  assert.equal(freshness.drifted, true)
  assert.match(freshness.message ?? '', /source-head .* current HEAD/u)

  const validation = validateRepository(root)

  assert.equal(validation.target_repo_primer?.drifted, true)
  assert.ok(
    validation.warnings.some((warning) =>
      warning.includes('target repository primer drift'),
    ),
  )
})

test('primer drift reaches doctor in a target installation', () => {
  const root = fixtureRoot({ installationMode: 'detached' })
  const target = path.join(root, 'target')

  mkdirSync(target, { recursive: true })
  fixtureGit(['init', '-q', '-b', 'main'], { cwd: target, encoding: 'utf8' })
  writeFileSync(path.join(target, 'README.md'), 'target\n')
  fixtureGit(['add', '-A'], { cwd: target, encoding: 'utf8' })
  fixtureGit(['commit', '-qm', 'init'], { cwd: target, encoding: 'utf8' })

  const targetHead = gitHead(target)

  assert.ok(targetHead)
  restamp(root, '0'.repeat(40), '2026-01-01T00:00:00Z')

  const freshness = targetRepoPrimerFreshness(root)

  // The primer describes the deliverable workspace, so the comparison reads
  // that repository's head rather than the harness root's.
  assert.equal(freshness.current_head, targetHead)
  assert.equal(freshness.drifted, true)

  const validation = validateRepository(root)

  // Doctor reports the drift through this shared object. The warning stays
  // self-development-only, so an installed harness still validates silently.
  assert.equal(validation.target_repo_primer?.drifted, true)
  assert.ok(
    !validation.warnings.some((warning) =>
      warning.includes('target repository primer'),
    ),
  )
})

test('an inconsistent primer stamp is reported, and its limit is stated', () => {
  const root = fixtureRoot()
  const head = gitHead(root)

  assert.ok(head)

  // The stamp names the current commit, so the drift check is satisfied,
  // but generated-at precedes that commit, so the two header fields cannot
  // describe one generation.
  restamp(root, head, '2020-01-01T00:00:00Z')

  const freshness = targetRepoPrimerFreshness(root)

  assert.equal(freshness.drifted, false)
  assert.equal(freshness.stamp_predates_source, true)
  assert.match(freshness.message ?? '', /stamp is inconsistent/u)

  // Moving the timestamp forward over the same body clears the signal, and
  // that is the boundary of what this check can see: the file carries no
  // evidence of its own body's age. The result says so rather than
  // reporting a clean stamp as a fresh body.
  restamp(root, head, new Date().toISOString())

  const restamped = targetRepoPrimerFreshness(root)

  assert.equal(restamped.stamp_predates_source, false)
  assert.equal(restamped.message, null)
  assert.equal(restamped.body_freshness, 'unverified')
  assert.match(PRIMER_BODY_FRESHNESS_LIMIT, /pan-build-docs/u)
})
