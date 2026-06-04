import { appendFile, mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";

import { stringifyCompactJson } from "@pancreator/core";

import type { RunLogRecord } from "./record.js";
import { isRunLogRecord } from "./record.js";

export interface RunLogAppendResult {
  /** Byte offset in the file where the new line starts (for checkpoint `metadata.run_log_offset`). */
  run_log_offset: number;
}

function encodeLine(record: RunLogRecord): string {
  return `${stringifyCompactJson(record)}\n`;
}

/**
 * Appends one run-log record as a single JSONL line. Creates parent directories when missing.
 * Append order is the durability boundary per the run-log schema handbook.
 */
export async function appendRunLogRecord(
  filePath: string,
  record: RunLogRecord
): Promise<RunLogAppendResult> {
  if (!isRunLogRecord(record)) {
    throw new TypeError("appendRunLogRecord: value is not a valid RunLogRecord");
  }
  const line = encodeLine(record);
  await mkdir(dirname(filePath), { recursive: true });
  let run_log_offset = 0;
  try {
    const st = await stat(filePath);
    run_log_offset = st.size;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw e;
  }
  await appendFile(filePath, line, "utf8");
  return { run_log_offset };
}
