import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findRepoRoot } from "./repo-paths";
import { normalizePanCommand, type PanExecuteResult } from "./run-state-shared";

export type { PanExecuteResult } from "./run-state-shared";
export { normalizePanCommand, panArgsFromNextCommand } from "./run-state-shared";

const execFileAsync = promisify(execFile);

export const ALLOWLISTED_VERBS = [
  "advance",
  "pause",
  "resume",
  "abort",
  "check",
  "batch status",
] as const;

export type PanExecuteRejection = {
  error: string;
  verb: string;
};

const SHELL_METACHAR_PATTERN = /[;&|`$()<>\n\r\0]/u;

export function extractAllowlistedVerb(normalizedCommand: string): string {
  if (normalizedCommand.startsWith("batch status")) {
    return "batch status";
  }
  return normalizedCommand.split(/\s+/u)[0] ?? "";
}

export function validatePanCommand(rawCommand: string): PanExecuteRejection | null {
  const normalized = normalizePanCommand(rawCommand);
  if (normalized.length === 0) {
    return { error: "Command is required", verb: "" };
  }

  if (SHELL_METACHAR_PATTERN.test(normalized)) {
    return { error: "Shell metacharacters are not allowed", verb: extractAllowlistedVerb(normalized) };
  }

  const verb = extractAllowlistedVerb(normalized);
  if (!ALLOWLISTED_VERBS.includes(verb as (typeof ALLOWLISTED_VERBS)[number])) {
    return {
      error: `Verb "${verb || "unknown"}" is not allowlisted`,
      verb: verb || "unknown",
    };
  }

  return null;
}

export async function executePanCommand(
  rawCommand: string,
  repoRoot: string = findRepoRoot(),
): Promise<PanExecuteResult | PanExecuteRejection> {
  const rejection = validatePanCommand(rawCommand);
  if (rejection !== null) {
    return rejection;
  }

  const normalized = normalizePanCommand(rawCommand);
  const verb = extractAllowlistedVerb(normalized);

  if (verb === "batch status") {
    return {
      stdout: "",
      stderr: "Batch status subcommand not yet available. Use pan batch run until batch status ships.",
      exitCode: 125,
      deferred: true,
      deferralMessage: "Batch status subcommand not yet available",
    };
  }

  const args = ["-w", "exec", "pan", ...normalized.split(/\s+/u)];

  try {
    const { stdout, stderr } = await execFileAsync("pnpm", args, {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    });
    return {
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      exitCode: 0,
    };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number | string;
    };
    return {
      stdout: execError.stdout?.toString() ?? "",
      stderr: execError.stderr?.toString() ?? execError.message,
      exitCode: typeof execError.code === "number" ? execError.code : 1,
    };
  }
}
