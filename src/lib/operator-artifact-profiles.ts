import type { BriefSection, OperatorBrief } from './briefs.js'

export const OPERATOR_ARTIFACT_PROFILE_HEADINGS = {
  intake: ['approach', 'user stories', 'constraints'],
  plan: ['approach', 'architecture', 'acceptance criteria'],
  implementation: ['summary', 'changes', 'acceptance'],
  review: ['findings', 'verdict'],
  qa: ['test cases', 'defects', 'verdict'],
  release: ['change list', 'rollback'],
  inspection: ['findings', 'verdict'],
  investigation: ['root cause', 'acceptance criteria', 'work mode'],
  spotfix: ['outcome', 'validation cycles'],
  escalation: ['escalation', 'acceptance criteria'],
  design: ['approach', 'mocks', 'acceptance criteria'],
  handoff: ['design package', 'acceptance criteria', 'next steps'],
  'prototype-brief': ['objective', 'technical questions', 'success signals'],
  'prototype-approach': ['hypothesis', 'strategy', 'signals'],
  spike: ['summary', 'shortcuts', 'signals'],
  'prototype-evaluation': ['verdict', 'questions', 'productionization gap'],
} as const

export type OperatorArtifactProfile =
  keyof typeof OPERATOR_ARTIFACT_PROFILE_HEADINGS

export type WorkflowOperatorArtifactProfile =
  | 'intake'
  | 'plan'
  | 'implementation'
  | 'review'
  | 'qa'
  | 'release'
  | 'inspection'
  | 'design'
  | 'handoff'
  | 'prototype-brief'
  | 'prototype-approach'
  | 'spike'
  | 'prototype-evaluation'

interface GeneratedBriefInput {
  profile: WorkflowOperatorArtifactProfile
  title: string
  source: string
  stageTitle: string
  outcome: string
  summary: string
  data: Record<string, unknown>
  risks: string[]
  unknowns: string[]
}

const PROFILE_DATA_KEYS: Record<WorkflowOperatorArtifactProfile, string[][]> = {
  intake: [
    ['product_spec.summary'],
    ['product_spec.user_stories'],
    [
      'product_spec.constraints',
      'product_spec.out_of_scope',
      'product_spec.open_questions',
    ],
  ],
  plan: [
    ['engineering_plan.approach'],
    ['engineering_plan.components', 'engineering_plan.files'],
    ['acceptance_criteria'],
  ],
  implementation: [
    ['implementation.notes'],
    ['implementation.changed_files', 'implementation.tests_added'],
    ['acceptance_results'],
  ],
  review: [
    ['review.findings'],
    ['review.verdict', 'review.acceptance_results'],
  ],
  qa: [
    ['test.cases'],
    ['test.defects'],
    ['test.verdict', 'test.acceptance_results'],
  ],
  release: [['release.change_list'], ['release.rollback']],
  inspection: [['inspection.findings'], ['inspection.verdict']],
  design: [
    ['design_spec.summary', 'design_spec.screens'],
    ['mocks'],
    ['acceptance_criteria'],
  ],
  handoff: [
    ['design_package.summary', 'design_package.design_spec_path'],
    ['design_package.acceptance_criteria'],
    ['design_package.dev_request_instructions'],
  ],
  'prototype-brief': [
    ['prototype_brief.objective'],
    ['prototype_brief.technical_questions'],
    ['prototype_brief.success_signals'],
  ],
  'prototype-approach': [
    ['technical_approach.hypothesis'],
    ['technical_approach.strategy', 'technical_approach.touch_points'],
    ['technical_approach.observable_signals'],
  ],
  spike: [
    ['spike.notes', 'spike.changed_files'],
    ['spike.shortcuts_taken'],
    ['spike.signal_evidence'],
  ],
  'prototype-evaluation': [
    ['evaluation.verdict', 'evaluation.recommendation'],
    ['evaluation.question_results'],
    ['evaluation.productionization_gap'],
  ],
}

const PROFILE_SEMANTICS: Record<WorkflowOperatorArtifactProfile, string[]> = {
  intake: ['context', 'actions', 'risks'],
  plan: ['workflow', 'changes', 'validation'],
  implementation: ['changes', 'validation', 'actions'],
  review: ['evidence', 'validation'],
  qa: ['validation', 'risks', 'actions'],
  release: ['release', 'validation'],
  inspection: ['evidence', 'validation'],
  design: ['changes', 'evidence', 'validation'],
  handoff: ['changes', 'validation', 'actions'],
  'prototype-brief': ['context', 'actions', 'risks'],
  'prototype-approach': ['workflow', 'changes', 'risks'],
  spike: ['changes', 'risks', 'evidence'],
  'prototype-evaluation': ['evidence', 'validation', 'actions'],
}

