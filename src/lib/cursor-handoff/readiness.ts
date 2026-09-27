/**
 * Readiness block for `pan doctor`. Reports the cursor_handoff advisory
 * without compiling the helper, failing doctor, or changing state.
 *
 * Per architecture: this block MUST NOT change doctor `ok`. It is purely
 * advisory.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'

import { helperPreflight, type HelperPreflightResult } from './helper.js'

export interface CursorHandoffReadiness {
  platform_supported: boolean
  swiftc_path: string | null
  helper: HelperPreflightResult
  /** Whether Cursor is running (non-null pid). */
  cursor_running: boolean
  /** Whether the Cursor Agents window is present (null when not checked). */
  agents_window_present: boolean | null
  /** Whether the process holds the Accessibility permission. */
  accessibility_trusted: boolean | null
  advisories: string[]
}

const CURSOR_EXECUTABLE = /(?:^|\/)Cursor\.app\/Contents\/MacOS\/Cursor$/mu

/** Whether `ps -axo comm=` output lists the Cursor application executable. */
export function cursorProcessListed(psOutput: string): boolean {
  return CURSOR_EXECUTABLE.test(psOutput)
}

/**
 * Run the advisory readiness check for `pan doctor`. Never compiles the
 * helper. Never changes run state.
 */
export function cursorHandoffReadiness(
  root: string,
  options: { platform?: string } = {},
): CursorHandoffReadiness {
  const advisories: string[] = []
  const helper = helperPreflight(root, options)

  if (!helper.platform_supported) {
    advisories.push(
      'pan handoff is supported on macOS only. Accessibility and Cursor checks are skipped.',
    )
    return {
      platform_supported: false,
      swiftc_path: null,
      helper,
      cursor_running: false,
      agents_window_present: null,
      accessibility_trusted: null,
      advisories,
    }
  }

  if (!helper.binary_built) {
    if (helper.swiftc_path === null) {
      advisories.push(
        'No compiled helper and no swiftc. Install Xcode Command Line Tools ' +
          'to allow pan handoff to compile on first use.',
      )
    } else {
      advisories.push(
        'Helper not yet compiled. The first `pan handoff` call will compile it with swiftc.',
      )
    }
  }

  // Check Cursor running by looking at running applications
  let cursorRunning = false
  let agentsWindowPresent: boolean | null = null
  let accessibilityTrusted: boolean | null = null

  // Use the helper's preflight if it is already compiled
  if (helper.binary_built && helper.binary_path !== null) {
    const binaryPath = path.join(root, helper.binary_path)
    const result = spawnSync(binaryPath, ['--preflight'], {
      encoding: 'utf8',
      timeout: 5_000,
    })

    if (result.status === 0 && result.stdout.trim().length > 0) {
      try {
        const data = JSON.parse(result.stdout.trim()) as Record<string, unknown>
        if (typeof data.cursor_pid === 'number') {
          cursorRunning = true
        }
        if (typeof data.agents_window_present === 'boolean') {
          agentsWindowPresent = data.agents_window_present
        }
        if (typeof data.accessibility_trusted === 'boolean') {
          accessibilityTrusted = data.accessibility_trusted
        }
      } catch {
        // Malformed preflight reply — advisory only
        advisories.push(
          'Helper preflight returned a malformed reply. ' +
            'Run `pan handoff --self-check` for details.',
        )
      }
    }
  } else {
    // No compiled helper: list process executables. macOS reports the full
    // bundle path, so `pgrep -x Cursor` never matches the running app.
    const ps = spawnSync('ps', ['-axo', 'comm='], {
      encoding: 'utf8',
      timeout: 3_000,
      maxBuffer: 4 * 1024 * 1024,
    })
    cursorRunning = ps.status === 0 && cursorProcessListed(ps.stdout)
  }

  if (!cursorRunning) {
    advisories.push(
      'Cursor is not running. Start Cursor for pan handoff to work.',
    )
  } else if (agentsWindowPresent === false) {
    advisories.push(
      'No Cursor Agents window found. Open a Cursor Agents panel before running pan handoff.',
    )
  }

  if (accessibilityTrusted === false) {
    advisories.push(
      'The running process does not hold the Accessibility permission. ' +
        'Grant it in System Settings → Privacy & Security → Accessibility.',
    )
  }

  return {
    platform_supported: true,
    swiftc_path: helper.swiftc_path,
    helper,
    cursor_running: cursorRunning,
    agents_window_present: agentsWindowPresent,
    accessibility_trusted: accessibilityTrusted,
    advisories,
  }
}
