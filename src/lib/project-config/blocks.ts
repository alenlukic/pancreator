/**
 * Validation of each configuration block: worktrees, retention, away mode,
 * schedule, installations, spend, handoff, and the fast wall, with the
 * loopback rule the spend sync origin follows.
 */

import path from 'node:path'

import { invariant } from '../errors.js'
import { isRecord } from '../io.js'
import type { AwayModeAction, ProjectConfig, SpendConfig } from '../types.js'
import { AWAY_MODE_ACTIONS, PROJECT_CONFIG_PATH } from './files.js'

/**
 * Validate the optional `worktrees` block of `config.json`: a
 * repository-relative `root`, a whitespace-free `branch_prefix`,
 * worktree-relative `readiness_paths`, and non-empty `setup` commands. Throws
 * `PanError` `INVALID_PROJECT_CONFIG` on the first violation; an absent block
 * passes.
 */
export function assertWorktreesBlock(value: unknown): void {
  if (value === undefined) {
    return
  }

  invariant(
    isRecord(value),
    `${PROJECT_CONFIG_PATH}.worktrees MUST be an object when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    value.root === undefined ||
      (typeof value.root === 'string' &&
        value.root.trim().length > 0 &&
        !path.isAbsolute(value.root) &&
        path.normalize(value.root) !== '..' &&
        !path.normalize(value.root).startsWith(`..${path.sep}`)),
    `${PROJECT_CONFIG_PATH}.worktrees.root MUST be a non-empty repository-relative path when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    value.branch_prefix === undefined ||
      (typeof value.branch_prefix === 'string' &&
        value.branch_prefix.length > 0 &&
        !/\s/u.test(value.branch_prefix)),
    `${PROJECT_CONFIG_PATH}.worktrees.branch_prefix MUST be a non-empty string without whitespace when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  assertWorktreeReadinessPaths(value.readiness_paths)

  if (value.setup === undefined) {
    return
  }

  invariant(
    Array.isArray(value.setup),
    `${PROJECT_CONFIG_PATH}.worktrees.setup MUST be an array when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  for (const [index, command] of value.setup.entries()) {
    invariant(
      typeof command === 'string' && command.trim().length > 0,
      `${PROJECT_CONFIG_PATH}.worktrees.setup[${index}] MUST be a non-empty command string.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
  }
}

function assertWorktreeReadinessPaths(value: unknown): void {
  if (value === undefined) {
    return
  }

  invariant(
    Array.isArray(value),
    `${PROJECT_CONFIG_PATH}.worktrees.readiness_paths MUST be an array when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  for (const [index, entry] of value.entries()) {
    const source = `${PROJECT_CONFIG_PATH}.worktrees.readiness_paths[${index}]`

    invariant(
      typeof entry === 'string' &&
        entry.trim().length > 0 &&
        !path.isAbsolute(entry) &&
        !path.normalize(entry).startsWith('..'),
      `${source} MUST be a non-empty worktree-relative path.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
  }
}

/**
 * Validate the optional `retention` block of `config.json`: a positive integer
 * `default_days` and a `classes` map of positive integer day counts. Throws
 * `PanError` `INVALID_RETENTION_DAYS` on the first violation; an absent block
 * passes.
 */
export function assertRetentionBlock(value: unknown): void {
  if (value === undefined) {
    return
  }

  invariant(
    isRecord(value),
    `${PROJECT_CONFIG_PATH}.retention MUST be an object when present.`,
    { code: 'INVALID_RETENTION_DAYS' },
  )
  invariant(
    value.default_days === undefined ||
      (Number.isInteger(value.default_days) &&
        (value.default_days as number) > 0),
    `${PROJECT_CONFIG_PATH}.retention.default_days MUST be a positive integer when present.`,
    { code: 'INVALID_RETENTION_DAYS' },
  )
  invariant(
    value.classes === undefined || isRecord(value.classes),
    `${PROJECT_CONFIG_PATH}.retention.classes MUST be an object when present.`,
    { code: 'INVALID_RETENTION_DAYS' },
  )

  if (!isRecord(value.classes)) {
    return
  }

  for (const [className, days] of Object.entries(value.classes)) {
    invariant(
      className.trim().length > 0 &&
        Number.isInteger(days) &&
        (days as number) > 0,
      `${PROJECT_CONFIG_PATH}.retention.classes.${className || '(empty)'} MUST be a positive integer.`,
      { code: 'INVALID_RETENTION_DAYS' },
    )
  }
}

/**
 * Validate the optional `away_mode` block of `config.json`: a boolean `enabled`
 * and `guardrails.allowed_actions` drawn only from the known away mode actions.
 * Throws `PanError` `INVALID_PROJECT_CONFIG` on the first violation; an absent
 * block passes.
 */
export function assertAwayModeBlock(value: unknown): void {
  if (value === undefined) {
    return
  }

  invariant(
    isRecord(value) && typeof value.enabled === 'boolean',
    `${PROJECT_CONFIG_PATH}.away_mode MUST contain enabled as a boolean.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  const guardrails = value.guardrails

  if (guardrails === undefined) {
    return
  }

  invariant(
    isRecord(guardrails),
    `${PROJECT_CONFIG_PATH}.away_mode.guardrails MUST be an object when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    guardrails.allowed_actions === undefined ||
      (Array.isArray(guardrails.allowed_actions) &&
        guardrails.allowed_actions.every(
          (action) =>
            typeof action === 'string' &&
            AWAY_MODE_ACTIONS.includes(action as AwayModeAction),
        )),
    `${PROJECT_CONFIG_PATH}.away_mode.guardrails.allowed_actions MUST contain only ${AWAY_MODE_ACTIONS.join(', ')}.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
}

const SCHEDULE_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

function assertScheduleMinutes(value: unknown, source: string): void {
  invariant(
    value === undefined || (Number.isInteger(value) && (value as number) >= 0),
    `${source} MUST be a non-negative integer when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
}

function assertScheduleAction(value: unknown, source: string): void {
  invariant(isRecord(value), `${source} MUST be an action object.`, {
    code: 'INVALID_PROJECT_CONFIG',
  })

  const kind = value.kind
  invariant(
    kind === 'command' ||
      kind === 'workflow' ||
      kind === 'session' ||
      kind === 'prompt',
    `${source}.kind MUST be command, workflow, session, or prompt.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  const nonEmpty = (candidate: unknown): candidate is string =>
    typeof candidate === 'string' && candidate.trim().length > 0
  const shared = [
    'kind',
    'involvement',
    'verification',
    'pipeline_config',
    'attest_supervisor_card',
  ]
  const allowed =
    kind === 'command'
      ? ['kind', 'command']
      : kind === 'session'
        ? ['kind', 'queue_path', 'involvement']
        : kind === 'workflow'
          ? [...shared, 'workflow', 'request_path']
          : [...shared, 'prompt', 'workflow']
  const unsupported = Object.keys(value).filter((key) => !allowed.includes(key))
  invariant(
    unsupported.length === 0,
    `${source} contains unsupported fields for '${kind}': ${unsupported.join(', ')}.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  if (kind === 'command') {
    invariant(nonEmpty(value.command), `${source}.command MUST be non-empty.`, {
      code: 'INVALID_PROJECT_CONFIG',
    })
    return
  }

  if (kind === 'session') {
    invariant(
      nonEmpty(value.queue_path),
      `${source}.queue_path MUST be non-empty.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
  } else if (kind === 'workflow') {
    invariant(
      nonEmpty(value.workflow) && nonEmpty(value.request_path),
      `${source} MUST name a non-empty workflow and request_path.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
  } else {
    invariant(nonEmpty(value.prompt), `${source}.prompt MUST be non-empty.`, {
      code: 'INVALID_PROJECT_CONFIG',
    })
    invariant(
      value.workflow === undefined || nonEmpty(value.workflow),
      `${source}.workflow MUST be non-empty when present.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
  }

  invariant(
    value.involvement === undefined || nonEmpty(value.involvement),
    `${source}.involvement MUST be non-empty when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  if (kind !== 'session') {
    invariant(
      value.verification === undefined || nonEmpty(value.verification),
      `${source}.verification MUST be non-empty when present.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
    invariant(
      value.pipeline_config === undefined || nonEmpty(value.pipeline_config),
      `${source}.pipeline_config MUST be non-empty when present.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
    invariant(
      value.attest_supervisor_card === undefined ||
        typeof value.attest_supervisor_card === 'boolean',
      `${source}.attest_supervisor_card MUST be boolean when present.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
  }
}

const INSTALLATION_ID = /^[a-z0-9][a-z0-9-]*$/u

/**
 * Validate the optional `installations` registry of `config.json`: each entry
 * needs a unique lowercase hyphenated `id` and an absolute `path`. Throws
 * `PanError` `INVALID_PROJECT_CONFIG` on the first violation; an absent block
 * passes.
 */
export function assertInstallationsBlock(value: unknown): void {
  if (value === undefined) {
    return
  }

  invariant(
    Array.isArray(value),
    `${PROJECT_CONFIG_PATH}.installations MUST be an array when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  const ids = new Set<string>()

  for (const [index, entry] of value.entries()) {
    const source = `${PROJECT_CONFIG_PATH}.installations[${index}]`

    invariant(isRecord(entry), `${source} MUST be an object.`, {
      code: 'INVALID_PROJECT_CONFIG',
    })
    invariant(
      typeof entry.id === 'string' && INSTALLATION_ID.test(entry.id),
      `${source}.id MUST match ${INSTALLATION_ID.source}.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
    invariant(!ids.has(entry.id), `${source}.id duplicates '${entry.id}'.`, {
      code: 'INVALID_PROJECT_CONFIG',
    })
    ids.add(entry.id)
    invariant(
      typeof entry.path === 'string' && path.isAbsolute(entry.path),
      `${source}.path MUST be an absolute path.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
  }
}

/**
 * Validate the optional `schedule` block of `config.json`: a boolean `enabled`,
 * non-negative window minutes, and jobs with unique ids, a valid hour, minute,
 * weekdays, and IANA timezone, exactly one of `workspace` or `worktree`, and an
 * action whose fields fit its kind (`command`, `workflow`, `session`, or
 * `prompt`). Throws `PanError` `INVALID_PROJECT_CONFIG` on the first violation;
 * an absent block passes.
 */
export function assertScheduleBlock(value: unknown): void {
  if (value === undefined) {
    return
  }

  invariant(
    isRecord(value) &&
      typeof value.enabled === 'boolean' &&
      Array.isArray(value.jobs),
    `${PROJECT_CONFIG_PATH}.schedule MUST contain enabled as a boolean and jobs as an array.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  assertScheduleMinutes(
    value.catch_up_window_minutes,
    `${PROJECT_CONFIG_PATH}.schedule.catch_up_window_minutes`,
  )
  assertScheduleMinutes(
    value.grace_period_minutes,
    `${PROJECT_CONFIG_PATH}.schedule.grace_period_minutes`,
  )

  const ids = new Set<string>()

  for (const [index, job] of value.jobs.entries()) {
    const source = `${PROJECT_CONFIG_PATH}.schedule.jobs[${index}]`
    invariant(isRecord(job), `${source} MUST be an object.`, {
      code: 'INVALID_PROJECT_CONFIG',
    })
    invariant(
      typeof job.id === 'string' && SCHEDULE_JOB_ID.test(job.id),
      `${source}.id MUST match ${SCHEDULE_JOB_ID.source}.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
    invariant(!ids.has(job.id), `${source}.id duplicates '${job.id}'.`, {
      code: 'INVALID_PROJECT_CONFIG',
    })
    ids.add(job.id)
    invariant(
      typeof job.enabled === 'boolean',
      `${source}.enabled MUST be boolean.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
    invariant(
      Number.isInteger(job.hour) &&
        (job.hour as number) >= 0 &&
        (job.hour as number) <= 23,
      `${source}.hour MUST be an integer from 0 through 23.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
    invariant(
      Number.isInteger(job.minute) &&
        (job.minute as number) >= 0 &&
        (job.minute as number) <= 59,
      `${source}.minute MUST be an integer from 0 through 59.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
    invariant(
      job.weekdays === undefined ||
        (Array.isArray(job.weekdays) &&
          job.weekdays.length > 0 &&
          new Set(job.weekdays).size === job.weekdays.length &&
          job.weekdays.every(
            (day) => Number.isInteger(day) && day >= 0 && day <= 6,
          )),
      `${source}.weekdays MUST contain unique integers from 0 (Sunday) through 6 (Saturday).`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )

    if (job.timezone !== undefined) {
      invariant(
        nonEmptyScheduleString(job.timezone),
        `${source}.timezone MUST be non-empty when present.`,
        { code: 'INVALID_PROJECT_CONFIG' },
      )

      try {
        new Intl.DateTimeFormat('en-US', { timeZone: job.timezone as string })
      } catch {
        invariant(false, `${source}.timezone MUST be a valid IANA timezone.`, {
          code: 'INVALID_PROJECT_CONFIG',
        })
      }
    }
    assertScheduleMinutes(
      job.catch_up_window_minutes,
      `${source}.catch_up_window_minutes`,
    )
    assertScheduleMinutes(
      job.grace_period_minutes,
      `${source}.grace_period_minutes`,
    )
    invariant(
      (nonEmptyScheduleString(job.workspace) ? 1 : 0) +
        (nonEmptyScheduleString(job.worktree) ? 1 : 0) ===
        1,
      `${source} MUST name exactly one of workspace or worktree.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
    invariant(
      job.self_development_only === undefined ||
        typeof job.self_development_only === 'boolean',
      `${source}.self_development_only MUST be boolean when present.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
    assertScheduleAction(job.action, `${source}.action`)
  }
}

function nonEmptyScheduleString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

/** True for a loopback URL hostname; WHATWG URL keeps IPv6 brackets. */
export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.replace(/^\[(.*)\]$/u, '$1'))
}

/**
 * Resolve the configured `spend.vercel_host` to its normalized origin.
 * An absent host fails with `SPEND_SYNC_HOST_MISSING`.
 */
export function resolveSpendSyncOrigin(config: ProjectConfig | null): string {
  const host = config?.spend?.vercel_host

  invariant(
    typeof host === 'string' && host.length > 0,
    `${PROJECT_CONFIG_PATH}.spend.vercel_host must be set to use spend sync or report.`,
    { code: 'SPEND_SYNC_HOST_MISSING' },
  )

  return normalizeSpendSyncHost(host)
}

/**
 * Normalize a `spend.vercel_host` value to an origin.
 * Accepts:
 *   - a bare host (`pan-spend.vercel.app`) → `https://pan-spend.vercel.app`
 *   - `https://<host>[:port]` (trailing slash stripped)
 *   - `http://<loopback>[:port]` (loopback only, for tests)
 * Everything else fails with `INVALID_PROJECT_CONFIG`.
 */
function normalizeSpendSyncHost(host: string): string {
  let parsed: URL

  if (host.includes('://')) {
    try {
      parsed = new URL(host)
    } catch {
      invariant(
        false,
        `${PROJECT_CONFIG_PATH}.spend.vercel_host is not a valid URL: ${host}`,
        { code: 'INVALID_PROJECT_CONFIG' },
      )
    }
  } else {
    // Bare host — treat as https.
    try {
      parsed = new URL(`https://${host}`)
    } catch {
      invariant(
        false,
        `${PROJECT_CONFIG_PATH}.spend.vercel_host is not a valid host: ${host}`,
        { code: 'INVALID_PROJECT_CONFIG' },
      )
    }
  }

  invariant(
    parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname)),
    `${PROJECT_CONFIG_PATH}.spend.vercel_host must use https (or http for a loopback host).`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  invariant(
    parsed.pathname === '/',
    `${PROJECT_CONFIG_PATH}.spend.vercel_host must not include a path.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  invariant(
    parsed.search === '',
    `${PROJECT_CONFIG_PATH}.spend.vercel_host must not include a query string.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  invariant(
    parsed.hash === '',
    `${PROJECT_CONFIG_PATH}.spend.vercel_host must not include a fragment.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  invariant(
    parsed.username === '' && parsed.password === '',
    `${PROJECT_CONFIG_PATH}.spend.vercel_host must not include credentials.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  // Remove trailing slash and return.
  return `${parsed.protocol}//${parsed.host}`
}

/** Default model and effort used when `config.json` omits the `handoff` block. */
export const DEFAULT_HANDOFF_MODEL = 'Claude Opus 5.5'
export const DEFAULT_HANDOFF_EFFORT = 'High'

/**
 * Validate the optional `handoff` block of `config.json`: `model` and `effort`
 * must be non-empty strings when present. Throws `PanError`
 * `INVALID_PROJECT_CONFIG` on the first violation; an absent block passes.
 */
export function assertHandoffBlock(value: unknown): void {
  if (value === undefined) {
    return
  }

  invariant(
    isRecord(value),
    `${PROJECT_CONFIG_PATH}.handoff MUST be an object when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    value.model === undefined ||
      (typeof value.model === 'string' && value.model.trim().length > 0),
    `${PROJECT_CONFIG_PATH}.handoff.model MUST be a non-empty string when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    value.effort === undefined ||
      (typeof value.effort === 'string' && value.effort.trim().length > 0),
    `${PROJECT_CONFIG_PATH}.handoff.effort MUST be a non-empty string when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
}

/**
 * Validate the optional `spend` block of `config.json` and narrow it to
 * `SpendConfig`: `vercel_host` must normalize to an https origin, or http for a
 * loopback host, with no path, query, fragment, or credentials. Throws
 * `PanError` `INVALID_PROJECT_CONFIG` on the first violation; an absent block
 * passes.
 */
export function assertSpendBlock(
  value: unknown,
): asserts value is SpendConfig | undefined {
  if (value === undefined) {
    return
  }

  invariant(
    isRecord(value),
    `${PROJECT_CONFIG_PATH}.spend MUST be an object when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )

  if (value.vercel_host !== undefined) {
    invariant(
      typeof value.vercel_host === 'string' && value.vercel_host.length > 0,
      `${PROJECT_CONFIG_PATH}.spend.vercel_host MUST be a non-empty string when present.`,
      { code: 'INVALID_PROJECT_CONFIG' },
    )
    normalizeSpendSyncHost(value.vercel_host)
  }
}

/**
 * Validate the optional `fast_wall` block of `config.json`: a positive
 * `ceiling_ms` or null, an ISO `calibrated_at`, a `YYYY-MM-DD` `anchor_date`, a
 * non-negative weekly allowance, a positive load-average ceiling, and a
 * positive minimum sample count. Throws `PanError` `INVALID_PROJECT_CONFIG` on
 * the first violation; an absent block passes.
 */
export function assertFastWallBlock(value: unknown): void {
  if (value === undefined) {
    return
  }

  invariant(
    isRecord(value),
    `${PROJECT_CONFIG_PATH}.fast_wall MUST be an object when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    value.ceiling_ms === null ||
      (Number.isInteger(value.ceiling_ms) && (value.ceiling_ms as number) > 0),
    `${PROJECT_CONFIG_PATH}.fast_wall.ceiling_ms MUST be a positive integer, or null until a measured baseline sets it.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    value.calibrated_at === undefined ||
      (typeof value.calibrated_at === 'string' &&
        Number.isFinite(Date.parse(value.calibrated_at))),
    `${PROJECT_CONFIG_PATH}.fast_wall.calibrated_at MUST be an ISO-8601 timestamp when present.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    typeof value.anchor_date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/u.test(value.anchor_date) &&
      Number.isFinite(Date.parse(`${value.anchor_date}T00:00:00.000Z`)),
    `${PROJECT_CONFIG_PATH}.fast_wall.anchor_date MUST be a UTC date in YYYY-MM-DD form.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    Number.isInteger(value.weekly_allowance_ms) &&
      (value.weekly_allowance_ms as number) >= 0,
    `${PROJECT_CONFIG_PATH}.fast_wall.weekly_allowance_ms MUST be a non-negative integer.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    typeof value.max_load_average_per_cpu === 'number' &&
      Number.isFinite(value.max_load_average_per_cpu) &&
      value.max_load_average_per_cpu > 0,
    `${PROJECT_CONFIG_PATH}.fast_wall.max_load_average_per_cpu MUST be a positive number.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
  invariant(
    Number.isInteger(value.minimum_qualified_samples) &&
      (value.minimum_qualified_samples as number) > 0,
    `${PROJECT_CONFIG_PATH}.fast_wall.minimum_qualified_samples MUST be a positive integer.`,
    { code: 'INVALID_PROJECT_CONFIG' },
  )
}
