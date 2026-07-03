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

export function operatorArtifactProfileForStage(
  stageSlug: string,
): WorkflowOperatorArtifactProfile {
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
    default:
      return 'implementation'
  }
}
