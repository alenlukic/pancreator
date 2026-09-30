import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  attestationModelMatches,
  validateInvocationAttestation,
} from '../../src/lib/validation.js'
import {
  buildInvocationContractManifest,
  renderInvocationMarkdown,
} from '../../src/lib/render.js'
import { buildContextReference } from '../../src/lib/context.js'
import { scaffoldStageOutput } from '../../src/lib/requirements/scaffold.js'
import { createFixture } from '../fixture-template.js'
import type { Invocation, InvocationAttestation } from '../../src/lib/types.js'
import { readJson } from './validation-helpers.js'
import { fixtureInvocation } from './validation-invocation-helpers.js'

type ReadAttestation = Extract<
  InvocationAttestation,
  { contract_sha256: string }
>

function attestedFixture(root: string): {
  invocation: Invocation
  attestation: ReadAttestation
} {
  const invocation = fixtureInvocation(root, 'implement')
  const contractPath = `runtime/logs/workflows/run-fixture/invocations/${invocation.invocation_id}.md`

  invocation.contract_manifest = buildInvocationContractManifest(
    contractPath,
    renderInvocationMarkdown(invocation),
    invocation.policies,
  )

  const manifest = invocation.contract_manifest

  return {
    invocation,
    attestation: {
      invocation_id: invocation.invocation_id,
      model: invocation.stage.model,
      contract_path: manifest.contract_path,
      contract_sha256: manifest.contract_sha256,
      status: 'read',
      sections: manifest.sections.map((section) => ({
        id: section.id,
        sha256: section.sha256,
      })),
      ...(manifest.guidance?.length
        ? {
            guidance: manifest.guidance.map((entry) => ({
              policy_id: entry.policy_id,
              source_path: entry.source_path,
              content_sha256: entry.content_sha256,
              status: 'read' as const,
              final_line: guidanceFinalLine(invocation, entry),
            })),
          }
        : {}),
    },
  }
}

/** Last non-empty line of the selection, from the invocation's own policies. */
function guidanceFinalLine(
  invocation: Invocation,
  entry: { policy_id: string; source_path: string },
): string {
  const divider = /^\s*(?:[-_*]\s*){3,}$/u

  for (const policy of invocation.policies) {
    if (policy.id !== entry.policy_id) {
      continue
    }

    for (const guidance of policy.guidance ?? []) {
      if (guidance.source_path === entry.source_path) {
        const lines = guidance.content.split('\n')

        for (let index = lines.length - 1; index >= 0; index -= 1) {
          if (lines[index].trim().length > 0 && !divider.test(lines[index])) {
            return lines[index]
          }
        }
      }
    }
  }

  return ''
}

/** A submitted output carrying whatever the worker declared, valid or not. */
function attestedOutput(
  attestation: unknown,
  result: 'success' | 'blocked' = 'success',
): Record<string, unknown> {
  return {
    schema_version: 1,
    result,
    ...(attestation ? { invocation_attestation: attestation } : {}),
  }
}

