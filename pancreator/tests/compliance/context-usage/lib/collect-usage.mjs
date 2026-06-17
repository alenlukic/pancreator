/**
 * Prototype harness re-exports — shared implementation lives in @pancreator/runner-cursor.
 */
export {
  TurnEndedUsageMissingError,
  UsageCaptureMissingError,
  assertUsageCaptured,
  collectFromStream,
  createEmptyMetrics,
  createTraceSink,
  drainRunStream,
  processStreamEvent,
} from "@pancreator/runner-cursor";

import { repoRelativePath as collectorRepoRelativePath } from "@pancreator/runner-cursor";
import { extractReadPathsFromToolEvent } from "@pancreator/runner-cursor";

export { extractReadPathsFromToolEvent };

/** @deprecated Use repoRelativePath from runner-cursor; kept for harness compatibility. */
export function repoRelativePath(absPath) {
  return collectorRepoRelativePath(absPath);
}