function readableName(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/gu, (letter) => letter.toUpperCase())
}

function readableValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'No value was recorded.'
  }

  if (typeof value === 'string') {
    return value
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value)
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return 'No entries were recorded.'
    }

    return value.map((item) => readableValue(item)).join('\n')
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)

    if (entries.length === 0) {
      return 'No details were recorded.'
    }

    return entries
      .map(([key, item]) => `${readableName(key)}: ${readableValue(item)}`)
      .join('\n')
  }

  return String(value)
}

function valueAtPath(
  value: Record<string, unknown>,
  dottedPath: string,
): unknown {
  let current: unknown = value

  for (const segment of dottedPath.split('.')) {
    if (
      typeof current !== 'object' ||
      current === null ||
      Array.isArray(current) ||
      !(segment in current)
    ) {
      return undefined
    }

    current = (current as Record<string, unknown>)[segment]
  }

  return current
}

function cardTypeForSemantic(semantic: string): string {
  if (semantic === 'validation') {
    return 'validation'
  }

  if (semantic === 'risks') {
    return 'risk'
  }

  if (semantic === 'release') {
    return 'release'
  }

  if (semantic === 'actions') {
    return 'action'
  }

  return 'summary'
}

/** Build a profile-shaped brief from canonical submitted stage data. */
export function generatedOperatorBrief(
  input: GeneratedBriefInput,
): OperatorBrief {
  const headings = OPERATOR_ARTIFACT_PROFILE_HEADINGS[input.profile]
  const dataKeys = PROFILE_DATA_KEYS[input.profile]
  const semantics = PROFILE_SEMANTICS[input.profile]
  const sections: BriefSection[] = [
    {
      semantic: 'executive-summary',
      title: 'Executive summary',
      cards: [
        {
          type: 'summary',
          title: `${input.stageTitle} ${input.outcome}`,
          body:
            `${input.summary} ` +
            (input.outcome === 'success'
              ? 'The stage completed, and no immediate operator action is required.'
              : 'Review the recorded stage outcome before the workflow continues.'),
        },
      ],
    },
  ]

  for (const [index, heading] of headings.entries()) {
    const semantic = semantics[index] ?? 'context'
    const keys = dataKeys[index] ?? []
    const selected = Object.fromEntries(
      keys.flatMap((key) => {
        const value = valueAtPath(input.data, key)

        return value === undefined
          ? []
          : [[key.split('.').at(-1) ?? key, value]]
      }),
    )
    let body = readableValue(selected)

    if (Object.keys(selected).length === 0 && semantic === 'risks') {
      body = readableValue(input.risks)
    } else if (
      Object.keys(selected).length === 0 &&
      semantic === 'actions' &&
      input.unknowns.length > 0
    ) {
      body = readableValue(input.unknowns)
    }

    sections.push({
      semantic,
      title: readableName(heading),
      cards: [
        {
          type: cardTypeForSemantic(semantic),
          title: readableName(heading),
          body,
        },
      ],
    })
  }

  return {
    schema_version: 1,
    brief_type: input.profile === 'release' ? 'release' : 'workflow-run',
    title: input.title,
    generated_at: new Date().toISOString(),
    source: input.source,
    sections,
  }
}

/**
 * Prototype stages need their own brief shape: a spike record reports shortcuts
 * and signals, not changes and acceptance. Their slugs would otherwise collide
 * with `dev` (`intake`) or fall through to `implementation`, so they resolve by
 * workflow first.
 */
const PROTOTYPE_PROFILES: Record<string, WorkflowOperatorArtifactProfile> = {
  intake: 'prototype-brief',
  approach: 'prototype-approach',
  build: 'spike',
  evaluate: 'prototype-evaluation',
}

export function operatorArtifactProfileForStage(
  stageSlug: string,
  workflowSlug?: string,
): WorkflowOperatorArtifactProfile {
  if (workflowSlug === 'prototype') {
    const profile = PROTOTYPE_PROFILES[stageSlug]

    if (profile) {
      return profile
    }
  }

  switch (stageSlug) {
    case 'intake':
      return 'intake'
    case 'plan':
      return 'plan'
    case 'review':
      return 'review'
    case 'test':
      return 'qa'
    case 'ship':
      return 'release'
    case 'inspect':
      return 'inspection'
    case 'design':
      return 'design'
    case 'handoff':
      return 'handoff'
    default:
      return 'implementation'
  }
}
