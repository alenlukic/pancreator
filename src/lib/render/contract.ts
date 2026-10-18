/**
 * Invocation contract blocks: the section split of a rendered card and the
 * contract manifest built from it.
 */

import { acceptanceCriterionStatements } from '../acceptance-proof.js'
import {
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  sha256,
} from '../io.js'
import { originatingItemId } from '../validators/cohort-plan.js'
import type {
  InvocationContractSectionOwner,
  Policy,
  InvocationContractGuidance,
  InvocationContractManifest,
} from '../types.js'
import { DELEGATION_HEADING } from '../validation/artifacts.js'
import { normalizeContractMarkdown } from '../validation/attestation.js'

/**
 * Returns the value as pretty-printed JSON inside a fenced Markdown `json` code
 * block.
 */
export function fencedJson(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n')
}

/** Derive criterion lines from the structured registry; narrative sections remain authored. */
export function planningCriterionView(criteria: unknown): string {
  return (Array.isArray(criteria) ? criteria : [])
    .filter(isRecord)
    .filter(
      (criterion) =>
        typeof criterion.id === 'string' &&
        typeof criterion.statement === 'string',
    )
    .map(
      (criterion, index) =>
        `${index + 1}. ${criterion.id} [proof: ${criterion.proof}] ${criterion.statement}`,
    )
    .join('\n')
}

