/**
 * The names the harness and the test reporters must agree on.
 *
 * This lives apart from `suite-profile.ts` because the reporters run inside
 * every test process. Reading the name from that module put its imports,
 * and so the run layout, into the import closure of the fixture helpers,
 * which selected fixture-only tests for changes they cannot observe.
 */
import { createHash } from 'node:crypto'
import path from 'node:path'

import { testScratchRoot } from './test-scratch.js'

/** Environment variable the reporters read for their profile target. */
export const TEST_PROFILE_ENV = 'PAN_TEST_PROFILE'

/** Per-run scratch directory `bin/run-tests` owns and removes. */
export const TEST_SCRATCH_ENV = 'PANCREATOR_TEST_TMP'

/** Per-checkout file-duration record written after every test run. */
export const TEST_FILE_DURATIONS_ENV = 'PAN_TEST_FILE_DURATIONS'

const FIXTURE_SIDECAR_DIRECTORY = 'fixture-profile'

/**
 * The durable duration record used to order the next run's test files, or
 * `null` when this process does not own it.
 *
 * Only a run `bin/run-tests` scheduled owns the record, and that wrapper
 * always exports an absolute target. Resolving a default from the working
 * directory instead let any bare `node --test` from the repository root
 * silently replace the scheduler's input with a record naming one file.
 */
export function fileDurationRecordPath(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const configured = environment[TEST_FILE_DURATIONS_ENV]?.trim()

  return configured && path.isAbsolute(configured) ? configured : null
}

/**
 * Directory the transient fixture sidecars of one profile run live in.
 *
 * The sidecars used to derive their path from the profile target so the merge
 * could find them. A gate sets that target inside a run's evidence directory,
 * which put transient files where a watch and an evidence audit read durable
 * records. They now live in the runner's scratch tree, and only the merged
 * profile reaches the target.
 */
export function fixtureSidecarDirectory(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const scratch = environment[TEST_SCRATCH_ENV]?.trim()

  if (scratch && path.isAbsolute(scratch)) {
    return path.join(scratch, FIXTURE_SIDECAR_DIRECTORY)
  }

  return path.join(testScratchRoot(process.cwd()), FIXTURE_SIDECAR_DIRECTORY)
}

/** Filename prefix every sidecar of one profile target shares. */
export function fixtureSidecarPrefix(profileTarget: string): string {
  return createHash('sha256').update(profileTarget).digest('hex').slice(0, 16)
}

/** Scratch path one process writes its fixture events to. */
export function fixtureSidecarPath(
  profileTarget: string,
  processId = process.pid,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(
    fixtureSidecarDirectory(environment),
    `${fixtureSidecarPrefix(profileTarget)}.${processId}.json`,
  )
}
