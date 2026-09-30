/**
 * Invocation attestation: guidance and context-reference read evidence, the
 * contract-file digest check, and the validation-artifact loaders.
 */

import { errorMessage } from '../errors.js'
import {
  isRecord,
  lastEvidenceLine,
  resolveInside,
  fileExists,
  sha256,
  readText,
  readJson,
} from '../io.js'
import type { Invocation, InvocationContractManifest } from '../types.js'
import {
  delegationPath,
  delegationValidationPath,
  invocationValidationPath,
  normalizeMarkdownContent,
  type InvocationValidationStatus,
  type ValidationArtifactLoad,
  type ValidationCheck,
  type ValidationResultArtifact,
} from './artifacts.js'

function attestationSections(value: unknown): Array<{
  id: unknown
  sha256: unknown
}> {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item) =>
    isRecord(item)
      ? { id: item.id, sha256: item.sha256 }
      : { id: undefined, sha256: undefined },
  )
}

/**
 * Check the worker's guidance declarations against the manifest's guidance
 * index. Progressive disclosure moved guidance bodies off the card, and these
 * checks are what make the mandated reads observable: every referenced
 * selection needs a worker decision — `read`, `skipped` with the reason the
 * trigger did not apply, or `reference_failed` with the concrete error. A
 * failed reference fails the attestation, because the worker acted without
 * guidance the policy holds it to; re-preparation resolves the source loudly.
 *
 * A manifest without a guidance index belongs to an invocation prepared before
 * guidance attestation existed (or one whose contract references no guidance),
 * so it requires nothing.
 */
/**
 * Expected `final_line` read evidence for each referenced guidance selection,
 * keyed by policy id, source path, and content digest. Built from the
 * invocation's own policy snapshot, so the check needs no source file that
 * may have drifted since preparation.
 */
function expectedGuidanceFinalLines(
  invocation: Invocation,
): Map<string, string> {
  const expected = new Map<string, string>()
  const policySets = [
    invocation.policies,
    invocation.delegation?.policies ?? [],
  ]

  for (const policies of policySets) {
    for (const policy of policies) {
      for (const guidance of policy.guidance ?? []) {
        if (!guidance.reference) {
          continue
        }

        expected.set(
          `${policy.id}\0${guidance.source_path}\0${guidance.reference.content_sha256}`,
          lastEvidenceLine(guidance.content),
        )
      }
    }
  }

  return expected
}