/** Conflicts in authored copies of the structured acceptance registry, including wrapped lines. */
export function planningViewConflicts(
  data: Record<string, unknown>,
  content: string,
): string[] {
  const criteria = new Map(
    (Array.isArray(data.acceptance_criteria) ? data.acceptance_criteria : [])
      .filter(isRecord)
      .filter((criterion) => typeof criterion.id === 'string')
      .map((criterion) => [criterion.id, criterion]),
  )
  const conflicts: string[] = []
  const seen = new Set<string>()
  const normalize = (text: string) =>
    text
      .replaceAll(/`([^`]+)`/gu, '$1')
      .replaceAll(/(?<!\w)(\*\*|__|\*|_)(?=\S)([\s\S]*?\S)\1(?!\w)/gu, '$2')
      .replaceAll(/\s+/gu, ' ')
      .trim()
  for (const { id, tag, statement } of acceptanceCriterionStatements(content)) {
    const criterion = criteria.get(id)
    if (
      !criterion ||
      seen.has(id) ||
      criterion.proof !== tag ||
      (typeof criterion.statement === 'string' &&
        normalize(criterion.statement) !== normalize(statement))
    ) {
      conflicts.push(id)
    }
    seen.add(id)
  }
  return conflicts
}

/** Stable digest independent of JSON object key order; array order remains significant. */
function planningFactDigest(value: unknown): string {
  const canonical = (entry: unknown): unknown =>
    Array.isArray(entry)
      ? entry.map(canonical)
      : isRecord(entry)
        ? Object.fromEntries(
            Object.keys(entry)
              .sort()
              .map((key) => [key, canonical(entry[key])]),
          )
        : entry

  return sha256(JSON.stringify(canonical(value)))
}

function registryFacts(collection: unknown): unknown {
  if (!Array.isArray(collection)) return collection
  return collection.map((entry) => {
    const id = originatingItemId(entry)
    if (typeof entry === 'string') return { id, text: entry }
    if (!isRecord(entry)) return entry
    const textKeys = ['statement', 'description', 'text'].filter(
      (key) => typeof entry[key] === 'string',
    )
    if (textKeys.length !== 1) return entry
    const textKey = textKeys[0]
    return {
      ...Object.fromEntries(
        Object.entries(entry).filter(
          ([key]) => key !== textKey && key !== 'id',
        ),
      ),
      id,
      text: entry[textKey],
    }
  })
}

function preservedPlanningFacts(
  data: Record<string, unknown>,
  permittedFields: string[],
): Record<string, unknown> {
  const facts = { ...data }
  delete facts.planning_correction
  if (isRecord(facts.product_spec)) {
    const spec = facts.product_spec
    facts.product_spec = {
      ...spec,
      ...Object.fromEntries(
        ['constraints', 'out_of_scope']
          .filter((key) => permittedFields.includes(`data.product_spec.${key}`))
          .map((key) => [key, registryFacts(spec[key])]),
      ),
    }
  }
  return facts
}

export interface PlanningCorrectionBundle {
  mode: 'mechanical' | 'ordinary'
  reason: string
  failures: string[]
  permitted_fields: string[]
  current_values: Record<string, unknown>
  derived_views: { acceptance_criteria: string }
  prior_invocation_id?: string
  prior_output_sha256?: string
  preserved_data_sha256?: string
  specifications: Array<{
    path: string
    sha256: string
    authored_sha256: string
  }>
}

function specificationFacts(content: string): string {
  const lines = content.split('\n')
  let inReference = false
  return lines
    .map((line) => {
      if (/^#{1,6}\s/u.test(line)) {
        inReference = /^#{1,6}\s+Parent specification\s*$/iu.test(line)
      }
      return inReference &&
        /^\s*-\s+(?:Content digest|Reference status):/iu.test(line)
        ? line.replace(/:.*/u, ': <harness-reference-metadata>')
        : line
    })
    .join('\n')
}

/**
 * Prepare a bounded registry-shape repair from the existing prior-failure record.
 * No feedback inference: only exact unknown-registry diagnostics qualify.
 */
export function planningCorrectionBundle(
  root: string,
  invocation: unknown,
): PlanningCorrectionBundle {
  const ordinary = (
    reason: string,
    failures: string[] = [],
  ): PlanningCorrectionBundle => ({
    mode: 'ordinary',
    reason,
    failures,
    permitted_fields: [],
    current_values: {},
    derived_views: { acceptance_criteria: '' },
    specifications: [],
  })
  if (
    !isRecord(invocation) ||
    !isRecord(invocation.stage) ||
    invocation.stage.slug !== 'plan' ||
    !isRecord(invocation.prior_failure)
  )
    return ordinary('No planning retry preservation evidence.')
  const failure = invocation.prior_failure
  const failures = Array.isArray(failure.validation_errors)
    ? failure.validation_errors.filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : []
  if (
    !failures.length ||
    !Array.isArray(failure.validation_errors) ||
    failures.length !== failure.validation_errors.length ||
    failures.some((entry) => !entry.includes('plan.maps_to_unknown')) ||
    [
      'failed_hard_criteria',
      'failed_deterministic',
      'declared_criteria_failures',
      'governance_artifact_warnings',
    ].some((key) => Array.isArray(failure[key]) && failure[key].length > 0) ||
    failure.supervisor_assessment ||
    invocation.operator_stage_repair ||
    typeof failure.output_path !== 'string' ||
    typeof failure.invocation_id !== 'string'
  ) {
    return ordinary(
      'Feedback is not exclusively a proved registry-shape defect; use ordinary planning review.',
      failures,
    )
  }
  const priorPath = resolveInside(root, failure.output_path)
  if (!fileExists(priorPath))
    return ordinary('Prior output is unavailable.', failures)
  const prior = readJson(priorPath)
  if (
    !isRecord(prior) ||
    prior.invocation_id !== failure.invocation_id ||
    !isRecord(prior.data) ||
    !isRecord(prior.data.product_spec) ||
    !Array.isArray(prior.data.acceptance_criteria) ||
    prior.data.acceptance_criteria.length === 0 ||
    !isRecord(prior.data.engineering_plan) ||
    prior.data.acceptance_criteria.some(
      (entry) =>
        !isRecord(entry) ||
        typeof entry.id !== 'string' ||
        !entry.id.trim() ||
        typeof entry.statement !== 'string' ||
        !entry.statement.trim() ||
        typeof entry.proof !== 'string' ||
        !entry.proof.trim(),
    ) ||
    !isRecord(prior.data.cohort_plan) ||
    typeof prior.data.cohort_plan.parent_spec_path !== 'string' ||
    !prior.data.cohort_plan.parent_spec_path.trim() ||
    !Array.isArray(prior.data.cohort_plan.chunks) ||
    prior.data.cohort_plan.chunks.length === 0 ||
    prior.data.cohort_plan.chunks.some(
      (chunk) =>
        !isRecord(chunk) ||
        typeof chunk.id !== 'string' ||
        !chunk.id.trim() ||
        typeof chunk.child_spec_path !== 'string' ||
        !chunk.child_spec_path.trim(),
    )
  ) {
    return ordinary('Prior plan has insufficient preservation facts.', failures)
  }
  const spec = prior.data.product_spec
  const fields = new Set<string>()
  for (const diagnostic of failures) {
    const match =
      /^\[plan\.maps_to_unknown\] Criterion (AC-[\w.-]+) maps_to references unknown registry id ((?:C|OOS)-[A-Za-z0-9-]+)$/u.exec(
        diagnostic,
      )
    if (!match)
      return ordinary(
        'Diagnostic does not identify an exact registry field.',
        failures,
      )
    const [, criterionId, id] = match
    const key = id.startsWith('OOS-') ? 'out_of_scope' : 'constraints'
    const entries = spec[key]
    const criterion = prior.data.acceptance_criteria.find(
      (entry) => isRecord(entry) && entry.id === criterionId,
    )
    if (
      !Array.isArray(entries) ||
      !entries.some(
        (entry) => typeof entry === 'string' && originatingItemId(entry) === id,
      ) ||
      !isRecord(criterion) ||
      !Array.isArray(criterion.maps_to) ||
      !criterion.maps_to.includes(id)
    ) {
      return ordinary(
        'The reported identifier has no unchanged prefixed-string definition.',
        failures,
      )
    }
    fields.add(`data.product_spec.${key}`)
  }
  const cohort = isRecord(prior.data.cohort_plan)
    ? prior.data.cohort_plan
    : null
  const paths = [
    cohort?.parent_spec_path,
    ...(Array.isArray(cohort?.chunks)
      ? cohort.chunks.filter(isRecord).map((chunk) => chunk.child_spec_path)
      : []),
  ].filter((entry): entry is string => typeof entry === 'string')
  const specifications: PlanningCorrectionBundle['specifications'] = []
  for (const specPath of paths) {
    const absolute = resolveInside(root, specPath)
    if (!fileExists(absolute))
      return ordinary(
        `Preserved specification is unavailable: ${specPath}`,
        failures,
      )
    const content = readText(absolute)
    specifications.push({
      path: specPath,
      sha256: sha256(content),
      authored_sha256: sha256(specificationFacts(content)),
    })
  }
  return {
    mode: 'mechanical',
    reason:
      'Only identifier representation may change; all narrative, requirements, criteria, proofs, ownership, migration facts, and authored specification bytes are preserved. The existing finalizer may refresh draft reference metadata.',
    failures,
    permitted_fields: [...fields],
    current_values: Object.fromEntries(
      [...fields].map((field) => [field, spec[field.split('.').at(-1) ?? '']]),
    ),
    derived_views: {
      acceptance_criteria: planningCriterionView(
        prior.data.acceptance_criteria,
      ),
    },
    prior_invocation_id: failure.invocation_id,
    prior_output_sha256: sha256(readText(priorPath)),
    preserved_data_sha256: planningFactDigest(
      preservedPlanningFacts(prior.data, [...fields]),
    ),
    specifications,
  }
}

/** Validate the materialized document against the harness-prepared preservation record. */
export function planningCorrectionErrors(
  root: string,
  invocation: unknown,
  data: Record<string, unknown>,
): string[] {
  if (!isRecord(data.planning_correction)) return []
  if (data.planning_correction.mode !== 'mechanical')
    return [
      'Unknown planning correction mode; remove planning_correction for ordinary review.',
    ]
  const expected = planningCorrectionBundle(root, invocation)
  if (
    expected.mode !== 'mechanical' ||
    !isRecord(invocation) ||
    !isRecord(invocation.output) ||
    typeof invocation.output.path !== 'string'
  )
    return [expected.reason]
  const bundlePath = resolveInside(
    root,
    `${invocation.output.path}.planning-correction.json`,
  )
  if (!fileExists(bundlePath))
    return [
      'Harness-prepared preservation bundle is unavailable; use ordinary review.',
    ]
  const bundle = readJson(bundlePath)
  if (
    !isRecord(bundle) ||
    bundle.mode !== 'mechanical' ||
    bundle.prior_output_sha256 !== expected.prior_output_sha256 ||
    bundle.preserved_data_sha256 !== expected.preserved_data_sha256 ||
    planningFactDigest(bundle.failures) !==
      planningFactDigest(expected.failures)
  ) {
    return [
      'Preservation evidence is stale or conflicts with the current feedback; use ordinary review.',
    ]
  }
  if (
    planningFactDigest(
      preservedPlanningFacts(data, expected.permitted_fields),
    ) !== expected.preserved_data_sha256
  ) {
    return [
      'Materialized patch changes preserved plan facts; remove mechanical mode and obtain ordinary planning review.',
    ]
  }
  if (
    !Array.isArray(bundle.specifications) ||
    planningFactDigest(
      bundle.specifications.map((entry) =>
        isRecord(entry)
          ? { path: entry.path, authored_sha256: entry.authored_sha256 }
          : entry,
      ),
    ) !==
      planningFactDigest(
        expected.specifications.map(({ path, authored_sha256 }) => ({
          path,
          authored_sha256,
        })),
      )
  ) {
    return [
      'Specification bytes changed since preparation; use ordinary planning review.',
    ]
  }
  return []
}

/** Longest section-id slug retained from a heading, so ids stay readable. */
const SECTION_SLUG_MAX_LENGTH = 48

const TOP_LEVEL_HEADING_PATTERN = /^## /u

/**
 * One top-level block of a canonical worker contract. Concatenating every
 * block's `markdown` reproduces the contract byte for byte, which is what lets a
 * section digest and the whole-file digest be checked against the same file.
 */
export interface InvocationContractBlock {
  id: string
  heading: string
  owner: InvocationContractSectionOwner
  markdown: string
  line_count: number
}

function sectionSlug(heading: string): string {
  const slug = heading
    .replace(/^#+\s*/u, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')
    .slice(0, SECTION_SLUG_MAX_LENGTH)
    .replaceAll(/-+$/gu, '')

  return slug.length > 0 ? slug : 'section'
}

function sectionId(index: number, heading: string): string {
  return `${String(index + 1).padStart(3, '0')}-${sectionSlug(heading)}`
}

/**
 * Split a rendered contract into ordered top-level blocks.
 *
 * Content before the first `## ` heading forms a preamble block. The supervisor
 * delivery procedure is appended last, so every block from that heading onward
 * is supervisor-owned and the rest binds the worker.
 */
