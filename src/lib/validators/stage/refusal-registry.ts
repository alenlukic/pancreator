/**
 * Verify item rule tables and the refusal registries every stage-output
 * validator is checked against.
 */

import { isRecord } from '../../io.js'
import {
  type StageRefusal,
  type StageValidatorRefusals,
  stageValidatorRefusals,
  type ValidatorBlockingFields,
} from '../refusals.js'

/** Enum sets a verify item rule resolves from the shared field contract. */
export interface VerifyRuleContext {
  severities: Set<string>
  sources: Set<string>
}

/**
 * One refusal the verify handler can raise against an item of a verify array,
 * and the declared field paths it blocks on.
 */
interface VerifyItemFieldRule {
  /** Field paths as `stage-output-requirements.json` declares them. */
  paths: readonly string[]
  /** Stable issue code the refusal carries. */
  code: string
  /** True when the item satisfies the rule. */
  satisfied: (
    item: Record<string, unknown>,
    context: VerifyRuleContext,
  ) => boolean
  /** Refusal text for one item, given the label the handler resolved. */
  message: (label: string) => string
}

/**
 * The rules one array of verify records is checked against.
 *
 * The identity rule runs first and stops the item when it fails, because an
 * item without an identity has no label the remaining refusals could name.
 */
export interface VerifyItemRules {
  /** The array these rules check, for the declaration and for diagnosis. */
  collection: string
  /** Label for an item whose identity rule failed. */
  positionLabel: (index: number) => string
  /** Label for an item the identity rule accepted. */
  itemLabel: (item: Record<string, unknown>) => string
  identity: VerifyItemFieldRule
  fields: readonly VerifyItemFieldRule[]
}

export const VERIFY_FINDING_RULES: VerifyItemRules = {
  collection: 'data.verify.findings[]',
  positionLabel: (index) => `Finding ${index + 1}`,
  itemLabel: (finding) => `Finding ${finding.id as string}`,
  identity: {
    paths: ['data.verify.findings[].id'],
    code: 'verify.finding_shape',
    satisfied: (finding) => typeof finding.id === 'string',
    message: (label) => `${label} MUST have an id`,
  },
  fields: [
    {
      paths: ['data.verify.findings[].severity'],
      code: 'verify.severity',
      satisfied: (finding, context) =>
        typeof finding.severity === 'string' &&
        context.severities.has(finding.severity),
      message: (label) => `${label} MUST use an allowed severity`,
    },
    {
      paths: ['data.verify.findings[].source'],
      code: 'verify.finding_source',
      satisfied: (finding, context) =>
        typeof finding.source === 'string' &&
        context.sources.has(finding.source),
      message: (label) => `${label} MUST declare source as review or qa`,
    },
    {
      paths: ['data.verify.findings[].statement'],
      code: 'verify.finding_statement',
      satisfied: (finding) =>
        typeof finding.statement === 'string' &&
        finding.statement.trim().length > 0,
      message: (label) => `${label} MUST include a statement`,
    },
    {
      paths: ['data.verify.findings[].evidence[]'],
      code: 'verify.finding_evidence',
      satisfied: (finding) =>
        Array.isArray(finding.evidence) &&
        finding.evidence.length > 0 &&
        finding.evidence.every(
          (entry) => typeof entry === 'string' && entry.trim().length > 0,
        ),
      message: (label) => `${label} MUST include non-empty evidence`,
    },
  ],
}

export const VERIFY_QA_CASE_RULES: VerifyItemRules = {
  collection: 'data.verify.qa_cases[]',
  positionLabel: (index) => `QA case ${index + 1}`,
  itemLabel: (qaCase) => `QA case ${qaCase.id as string}`,
  identity: {
    paths: ['data.verify.qa_cases[].id'],
    code: 'verify.case_shape',
    satisfied: (qaCase) => typeof qaCase.id === 'string',
    message: (label) => `${label} MUST have an id`,
  },
  fields: [
    {
      paths: [
        'data.verify.qa_cases[].carried_from.invocation_id',
        'data.verify.qa_cases[].carried_from.workspace_fingerprint',
      ],
      code: 'verify.case_carried_from_shape',
      // VERIFY-001: a returning verification executes the cases the
      // remediation can reach and carries the rest. A carried result has to
      // name where it came from, or the reader cannot tell a case observed
      // against another workspace from one observed against this one.
      satisfied: (qaCase) => {
        if (qaCase.carried_from === undefined) {
          return true
        }

        const carried = qaCase.carried_from

        return ['invocation_id', 'workspace_fingerprint'].every(
          (field) =>
            isRecord(carried) &&
            typeof carried[field] === 'string' &&
            (carried[field] as string).trim().length > 0,
        )
      },
      message: (label) =>
        `${label} MUST name carried_from.invocation_id and ` +
        'carried_from.workspace_fingerprint',
    },
  ],
}