function guidanceAttestationChecks(
  manifest: InvocationContractManifest,
  attestation: Record<string, unknown>,
  expectedFinalLines: Map<string, string>,
): ValidationCheck[] {
  const expected = manifest.guidance ?? []

  if (expected.length === 0) {
    return []
  }

  const declared = Array.isArray(attestation.guidance)
    ? attestation.guidance
    : []
  const checks: ValidationCheck[] = [
    {
      id: 'attestation.guidance_count',
      passed: declared.length === expected.length,
      message:
        declared.length === expected.length
          ? `Attestation covers all ${expected.length} guidance reference(s)`
          : `Attestation MUST declare all ${expected.length} guidance reference(s) in manifest order (got ${declared.length})`,
    },
  ]

  for (const [index, entry] of expected.entries()) {
    const id = `attestation.guidance.${entry.policy_id}.${index + 1}`
    const claim = isRecord(declared[index]) ? declared[index] : {}
    const identityMatches =
      claim.policy_id === entry.policy_id &&
      claim.source_path === entry.source_path &&
      claim.content_sha256 === entry.content_sha256

    if (!identityMatches) {
      checks.push({
        id,
        passed: false,
        message:
          `Guidance attestation position ${index + 1} MUST name policy ` +
          `'${entry.policy_id}', source '${entry.source_path}', and digest ` +
          `'${entry.content_sha256}'`,
      })
      continue
    }

    const reason = typeof claim.reason === 'string' ? claim.reason.trim() : ''
    const error = typeof claim.error === 'string' ? claim.error.trim() : ''

    switch (claim.status) {
      case 'read': {
        // The final line is deliberately not printed on the card: quoting it
        // is what separates "opened the selection" from "echoed the card".
        const expectedFinalLine = expectedFinalLines.get(
          `${entry.policy_id}\0${entry.source_path}\0${entry.content_sha256}`,
        )
        const declaredFinalLine =
          typeof claim.final_line === 'string' ? claim.final_line : ''
        const finalLineMatches =
          expectedFinalLine === undefined ||
          declaredFinalLine.trim() === expectedFinalLine.trim()

        checks.push({
          id,
          passed: finalLineMatches && declaredFinalLine.trim().length > 0,
          message:
            finalLineMatches && declaredFinalLine.trim().length > 0
              ? `Guidance ${entry.source_path} (${entry.policy_id}) is attested as read with matching final-line evidence`
              : declaredFinalLine.trim().length === 0
                ? `A read guidance entry MUST quote the selection's last content line (skipping trailing dividers) as final_line for ${entry.source_path}`
                : // The source can move after the card was written, so the
                  // repair names the snapshot that holds the attested bytes.
                  `Guidance ${entry.source_path} (${entry.policy_id}) final_line does not match the selected content's last content line (trailing divider lines are skipped). When the source file changed after the card was written, quote the last content line of this selection from the invocation JSON snapshot instead`,
        })
        break
      }
      case 'skipped': {
        // Naming the field is the whole repair: the two prose slots are
        // mutually exclusive, and a worker that wrote the skip reason into
        // `final_line` needs to be told which slot the validator reads.
        const misplaced =
          typeof claim.final_line === 'string' &&
          claim.final_line.trim().length > 0

        checks.push({
          id,
          passed: reason.length > 0,
          message:
            reason.length > 0
              ? `Guidance ${entry.source_path} (${entry.policy_id}) is skipped: ${reason}`
              : `A skipped guidance read MUST carry the concrete reason the trigger did not apply in \`reason\` for ${entry.source_path}` +
                (misplaced
                  ? '; `final_line` is read evidence for a completed read and does not satisfy `reason`'
                  : ''),
        })
        break
      }
      case 'reference_failed':
        checks.push({
          id,
          passed: false,
          message:
            error.length > 0
              ? `Guidance ${entry.source_path} (${entry.policy_id}) was unreadable: ${error} — repair the source or read the selection from the invocation JSON snapshot`
              : `A reference_failed guidance entry MUST carry the concrete read error for ${entry.source_path}`,
        })
        break
      case 'pending':
        checks.push({
          id,
          passed: false,
          message:
            `Guidance ${entry.source_path} (${entry.policy_id}) is still the scaffold value pending; ` +
            'set it to read, or to skipped with the reason the trigger does not apply',
        })
        break
      default:
        checks.push({
          id,
          passed: false,
          message: `Guidance status MUST be read, skipped, or reference_failed (got ${JSON.stringify(claim.status)})`,
        })
    }
  }

  return checks
}

/**
 * Check the attestation of the context reference the invocation carried.
 *
 * The reference is a required read that the card never inlines, so the worker
 * owes the same status flip guidance owes. There is no `final_line` here: the
 * card prints the digest and the source stays readable, so the digest match is
 * the evidence a drifted or substituted source cannot fake.
 */
