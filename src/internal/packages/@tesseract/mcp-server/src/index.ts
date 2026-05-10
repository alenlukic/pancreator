/**
 * @packageDocumentation Bridges Tesseract workspace primitives to MCP (stdio transport).
 */

import { TESSERACT_CORE_VERSION } from "@tesseract/core";

export { TESSERACT_CORE_VERSION };

/** @deprecated Meta-package probe; prefer package exports. */
export const TESSERACT_MCP_SERVER_STUB = "mcp-server" as const;

/** @deprecated Meta-package probe; prefer package exports. */
export function mcpServerStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}

export {
  createMcpServer,
  callTessToolMcp,
  readTesseractResourceMcp,
  type CreateMcpServerOptions,
  type McpServerHandle,
} from "./create-mcp-server.js";

export { listResourceDefinitions, listToolDefinitions } from "./definitions.js";
export type { TessToolName, ToolDefinition } from "./definitions.js";
