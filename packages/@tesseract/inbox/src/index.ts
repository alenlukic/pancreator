import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * @packageDocumentation Phase 0a scaffold. Inbox I/O and MCP elicitation land in Phase 3+.
 */
export const TESSERACT_INBOX_STUB = "inbox" as const;

export function inboxStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}