export const VERIFY_ACCEPTANCE_RULES: VerifyItemRules = {
  collection: 'data.verify.acceptance_results[]',
  positionLabel: (index) => `acceptance_results[${index}]`,
  itemLabel: (item) => `Acceptance ${item.id as string}`,
  identity: {
    paths: ['data.verify.acceptance_results[].id'],
    code: 'verify.acceptance_shape',
    satisfied: (item) => typeof item.id === 'string',
    message: (label) => `${label} MUST have an id`,
  },
  fields: [
    {
      paths: ['data.verify.acceptance_results[].result'],
      code: 'verify.acceptance_result',
      satisfied: (item) =>
        typeof item.result === 'string' && item.result.trim().length > 0,
      message: (label) => `${label} MUST declare a result`,
    },
  ],
}

export const VERIFY_GATE_CITATION_RULES: VerifyItemRules = {
  collection: 'data.verify.gate_evidence_citations[]',
  positionLabel: (index) => `gate_evidence_citations[${index}]`,
  itemLabel: (_citation) => 'gate_evidence_citations entry',
  identity: {
    paths: [
      'data.verify.gate_evidence_citations[].profile',
      'data.verify.gate_evidence_citations[].fingerprint',
      'data.verify.gate_evidence_citations[].evidence_path',
    ],
    code: 'verify.gate_citation_shape',
    satisfied: (citation) =>
      ['profile', 'fingerprint', 'evidence_path'].every(
        (field) =>
          typeof citation[field] === 'string' &&
          (citation[field] as string).trim().length > 0,
      ),
    message: (label) =>
      `${label} MUST carry profile, fingerprint, and evidence_path`,
  },
  fields: [],
}

const VERIFY_ITEM_RULES: readonly VerifyItemRules[] = [
  VERIFY_FINDING_RULES,
  VERIFY_QA_CASE_RULES,
  VERIFY_ACCEPTANCE_RULES,
  VERIFY_GATE_CITATION_RULES,
]

/** Verify refusals that block on a declared field the handler names inline. */
const VERIFY_FIELD_REFUSALS: readonly StageRefusal[] = [
  { code: 'verify.verdict', paths: ['data.verify.verdict'] },
  { code: 'verify.blocking_reason', paths: ['data.verify.blocking_reason'] },
  {
    code: 'verify.missing_evidence',
    paths: ['data.verify.missing_evidence_paths'],
  },
  {
    code: 'verify.remediation_guidance',
    paths: ['data.verify.remediation_guidance'],
  },
  {
    code: 'verify.severity_rationale',
    paths: ['data.verify.severity_rationale'],
  },
  {
    code: 'verify.dimension_field',
    paths: [
      'data.verify.dimensions.review.summary',
      'data.verify.dimensions.review.evidence[]',
      'data.verify.dimensions.qa.summary',
      'data.verify.dimensions.qa.evidence[]',
    ],
  },
]

/**
 * Verify refusals no single declared field owns. Each states why, because an
 * unexplained entry here is how a field-shaped refusal escapes the
 * declaration the whole mechanism rests on.
 */
