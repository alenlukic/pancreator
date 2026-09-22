import path from 'node:path'

import { appendJsonLine } from './io.js'

export const HOOK_SPECIFIC_CONTEXT_PROBE =
  'PANCREATOR_HOOK_SPECIFIC_CONTEXT_PROBE'
export const FLAT_CONTEXT_PROBE = 'PANCREATOR_FLAT_CONTEXT_PROBE'

export interface PromptContextProbeResponse {
  continue: true
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit'
    additionalContext: typeof HOOK_SPECIFIC_CONTEXT_PROBE
  }
  additional_context: typeof FLAT_CONTEXT_PROBE
}

/** Record Cursor's payload byte for byte inside one JSONL string entry. */
export function recordPromptContextProbe(
  root: string,
  payload: string,
): PromptContextProbeResponse {
  appendJsonLine(
    path.join(root, 'runtime', 'logs', 'hooks', 'prompt-context.jsonl'),
    payload,
  )

  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: HOOK_SPECIFIC_CONTEXT_PROBE,
    },
    additional_context: FLAT_CONTEXT_PROBE,
  }
}
