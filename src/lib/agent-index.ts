/**
 * Hook-fed agent activity index.
 *
 * Appends bounded event lines to per-agent JSONL files and maintains a
 * mutex-guarded `index.json`. Designed for hook start-up performance:
 * every write path is synchronous and the lock wait is bounded.
 *
 * Layout under `runtime/logs/agents/`:
 *   index.json    — summary of known agents with aliases and pending launches
 *   <id>.jsonl    — append-only event stream for one agent id or alias
 *   index.lock    — operation mutex
 *
 * The implementation lives in `./agent-index/`, one module per concern; this
 * module re-exports its public surface for the CLI, the watch, and the tests.
 * The Cursor hook entry point imports `./agent-index/hooks.js` and
 * `./agent-index/store.js` directly, so a hook process never loads the reader
 * side.
 */

export { agentIndexHooksStatus } from './agent-index/hooks-status.js'
export type { AgentIndexHooksStatus } from './agent-index/hooks-status.js'
export {
  AGENTS_DIR,
  agentsDir,
  agentEventFile,
  collectSecrets,
  summarizeToolInput,
  promptDigest,
  parseRunInvocation,
  resolveCanonicalId,
} from './agent-index/store.js'
export type {
  AgentStatus,
  EventKind,
  AgentStopRecord,
  AgentEntry,
  PendingLaunch,
  AgentIndex,
  AgentEvent,
  PreToolUsePayload,
  PostToolUsePayload,
  SubagentStartPayload,
  SubagentStopPayload,
  HookPayload,
} from './agent-index/store.js'
export {
  handlePreToolUse,
  handlePostToolUse,
  handleSubagentStart,
  handleSubagentStop,
  extractTaskHandle,
} from './agent-index/hooks.js'
export {
  loadAgentEvents,
  getLatestEvent,
  getOpenCall,
  getStopRecord,
  getAgentEntry,
  getAgentByRunInvocation,
  readAgentIndex,
  isShellTool,
  linkedShellHeartbeat,
  readAgentActivity,
  agentActivitySignature,
} from './agent-index/activity.js'
export type { ShellHeartbeat, AgentActivity } from './agent-index/activity.js'
