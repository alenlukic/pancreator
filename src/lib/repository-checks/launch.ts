import { createHash, randomBytes } from 'node:crypto'
import { PanError } from '../errors.js'
import { isRecord, readJson, resolveInside, writeJsonAtomic } from '../io.js'
import { prefetchRecordPaths } from '../run-layout.js'

/** Who started a recorded profile execution. */
export type RepositoryCheckInitiator = 'agent' | 'harness'

/**
 * Environment variable carrying the launch token the harness hands the
 * release-profile prefetch child it starts for itself.
 */
export const HARNESS_LAUNCH_TOKEN_ENV = 'PAN_HARNESS_LAUNCH_TOKEN'

/** A fresh launch token and the digest a harness launch record carries. */
export function newHarnessLaunchToken(): { token: string; digest: string } {
  const token = randomBytes(32).toString('hex')

  return { token, digest: harnessLaunchDigest(token) }
}

/** Digest a harness launch record carries in place of the token itself. */
export function harnessLaunchDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Who started this execution, decided from process provenance.
 *
 * Authority cannot come from argv. `--harness-initiated` declares the claim,
 * but a caller that grades its own permission is not a permission check: a
 * verify worker could otherwise label its own `full` execution as
 * harness-owned and the ship release gate would accept the pass that worker
 * was forbidden to produce. The harness hands its prefetch child a launch
 * token and records only the token's digest, so the value the claim needs
 * never reaches a file an agent can read. An undeclared execution is an
 * agent's, and a declared one without the token is refused rather than
 * quietly downgraded, because the attempt is worth seeing.
 */
export function resolveRepositoryCheckInitiator(
  root: string,
  runId: string | null,
  declaredHarnessInitiated: boolean,
): RepositoryCheckInitiator {
  const token = process.env[HARNESS_LAUNCH_TOKEN_ENV]

  // A profile spawns a whole toolchain. A token left in the environment would
  // hand the same authority to every one of those children.
  delete process.env[HARNESS_LAUNCH_TOKEN_ENV]

  if (!declaredHarnessInitiated) {
    return 'agent'
  }

  if (
    token !== undefined &&
    token.length > 0 &&
    runId !== null &&
    consumeHarnessLaunch(root, runId, harnessLaunchDigest(token))
  ) {
    return 'harness'
  }

  throw new PanError(
    `--harness-initiated names an execution the harness started for itself. ` +
      `This process carries no harness launch token, so the claim is ` +
      `refused: an agent execution cannot record a pass the ship release ` +
      `gate would accept (VERIFY-001).`,
    { code: 'HARNESS_INITIATION_UNVERIFIED' },
  )
}

/**
 * Spend a run's harness launch record for this token digest.
 *
 * The token is single use. A launch authorizes the one child the harness
 * started, and that child resolves its initiator in its first milliseconds,
 * so the digest is spent before the profile it authorizes begins. The window
 * in which the token is both live and readable from the running child's
 * environment, which a same-user process can do, is therefore the child's
 * startup rather than the minutes its profile runs.
 */
function consumeHarnessLaunch(
  root: string,
  runId: string,
  digest: string,
): boolean {
  for (const relative of prefetchRecordPaths(root, runId)) {
    const absolute = resolveInside(root, relative)
    const record = readJson(absolute)

    if (!isRecord(record) || record.launch_digest !== digest) {
      continue
    }

    const { launch_digest: _spent, ...spent } = record

    writeJsonAtomic(absolute, {
      ...spent,
      launch_consumed_at: new Date().toISOString(),
    })

    return true
  }

  return false
}

/** Refuse a worker from taking over the harness-owned ship release gate. */
export function assertRepositoryCheckProfileAllowed(
  profileName: string,
  stageSlug: string | null,
  initiator: RepositoryCheckInitiator,
): void {
  if (
    initiator === 'agent' &&
    stageSlug === 'verify' &&
    profileName === 'full'
  ) {
    throw new PanError(
      `VERIFY-001 forbids a verify-stage evidence worker or verifier from ` +
        `running the 'full' profile. The harness-owned ship release gate ` +
        `runs that profile when the run enters ship. What is refused is an ` +
        `execution recorded against a run at verify: an operator who wants ` +
        `the profile for its own sake runs it outside this run's workspace, ` +
        `where it records no pass any gate can reuse.`,
      { code: 'REPOSITORY_CHECK_PROFILE_FORBIDDEN' },
    )
  }
}