function contextReferenceAttestationChecks(
  invocation: Invocation,
  attestation: Record<string, unknown>,
  stageResult: unknown,
): ValidationCheck[] {
  const expected = invocation.inputs.context_reference

  if (!expected) {
    return []
  }

  const declared = Array.isArray(attestation.context_references)
    ? attestation.context_references
    : []
  const id = `attestation.context_reference.${expected.source_path}`
  const claim = isRecord(declared[0]) ? declared[0] : {}

  if (
    declared.length !== 1 ||
    claim.source_path !== expected.source_path ||
    claim.content_sha256 !== expected.content_sha256
  ) {
    return [
      {
        id,
        passed: false,
        message:
          'Attestation MUST declare one context reference naming source ' +
          `'${expected.source_path}' and digest '${expected.content_sha256}'`,
      },
    ]
  }

  const reason = typeof claim.reason === 'string' ? claim.reason.trim() : ''
  const error = typeof claim.error === 'string' ? claim.error.trim() : ''
  const drift =
    expected.reference_status === 'current'
      ? null
      : expected.reference_status === 'drifted'
        ? `the source drifted after the run recorded it (recorded sha256:${expected.content_sha256}, actual ${
            expected.actual_content_sha256
              ? `sha256:${expected.actual_content_sha256}`
              : 'unavailable'
          })`
        : `the source is missing at ${expected.source_path}`

  switch (claim.status) {
    case 'read':
      // The card recorded the digest at preparation. A read attested against a
      // drifted or missing source claims bytes the worker cannot have read, so
      // the audited chain refuses it instead of letting drift pass silently.
      return [
        {
          id,
          passed: drift === null,
          message:
            drift === null
              ? `Context reference ${expected.source_path} is attested as read`
              : `Context reference ${expected.source_path} MUST NOT be attested as read: ${drift}. Report it as reference_failed with a blocked result.`,
        },
      ]
    case 'skipped':
      // A skip is a judgment that the read trigger did not apply. It is not a
      // route around drift: a drifted or missing source must surface as a
      // reference failure whatever the worker decided about reading it.
      return [
        {
          id,
          passed: drift === null && reason.length > 0,
          message:
            drift !== null
              ? `Context reference ${expected.source_path} MUST NOT be attested as skipped: ${drift}. Report it as reference_failed with a blocked result.`
              : reason.length > 0
                ? `Context reference ${expected.source_path} is skipped: ${reason}`
                : `A skipped context reference MUST carry the concrete reason the trigger did not apply for ${expected.source_path}`,
        },
      ]
    case 'reference_failed':
      // Mirrors the contract attestation: a reference failure is accepted only
      // with its concrete error and a blocked stage result, so an unreadable or
      // drifted parent stays loud and never becomes a product verdict.
      return [
        {
          id,
          passed: error.length > 0 && stageResult === 'blocked',
          message:
            error.length === 0
              ? `A reference_failed context reference MUST carry the concrete read error for ${expected.source_path}`
              : stageResult !== 'blocked'
                ? `A reference_failed context reference MUST accompany result blocked (${expected.source_path}: ${error})`
                : `Context reference ${expected.source_path} is reported as a reference failure: ${error}`,
        },
      ]
    case 'pending':
      return [
        {
          id,
          passed: false,
          message:
            `Context reference ${expected.source_path} is still the scaffold value pending; ` +
            'set it to read, or to skipped with the reason the trigger does not apply',
        },
      ]
    default:
      return [
        {
          id,
          passed: false,
          message: `Context reference status MUST be read, skipped, or reference_failed (got ${JSON.stringify(claim.status)})`,
        },
      ]
  }
}

/**
 * Check a worker's read attestation against the invocation contract manifest.
 *
 * The attestation is the only observable the harness has for a referenced
 * delivery, so it is checked for exact section order, cardinality, ids, and
 * digests. A `reference_failed` report is accepted only next to a `blocked`
 * stage result carrying the concrete read error, which keeps an unreadable
 * contract loud instead of letting it pass as a product verdict.
 *
 * `pending` is the scaffold value and is rejected here. The scaffold cannot know
 * whether the worker read the contract, so submitting the prefilled value would
 * record a claim nobody made.
 */
/**
 * A card that declares model 'auto' delegates model selection to the
 * executor, so the worker attests the model it actually ran as; any other
 * declaration must match exactly.
 */
export function attestationModelMatches(
  attested: unknown,
  declared: string,
): boolean {
  return declared === 'auto'
    ? typeof attested === 'string' && attested.trim().length > 0
    : attested === declared
}

/**
 * The byte basis of `contract_sha256`: LF line endings and exactly one final
 * newline. The renderer hashes this form, and the submission check re-hashes
 * the file on disk in the same form, so the two agree on identical content.
 */
export function normalizeContractMarkdown(markdown: string): string {
  const normalized = normalizeMarkdownContent(markdown)

  return normalized.endsWith('\n') ? normalized : `${normalized}\n`
}

/**
 * Re-hash the delivered contract file and compare it with the manifest digest.
 *
 * The harness writes the card and its manifest together, so the worker never
 * recomputes the digest. This check is what keeps that promise: a card edited
 * on disk after delivery no longer matches what the worker was told it read.
 */
