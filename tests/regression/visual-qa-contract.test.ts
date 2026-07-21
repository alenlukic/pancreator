import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const REPO_ROOT = process.cwd()

const PERSONA_SURFACES = [
  'library/personas/qa-tester.md',
  'library/personas/design-qa.md',
] as const

const AGENT_SURFACES = [
  'library/cursor/agents/qa-tester.md',
  'library/cursor/agents/design-qa.md',
] as const

const PROMPT_SURFACES = [
  'library/workflows/dev/prompts/test.md',
  'library/workflows/design/prompts/test.md',
] as const

const ISOLATION_TOKENS = [
  'chrome-devtools',
  'new_page',
  'unique isolated context',
  'close_page',
  'including on failure',
  'isolated',
  'personal browser',
  'Launch Services',
  'default browser',
  'Chrome preferences',
  'kill',
  'MCP Chrome',
] as const

function readSurface(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
}

function assertTokens(surfacePath: string, tokens: readonly string[]): void {
  const content = readSurface(surfacePath)
    .toLowerCase()
    .replaceAll(/\s+/gu, ' ')

  for (const token of tokens) {
    assert.match(
      content,
      new RegExp(token.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'iu'),
      `${surfacePath} must include ${token}`,
    )
  }
}

for (const surface of [
  ...PERSONA_SURFACES,
  ...AGENT_SURFACES,
  ...PROMPT_SURFACES,
]) {
  test(`visual QA isolation contract tokens are present in ${surface}`, () => {
    assertTokens(surface, ISOLATION_TOKENS)
  })
}

test('visual QA isolation rule template encodes host-safety procedure', () => {
  const rulePath = 'library/cursor/rules/visual-qa-isolation.mdc'
  const content = readSurface(rulePath)

  assert.match(content, /alwaysApply:\s*true/u)
  assertTokens(rulePath, [
    ...ISOLATION_TOKENS,
    'com.google.chrome',
    'executablepath',
  ])
})

test('operator guide documents Chrome for Testing hardening', () => {
  assertTokens('docs/operator-guide.md', [
    'chrome for testing',
    '--executablepath',
    '--isolated',
    'com.google.chrome',
  ])
})

test('qa-tester persona and dev test prompt classify intermittent full-suite timeouts', () => {
  const taxonomy = 'harness-owned evidence'

  for (const surface of [
    'library/personas/qa-tester.md',
    'library/workflows/dev/prompts/test.md',
  ]) {
    const content = readSurface(surface).toLowerCase()

    assert.match(content, /intermittent/u)
    assert.match(content, /full-suite/u)
    assert.match(content, /harness\/test/u)
    assert.match(content, new RegExp(taxonomy, 'u'))
  }
})

test('library/cursor/mcp.json declares chrome-devtools with --isolated', () => {
  const mcp = JSON.parse(readSurface('library/cursor/mcp.json')) as {
    mcpServers: Record<string, { command: string; args: string[] }>
  }

  const chromeDevtools = mcp.mcpServers['chrome-devtools']

  assert.ok(chromeDevtools)
  assert.equal(chromeDevtools.command, 'npx')
  assert.ok(chromeDevtools.args.includes('chrome-devtools-mcp@latest'))
  assert.ok(chromeDevtools.args.includes('--isolated'))
  assert.ok(mcp.mcpServers.playwright)
})

test('projection manifest declares visual QA rule for both installation modes', () => {
  const manifest = JSON.parse(
    readSurface('governance/registries/projection_manifest.json'),
  ) as {
    projections: Array<{
      id: string
      source: string
      target: string
      installation_modes: string[]
    }>
  }

  const rule = manifest.projections.find(
    (projection) => projection.id === 'cursor-visual-qa-rule',
  )

  assert.ok(rule)
  assert.equal(rule.source, 'library/cursor/rules/visual-qa-isolation.mdc')
  assert.equal(rule.target, '.cursor/rules/visual-qa-isolation.mdc')
  assert.deepEqual(rule.installation_modes, ['self_development', 'embedded'])
})

test('ux guide presents playwright only as explicit fallback', () => {
  const content = readSurface('governance/handbooks/design/ux-guide.md')

  assert.match(content, /chrome-devtools/iu)
  assert.match(content, /explicit fallback/iu)
})
