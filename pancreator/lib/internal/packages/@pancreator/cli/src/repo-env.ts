import { ensureCursorSdkRipgrepConfigured } from "@pancreator/runner-cursor";

export { loadRepoEnv, prepareCursorRunnerEnvironment } from "@pancreator/runner-cursor";

/**
 * Sets `CURSOR_RIPGREP_PATH` when the platform `@cursor/sdk-*` bundle is present so
 * `@cursor/sdk` local runtime can call `configureRipgrepPath()` before ignore-map init.
 */
export function configureCursorSdkTransportPrereqs(repoRoot: string): boolean {
  return ensureCursorSdkRipgrepConfigured(repoRoot);
}
