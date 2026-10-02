/**
 * The multi-instance spend report combined from every instance's latest
 * snapshot.
 */

import { PanError, errorMessage, invariant } from '../errors.js'
import { isRecord } from '../io.js'
import { readProjectConfig, resolveSpendSyncOrigin } from '../project-config.js'
import { aggregateSpendRecords } from '../token-spend/report.js'
import {
  DAY_MS,
  type InstanceSummary,
  MAX_LEDGER_DAYS,
  type MultiInstanceSpendReport,
  type ReportMultiInstanceSpendOptions,
  type SpendSnapshot,
} from './model.js'
import { type LedgerRecordMeta, selectSpendRecord } from './ledger.js'
import {
  assertSecureUrl,
  expectJson,
  gunzipBuffer,
  resolveSpendToken,
  timedFetch,
} from './transport.js'
import { parseSpendSnapshot } from './snapshot.js'

const DEFAULT_REPORT_DAYS = 14

function emptySpendCoverage() {
  return {
    known_events: 0,
    total_events: 0,
    known_tokens: 0,
    total_tokens: 0,
    known_token_percent: null,
  }
}

function emptyMultiInstanceReport(
  period: MultiInstanceSpendReport['period'],
  warnings: string[],
): MultiInstanceSpendReport {
  return {
    scope: 'multi-instance',
    period,
    attribution_sources: {
      instances: 0,
      workspaces_scanned: 0,
      embedded_installations_scanned: 0,
    },
    instances: [],
    totals: {
      events: 0,
      request_units: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_write_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 0,
      cost_cents: 0,
      cursor_fee_cents: 0,
      included_cost_cents: 0,
      included_fee_cents: 0,
    },
    token_categories: {
      input: 0,
      output: 0,
      cache_write: 0,
      cache_read: 0,
      cached: 0,
    },
    daily: [],
    slices: {
      commands: [],
      persona_models: [],
      tools: [],
      fast_mode: [],
      governance: [],
      workflow_role: [],
      stages: [],
      remediation: [],
    },
    coverage: {
      command: emptySpendCoverage(),
      persona: emptySpendCoverage(),
      tools: emptySpendCoverage(),
      fast_mode: emptySpendCoverage(),
      governance: emptySpendCoverage(),
      workflow_role: emptySpendCoverage(),
      stage: emptySpendCoverage(),
      remediation: emptySpendCoverage(),
    },
    warnings: [
      ...warnings,
      'No snapshots are available. Run `pan spend sync` on each instance first.',
    ],
  }
}

/** Tool maps for the selected records, taken from the instance that supplied each record. */
function selectedToolCalls(
  selected: LedgerRecordMeta[],
  snapshotsById: Map<string, SpendSnapshot>,
): Map<string, Map<string, number>> {
  const toolCalls = new Map<string, Map<string, number>>()

  for (const { record, instance_id } of selected) {
    const conversationKey = record.conversation_key

    if (conversationKey === null || toolCalls.has(conversationKey)) {
      continue
    }

    const tools = snapshotsById.get(instance_id)?.tool_calls[conversationKey]

    if (tools !== undefined) {
      toolCalls.set(conversationKey, new Map(Object.entries(tools)))
    }
  }

  return toolCalls
}

/** Keep the newest snapshot of each instance; the host can hold older ones. */
function latestSnapshotPerInstance(
  snapshots: SpendSnapshot[],
): SpendSnapshot[] {
  const latest = new Map<string, SpendSnapshot>()

  for (const snapshot of snapshots) {
    const current = latest.get(snapshot.instance_id)

    if (current === undefined || snapshot.synced_at > current.synced_at) {
      latest.set(snapshot.instance_id, snapshot)
    }
  }

  return [...latest.values()]
}

export interface CombineSpendSnapshotsOptions {
  days: number
  now: Date
  /** Warnings gathered while fetching; they lead the report warnings. */
  warnings?: string[]
}

/**
 * Combine validated instance snapshots into one report. Each event key counts
 * once under the selection rule, and each instance's totals cover only the
 * records it supplied to the selection, so instance totals sum to the report
 * totals.
 */