test('attestation validator passes a complete in-order declaration', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)

  const validate = (output: Record<string, unknown>) =>
    validateInvocationAttestation(invocation, output)
  const failedCheck = (
    result: ReturnType<typeof validateInvocationAttestation>,
    id: string,
  ) => result.checks.find((check) => check.id === id)?.passed === false
  const firstFailureMessage = (
    result: ReturnType<typeof validateInvocationAttestation>,
  ) => result.checks.find((check) => !check.passed)?.message ?? ''

  const complete = validate(attestedOutput(attestation))

  assert.equal(complete.passed, true)
  assert.equal(complete.status, 'read')

  const missing = validate(attestedOutput(undefined))

  assert.equal(missing.passed, false)
  assert.equal(missing.status, 'missing')

  const pending = validate(
    attestedOutput({ ...attestation, status: 'pending' }),
  )

  assert.equal(pending.passed, false)
  assert.equal(pending.status, 'pending')
  assert.ok(failedCheck(pending, 'attestation.status'))

  const malformed = validate(
    attestedOutput({ ...attestation, status: 'skimmed' }),
  )

  assert.equal(malformed.passed, false)
  assert.equal(malformed.status, 'malformed')
  assert.ok(failedCheck(malformed, 'attestation.status'))

  const partial = validate(
    attestedOutput({
      ...attestation,
      sections: attestation.sections?.slice(0, -1),
    }),
  )

  assert.equal(partial.passed, false)
  assert.ok(failedCheck(partial, 'attestation.section_count'))

  const reordered = validate(
    attestedOutput({
      ...attestation,
      sections: [...(attestation.sections ?? [])].reverse(),
    }),
  )

  assert.equal(reordered.passed, false)

  const sections = [...(attestation.sections ?? [])]
  const first = sections[0]

  assert.ok(first)
  sections[0] = { id: first.id, sha256: 'stale-digest' }

  const staleSection = validate(attestedOutput({ ...attestation, sections }))

  assert.equal(staleSection.passed, false)
  assert.ok(failedCheck(staleSection, `attestation.section.${first.id}`))

  const staleContract = validate(
    attestedOutput({ ...attestation, contract_sha256: 'stale' }),
  )

  assert.equal(staleContract.passed, false)
  assert.ok(failedCheck(staleContract, 'attestation.contract_digest'))

  assert.ok(
    attestation.guidance?.length,
    'the fixture contract references guidance',
  )

  const withFirstGuidance = (
    patch: Partial<NonNullable<ReadAttestation['guidance']>[number]>,
  ) =>
    attestation.guidance?.map((entry, index) =>
      index === 0 ? { ...entry, ...patch } : entry,
    )

  const pendingGuidance = validate(
    attestedOutput({
      ...attestation,
      guidance: withFirstGuidance({ status: 'pending' }),
    }),
  )

  assert.equal(pendingGuidance.passed, false)
  assert.match(
    firstFailureMessage(pendingGuidance),
    /still the scaffold value pending/u,
  )

  const skippedBare = validate(
    attestedOutput({
      ...attestation,
      guidance: withFirstGuidance({ status: 'skipped' }),
    }),
  )

  assert.equal(skippedBare.passed, false)
  assert.match(
    firstFailureMessage(skippedBare),
    /MUST carry the concrete reason/u,
  )

  // AC-002. The scaffold prefills both prose slots, and a worker that wrote
  // its skip reason into the read-evidence slot must be told which slot the
  // validator reads rather than left to guess from a generic refusal.
  const skippedIntoFinalLine = validate(
    attestedOutput({
      ...attestation,
      guidance: withFirstGuidance({
        status: 'skipped',
        final_line: 'The task changes no file the trigger governs.',
        reason: '',
      }),
    }),
  )

  assert.equal(skippedIntoFinalLine.passed, false)
  assert.match(firstFailureMessage(skippedIntoFinalLine), /in `reason`/u)
  assert.match(
    firstFailureMessage(skippedIntoFinalLine),
    /`final_line` is read evidence/u,
  )

  const skippedReasoned = validate(
    attestedOutput({
      ...attestation,
      guidance: withFirstGuidance({
        status: 'skipped',
        reason: 'The task changes no file the trigger governs.',
      }),
    }),
  )

  assert.equal(skippedReasoned.passed, true)

  // Unreadable guidance means the worker acted without policy it is held to,
  // so the attestation fails rather than recording the loss as an aside.
  const referenceFailed = validate(
    attestedOutput({
      ...attestation,
      guidance: withFirstGuidance({
        status: 'reference_failed',
        error: 'ENOENT: guidance source missing',
      }),
    }),
  )

  assert.equal(referenceFailed.passed, false)
  assert.match(
    firstFailureMessage(referenceFailed),
    /ENOENT: guidance source missing/u,
  )

  // A self-declared "I read the contract" cannot cover external selections
  // the worker never opened, so omitting the entries fails the attestation.
  const { guidance: _guidance, ...withoutGuidance } = attestation
  const absent = validate(attestedOutput(withoutGuidance))

  assert.equal(absent.passed, false)
  assert.ok(failedCheck(absent, 'attestation.guidance_count'))

  // A read entry without its final-line quote is a path list, not evidence.
  const missingQuote = validate(
    attestedOutput({
      ...attestation,
      guidance: withFirstGuidance({ final_line: undefined }),
    }),
  )

  assert.equal(missingQuote.passed, false)
  assert.match(
    firstFailureMessage(missingQuote),
    /MUST quote the selection's last content line/u,
  )

  // A wrong quote fails: the line validates against the selected bytes.
  const mismatch = validate(
    attestedOutput({
      ...attestation,
      guidance: withFirstGuidance({
        final_line: 'not the selection closing line',
      }),
    }),
  )

  assert.equal(mismatch.passed, false)
  assert.match(firstFailureMessage(mismatch), /final_line does not match/u)

  const referenceFailure = {
    invocation_id: attestation.invocation_id,
    model: invocation.stage.model,
    contract_path: attestation.contract_path,
    status: 'reference_failed',
    error: 'ENOENT: contract path could not be opened',
  }
  const blocked = validate(attestedOutput(referenceFailure, 'blocked'))

  assert.equal(blocked.passed, true)
  assert.equal(blocked.status, 'reference_failed')
  assert.ok(
    blocked.checks.some((check) => check.message.includes('ENOENT')),
    'the failed reference MUST stay visible in the checks',
  )

  const reportedAsSuccess = validate(attestedOutput(referenceFailure))

  assert.equal(reportedAsSuccess.passed, false)
  assert.ok(
    failedCheck(reportedAsSuccess, 'attestation.reference_failure_blocks'),
  )

  const { error: _error, ...withoutReason } = referenceFailure
  const unreasoned = validate(attestedOutput(withoutReason, 'blocked'))

  assert.equal(unreasoned.passed, false)

  // An invocation prepared before guidance attestation existed carries no
  // guidance index, and its worker owes no entries.
  const legacy = structuredClone(invocation)

  assert.ok(legacy.contract_manifest)
  delete legacy.contract_manifest.guidance
  assert.equal(
    validateInvocationAttestation(legacy, attestedOutput(withoutGuidance))
      .passed,
    true,
  )

  assert.equal(
    validateInvocationAttestation(
      fixtureInvocation(root, 'implement'),
      attestedOutput(undefined),
    ).passed,
    true,
  )
})

