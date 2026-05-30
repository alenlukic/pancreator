/**
 * @packageDocumentation Unscoped `pancreator` meta package. Re-exports provide linked installs;
 * a fuller surface lands in Phase 3+.
 */
import { PANCREATOR_CHECKPOINTER_FS_VERSION } from "@pancreator/checkpointer-fs";
import { PANCREATOR_RUN_LOGGER_VERSION } from "@pancreator/run-logger";

export { PANCREATOR_CORE_VERSION } from "@pancreator/core";
export { PANCREATOR_ADOPTER_SCAN_STUB, adopterScanStubVersion } from "@pancreator/adopter-scan";
export { PANCREATOR_CHECKPOINTER_FS_VERSION };
export const PANCREATOR_CHECKPOINTER_FS_STUB = "checkpointer-fs" as const;
export function checkpointerFsStubVersion(): string {
  return PANCREATOR_CHECKPOINTER_FS_VERSION;
}
export { PANCREATOR_CLI_STUB, cliStubVersion } from "@pancreator/cli";
export { PANCREATOR_CONTRACT_STUB, contractStubVersion } from "@pancreator/contract";
export {
  PANCREATOR_CONTRACT_RUNNER_LLM_JUDGE_STUB,
  contractRunnerLlmJudgeStubVersion,
} from "@pancreator/contract-runner-llm-judge";
export {
  PANCREATOR_CONTRACT_RUNNER_REGO_STUB,
  contractRunnerRegoStubVersion,
} from "@pancreator/contract-runner-rego";
export { PANCREATOR_CONTRACT_STYLE_STUB, contractStyleStubVersion } from "@pancreator/contract-style";
export { PANCREATOR_ENV_ISOLATION_STUB, envIsolationStubVersion } from "@pancreator/env-isolation";
export { PANCREATOR_INBOX_STUB, inboxStubVersion } from "@pancreator/inbox";
export { PANCREATOR_INTERVENTION_STUB, interventionStubVersion } from "@pancreator/intervention";
export { PANCREATOR_MCP_SERVER_STUB, mcpServerStubVersion } from "@pancreator/mcp-server";
export { PANCREATOR_MEMORY_STUB, memoryStubVersion } from "@pancreator/memory";
export { PANCREATOR_NOTIFIER_STUB, notifierStubVersion } from "@pancreator/notifier";
export { PANCREATOR_PERSONA_STUB, personaStubVersion } from "@pancreator/persona";
export { PANCREATOR_PIPELINE_STUB, pipelineStubVersion } from "@pancreator/pipeline";
export { PANCREATOR_POLICY_STUB, policyStubVersion } from "@pancreator/policy";
export { PANCREATOR_RUN_LOGGER_VERSION };
export const PANCREATOR_RUN_LOGGER_STUB = "run-logger" as const;
export function runLoggerStubVersion(): string {
  return PANCREATOR_RUN_LOGGER_VERSION;
}
export { PANCREATOR_RUNNER_CURSOR_STUB, runnerCursorStubVersion } from "@pancreator/runner-cursor";
export { PANCREATOR_WORKTREE_STUB, worktreeStubVersion } from "@pancreator/worktree";

export const PANCREATOR_META_PACKAGE_STUB = "pancreator" as const;