export function combineSpendSnapshots(
  uploaded: SpendSnapshot[],
  options: CombineSpendSnapshotsOptions,
): MultiInstanceSpendReport {
  const endDateMs = options.now.getTime()
  const startDateMs = endDateMs - options.days * DAY_MS
  const warnings = [...(options.warnings ?? [])]
  const snapshots = latestSnapshotPerInstance(uploaded)

  if (snapshots.length < uploaded.length) {
    warnings.push(
      `Ignored ${uploaded.length - snapshots.length} superseded snapshot(s); each instance contributes only its latest sync.`,
    )
  }
  const basePeriod = {
    days: options.days,
    start: new Date(startDateMs).toISOString(),
    end: options.now.toISOString(),
    timezone: 'UTC' as const,
    source: 'Pancreator spend sync' as const,
  }

  if (snapshots.length === 0) {
    return emptyMultiInstanceReport(
      { ...basePeriod, cost_basis: 'charged' },
      warnings,
    )
  }

  const byKey = new Map<string, LedgerRecordMeta>()
  const inWindowPerInstance = new Map<string, number>()
  const snapshotsById = new Map<string, SpendSnapshot>()

  for (const snapshot of snapshots) {
    snapshotsById.set(snapshot.instance_id, snapshot)

    let inWindow = 0

    for (const record of snapshot.records) {
      if (
        record.timestamp_ms < startDateMs ||
        record.timestamp_ms > endDateMs
      ) {
        continue
      }

      inWindow += 1

      const existing = byKey.get(record.key)
      const selected =
        existing === undefined
          ? record
          : selectSpendRecord(
              record,
              existing.record,
              snapshot.instance_id,
              existing.instance_id,
              snapshot.synced_at,
              existing.synced_at,
            )

      if (existing === undefined || selected === record) {
        byKey.set(record.key, {
          record,
          instance_id: snapshot.instance_id,
          synced_at: snapshot.synced_at,
        })
      }
    }

    inWindowPerInstance.set(snapshot.instance_id, inWindow)
  }

  const selected = [...byKey.values()]
  const selectedByInstance = new Map<string, LedgerRecordMeta[]>()

  for (const meta of selected) {
    const group = selectedByInstance.get(meta.instance_id) ?? []

    group.push(meta)
    selectedByInstance.set(meta.instance_id, group)
  }

  const instances: InstanceSummary[] = [...snapshotsById.values()].map(
    (snapshot) => {
      const supplied = selectedByInstance.get(snapshot.instance_id) ?? []

      return {
        instance_id: snapshot.instance_id,
        label: snapshot.label,
        synced_at: snapshot.synced_at,
        harness_version: snapshot.harness_version,
        records_in_window: inWindowPerInstance.get(snapshot.instance_id) ?? 0,
        records_selected: supplied.length,
        totals: aggregateSpendRecords(
          supplied.map((meta) => meta.record),
          selectedToolCalls(supplied, snapshotsById),
        ).totals,
      }
    },
  )

  const aggregated = aggregateSpendRecords(
    selected.map((meta) => meta.record),
    selectedToolCalls(selected, snapshotsById),
  )
  warnings.push(
    'Duplicate events across instances were counted once, using the better attributed record.',
    ...aggregated.warnings,
  )

  const feeDerived = selected.filter(
    (meta) => meta.record.fee_derived === true,
  ).length

  if (feeDerived > 0) {
    warnings.push(
      `${feeDerived} event(s) were synced before Cursor fees were recorded. Their fee is derived at $0.25 per million tokens for models Cursor does not own.`,
    )
  }

  const billingUnrecorded = selected.filter(
    (meta) => meta.record.billing_unrecorded === true,
  ).length

  if (billingUnrecorded > 0) {
    warnings.push(
      `${billingUnrecorded} event(s) were synced before included usage was recorded. Their whole cost counts as on-demand.`,
    )
  }

  return {
    scope: 'multi-instance',
    period: { ...basePeriod, cost_basis: 'charged' },
    attribution_sources: {
      instances: snapshotsById.size,
      workspaces_scanned: [...snapshotsById.values()].reduce(
        (total, snapshot) =>
          total + snapshot.attribution_sources.workspaces_scanned,
        0,
      ),
      embedded_installations_scanned: [...snapshotsById.values()].reduce(
        (total, snapshot) =>
          total + snapshot.attribution_sources.embedded_installations_scanned,
        0,
      ),
    },
    instances,
    totals: aggregated.totals,
    token_categories: aggregated.token_categories,
    daily: aggregated.daily,
    slices: aggregated.slices,
    coverage: aggregated.coverage,
    warnings,
  }
}

