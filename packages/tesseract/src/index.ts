/**
 * @packageDocumentation Unscoped `tesseract` meta package. Re-exports provide linked installs;
 * a fuller surface lands in Phase 3+.
 */
export { TESSERACT_CORE_VERSION } from "@tesseract/core";
export { TESSERACT_ADOPTER_SCAN_STUB, adopterScanStubVersion } from "@tesseract/adopter-scan";
export {
  TESSERACT_CHECKPOINTER_FS_STUB,
  checkpointerFsStubVersion,
} from "@tesseract/checkpointer-fs";
export { TESSERACT_CLI_STUB, cliStubVersion } from "@tesseract/cli";
export { TESSERACT_CONTRACT_STUB, contractStubVersion } from "@tesseract/contract";
export {
  TESSERACT_CONTRACT_RUNNER_LLM_JUDGE_STUB,
  contractRunnerLlmJudgeStubVersion,
} from "@tesseract/contract-runner-llm-judge";
export {
  TESSERACT_CONTRACT_RUNNER_REGO_STUB,
  contractRunnerRegoStubVersion,
} from "@tesseract/contract-runner-rego";
export { TESSERACT_CONTRACT_STYLE_STUB, contractStyleStubVersion } from "@tesseract/contract-style";
export { TESSERACT_ENV_ISOLATION_STUB, envIsolationStubVersion } from "@tesseract/env-isolation";
export { TESSERACT_INBOX_STUB, inboxStubVersion } from "@tesseract/inbox";
export { TESSERACT_INTERVENTION_STUB, interventionStubVersion } from "@tesseract/intervention";
export { TESSERACT_MCP_SERVER_STUB, mcpServerStubVersion } from "@tesseract/mcp-server";
export { TESSERACT_MEMORY_STUB, memoryStubVersion } from "@tesseract/memory";
export { TESSERACT_NOTIFIER_STUB, notifierStubVersion } from "@tesseract/notifier";
export { TESSERACT_PERSONA_STUB, personaStubVersion } from "@tesseract/persona";
export { TESSERACT_PIPELINE_STUB, pipelineStubVersion } from "@tesseract/pipeline";
export { TESSERACT_POLICY_STUB, policyStubVersion } from "@tesseract/policy";
export { TESSERACT_RUN_LOGGER_STUB, runLoggerStubVersion } from "@tesseract/run-logger";
export { TESSERACT_RUNNER_CURSOR_STUB, runnerCursorStubVersion } from "@tesseract/runner-cursor";
export { TESSERACT_WORKTREE_STUB, worktreeStubVersion } from "@tesseract/worktree";

export const TESSERACT_META_PACKAGE_STUB = "tesseract" as const;
