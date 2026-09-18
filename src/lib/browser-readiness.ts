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

/**
 * A shared Chrome for Testing instance exposes its DevTools port on loopback
 * only. `BROWSER-001` requires every server to attach to that one instance
 * rather than launch its own, so a remote or non-loopback URL is not ready.
 */
const LOOPBACK_BROWSER_URL =
  /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\/?$/u

export interface BrowserReadiness {
  /** Whether a browser verdict can be produced in this environment. */
  ready: boolean
  chrome_for_testing: { path: string | null; source: string }
  chrome_devtools_mcp: {
    configured: boolean
    config_path: string | null
    isolated: boolean
    executable_path: string | null
    /** `--browserUrl` of the shared instance the server attaches to. */
    browser_url: string | null
  }
  playwright_mcp_fallback: boolean
  advisories: string[]
}

export interface BrowserReadinessOptions {
  chrome_for_testing?: { path: string | null; source: string }
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

/** Read `--flag=value` or `--flag value` from a server argument list. */
function argumentValue(args: string[], flag: string): string | null {
  const index = args.findIndex(
    (arg) => arg === flag || arg.startsWith(`${flag}=`),
  )

  if (index === -1) {
    return null
  }

  const inline = args[index]

  if (inline !== undefined && inline.includes('=')) {
    return inline.slice(inline.indexOf('=') + 1) || null
  }

  return args[index + 1] ?? null
}

/**
 * Report whether this environment can satisfy `BROWSER-001`.
 *
 * `searchRoots` covers the harness checkout and, for a target installation, the
 * workspace that owns its own `.cursor/mcp.json`.
 */
export function browserReadiness(
  searchRoots: string[],
  options: BrowserReadinessOptions = {},
): BrowserReadiness {
  const chrome = options.chrome_for_testing ?? resolveChromeForTesting()
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
  const executablePath = argumentValue(args, '--executablePath')
  const browserUrl = argumentValue(args, '--browserUrl')
  const chromeDevtoolsConfigured = chromeDevtools !== undefined
  const chromeDevtoolsIsolated = args.includes('--isolated')
  // Attached mode: the server joins the one shared Chrome for Testing instance
  // instead of launching a browser, so --executablePath and --isolated do not
  // apply. Readiness is judged from configuration; the running instance is
  // not probed here because this report is synchronous.
  const attachesToSharedInstance =
    browserUrl !== null && LOOPBACK_BROWSER_URL.test(browserUrl)
  const launchesIsolatedBundle =
    chromeDevtoolsIsolated && executablePath === chrome.path
  const readiness: BrowserReadiness = {
    ready:
      chrome.path !== null &&
      chromeDevtoolsConfigured &&
      (attachesToSharedInstance || launchesIsolatedBundle),
    chrome_for_testing: chrome,
    chrome_devtools_mcp: {
      configured: chromeDevtoolsConfigured,
      config_path: located ? path.join(locatedRoot, located.configPath) : null,
      isolated: chromeDevtoolsIsolated,
      executable_path: executablePath,
      browser_url: browserUrl,
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

    return readiness
  }

  if (!readiness.chrome_devtools_mcp.configured) {
    advisories.push(
      'No chrome-devtools MCP server is configured in .cursor/mcp.json or ' +
        '.mcp.json. Browser inspection cases MUST be reported as ' +
        'environment-blocked.',
    )
  } else if (browserUrl !== null) {
    if (!attachesToSharedInstance) {
      advisories.push(
        `The chrome-devtools MCP server passes --browserUrl=${browserUrl}, ` +
          'which is not a loopback DevTools URL. BROWSER-001 requires attaching ' +
          'to the one shared Chrome for Testing instance on 127.0.0.1.',
      )
    }

    if (chromeDevtoolsIsolated || executablePath !== null) {
      advisories.push(
        'The chrome-devtools MCP server passes --browserUrl together with ' +
          '--isolated or --executablePath. Those launch flags are ignored when ' +
          'attaching; remove them so the server never launches its own browser.',
      )
    }

    return readiness
  } else if (!readiness.chrome_devtools_mcp.isolated) {
    advisories.push(
      'The chrome-devtools MCP server passes neither --browserUrl nor ' +
        '--isolated. BROWSER-001 requires attaching to the shared Chrome for ' +
        'Testing instance with --browserUrl=http://127.0.0.1:<port>.',
    )
  }

  if (
    readiness.chrome_devtools_mcp.configured &&
    readiness.chrome_devtools_mcp.executable_path !== chrome.path
  ) {
    advisories.push(
      `Chrome for Testing is installed at ${chrome.path} but the ` +
        'chrome-devtools MCP server does not pass that full --executablePath, ' +
        'so automation may fall back to the personal browser identity.',
    )
  }

  return readiness
}
