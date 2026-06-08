import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findRepoRoot } from "./repo-paths";
import {
  type SuiteDefinition,
  type SuiteId,
  SUITE_DEFINITIONS,
} from "./maintenance-suite-presets";

export {
  SUITE_DEFINITIONS,
  SUITE_IDS,
  suiteDefinition,
  validateSuiteId,
  type SuiteDefinition,
  type SuiteId,
} from "./maintenance-suite-presets";

export type StreamChunk =
  | { type: "stdout" | "stderr"; line: string }
  | { type: "exit"; exitCode: number };

function repoStructureTestFiles(repoRoot: string): string[] {
  const testsDir = path.join(repoRoot, "tests");
  return fs
    .readdirSync(testsDir)
    .filter((name) => name.endsWith(".test.mjs"))
    .map((name) => path.join(testsDir, name))
    .sort();
}

function argvForSuiteStep(suiteId: SuiteId, stepIndex: number, repoRoot: string): string[] {
  if (suiteId === "client") {
    return ["pnpm", "--dir", "client", "test"];
  }
  if (suiteId === "compliance") {
    return ["node", path.join(repoRoot, "lib/internal/tools/run-compliance.mjs")];
  }
  if (suiteId === "pan-check") {
    return ["pnpm", "-w", "exec", "pan", "check"];
  }
  if (suiteId === "repo-structure") {
    if (stepIndex === 0) {
      return ["node", path.join(repoRoot, "lib/internal/tools/check-phase-0a-scaffold.mjs")];
    }
    return ["node", "--test", ...repoStructureTestFiles(repoRoot)];
  }
  throw new Error(`Unknown suite id "${suiteId}"`);
}

function stepCountForSuite(suiteId: SuiteId): number {
  return suiteId === "repo-structure" ? 2 : 1;
}

function spawnStep(
  argv: string[],
  repoRoot: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function splitOutputLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const parts = text.split(/\r?\n/u);
  if (text.endsWith("\n")) {
    return parts.slice(0, -1);
  }
  return parts;
}

export async function* streamSuiteOutput(
  suiteId: SuiteId,
  repoRoot: string = findRepoRoot(),
): AsyncGenerator<StreamChunk> {
  let finalExitCode = 0;

  for (let stepIndex = 0; stepIndex < stepCountForSuite(suiteId); stepIndex += 1) {
    const argv = argvForSuiteStep(suiteId, stepIndex, repoRoot);
    const result = await spawnStep(argv, repoRoot);
    for (const line of splitOutputLines(result.stdout)) {
      yield { type: "stdout", line };
    }
    for (const line of splitOutputLines(result.stderr)) {
      yield { type: "stderr", line };
    }
    if (result.exitCode !== 0) {
      finalExitCode = result.exitCode;
      break;
    }
  }

  yield { type: "exit", exitCode: finalExitCode };
}

export async function collectSuiteOutput(
  suiteId: SuiteId,
  repoRoot: string = findRepoRoot(),
): Promise<{ lines: Array<{ stream: "stdout" | "stderr"; line: string }>; exitCode: number }> {
  const lines: Array<{ stream: "stdout" | "stderr"; line: string }> = [];
  let exitCode = 0;
  for await (const chunk of streamSuiteOutput(suiteId, repoRoot)) {
    if (chunk.type === "exit") {
      exitCode = chunk.exitCode;
    } else {
      lines.push({ stream: chunk.type, line: chunk.line });
    }
  }
  return { lines, exitCode };
}

export function suiteDefinitions(): SuiteDefinition[] {
  return SUITE_DEFINITIONS;
}
