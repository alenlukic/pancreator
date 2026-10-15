import path from 'node:path'
import { statSync, writeFileSync } from 'node:fs'

import {
  fileExists,
  isRecord,
  readText,
  resolveInside,
  sha256,
  writeJsonAtomic,
} from './io.js'
import { resolveRunLayout } from './run-layout.js'
import { resolveRunCitation } from './workflow-artifacts.js'
import type {
  DeterministicResult,
  Invocation,
  RunState,
  StageOutcome,
  StageOutput,
} from './types.js'

interface EvidenceSnapshot {
  path: string
  description: string
  available: boolean
  required?: boolean
  sha256?: string
  gate_evidence?: Invocation['inputs']['references'][number]['gate_evidence']
}

interface StructuralRepair {
  field: string
  operation: string
}

export interface VerificationEvidencePacket {
  schema_version: 1
  run_id: string
  invocation_id: string
  status: 'pending' | 'passed' | 'failed' | 'blocked'
  workspace_fingerprint?: string
  incoming: EvidenceSnapshot[]
  prior_incoming: EvidenceSnapshot[]
  verifications: Record<string, unknown>[]
  checks: Record<string, unknown>[]
  structural_repairs: StructuralRepair[]
}

/** The same run-owned packet is extended across verification attempts and remediation returns. */
export function verificationEvidencePacketPath(
  root: string,
  runId: string,
): { absolute: string; relative: string } {
  return resolveRunLayout(root, runId).evidence('verification-packet.json')
}

function emptyPacket(
  runId: string,
  invocationId: string,
): VerificationEvidencePacket {
  return {
    schema_version: 1,
    run_id: runId,
    invocation_id: invocationId,
    status: 'pending',
    incoming: [],
    prior_incoming: [],
    verifications: [],
    checks: [],
    structural_repairs: [],
  }
}

function loadPacket(
  root: string,
  runId: string,
  invocationId: string,
): VerificationEvidencePacket {
  const target = verificationEvidencePacketPath(root, runId)
  const packet = emptyPacket(runId, invocationId)

  if (!fileExists(target.absolute)) {
    return packet
  }

  const original = readText(target.absolute)
  let raw: unknown

  try {
    raw = JSON.parse(original)
  } catch {
    raw = null
  }

  if (
    !isRecord(raw) ||
    raw.run_id !== runId ||
    [
      'incoming',
      'prior_incoming',
      'verifications',
      'checks',
      'structural_repairs',
    ].some(
      (key) =>
        raw[key] !== undefined &&
        (!Array.isArray(raw[key]) || !(raw[key] as unknown[]).every(isRecord)),
    )
  ) {
    const saved = `${target.absolute}.${sha256(original).slice(0, 12)}.original.json`
    if (!fileExists(saved)) {
      writeFileSync(saved, original, { flag: 'wx', mode: 0o600 })
    }
    packet.prior_incoming.push({
      path: path.relative(root, saved),
      description: 'Original evidence packet before envelope repair',
      available: true,
      sha256: sha256(original),
    })
    packet.structural_repairs.push({
      field: 'evidence_packet',
      operation:
        'Rebuild its envelope from the original record and current input references; preserve the original record.',
    })
    return packet
  }

  for (const key of [
    'incoming',
    'prior_incoming',
    'verifications',
    'checks',
    'structural_repairs',
  ] as const) {
    if (Array.isArray(raw[key])) {
      Object.assign(packet, { [key]: raw[key] })
    }
  }

  return packet
}

/** Resolve only recorded invocation aliases to an artifact that exists; never guess a replacement path. */
export function canonicalVerificationEvidencePath(
  root: string,
  evidencePath: string,
): string {
  const runId = /(?:^|\/)logs\/workflows\/([^/]+)/u.exec(evidencePath)?.[1]

  if (!runId) {
    return evidencePath
  }

  try {
    const suffix = /logs\/workflows\/[^/]+\/.+/u.exec(evidencePath)?.[0]
    const candidates = [evidencePath, ...(suffix ? [`runtime/${suffix}`] : [])]

    for (const candidate of candidates) {
      const resolved = resolveRunCitation(root, runId, candidate)

      if (resolved.path && (resolved.aliased || candidate !== evidencePath)) {
        return resolved.path
      }
    }

    return evidencePath
  } catch {
    return evidencePath
  }
}

