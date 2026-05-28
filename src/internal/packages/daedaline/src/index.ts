/**
 * @packageDocumentation Unscoped `daedaline` meta package. Re-exports provide linked installs;
 * a fuller surface lands in Phase 3+.
 */
import { DAEDALINE_CHECKPOINTER_FS_VERSION } from "@daedaline/checkpointer-fs";
import { DAEDALINE_RUN_LOGGER_VERSION } from "@daedaline/run-logger";

export { DAEDALINE_CORE_VERSION } from "@daedaline/core";
export { DAEDALINE_ADOPTER_SCAN_STUB, adopterScanStubVersion } from "@daedaline/adopter-scan";
export { DAEDALINE_CHECKPOINTER_FS_VERSION };
export const DAEDALINE_CHECKPOINTER_FS_STUB = "checkpointer-fs" as const;
export function checkpointerFsStubVersion(): string {
  return DAEDALINE_CHECKPOINTER_FS_VERSION;
}
export { DAEDALINE_CLI_STUB, cliStubVersion } from "@daedaline/cli";
export { DAEDALINE_CONTRACT_STUB, contractStubVersion } from "@daedaline/contract";
export {
  DAEDALINE_CONTRACT_RUNNER_LLM_JUDGE_STUB,
  contractRunnerLlmJudgeStubVersion,
} from "@daedaline/contract-runner-llm-judge";
export {
  DAEDALINE_CONTRACT_RUNNER_REGO_STUB,
  contractRunnerRegoStubVersion,
} from "@daedaline/contract-runner-rego";
export { DAEDALINE_CONTRACT_STYLE_STUB, contractStyleStubVersion } from "@daedaline/contract-style";
export { DAEDALINE_ENV_ISOLATION_STUB, envIsolationStubVersion } from "@daedaline/env-isolation";
export { DAEDALINE_INBOX_STUB, inboxStubVersion } from "@daedaline/inbox";
export { DAEDALINE_INTERVENTION_STUB, interventionStubVersion } from "@daedaline/intervention";
export { DAEDALINE_MCP_SERVER_STUB, mcpServerStubVersion } from "@daedaline/mcp-server";
export { DAEDALINE_MEMORY_STUB, memoryStubVersion } from "@daedaline/memory";
export { DAEDALINE_NOTIFIER_STUB, notifierStubVersion } from "@daedaline/notifier";
export { DAEDALINE_PERSONA_STUB, personaStubVersion } from "@daedaline/persona";
export { DAEDALINE_PIPELINE_STUB, pipelineStubVersion } from "@daedaline/pipeline";
export { DAEDALINE_POLICY_STUB, policyStubVersion } from "@daedaline/policy";
export { DAEDALINE_RUN_LOGGER_VERSION };
export const DAEDALINE_RUN_LOGGER_STUB = "run-logger" as const;
export function runLoggerStubVersion(): string {
  return DAEDALINE_RUN_LOGGER_VERSION;
}
export { DAEDALINE_RUNNER_CURSOR_STUB, runnerCursorStubVersion } from "@daedaline/runner-cursor";
export { DAEDALINE_WORKTREE_STUB, worktreeStubVersion } from "@daedaline/worktree";

export const DAEDALINE_META_PACKAGE_STUB = "daedaline" as const;
