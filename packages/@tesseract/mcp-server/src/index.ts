import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * @packageDocumentation Phase 0a scaffold. MCP server wiring lands in Phase 3+.
 */
export const TESSERACT_MCP_SERVER_STUB = "mcp-server" as const;

export function mcpServerStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}