function snapshotReference(
  root: string,
  reference: Invocation['inputs']['references'][number],
  workspaceRoot: string,
): EvidenceSnapshot {
  reference = {
    ...reference,
    path: canonicalVerificationEvidencePath(root, reference.path),
  }
  let absolute: string

  try {
    absolute = resolveInside(root, reference.path)
  } catch {
    try {
      absolute = resolveInside(
        workspaceRoot,
        path.resolve(root, reference.path),
      )
    } catch {
      return {
        path: reference.path,
        description: reference.description,
        available: false,
      }
    }
  }

  if (!fileExists(absolute) || !statSync(absolute).isFile()) {
    return {
      path: reference.path,
      description: reference.description,
      available: false,
    }
  }

  return {
    path: reference.path,
    description: reference.description,
    available: true,
    sha256: sha256(readText(absolute)),
    ...(reference.gate_evidence
      ? { gate_evidence: reference.gate_evidence }
      : {}),
  }
}

/** Publish incoming evidence before the verifier starts, preserving earlier snapshots rather than replacing their signal. */
export function prepareVerificationEvidence(
  root: string,
  state: RunState,
  invocation: Invocation,
  { persist = true }: { persist?: boolean } = {},
): VerificationEvidencePacket {
  const target = verificationEvidencePacketPath(root, state.run_id)
  const packet = loadPacket(root, state.run_id, invocation.invocation_id)
  const references = invocation.inputs.references.filter(
    (reference) =>
      reference.path !== target.relative &&
      reference.retrieval !== 'index_only',
  )
  const incoming = references.map((reference) =>
    snapshotReference(
      root,
      reference,
      path.resolve(root, state.workspace_root || '.'),
    ),
  )
  const current = new Set(
    incoming.map(
      (reference) => `${reference.path}:${reference.sha256 ?? 'missing'}`,
    ),
  )
  const historical = [
    ...packet.prior_incoming,
    ...packet.incoming.filter(
      (reference) =>
        !current.has(`${reference.path}:${reference.sha256 ?? 'missing'}`),
    ),
  ]
  packet.prior_incoming = historical.filter(
    (reference, index) =>
      historical.findIndex(
        (other) =>
          other.path === reference.path && other.sha256 === reference.sha256,
      ) === index,
  )
  packet.incoming = incoming.map((reference, index) => ({
    ...reference,
    required: references[index]?.retrieval !== 'conditional',
  }))
  packet.invocation_id = invocation.invocation_id
  packet.workspace_fingerprint = invocation.workspace_before.fingerprint
  packet.status = 'pending'

  if (persist) {
    writeJsonAtomic(target.absolute, packet)
  }

  return packet
}

function renameField(
  record: Record<string, unknown>,
  canonical: string,
  aliases: string[],
  field: string,
  repairs: StructuralRepair[],
): void {
  if (record[canonical] !== undefined) {
    return
  }

  const present = aliases.filter((alias) => record[alias] !== undefined)

  if (present.length !== 1) {
    return
  }

  const alias = present[0]!
  record[canonical] = record[alias]
  delete record[alias]
  repairs.push({
    field: `${field}.${canonical}`,
    operation: `Rename ${alias} without changing its value.`,
  })
}

