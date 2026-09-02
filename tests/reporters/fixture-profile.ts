/**
 * Fixture cost profiling for tune harness benchmark pass.
 *
 * When `PAN_TEST_PROFILE` names an absolute path, template-build and clone
 * events accumulate in memory and flush to one sidecar file at process exit.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { TEST_PROFILE_ENV } from '../../src/lib/suite-profile.js'

export const FIXTURE_SIDECAR_SUFFIX = '.fixture-profile'

export interface FixtureEvent {
  kind: 'template_build' | 'template_clone'
  lane: 'main' | 'secondary'
  duration_ms: number
  recorded_at: string
}

const events: FixtureEvent[] = []

function profilingActive(): boolean {
  const target = process.env[TEST_PROFILE_ENV]?.trim()

  return Boolean(target && path.isAbsolute(target))
}

export function recordFixtureEvent(
  kind: FixtureEvent['kind'],
  lane: FixtureEvent['lane'],
  durationMs: number,
): void {
  if (!profilingActive()) {
    return
  }

  events.push({
    kind,
    lane,
    duration_ms: Math.round(durationMs * 1000) / 1000,
    recorded_at: new Date().toISOString(),
  })
}

export function fixtureSidecarPath(
  profileTarget: string,
  processId = process.pid,
): string {
  return `${profileTarget}${FIXTURE_SIDECAR_SUFFIX}.${processId}.json`
}

export function flushFixtureSidecar(profileTarget: string): void {
  if (!profilingActive() || events.length === 0) {
    return
  }

  const target = fixtureSidecarPath(profileTarget)

  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(
    target,
    `${JSON.stringify({ schema_version: 1, events }, null, 2)}\n`,
  )
}

if (profilingActive()) {
  process.on('exit', () => {
    const target = process.env[TEST_PROFILE_ENV]?.trim()

    if (target) {
      flushFixtureSidecar(target)
    }
  })
}