export function splitInvocationContract(
  markdown: string,
): InvocationContractBlock[] {
  const lines = normalizeContractMarkdown(markdown).slice(0, -1).split('\n')
  const groups: Array<{ heading: string; lines: string[] }> = []

  for (const line of lines) {
    if (groups.length === 0 || TOP_LEVEL_HEADING_PATTERN.test(line)) {
      groups.push({
        heading: TOP_LEVEL_HEADING_PATTERN.test(line)
          ? line.trim()
          : 'Preamble',
        lines: [],
      })
    }

    groups[groups.length - 1]?.lines.push(line)
  }

  const supervisorIndex = groups.findIndex(
    (group) => group.heading === DELEGATION_HEADING,
  )

  return groups.map((group, index) => ({
    id: sectionId(index, group.heading),
    heading: group.heading,
    owner:
      supervisorIndex !== -1 && index >= supervisorIndex
        ? ('supervisor' as const)
        : ('worker' as const),
    markdown: `${group.lines.join('\n')}\n`,
    line_count: group.lines.length,
  }))
}

/**
 * Name every referenced guidance selection the contract points at, in policy
 * order. Legacy inline guidance carries its body on the card, so a read needs
 * no attestation and it is not listed.
 */
function manifestGuidance(policies: Policy[]): InvocationContractGuidance[] {
  return policies.flatMap((policy) =>
    (policy.guidance ?? []).flatMap((guidance) =>
      guidance.reference
        ? [
            {
              policy_id: policy.id,
              source_path: guidance.source_path,
              content_sha256: guidance.reference.content_sha256,
              read_trigger: guidance.reference.read_trigger,
            },
          ]
        : [],
    ),
  )
}

/** Describe a rendered contract as a flat, digest-bearing section index. */
export function buildInvocationContractManifest(
  contractPath: string,
  markdown: string,
  policies: Policy[] = [],
): InvocationContractManifest {
  const contract = normalizeContractMarkdown(markdown)
  const blocks = splitInvocationContract(contract)
  const guidance = manifestGuidance(policies)

  return {
    contract_path: contractPath,
    contract_sha256: sha256(contract),
    byte_length: Buffer.byteLength(contract, 'utf8'),
    line_count: contract.slice(0, -1).split('\n').length,
    sections: blocks.map((block) => ({
      id: block.id,
      heading: block.heading,
      owner: block.owner,
      line_count: block.line_count,
      sha256: sha256(block.markdown),
    })),
    ...(guidance.length > 0 ? { guidance } : {}),
  }
}
