import { invariant } from './errors.js'

import type { RunState } from './types.js'

/** True when one stage must receive workflow-generated operator artifacts. */
export function operatorArtifactsRequested(
  state: RunState,
  stageSlug: string,
): boolean {
  const selection = state.operator_artifacts

  if (!selection) {
    return true
  }

  return (
    selection.mode === 'requested' ||
    selection.requested_stages.includes(stageSlug)
  )
}

/** Add one stage-scoped artifact request before its invocation is prepared. */
export function requestStageOperatorArtifacts(
  state: RunState,
  stageSlug: string,
): boolean {
  invariant(
    state.current_invocation === null,
    `Stage '${stageSlug}' already has an active invocation. Generate its brief after submission instead.`,
    { code: 'OPERATOR_ARTIFACT_REQUEST_TOO_LATE' },
  )

  if (
    !state.operator_artifacts ||
    state.operator_artifacts.mode === 'requested'
  ) {
    return false
  }

  if (state.operator_artifacts.requested_stages.includes(stageSlug)) {
    return false
  }

  state.operator_artifacts.requested_stages.push(stageSlug)
  state.operator_artifacts.requested_stages.sort()

  return true
}