/** Normalize representation only; never change verdicts, failures, observations, coverage, or claimed execution. */
export function normalizeVerificationEvidence(
  value: Record<string, unknown>,
): StructuralRepair[] {
  const repairs: StructuralRepair[] = []
  const verify =
    isRecord(value.data) && isRecord(value.data.verify)
      ? value.data.verify
      : null

  if (!verify) {
    return repairs
  }

  for (const [index, raw] of (Array.isArray(verify.qa_cases)
    ? verify.qa_cases
    : []
  ).entries()) {
    if (!isRecord(raw)) {
      continue
    }

    if (
      Array.isArray(raw.steps) &&
      raw.steps.length > 0 &&
      raw.steps.every((step) => typeof step === 'string')
    ) {
      raw.steps = raw.steps.join('\n')
      repairs.push({
        field: `verify.qa_cases[${index}].steps`,
        operation: 'Join ordered text steps without changing any step.',
      })
    }
  }

  for (const [index, raw] of (Array.isArray(verify.gate_evidence_citations)
    ? verify.gate_evidence_citations
    : []
  ).entries()) {
    if (!isRecord(raw)) {
      continue
    }

    const field = `verify.gate_evidence_citations[${index}]`
    renameField(raw, 'profile', ['profile_name'], field, repairs)
    renameField(raw, 'fingerprint', ['workspace_fingerprint'], field, repairs)
    renameField(raw, 'evidence_path', ['path', 'log_path'], field, repairs)
  }

  return repairs
}

/** Repair verifier-owned field and citation structure with an immutable original and an auditable receipt. */
export function repairVerificationSubmission(
  root: string,
  state: RunState,
  invocation: Invocation,
  submittedPath: string,
  value: Record<string, unknown>,
): VerificationEvidencePacket {
  const original = JSON.stringify(value)
  const repairs = normalizeVerificationEvidence(value)
  const verify =
    isRecord(value.data) && isRecord(value.data.verify)
      ? value.data.verify
      : null

  if (verify && Array.isArray(verify.gate_evidence_citations)) {
    for (const [index, raw] of verify.gate_evidence_citations.entries()) {
      if (!isRecord(raw) || typeof raw.evidence_path !== 'string') {
        continue
      }

      try {
        const resolved = canonicalVerificationEvidencePath(
          root,
          raw.evidence_path,
        )

        if (resolved !== raw.evidence_path) {
          raw.evidence_path = resolved
          repairs.push({
            field: `verify.gate_evidence_citations[${index}].evidence_path`,
            operation:
              'Resolve the existing invocation alias to the same evidence artifact.',
          })
        }
      } catch {
        // A missing or ambiguous artifact remains missing proof, not a formatting repair.
      }
    }
  }

  const packet = prepareVerificationEvidence(root, state, invocation)
  packet.structural_repairs.push(...repairs)

  if (repairs.length > 0) {
    const saved = resolveRunLayout(root, state.run_id).evidence(
      `${invocation.invocation_id}-${sha256(original).slice(0, 12)}-before-structure-repair.json`,
    )
    writeJsonAtomic(saved.absolute, JSON.parse(original) as unknown)
  }

  if (verify) {
    verify.evidence_packet = packet
    writeJsonAtomic(resolveInside(root, submittedPath), value)
  }

  writeJsonAtomic(
    verificationEvidencePacketPath(root, state.run_id).absolute,
    packet,
  )
  return packet
}

/** Extend the incoming packet with the verifier's actual observations and the harness's actual final gate result. */
export function finishVerificationEvidence(
  root: string,
  state: RunState,
  invocation: Invocation,
  output: StageOutput,
  checks: DeterministicResult[],
  outcome: StageOutcome,
): VerificationEvidencePacket {
  const packet = loadPacket(root, state.run_id, invocation.invocation_id)
  const verify = isRecord(output.data.verify) ? output.data.verify : {}
  const { evidence_packet: _packet, ...observations } = verify
  packet.verifications.push({
    invocation_id: invocation.invocation_id,
    ...observations,
  })
  packet.checks.push(
    ...checks.map((check) => ({
      invocation_id: invocation.invocation_id,
      ...check,
    })),
  )
  packet.status =
    outcome === 'success'
      ? 'passed'
      : outcome === 'blocked'
        ? 'blocked'
        : 'failed'
  packet.invocation_id = invocation.invocation_id
  writeJsonAtomic(
    verificationEvidencePacketPath(root, state.run_id).absolute,
    packet,
  )
  verify.evidence_packet = packet
  output.data.verify = verify
  return packet
}
