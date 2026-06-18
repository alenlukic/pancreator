import { spawnSync } from "node:child_process";
import path from "node:path";

export type PanValidationStep = {
  readonly id: string;
  readonly label: string;
  readonly command: string;
};

export type PanValidationResult = {
  command: "lint" | "test";
  status: "ok" | "fail";
  exitCode: number;
  failedStep?: string;
};

export type PanValidationHooks = {
  runStep?: (repoRoot: string, step: PanValidationStep) => number;
};

export const PAN_LINT_STEPS: readonly PanValidationStep[] = [
  { id: "lint", label: "pnpm lint", command: "pnpm lint" },
  { id: "typecheck", label: "pnpm typecheck", command: "pnpm typecheck" },
];

export const PAN_TEST_STEPS: readonly PanValidationStep[] = [
  { id: "test", label: "pnpm test", command: "pnpm test" },
  {
    id: "tests-mjs",
    label: "node --test tests/*.test.mjs",
    command: "node --test tests/*.test.mjs",
  },
];

function defaultRunStep(repoRoot: string, step: PanValidationStep): number {
  const result = spawnSync(step.command, {
    cwd: repoRoot,
    shell: true,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

function runSequentialValidation(
  command: "lint" | "test",
  repoRoot: string,
  steps: readonly PanValidationStep[],
  hooks?: PanValidationHooks,
): PanValidationResult {
  const resolvedRoot = path.resolve(repoRoot);
  const runStep = hooks?.runStep ?? defaultRunStep;
  for (const step of steps) {
    const exitCode = runStep(resolvedRoot, step);
    if (exitCode !== 0) {
      return {
        command,
        status: "fail",
        exitCode,
        failedStep: step.id,
      };
    }
  }
  return {
    command,
    status: "ok",
    exitCode: 0,
  };
}

/** Runs `pnpm lint` then `pnpm typecheck` from the repository root. */
export function runPanLint(
  repoRoot: string,
  hooks?: PanValidationHooks,
): PanValidationResult {
  return runSequentialValidation("lint", repoRoot, PAN_LINT_STEPS, hooks);
}

/** Runs `pnpm test` then `node --test tests/*.test.mjs` from the repository root. */
export function runPanTest(
  repoRoot: string,
  hooks?: PanValidationHooks,
): PanValidationResult {
  return runSequentialValidation("test", repoRoot, PAN_TEST_STEPS, hooks);
}