const VERIFY_UNOWNED_REFUSALS: readonly StageRefusal[] = [
  {
    code: 'verify.dimension_missing',
    paths: [],
    unowned_reason:
      'A scoped return visit lacks the whole section of a dimension its card assigns, a presence rule over the object the declared fields sit in.',
  },
  {
    code: 'verify.dimension_source',
    paths: [],
    unowned_reason:
      "The refusal compares each finding's declared source against the dimensions the card assigns, which is a relation rather than a field.",
  },
  {
    code: 'verify.missing',
    paths: [],
    unowned_reason:
      'The whole `data.verify` object is absent, so no field inside it exists to declare.',
  },
  {
    code: 'verify.blocked_forbidden_field',
    paths: [],
    unowned_reason:
      'A blocked output MUST NOT carry these fields, so the refusal is the inverse of a field requirement.',
  },
  {
    code: 'verify.qa_cases_missing',
    paths: [],
    unowned_reason:
      'The array itself is empty, which is a presence rule over the collection rather than a shape rule over an item.',
  },
  {
    // Resolved from the shared contract at validation time, so the paths are
    // listed here rather than spelled in the handler: removing one from
    // `fields[]` still has to fail repository validation rather than
    // silently shrink what the handler checks.
    code: 'verify.case_field',
    paths: [
      'data.verify.qa_cases[].id',
      'data.verify.qa_cases[].steps',
      'data.verify.qa_cases[].expected',
      'data.verify.qa_cases[].actual',
      'data.verify.qa_cases[].result',
    ],
  },
  {
    code: 'verify.case_reruns_profile',
    paths: [],
    unowned_reason:
      'The refusal reads the content of a declared field rather than requiring another field.',
  },
  {
    code: 'verify.gate_citation_missing',
    paths: [],
    unowned_reason:
      "The refusal compares the citations against the card's current gate-evidence references, which is a relation rather than a field.",
  },
  {
    code: 'verify.acceptance_missing',
    paths: [],
    unowned_reason:
      'The refusal covers an empty array and a plan criterion the output never reports, both relations over the collection.',
  },
  {
    code: 'verify.acceptance_duplicate',
    paths: [],
    unowned_reason:
      'Uniqueness is a relation between items rather than a requirement on one item.',
  },
  {
    code: 'verify.acceptance_observe_unproven',
    paths: [],
    unowned_reason:
      "The refusal compares an observe result against the criterion's proof in the plan or specification, which is a relation to another document.",
  },
  {
    code: 'verify.acceptance_observe_required',
    paths: [],
    unowned_reason:
      "The refusal compares an observe criterion's proof in the plan or specification against its result, which is a relation to another document.",
  },
  {
    code: 'verify.acceptance_unknown',
    paths: [],
    unowned_reason:
      'The refusal compares reported ids against the ratified plan, which is a relation to another document.',
  },
  {
    code: 'verify.verdict_inconsistent',
    paths: [],
    unowned_reason:
      'The refusal relates the verdict to the findings, acceptance results, and QA cases together.',
  },
  {
    code: 'verify.result_inconsistent',
    paths: [],
    unowned_reason: 'The refusal relates the top-level result to the verdict.',
  },
]

/**
 * Every refusal `validateVerifyOutput` can raise, classified by the declared
 * field it blocks on.
 *
 * This list is the handler's contract with the worker. The item entries are
 * generated from the rules the handler itself iterates, so a refusal raised
 * through the rule mechanism cannot be missing from it. The remaining entries
 * are classified by hand, and
 * `tests/integration/validators-stage-validators.test.ts::every verify
 * refusal is classified in the canonical declaration` reads the handler's
 * source and fails when it raises an issue code this list does not carry.
 * A new refusal therefore fails a test rather than a worker.
 */
export const VERIFY_REFUSALS: readonly StageRefusal[] = [
  ...VERIFY_ITEM_RULES.flatMap((rules) =>
    [rules.identity, ...rules.fields].map((rule) => ({
      code: rule.code,
      paths: rule.paths,
    })),
  ),
  ...VERIFY_FIELD_REFUSALS,
  ...VERIFY_UNOWNED_REFUSALS,
]

/**
 * Every stage-output validator that can refuse a submission, with the source
 * it raises its refusals from and the field each refusal blocks on.
 *
 * The verify entry is composed here because that handler generates its item
 * refusals from the rule tables above, which the handler in `./verify.ts`
 * iterates. Every other enumeration lives in `../refusals/`.
 */
export const STAGE_VALIDATOR_REFUSALS: readonly StageValidatorRefusals[] =
  stageValidatorRefusals(VERIFY_REFUSALS, [
    {
      expression: 'rules.identity.code',
      codes: VERIFY_ITEM_RULES.map((rules) => rules.identity.code),
    },
    {
      expression: 'rule.code',
      codes: VERIFY_ITEM_RULES.flatMap((rules) =>
        rules.fields.map((rule) => rule.code),
      ),
    },
  ])

/**
 * Every field path a stage validator refuses a submission on, by stage and by
 * the registry that owns the refusal. `validateSharedFieldContract` asserts
 * each path appears in the registry's `enforced_fields`, and the
 * enforced-field rule in `./field-contract.ts` then requires a `fields[]`
 * declaration, so a field a worker can be refused for always reaches the
 * worker's rendered card and scaffold first.
 *
 * Every entry is derived from a refusal enumeration rather than written out,
 * because a list written beside a handler drifts from it: the first version
 * of this table was three fields short of the verify handler on the day it
 * shipped, its ship entry named two of the thirty-three fields the release
 * handler blocks on, and its implement and remediate entries named two of the
 * fields the claims handler blocks on. Each of those was repaired for the one
 * validator a verifier had named, so deriving every entry from one
 * source-checked enumeration is the repair that does not need a fourth round.
 */
export const VALIDATOR_BLOCKING_FIELDS: readonly ValidatorBlockingFields[] =
  STAGE_VALIDATOR_REFUSALS.filter(
    (entry): entry is StageValidatorRefusals & { stage: string } =>
      entry.stage !== null,
  ).map((entry) => ({
    stage: entry.stage,
    registry_id: entry.registry_id,
    fields: [...new Set(entry.refusals.flatMap((refusal) => refusal.paths))],
  }))