test('submission re-hashes the delivered contract file against the manifest digest', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)
  const manifest = invocation.contract_manifest

  assert.ok(manifest)

  const contractFile = path.join(root, manifest.contract_path)
  const contract = renderInvocationMarkdown(invocation)
  const validate = () =>
    validateInvocationAttestation(invocation, attestedOutput(attestation), {
      root,
    })
  const fileCheck = (
    result: ReturnType<typeof validateInvocationAttestation>,
  ) =>
    result.checks.find(
      (check) => check.id === 'attestation.contract_file_digest',
    )

  mkdirSync(path.dirname(contractFile), { recursive: true })
  writeFileSync(contractFile, contract)
  assert.equal(validate().passed, true)
  assert.equal(fileCheck(validate())?.passed, true)

  // CRLF line endings are the same contract under the digest basis.
  writeFileSync(contractFile, contract.replaceAll('\n', '\r\n'))
  assert.equal(validate().passed, true)

  // An edit after delivery fails the attestation even though the worker
  // copied the delivered digest exactly, and the message says to re-read.
  writeFileSync(contractFile, `${contract}\nAn appended instruction.\n`)

  const changed = validate()

  assert.equal(changed.passed, false)
  assert.equal(fileCheck(changed)?.passed, false)
  assert.match(
    fileCheck(changed)?.message ?? '',
    /contract changed after delivery.*Re-read the complete contract/su,
  )

  rmSync(contractFile)

  const missing = validate()

  assert.equal(missing.passed, false)
  assert.match(fileCheck(missing)?.message ?? '', /is missing at submission/u)

  // Without a root (a pure record check), the file is not consulted, and a
  // reference_failed attestation never reaches the file check.
  assert.equal(
    validateInvocationAttestation(invocation, attestedOutput(attestation))
      .passed,
    true,
  )
  assert.equal(
    fileCheck(
      validateInvocationAttestation(
        invocation,
        attestedOutput(
          { ...attestation, status: 'reference_failed', error: 'unreadable' },
          'blocked',
        ),
        { root },
      ),
    ),
    undefined,
  )
})

test('attestation model matching accepts executor-selected models under auto', () => {
  assert.equal(attestationModelMatches('claude-opus-5[1m]', 'auto'), true)
  assert.equal(attestationModelMatches('  ', 'auto'), false)
  assert.equal(attestationModelMatches(undefined, 'auto'), false)
  assert.equal(
    attestationModelMatches(
      'gpt-5.6-terra[context=272k,reasoning=high,fast=false]',
      'gpt-5.6-terra[context=272k,reasoning=high,fast=false]',
    ),
    true,
  )
  assert.equal(attestationModelMatches('another-model', 'gpt-5.6-terra'), false)
})

test('guidance final-line evidence skips a trailing Markdown divider', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)

  assert.ok(attestation.guidance?.length)

  const target = attestation.guidance[0]
  const policy = invocation.policies.find(
    (item) => item.id === target.policy_id,
  )
  const guidance = policy?.guidance?.find(
    (item) => item.source_path === target.source_path,
  )

  assert.ok(guidance)

  const contentLine = guidanceFinalLine(invocation, target)

  assert.ok(contentLine.trim().length > 0)
  guidance.content = `${guidance.content}\n\n---\n`

  const evidence = attestation.guidance.map((entry, index) =>
    index === 0 ? { ...entry, final_line: contentLine } : entry,
  )
  const accepted = validateInvocationAttestation(
    invocation,
    attestedOutput({ ...attestation, guidance: evidence }),
  )

  assert.equal(accepted.passed, true)

  const dividerQuote = attestation.guidance.map((entry, index) =>
    index === 0 ? { ...entry, final_line: '---' } : entry,
  )
  const rejected = validateInvocationAttestation(
    invocation,
    attestedOutput({ ...attestation, guidance: dividerQuote }),
  )

  assert.equal(rejected.passed, false)
  assert.match(
    rejected.checks.find((check) => !check.passed)?.message ?? '',
    /final_line does not match/u,
  )
})

