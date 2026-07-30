import path from 'node:path'

import { fileExists, isRecord, readJson } from './io.js'

/**
 * Standard install locations for a Chrome for Testing bundle.
 *
 * `BROWSER-001` requires MCP automation to drive this bundle rather than the
 * operator's personal browser. Pancreator installs neither the browser nor target
 * MCP configuration, so readiness is reported rather than assumed, and a stage
 * that owes a browser verdict reports environment-blocked when it is missing.
 */
const CHROME_FOR_TESTING_CANDIDATES = [
  '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  '/opt/chrome-for-testing/chrome',
  '/usr/local/bin/chrome-for-testing',
]

/** MCP config surfaces a Cursor session may read, in precedence order. */
const MCP_CONFIG_PATHS = ['.cursor/mcp.json', '.mcp.json']

export interface BrowserReadiness {
  /** Whether a browser verdict can be produced in this environment. */
  ready: boolean
  chrome_for_testing: { path: string | null; source: string }
  chrome_devtools_mcp: {
    configured: boolean
    config_path: string | null
    isolated: boolean
    executable_path: string | null
  }
  playwright_mcp_fallback: boolean
  advisories: string[]
}

function resolveChromeForTesting(): { path: string | null; source: string } {
  const configured = process.env.PANCREATOR_CHROME_FOR_TESTING

  if (configured && fileExists(configured)) {
    return { path: configured, source: 'PANCREATOR_CHROME_FOR_TESTING' }
  }

  for (const candidate of CHROME_FOR_TESTING_CANDIDATES) {
    if (fileExists(candidate)) {
      return { path: candidate, source: 'standard install location' }
    }
  }

  return { path: null, source: 'not found' }
}

function readMcpServers(
  root: string,
): { configPath: string; servers: Record<string, unknown> } | null {
  for (const relative of MCP_CONFIG_PATHS) {
    const absolute = path.join(root, relative)

    if (!fileExists(absolute)) {
      continue
    }

    try {
      const value = readJson(absolute)

      if (isRecord(value) && isRecord(value.mcpServers)) {
        return { configPath: relative, servers: value.mcpServers }
      }
    } catch {
      // A malformed MCP config is the operator's to fix; treat it as absent.
    }
  }

  return null
}

function serverArguments(server: unknown): string[] {
  if (!isRecord(server) || !Array.isArray(server.args)) {
    return []
  }

  return server.args.filter((arg): arg is string => typeof arg === 'string')
}

/**
 * Report whether this environment can satisfy `BROWSER-001`.
 *
 * `searchRoots` covers the harness checkout and, for a target installation, the
 * workspace that owns its own `.cursor/mcp.json`.
 */
export function browserReadiness(searchRoots: string[]): BrowserReadiness {
  const chrome = resolveChromeForTesting()
  const advisories: string[] = []
  let located: { configPath: string; servers: Record<string, unknown> } | null =
    null
  let locatedRoot = ''

  for (const root of searchRoots) {
    const found = readMcpServers(root)

    if (found) {
      located = found
      locatedRoot = root
      break
    }
  }

  const chromeDevtools = located?.servers['chrome-devtools']
  const args = serverArguments(chromeDevtools)
  const executableArgument = args.find((arg) =>
    arg.startsWith('--executablePath'),
  )
  const readiness: BrowserReadiness = {
    ready: chrome.path !== null && chromeDevtools !== undefined,
    chrome_for_testing: chrome,
    chrome_devtools_mcp: {
      configured: chromeDevtools !== undefined,
      config_path: located ? path.join(locatedRoot, located.configPath) : null,
      isolated: args.includes('--isolated'),
      executable_path: executableArgument
        ? (executableArgument.split('=')[1] ?? null)
        : null,
    },
    playwright_mcp_fallback: located?.servers.playwright !== undefined,
    advisories,
  }

  if (!chrome.path) {
    advisories.push(
      'Chrome for Testing was not found. Install it and set ' +
        'PANCREATOR_CHROME_FOR_TESTING or the chrome-devtools --executablePath ' +
        'argument; BROWSER-001 blocks browser verdicts until then.',
    )
  }

  if (!readiness.chrome_devtools_mcp.configured) {
    advisories.push(
      'No chrome-devtools MCP server is configured in .cursor/mcp.json or ' +
        '.mcp.json. Browser inspection cases MUST be reported as ' +
        'environment-blocked.',
    )
  } else if (!readiness.chrome_devtools_mcp.isolated) {
    advisories.push(
      'The chrome-devtools MCP server does not pass --isolated. BROWSER-001 ' +
        'requires a unique isolated context.',
    )
  }

  if (
    readiness.chrome_devtools_mcp.configured &&
    !readiness.chrome_devtools_mcp.executable_path &&
    chrome.path
  ) {
    advisories.push(
      `Chrome for Testing is installed at ${chrome.path} but the ` +
        'chrome-devtools MCP server does not pass --executablePath, so ' +
        'automation may fall back to the personal browser identity.',
    )
  }

  return readiness
}