function contractFileDigestCheck(
  root: string,
  manifest: InvocationContractManifest,
): ValidationCheck {
  const id = 'attestation.contract_file_digest'
  let actual: string

  try {
    const absolute = resolveInside(root, manifest.contract_path)

    if (!fileExists(absolute)) {
      return {
        id,
        passed: false,
        message:
          `Contract file ${manifest.contract_path} is missing at submission, ` +
          'so the harness cannot confirm the delivered contract. Set the ' +
          'attestation status to reference_failed with this message as the error.',
      }
    }

    actual = sha256(normalizeContractMarkdown(readText(absolute)))
  } catch (error) {
    return {
      id,
      passed: false,
      message:
        `Contract file ${manifest.contract_path} is unreadable at submission ` +
        `(${errorMessage(error)}). Set the attestation status to ` +
        'reference_failed with this message as the error.',
    }
  }

  return actual === manifest.contract_sha256
    ? {
        id,
        passed: true,
        message: 'Contract file on disk matches the delivered contract digest',
      }
    : {
        id,
        passed: false,
        message:
          `The contract changed after delivery: ${manifest.contract_path} ` +
          `now hashes to sha256:${actual}, not the delivered ` +
          `sha256:${manifest.contract_sha256}. Re-read the complete contract ` +
          'before you submit; when it still differs, set the attestation ' +
          'status to reference_failed with this message as the error.',
      }
}

export function validateInvocationAttestation(
  invocation: Invocation,
  output: unknown,
  options: {
    /**
     * Harness root the contract path resolves against. When present, the
     * contract file on disk is re-hashed and compared with the manifest.
     */
    root?: string
  } = {},
): {
  passed: boolean
  status: 'read' | 'reference_failed' | 'pending' | 'missing' | 'malformed'
  checks: ValidationCheck[]
} {
  const manifest = invocation.contract_manifest
  const record = isRecord(output) ? output : {}
  const attestation = isRecord(record.invocation_attestation)
    ? record.invocation_attestation
    : null

  if (!manifest) {
    return {
      passed: true,
      status: 'missing',
      checks: [
        {
          id: 'attestation.not_required',
          passed: true,
          message:
            'Invocation carries no contract manifest, so no read attestation is required',
        },
      ],
    }
  }

  if (!attestation) {
    return {
      passed: false,
      status: 'missing',
      checks: [
        {
          id: 'attestation.present',
          passed: false,
          message:
            'Output MUST declare invocation_attestation for a referenced invocation contract',
        },
      ],
    }
  }

  const pending = attestation.status === 'pending'
  const status =
    attestation.status === 'read' || attestation.status === 'reference_failed'
      ? attestation.status
      : null
  const checks: ValidationCheck[] = [
    {
      id: 'attestation.status',
      passed: status !== null,
      message:
        status !== null
          ? `Attestation status is '${status}'`
          : pending
            ? 'Attestation status is still the scaffold value pending; set it to read after reading the complete contract'
            : `Attestation status MUST be read or reference_failed (got ${JSON.stringify(attestation.status)})`,
    },
    {
      id: 'attestation.invocation_id',
      passed: attestation.invocation_id === invocation.invocation_id,
      message:
        attestation.invocation_id === invocation.invocation_id
          ? 'Attestation names the active invocation'
          : `Attestation invocation_id MUST equal '${invocation.invocation_id}'`,
    },
    {
      id: 'attestation.model',
      passed: attestationModelMatches(
        attestation.model,
        invocation.stage.model,
      ),
      message: attestationModelMatches(
        attestation.model,
        invocation.stage.model,
      )
        ? invocation.stage.model === 'auto'
          ? `Attestation records executor-selected model '${String(attestation.model)}' under declared model 'auto'`
          : `Attestation records effective model '${invocation.stage.model}'`
        : invocation.stage.model === 'auto'
          ? `Attestation model MUST name the executor-selected model when the declared model is 'auto'`
          : `Attestation model MUST equal '${invocation.stage.model}'`,
    },
    {
      id: 'attestation.contract_path',
      passed: attestation.contract_path === manifest.contract_path,
      message:
        attestation.contract_path === manifest.contract_path
          ? 'Attestation names the canonical contract path'
          : `Attestation contract_path MUST equal '${manifest.contract_path}'`,
    },
  ]

  if (status === null) {
    return { passed: false, status: pending ? 'pending' : 'malformed', checks }
  }

  if (status === 'reference_failed') {
    const error =
      typeof attestation.error === 'string' ? attestation.error.trim() : ''

    checks.push(
      {
        id: 'attestation.reference_failure_reason',
        passed: error.length > 0,
        message:
          error.length > 0
            ? `Reported reference failure: ${error}`
            : 'A reference_failed attestation MUST carry the concrete read error in error',
      },
      {
        id: 'attestation.reference_failure_blocks',
        passed: record.result === 'blocked',
        message:
          record.result === 'blocked'
            ? 'Reference failure is reported as a blocked stage result'
            : 'A reference_failed attestation MUST accompany result blocked',
      },
    )

    return {
      passed: checks.every((check) => check.passed),
      status,
      checks,
    }
  }

  checks.push({
    id: 'attestation.contract_digest',
    passed: attestation.contract_sha256 === manifest.contract_sha256,
    message:
      attestation.contract_sha256 === manifest.contract_sha256
        ? 'Attestation matches the contract digest'
        : `Attestation contract_sha256 MUST equal '${manifest.contract_sha256}'`,
  })

  if (options.root !== undefined) {
    checks.push(contractFileDigestCheck(options.root, manifest))
  }

  // The whole contract digest above already proves the worker held the exact
  // card. A per-section digest echo re-proves the same thing at ~19 lines of
  // transcription per attempt, so it is validated only when a worker (or a
  // legacy scaffold) volunteers it — never required.
  if (attestation.sections !== undefined) {
    const declared = attestationSections(attestation.sections)

    checks.push({
      id: 'attestation.section_count',
      passed: declared.length === manifest.sections.length,
      message:
        declared.length === manifest.sections.length
          ? `Attestation covers all ${manifest.sections.length} contract sections`
          : `Attestation MUST declare all ${manifest.sections.length} contract sections (got ${declared.length})`,
    })

    for (const [index, section] of manifest.sections.entries()) {
      const claim = declared[index]
      const matches =
        claim?.id === section.id && claim.sha256 === section.sha256

      checks.push({
        id: `attestation.section.${section.id}`,
        passed: matches,
        message: matches
          ? `Section ${section.id} is attested in order with a matching digest`
          : `Attestation position ${index + 1} MUST be section '${section.id}' with digest '${section.sha256}'`,
      })
    }
  }

  // Guidance read evidence is required whenever the manifest references
  // guidance: the card carries only digests, so a self-declared "I read the
  // contract" cannot cover external selections the worker never opened.
  checks.push(
    ...guidanceAttestationChecks(
      manifest,
      attestation,
      expectedGuidanceFinalLines(invocation),
    ),
    ...contextReferenceAttestationChecks(
      invocation,
      attestation,
      record.result,
    ),
  )

  return {
    passed: checks.every((check) => check.passed),
    status: 'read',
    checks,
  }
}

