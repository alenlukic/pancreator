/**
 * @packageDocumentation Bridges Daedaline workspace primitives to MCP (stdio transport).
 */

import { DAEDALINE_CORE_VERSION } from "@daedaline/core";

export { DAEDALINE_CORE_VERSION };

/** @deprecated Meta-package probe; prefer package exports. */
export const DAEDALINE_MCP_SERVER_STUB = "mcp-server" as const;

/** @deprecated Meta-package probe; prefer package exports. */
export function mcpServerStubVersion(): string {
  return DAEDALINE_CORE_VERSION;
}

export {
  createMcpServer,
  callDdlToolMcp,
  readDaedalineResourceMcp,
  type CreateMcpServerOptions,
  type McpServerHandle,
} from "./create-mcp-server.js";

export { listResourceDefinitions, listToolDefinitions } from "./definitions.js";
export type { DdlToolName, ToolDefinition } from "./definitions.js";
