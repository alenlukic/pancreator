/**
 * Thin entry point for the platform-guidance VS Code and Copilot CLI hook.
 *
 * Imported by `bin/pan-hook-platform-guidance` through `bin/pan-hook-adapter`.
 * Reads the Cursor-shaped payload from stdin and writes one JSON response to
 * stdout. A sighting runs `pan redline observe`, because a hook never writes
 * run state itself. Fails open.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import {
  resolvePlatformGuidanceHook,
  type PlatformGuidanceHookEvent,
  type SightingRequest,
} from './lib/governance/platform-guidance-hook.js'
import { findProjectRoot } from './lib/io.js'

const EVENTS: readonly PlatformGuidanceHookEvent[] = ['postToolUse', 'stop']
const pan = process.env.PAN_HOOK_PAN ?? 'bin/pan'

function observe(request: SightingRequest): void {
  spawnSync(
    pan,
    [
      'redline',
      'observe',
      '--host',
      request.host,
      '--guidance-id',
      request.guidanceId,
      ...(request.evidence ? ['--evidence', request.evidence] : []),
      ...(request.sessionId ? ['--session-id', request.sessionId] : []),
    ],
    { stdio: 'ignore', timeout: 8000 },
  )
}

const event = process.argv[2]
let response = {}

if (EVENTS.includes(event as PlatformGuidanceHookEvent)) {
  try {
    let root: string | null = null

    try {
      root = findProjectRoot()
    } catch {
      root = null
    }

    response = resolvePlatformGuidanceHook(
      event as PlatformGuidanceHookEvent,
      readFileSync(0, 'utf8'),
      root,
      { pan, observe },
    )
  } catch {
    response = {}
  }
}

process.stdout.write(`${JSON.stringify(response)}\n`)
