import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { browserReadiness } from '../../src/lib/browser-readiness.js'

function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'pancreator-browser-'))
}

function writeBrowser(root: string): string {
  const browser = path.join(root, 'chrome-for-testing')

  writeFileSync(browser, '#!/bin/sh\n')
  return browser
}

function writeMcp(root: string, relative: string, value: unknown): void {
  const target = path.join(root, relative)

  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`)
}

function chromeDevtoolsConfig(args: string[]): unknown {
  return {
    mcpServers: {
      'chrome-devtools': { command: 'npx', args },
      playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
    },
  }
}

test('missing MCP configuration is reported as not ready', () => {
  const root = makeRoot()
  const browser = writeBrowser(root)
  const readiness = browserReadiness([root], {
    chrome_for_testing: { path: browser, source: 'test' },
  })

  assert.equal(readiness.ready, false)
  assert.equal(readiness.chrome_devtools_mcp.configured, false)
  assert.equal(readiness.chrome_devtools_mcp.config_path, null)
  assert.ok(
    readiness.advisories.some((advisory) =>
      advisory.includes('environment-blocked'),
    ),
  )
})

test('a chrome-devtools server without --isolated is advised', () => {
  const root = makeRoot()
  const browser = writeBrowser(root)

  writeMcp(
    root,
    '.cursor/mcp.json',
    chromeDevtoolsConfig(['chrome-devtools-mcp@latest']),
  )

  const readiness = browserReadiness([root], {
    chrome_for_testing: { path: browser, source: 'test' },
  })

  assert.equal(readiness.ready, false)
  assert.equal(readiness.chrome_devtools_mcp.configured, true)
  assert.equal(readiness.chrome_devtools_mcp.isolated, false)
  assert.equal(readiness.playwright_mcp_fallback, true)
  assert.ok(
    readiness.advisories.some((advisory) => advisory.includes('--isolated')),
  )
})

test('partial browser configuration does not satisfy readiness', () => {
  const root = makeRoot()
  const browser = writeBrowser(root)

  writeMcp(
    root,
    '.cursor/mcp.json',
    chromeDevtoolsConfig(['chrome-devtools-mcp@latest', '--isolated']),
  )

  const readiness = browserReadiness([root], {
    chrome_for_testing: { path: browser, source: 'test' },
  })

  assert.equal(readiness.ready, false)
  assert.ok(
    readiness.advisories.some((advisory) =>
      advisory.includes('does not pass that full --executablePath'),
    ),
  )
})

test('a target-owned .mcp.json is discovered when .cursor/mcp.json is absent', () => {
  const root = makeRoot()

  writeMcp(
    root,
    '.mcp.json',
    chromeDevtoolsConfig(['chrome-devtools-mcp@latest', '--isolated']),
  )

  const readiness = browserReadiness([root])

  assert.equal(readiness.chrome_devtools_mcp.configured, true)
  assert.equal(readiness.chrome_devtools_mcp.isolated, true)
  assert.match(readiness.chrome_devtools_mcp.config_path ?? '', /\.mcp\.json$/u)
})

test('a configured Chrome for Testing bundle satisfies readiness', () => {
  const root = makeRoot()
  const browser = writeBrowser(root)

  writeMcp(
    root,
    '.cursor/mcp.json',
    chromeDevtoolsConfig([
      'chrome-devtools-mcp@latest',
      `--executablePath=${browser}`,
      '--isolated',
    ]),
  )

  const previous = process.env.PANCREATOR_CHROME_FOR_TESTING

  process.env.PANCREATOR_CHROME_FOR_TESTING = browser

  try {
    const readiness = browserReadiness([root])

    assert.equal(readiness.ready, true)
    assert.equal(readiness.chrome_for_testing.path, browser)
    assert.equal(readiness.chrome_devtools_mcp.executable_path, browser)
    assert.deepEqual(readiness.advisories, [])
  } finally {
    if (previous === undefined) {
      delete process.env.PANCREATOR_CHROME_FOR_TESTING
    } else {
      process.env.PANCREATOR_CHROME_FOR_TESTING = previous
    }
  }
})

test('a malformed MCP config is treated as absent rather than throwing', () => {
  const root = makeRoot()

  mkdirSync(path.join(root, '.cursor'), { recursive: true })
  writeFileSync(path.join(root, '.cursor', 'mcp.json'), '{ not json')

  const readiness = browserReadiness([root])

  assert.equal(readiness.chrome_devtools_mcp.configured, false)
})
