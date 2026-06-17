/**
 * @packageDocumentation Bridges Pancreator workspace primitives to MCP (stdio transport).
 */

import { PANCREATOR_CORE_VERSION } from "@pancreator/core";

export { PANCREATOR_CORE_VERSION };

/** @deprecated Meta-package probe; prefer package exports. */
export const PANCREATOR_MCP_SERVER_STUB = "mcp-server" as const;

/** @deprecated Meta-package probe; prefer package exports. */
export function mcpServerStubVersion(): string {
  return PANCREATOR_CORE_VERSION;
}

export {
  createMcpServer,
  callDdlToolMcp,
  readPancreatorResourceMcp,
  type CreateMcpServerOptions,
  type McpServerHandle,
} from "./create-mcp-server.js";

export { listResourceDefinitions, listToolDefinitions } from "./definitions.js";
export type { DdlToolName, ToolDefinition } from "./definitions.js";
