/** `syncSpend`: merge this instance's records and upload the ledger snapshot. */

import { PanError, errorMessage, invariant } from '../errors.js'
import { isRecord, withOperationMutex, writeTextAtomic } from '../io.js'
import { readProjectConfig, resolveSpendSyncOrigin } from '../project-config.js'
import { collectSpendRecords } from '../token-spend/report.js'
import {
  SNAPSHOT_SCHEMA_VERSION,
  type SpendSnapshot,
  type SyncSpendOptions,
  type SyncSpendResult,
} from './model.js'
import {
  ledgerFilePath,
  ledgerLockPath,
  ledgerWindow,
  mergeLedger,
  readLedger,
  resolveInstanceId,
} from './ledger.js'
import {
  assertSecureUrl,
  expectJson,
  gzipJson,
  readVersion,
  resolveSpendToken,
  timedFetch,
} from './transport.js'

/**
 * Sync this instance's spend data to the configured Vercel service.
 *
 * Fails with `SPEND_SYNC_HOST_MISSING` when no host is configured, and with
 * `SPEND_SYNC_TOKEN_MISSING` when the token is absent — before any network
 * request.
 */
export async function syncSpend(
  root: string,
  options: SyncSpendOptions = {},
): Promise<SyncSpendResult> {
  const config = readProjectConfig(root)

  // Resolve origin and token before any network request (AC-2).
  const origin = resolveSpendSyncOrigin(config)
  const token = resolveSpendToken(root)

  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? new Date()
  const syncedAt = now.toISOString()

  // Resolve instance identity.
  const { instance_id, label } = resolveInstanceId(root)

  // Collect spend records for the window.
  const collected = await collectSpendRecords(root, { ...options, now })

  // Merge and write the ledger under the mutex.
  const ledgerPath = ledgerFilePath(root)
  const lockPath = ledgerLockPath(root)

  const mergedLedger = withOperationMutex(lockPath, () => {
    const merged = mergeLedger(
      readLedger(root, instance_id),
      collected.records,
      collected.tool_calls,
      instance_id,
      syncedAt,
      now,
    )

    // Compact: the ledger holds up to 365 days of records and is machine
    // state, so indentation would only add size and serialization time.
    writeTextAtomic(ledgerPath, JSON.stringify(merged))

    return merged
  })

  // Build and compress the snapshot (whole ledger, not just the window).
  const snapshot: SpendSnapshot = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    instance_id,
    label,
    harness_version: readVersion(root),
    synced_at: syncedAt,
    attribution_sources: collected.attribution_sources,
    records: mergedLedger.records,
    tool_calls: mergedLedger.tool_calls,
  }

  const compressed = await gzipJson(snapshot)

  // POST /api/snapshots/upload to get a signed PUT URL.
  let uploadResponse: unknown

  try {
    const response = await timedFetch(
      fetchImpl,
      `${origin}/api/snapshots/upload`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ instance_id }),
      },
    )

    uploadResponse = await expectJson(response, 'POST /api/snapshots/upload')
  } catch (err) {
    if (err instanceof PanError) {
      throw err
    }

    invariant(
      false,
      `POST /api/snapshots/upload failed: ${errorMessage(err)}`,
      {
        code: 'SPEND_SYNC_REQUEST_FAILED',
      },
    )
  }

  invariant(
    isRecord(uploadResponse) &&
      typeof uploadResponse.upload_url === 'string' &&
      typeof uploadResponse.pathname === 'string',
    'POST /api/snapshots/upload returned an unexpected response shape.',
    { code: 'SPEND_SYNC_INVALID_RESPONSE' },
  )

  const uploadUrl = uploadResponse.upload_url as string

  assertSecureUrl(uploadUrl, 'upload_url')

  // PUT the compressed snapshot to the signed URL.
  try {
    const putResponse = await timedFetch(fetchImpl, uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(compressed.length),
      },
      body: compressed,
    })

    if (!putResponse.ok) {
      invariant(
        false,
        `PUT snapshot failed with status ${putResponse.status}.`,
        {
          code: 'SPEND_SYNC_REQUEST_FAILED',
        },
      )
    }
  } catch (err) {
    if (err instanceof PanError) {
      throw err
    }

    invariant(false, `PUT snapshot failed: ${errorMessage(err)}`, {
      code: 'SPEND_SYNC_REQUEST_FAILED',
    })
  }

  return {
    status: 'synced',
    instance_id,
    label,
    host: origin,
    records_fetched: collected.records.length,
    ledger_records: mergedLedger.records.length,
    ledger_window: ledgerWindow(mergedLedger.records, now),
    uploaded_bytes: compressed.length,
  }
}
