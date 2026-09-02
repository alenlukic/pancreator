import path from 'node:path'

import { invariant } from './errors.js'
import { fileExists, isRecord } from './io.js'
import { harnessConfigName, readHarnessConfig } from './project-config.js'
import { repositoryCheckProfileName } from './repository-checks.js'
import type { Criterion, ResolvedVerification } from './types.js'

const CONFIG_PATH = 'config.json'
const CONFIG_KEY = 'verification'

/** Level assumed when `config.json` declares no verification block at all. */
export const DEFAULT_VERIFICATION_LEVEL = 'light'

/** One named verification level: how thorough repository-check gating runs. */
export interface VerificationLevel {
  summary: string
  /**
   * Shell-criterion id → the repository-check profile that gate runs instead
   * of its workflow-declared profile, or `false` to skip the gate entirely.
   * A criterion the map does not name keeps its workflow-declared profile.
   */
  gates: Record<string, string | false>
}

export interface VerificationFile {
  active: string
  levels: Record<string, VerificationLevel>
}

/**
 * Built-in levels. Agents iterate on blast-radius tests and run the fast
 * profile once as validation; the harness owns every heavier execution. The
 * `full` profile runs only as a submission gate: once at verify on a passing
 * verdict, or once at remediate when the repair is ready to ship, after which
 * the returning verify gate accepts the recorded pass from the gate cache.
 * `full` is never baselined before implementation, so a pre-existing failure
 * fails the gate on its own result and needs an operator decision.
 */
export const BUILT_IN_VERIFICATION_LEVELS: Record<string, VerificationLevel> = {
  minimal: {
    summary:
      'Static and fast checks gate the implement and remediate loops; no ' +
      'submission gate runs the full profile. QA argues from manual cases ' +
      'and prior gate evidence.',
    gates: {
      'test.full_suite': false,
      'verify.full_suite': false,
      'remediate.full_suite': false,
    },
  },
  light: {
    summary:
      'Static and fast checks gate the implement loop. The verify ' +
      'submission gate runs the full profile once on a passing verdict, and ' +
      'the remediate submission gate runs it once when the repair is ready ' +
      'to ship; the returning verify gate accepts that recorded pass at an ' +
      'unchanged fingerprint. Agents run the fast profile at most once each ' +
      'as validation and never run full.',
    gates: {
      'test.full_suite': 'full',
      'verify.full_suite': 'full',
      'remediate.full_suite': 'full',
    },
  },
  thorough: {
    summary:
      'Alias of light kept for existing run snapshots and operator scripts: ' +
      'every submission gate keeps its workflow-declared profile, so verify ' +
      'and remediate run the full profile once each and the returning ' +
      'verify gate accepts the recorded remediate pass.',
    gates: {},
  },
}

const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u

function parseGateMap(
  value: unknown,
  source: string,
): Record<string, string | false> {
  invariant(isRecord(value), `${source} MUST be an object when present.`, {
    code: 'INVALID_VERIFICATION',
  })

  const gates: Record<string, string | false> = {}

  for (const [criterionId, profile] of Object.entries(value)) {
    invariant(
      profile === false ||
        (typeof profile === 'string' && PROFILE_NAME_PATTERN.test(profile)),
      `${source}.${criterionId} MUST name a repository-check profile or be false.`,
      { code: 'INVALID_VERIFICATION' },
    )

    gates[criterionId] = profile as string | false
  }

  return gates
}

function parseLevel(value: unknown, source: string): VerificationLevel {
  invariant(isRecord(value), `${source} MUST be an object.`, {
    code: 'INVALID_VERIFICATION',
  })
  invariant(
    typeof value.summary === 'string' && value.summary.length > 0,
    `${source}.summary MUST be a non-empty string.`,
    { code: 'INVALID_VERIFICATION' },
  )

  return {
    summary: value.summary,
    gates:
      value.gates === undefined
        ? {}
        : parseGateMap(value.gates, `${source}.gates`),
  }
}

/**
 * Parse the optional `verification` block of `config.json`. Operator-declared
 * levels merge over the built-ins, so an installation can retune a shipped
 * level or add its own without restating the rest.
 */
export function parseVerification(
  value: unknown,
  source = CONFIG_PATH,
): VerificationFile {
  invariant(isRecord(value), `${source} MUST contain an object.`, {
    code: 'INVALID_VERIFICATION',
  })

  const levels: Record<string, VerificationLevel> = {
    ...structuredClone(BUILT_IN_VERIFICATION_LEVELS),
  }

  if (value[CONFIG_KEY] === undefined) {
    return { active: DEFAULT_VERIFICATION_LEVEL, levels }
  }

  const block = value[CONFIG_KEY]

  invariant(isRecord(block), `${source}.${CONFIG_KEY} MUST be an object.`, {
    code: 'INVALID_VERIFICATION',
  })

  if (block.levels !== undefined) {
    invariant(
      isRecord(block.levels),
      `${source}.${CONFIG_KEY}.levels MUST be an object when present.`,
      { code: 'INVALID_VERIFICATION' },
    )

    for (const [name, level] of Object.entries(block.levels)) {
      levels[name] = parseLevel(level, `${source}.${CONFIG_KEY}.levels.${name}`)
    }
  }

  const active =
    block.active === undefined ? DEFAULT_VERIFICATION_LEVEL : block.active

  invariant(
    typeof active === 'string' && levels[active] !== undefined,
    `${source}.${CONFIG_KEY}.active '${String(active)}' is not a defined ` +
      `verification level. Available: ${Object.keys(levels).sort().join(', ')}.`,
    { code: 'INVALID_VERIFICATION' },
  )

  return { active, levels }
}

export function loadVerificationFile(root: string): VerificationFile {
  const configName = harnessConfigName(root) ?? CONFIG_PATH
  const filePath = path.join(root, configName)

  invariant(fileExists(filePath), `Missing required file: ${CONFIG_PATH}`, {
    code: 'INVALID_VERIFICATION',
  })

  return parseVerification(readHarnessConfig(root, filePath), configName)
}

/**
 * Resolve the verification level a run snapshots at init. A later edit to
 * `config.json` cannot change a run already in flight.
 */
export function resolveVerification(
  root: string,
  name?: string | null,
): ResolvedVerification {
  const file = loadVerificationFile(root)
  const resolved = name ?? file.active
  const level = file.levels[resolved]

  invariant(
    level !== undefined,
    `Verification level '${resolved}' is not defined in ${CONFIG_PATH}. ` +
      `Available: ${Object.keys(file.levels).sort().join(', ')}.`,
    { code: 'INVALID_VERIFICATION' },
  )

  return { level: resolved, summary: level.summary, gates: level.gates }
}

/**
 * The repository-check profile a shell criterion effectively runs under a
 * run's verification level: the level's remap when it names the criterion,
 * otherwise the workflow-declared profile. `profile: null` means the criterion
 * is not a repository-check gate; `skipped: true` means the level disables it.
 *
 * A run without a verification snapshot (created before levels existed) keeps
 * workflow-declared behavior everywhere.
 */
export function effectiveRepositoryCheckProfile(
  verification: ResolvedVerification | undefined,
  criterion: Pick<Criterion, 'id' | 'command'>,
): { profile: string | null; skipped: boolean } {
  const declared = repositoryCheckProfileName(criterion.command ?? '')

  if (!declared) {
    return { profile: null, skipped: false }
  }

  const remap = verification?.gates[criterion.id]

  if (remap === false) {
    return { profile: null, skipped: true }
  }

  return {
    profile: typeof remap === 'string' ? remap : declared,
    skipped: false,
  }
}
