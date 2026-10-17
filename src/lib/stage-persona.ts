import { isRecord, readJson, resolveInside } from './io.js'
import type { RunState, StageDefinition } from './types.js'

/**
 * Resolve verdict routing from trusted run history, retaining the declared
 * persona when the source output is absent, unreadable, or unmapped.
 */
export function resolveStageForAttempt(
  root: string,
  state: RunState,
  stage: StageDefinition,
): StageDefinition {
  const byVerdict = stage.persona_by_verdict

  if (!byVerdict) {
    return stage
  }

  const item = [...state.stage_history]
    .reverse()
    .find((entry) => entry.stage === byVerdict.source_stage)

  if (!item) {
    return stage
  }

  let verdict: unknown

  try {
    const output = readJson(resolveInside(root, item.output_path))

    verdict =
      isRecord(output) && isRecord(output.data)
        ? byVerdict.path
            .split('.')
            .reduce<unknown>(
              (value, key) => (isRecord(value) ? value[key] : undefined),
              output.data,
            )
        : undefined
  } catch {
    return stage
  }

  const persona =
    typeof verdict === 'string' ? byVerdict.map[verdict] : undefined

  return persona ? { ...stage, persona } : stage
}
