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
 * Built-in levels. The default is deliberately lightweight: teams run their
 * own tests locally and in CI, so the harness re-running a repository's entire
 * documented verification universe (integration suites, end-to-end browsers)
 * inside a delivery loop buys minutes-to-hours of latency for evidence that
 * already exists elsewhere. The `full` profile therefore never runs unless the
 * operator explicitly selects a level that names it.
 */
export const BUILT_IN_VERIFICATION_LEVELS: Record<string, VerificationLevel> = {
  minimal: {
    summary:
      'Static and fast checks gate the implement loop; QA argues from manual ' +
      'cases and prior gate evidence without re-running a suite.',
    gates: { 'test.full_suite': false },
  },
  light: {
    summary:
      'Static and fast checks gate the implement loop, and QA re-runs the ' +
      'fast suite against the pre-implementation baseline. Integration and ' +
      'end-to-end suites are left to the team and CI.',
    gates: { 'test.full_suite': 'fast' },
  },
  thorough: {
    summary:
      'QA runs the complete full profile. Explicit operator opt-in: the full ' +
      'profile is never baselined before implementation, so a pre-existing ' +
      'failure fails the gate and needs an operator decision.',
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
