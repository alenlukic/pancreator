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