export function loadValidationArtifact(
  root: string,
  relativePath: string,
): ValidationArtifactLoad {
  try {
    const absolute = resolveInside(root, relativePath)

    if (!fileExists(absolute)) {
      return { state: 'missing' }
    }

    const value = readJson(absolute)

    if (
      !isRecord(value) ||
      value.schema_version !== 1 ||
      typeof value.run_id !== 'string' ||
      typeof value.invocation_id !== 'string' ||
      (value.kind !== 'invocation' && value.kind !== 'delegation') ||
      (value.status !== 'pass' && value.status !== 'fail') ||
      typeof value.summary !== 'string' ||
      !Array.isArray(value.checks) ||
      typeof value.validated_at !== 'string' ||
      typeof value.artifact_path !== 'string'
    ) {
      return {
        state: 'malformed',
        reason: 'Validation artifact has invalid shape',
      }
    }

    return value as unknown as ValidationResultArtifact
  } catch (error) {
    return { state: 'malformed', reason: errorMessage(error) }
  }
}

export function loadInvocationValidationStatus(
  root: string,
  runId: string,
  invocationId: string,
): InvocationValidationStatus {
  const invocationValidationPathValue = invocationValidationPath(
    runId,
    invocationId,
    root,
  )
  const delegationValidationPathValue = delegationValidationPath(
    runId,
    invocationId,
    root,
  )
  const delegationPathValue = delegationPath(runId, invocationId, root)

  return {
    invocation: loadValidationArtifact(root, invocationValidationPathValue),
    delegation: loadValidationArtifact(root, delegationValidationPathValue),
    invocation_validation_path: invocationValidationPathValue,
    delegation_validation_path: delegationValidationPathValue,
    delegation_path: delegationPathValue,
  }
}