test('a parent context reference is scaffolded pending and must be declared read', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)
  const parentPath = 'runtime/specs/parent-specification.md'

  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })
  writeFileSync(
    path.join(root, parentPath),
    '# Parent specification\n\nOne requirement.\n',
  )

  const reference = buildContextReference(root, parentPath)

  invocation.inputs.context_reference = {
    ...reference,
    reference_status: 'current',
  }

  // The scaffold prefills the entry the worker owes, at the digest the card
  // printed, with the status only the worker may change.
  const scaffoldPath =
    'runtime/logs/workflows/run-fixture/outputs/scaffold.json'

  scaffoldStageOutput(root, invocation, scaffoldPath)

  const scaffolded = readJson<{
    invocation_attestation: {
      context_references: Array<Record<string, unknown>>
    }
  }>(path.join(root, scaffoldPath))

  assert.deepEqual(scaffolded.invocation_attestation.context_references, [
    {
      source_path: parentPath,
      content_sha256: reference.content_sha256,
      status: 'pending',
    },
  ])

  const declared = (entry: Record<string, unknown>) =>
    validateInvocationAttestation(
      invocation,
      attestedOutput({ ...attestation, context_references: [entry] }),
    )
  const base = {
    source_path: parentPath,
    content_sha256: reference.content_sha256,
  }
  const pending = declared({ ...base, status: 'pending' })

  assert.equal(pending.passed, false)
  assert.match(
    pending.checks.find((check) => !check.passed)?.message ?? '',
    /still the scaffold value pending/u,
  )

  assert.equal(declared({ ...base, status: 'read' }).passed, true)
  assert.equal(
    declared({ ...base, status: 'skipped' }).passed,
    false,
    'a skipped reference owes the reason the trigger did not apply',
  )
  assert.equal(
    declared({ ...base, status: 'skipped', reason: 'No shared context.' })
      .passed,
    true,
  )

  // An omitted or re-digested declaration cannot pass for a read.
  assert.equal(
    validateInvocationAttestation(invocation, attestedOutput(attestation))
      .passed,
    false,
  )
  assert.equal(
    declared({ ...base, content_sha256: 'other', status: 'read' }).passed,
    false,
  )
})

test('a read attestation against a drifted parent is rejected and a blocked reference failure is accepted', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)
  const parentPath = 'runtime/specs/parent-specification.md'

  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })
  writeFileSync(
    path.join(root, parentPath),
    '# Parent specification\n\nOne requirement.\n',
  )

  const reference = buildContextReference(root, parentPath)
  const actual = 'b'.repeat(64)

  invocation.inputs.context_reference = {
    ...reference,
    reference_status: 'drifted',
    actual_content_sha256: actual,
  }

  const base = {
    source_path: parentPath,
    content_sha256: reference.content_sha256,
  }
  const declared = (
    entry: Record<string, unknown>,
    result: 'success' | 'blocked' = 'success',
  ) =>
    validateInvocationAttestation(
      invocation,
      attestedOutput({ ...attestation, context_references: [entry] }, result),
    )
  const read = declared({ ...base, status: 'read' })
  const readFailure = read.checks.find((check) => !check.passed)?.message ?? ''

  assert.equal(read.passed, false)
  assert.match(readFailure, /MUST NOT be attested as read/u)
  assert.match(
    readFailure,
    new RegExp(`recorded sha256:${base.content_sha256}`, 'u'),
  )
  assert.match(readFailure, new RegExp(`actual sha256:${actual}`, 'u'))

  const failure = {
    ...base,
    status: 'reference_failed',
    error: `Parent drifted: recorded sha256:${base.content_sha256}, actual sha256:${actual}`,
  }

  assert.equal(
    declared(failure).passed,
    false,
    'a reference failure on a success result is refused',
  )
  assert.equal(
    declared({ ...base, status: 'reference_failed' }, 'blocked').passed,
    false,
    'a reference failure without its error is refused',
  )
  assert.equal(declared(failure, 'blocked').passed, true)

  // A skip with any reason must not become the quiet route around the drift
  // refusal that the read branch already enforces.
  const skipped = declared({
    ...base,
    status: 'skipped',
    reason: 'No shared context.',
  })

  assert.equal(skipped.passed, false)
  assert.match(
    skipped.checks.find((check) => !check.passed)?.message ?? '',
    /MUST NOT be attested as skipped/u,
  )

  invocation.inputs.context_reference = {
    ...reference,
    reference_status: 'missing',
  }
  assert.equal(
    declared({ ...base, status: 'skipped', reason: 'No shared context.' })
      .passed,
    false,
    'a skip against a missing source is refused as well',
  )
})