/**
 * Download every instance's latest snapshot and aggregate into a combined report.
 *
 * Fails with `SPEND_SYNC_HOST_MISSING` or `SPEND_SYNC_TOKEN_MISSING` before any
 * network request when those preconditions are missing.
 */
export async function reportMultiInstanceSpend(
  root: string,
  options: ReportMultiInstanceSpendOptions = {},
): Promise<MultiInstanceSpendReport> {
  const days = options.days ?? DEFAULT_REPORT_DAYS

  invariant(
    Number.isInteger(days) && days >= 1 && days <= MAX_LEDGER_DAYS,
    `--days MUST be an integer from 1 to ${MAX_LEDGER_DAYS}.`,
    { code: 'INVALID_ARGUMENT' },
  )

  const config = readProjectConfig(root)

  // Resolve origin and token before any network request (AC-2).
  const origin = resolveSpendSyncOrigin(config)
  const token = resolveSpendToken(root)

  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? new Date()

  let listData: unknown

  try {
    const response = await timedFetch(fetchImpl, `${origin}/api/snapshots`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    listData = await expectJson(response, 'GET /api/snapshots')
  } catch (err) {
    if (err instanceof PanError) {
      throw err
    }

    invariant(false, `GET /api/snapshots failed: ${errorMessage(err)}`, {
      code: 'SPEND_SYNC_REQUEST_FAILED',
    })
  }

  invariant(
    isRecord(listData) && Array.isArray(listData.snapshots),
    'GET /api/snapshots returned an unexpected response shape.',
    { code: 'SPEND_SYNC_INVALID_RESPONSE' },
  )

  const warnings: string[] = []
  const snapshots: SpendSnapshot[] = []

  for (const entry of listData.snapshots as unknown[]) {
    if (
      !isRecord(entry) ||
      typeof entry.instance_id !== 'string' ||
      typeof entry.download_url !== 'string'
    ) {
      warnings.push('Skipped a snapshot entry with an invalid shape.')
      continue
    }

    const instanceId = entry.instance_id
    const downloadUrl = entry.download_url

    try {
      assertSecureUrl(downloadUrl, `download_url for instance ${instanceId}`)
    } catch {
      warnings.push(
        `Skipped instance ${instanceId}: download_url is not a secure URL.`,
      )
      continue
    }

    try {
      const response = await timedFetch(fetchImpl, downloadUrl, {})

      if (!response.ok) {
        warnings.push(
          `Skipped instance ${instanceId}: download failed with status ${response.status}.`,
        )
        continue
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      const decompressed = await gunzipBuffer(buffer)
      const parsed = parseSpendSnapshot(
        JSON.parse(decompressed.toString('utf8')) as unknown,
      )

      if (parsed === null) {
        warnings.push(
          `Skipped instance ${instanceId}: snapshot has an invalid schema.`,
        )
        continue
      }

      if (parsed.skipped_records > 0) {
        warnings.push(
          `Skipped ${parsed.skipped_records} malformed record(s) in the snapshot of instance ${instanceId}.`,
        )
      }

      snapshots.push(parsed.snapshot)
    } catch (err) {
      warnings.push(`Skipped instance ${instanceId}: ${errorMessage(err)}`)
    }
  }

  return combineSpendSnapshots(snapshots, { days, now, warnings })
}
