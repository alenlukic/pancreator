/**
 * Fixture cost profiling for tune harness benchmark pass.
 *
 * When `PAN_TEST_PROFILE` names an absolute path, template-build and clone
 * events accumulate in memory and flush to one sidecar file at process exit.
 * The sidecar lands in the runner's scratch tree rather than beside the
 * profile target, which a gate places inside a run's evidence directory.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  fixtureSidecarPath,
  TEST_PROFILE_ENV,
} from '../../src/lib/suite-profile-env.js'

export { fixtureSidecarPath }

export interface FixtureEvent {
  kind: 'template_build' | 'template_clone' | 'run_prepare'
  lane: 'main' | 'secondary'
  duration_ms: number
  recorded_at: string
  template_bytes?: number
  template_files?: number
}

const events: FixtureEvent[] = []

function profilingActive(): boolean {
  const target = process.env[TEST_PROFILE_ENV]?.trim()

  return Boolean(target && path.isAbsolute(target))
}

/**
 * The lane of the test file this process runs, which owns every cost it pays.
 *
 * The runner gives each test file its own process, so the lane is a property
 * of the process rather than of the helper a test reached for. Reading it here
 * keeps a shared helper from attributing a secondary-lane clone to the main
 * lane.
 */
function currentLane(): FixtureEvent['lane'] {
  return process.argv.some((argument) => argument.includes('/tests/secondary/'))
    ? 'secondary'
    : 'main'
}

export function recordFixtureEvent(
  kind: FixtureEvent['kind'],
  durationMs: number,
  templateMeasurement?: { bytes: number; files: number },
): void {
  if (!profilingActive()) {
    return
  }

  events.push({
    kind,
    lane: currentLane(),
    duration_ms: Math.round(durationMs * 1000) / 1000,
    recorded_at: new Date().toISOString(),
    ...(templateMeasurement
      ? {
          template_bytes: templateMeasurement.bytes,
          template_files: templateMeasurement.files,
        }
      : {}),
  })
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
