import { randomUUID } from 'node:crypto'

import { appendJsonLine, fileExists, isRecord, readText } from '../io.js'
import { ledgerPath } from '../state.js'
import type {
  LedgerAnomaly,
  ModificationLedgerEntry,
  WorkspaceIndexEntry,
} from '../types.js'

export interface ReplayLedgerResult {
  final_checksums: Record<string, string | null>
  anomalies: LedgerAnomaly[]
  modified_paths: string[]
}

function parseLedgerEntry(
  value: unknown,
  source: string,
): ModificationLedgerEntry {
  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    typeof value.sequence !== 'number' ||
    typeof value.path !== 'string' ||
    typeof value.workflow_id !== 'string' ||
    typeof value.lock_id !== 'string'
  ) {
    throw new Error(`Invalid ledger entry at ${source}`)
  }

  return value as unknown as ModificationLedgerEntry
}

export function readLedgerEntries(
  stateRoot: string,
  runId: string,
): ModificationLedgerEntry[] {
  const filePath = ledgerPath(stateRoot, runId)

  if (!fileExists(filePath)) {
    return []
  }

  return readText(filePath)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) =>
      parseLedgerEntry(JSON.parse(line) as unknown, `${filePath}:${index + 1}`),
    )
}

export function nextLedgerSequence(entries: ModificationLedgerEntry[]): number {
  const latest = entries.at(-1)

  return latest ? latest.sequence + 1 : 1
}

export function appendLedgerEntry(
  stateRoot: string,
  runId: string,
  entry: Omit<ModificationLedgerEntry, 'schema_version' | 'sequence'>,
): ModificationLedgerEntry {
  const existing = readLedgerEntries(stateRoot, runId)
  const sequence = nextLedgerSequence(existing)
  const previousTime = existing.at(-1)?.modified_at_ms ?? 0
  const nextTime = Math.max(previousTime, Date.now())
  const complete: ModificationLedgerEntry = {
    schema_version: 1,
    sequence,
    ...entry,
    modified_at_ms: Math.max(entry.modified_at_ms, nextTime),
  }

  appendJsonLine(ledgerPath(stateRoot, runId), complete)

  return complete
}

function ledgerAnomaly(
  code: string,
  summary: string,
  details: string,
  options: Partial<LedgerAnomaly> = {},
): LedgerAnomaly {
  return {
    id: `anomaly-${randomUUID().slice(0, 8)}`,
    code,
    severity: 'hard',
    summary,
    details,
    suggested_actions: ['accept', 'restart-stage', 'spot-fix', 'abort'],
    ...options,
  }
}

export function replayLedger(
  baselineEntries: Record<string, WorkspaceIndexEntry>,
  ledgerEntries: ModificationLedgerEntry[],
): ReplayLedgerResult {
  const anomalies: LedgerAnomaly[] = []
  const finalChecksums: Record<string, string | null> = {}
  const modifiedPaths = new Set<string>()
  const baselineChecksums = new Map<string, string | null>(
    Object.entries(baselineEntries).map(([relativePath, entry]) => [
      relativePath,
      entry.checksum,
    ]),
  )
  const lastSeenByPath = new Map<string, string | null>()
  let expectedSequence = 1
  let previousTimestamp = 0

  for (const entry of ledgerEntries) {
    if (entry.sequence !== expectedSequence) {
      anomalies.push(
        ledgerAnomaly(
          'ledger.sequence_gap',
          'Ledger sequence is not contiguous.',
          `Expected sequence ${expectedSequence} but found ${entry.sequence}.`,
          { sequence: entry.sequence, path: entry.path },
        ),
      )
    }

    expectedSequence = entry.sequence + 1

    if (entry.modified_at_ms < previousTimestamp) {
      anomalies.push(
        ledgerAnomaly(
          'ledger.time_regression',
          'Ledger timestamps must be nondecreasing.',
          `Entry ${entry.sequence} moved backwards in time.`,
          { sequence: entry.sequence, path: entry.path },
        ),
      )
    }

    previousTimestamp = Math.max(previousTimestamp, entry.modified_at_ms)

    const currentChecksum = lastSeenByPath.has(entry.path)
      ? (lastSeenByPath.get(entry.path) ?? null)
      : (baselineChecksums.get(entry.path) ?? null)

    if (currentChecksum !== entry.before_checksum) {
      anomalies.push(
        ledgerAnomaly(
          'ledger.before_checksum_mismatch',
          'Ledger checksum chain is discontinuous.',
          `Path ${entry.path} expected before checksum ${currentChecksum ?? 'null'} but recorded ${entry.before_checksum ?? 'null'}.`,
          {
            sequence: entry.sequence,
            path: entry.path,
            expected: currentChecksum,
            observed: entry.before_checksum,
          },
        ),
      )
    }

    if (entry.operation === 'create') {
      if (currentChecksum !== null || entry.after_checksum === null) {
        anomalies.push(
          ledgerAnomaly(
            'ledger.invalid_create',
            'Create operation is invalid for the current replay state.',
            `Create on ${entry.path} requires before_checksum=null and after_checksum!=null.`,
            {
              sequence: entry.sequence,
              path: entry.path,
              expected: null,
              observed: entry.before_checksum,
            },
          ),
        )
      }
    }

    if (entry.operation === 'modify') {
      if (currentChecksum === null || entry.after_checksum === null) {
        anomalies.push(
          ledgerAnomaly(
            'ledger.invalid_modify',
            'Modify operation requires an existing path and non-null checksums.',
            `Modify on ${entry.path} is invalid for the replay state.`,
            { sequence: entry.sequence, path: entry.path },
          ),
        )
      }
    }

    if (entry.operation === 'delete') {
      if (currentChecksum === null || entry.after_checksum !== null) {
        anomalies.push(
          ledgerAnomaly(
            'ledger.invalid_delete',
            'Delete operation requires an existing path and null after checksum.',
            `Delete on ${entry.path} is invalid for the replay state.`,
            { sequence: entry.sequence, path: entry.path },
          ),
        )
      }
    }

    lastSeenByPath.set(entry.path, entry.after_checksum)
    finalChecksums[entry.path] = entry.after_checksum
    modifiedPaths.add(entry.path)
  }

  return {
    final_checksums: finalChecksums,
    anomalies,
    modified_paths: [...modifiedPaths].sort(),
  }
}
