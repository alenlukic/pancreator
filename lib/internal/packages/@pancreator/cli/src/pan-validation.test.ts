import { describe, expect, it } from "vitest";

import { PAN_LINT_STEPS, PAN_TEST_STEPS, runPanLint, runPanTest } from "./pan-validation.js";

describe("runPanLint", () => {
  it("runs lint then typecheck and stops on the first failure", () => {
    const steps: string[] = [];
    const result = runPanLint("/tmp/repo", {
      runStep: (_root, step) => {
        steps.push(step.id);
        return step.id === "lint" ? 1 : 0;
      },
    });
    expect(result).toEqual({
      command: "lint",
      status: "fail",
      exitCode: 1,
      failedStep: "lint",
    });
    expect(steps).toEqual(["lint"]);
  });

  it("succeeds when lint and typecheck both pass", () => {
    const steps: string[] = [];
    const result = runPanLint("/tmp/repo", {
      runStep: (_root, step) => {
        steps.push(step.id);
        return 0;
      },
    });
    expect(result).toEqual({
      command: "lint",
      status: "ok",
      exitCode: 0,
    });
    expect(steps).toEqual(PAN_LINT_STEPS.map((step) => step.id));
  });
});

describe("runPanTest", () => {
  it("runs pnpm test then repo mjs tests and stops on the first failure", () => {
    const steps: string[] = [];
    const result = runPanTest("/tmp/repo", {
      runStep: (_root, step) => {
        steps.push(step.id);
        return step.id === "test" ? 2 : 0;
      },
    });
    expect(result).toEqual({
      command: "test",
      status: "fail",
      exitCode: 2,
      failedStep: "test",
    });
    expect(steps).toEqual(["test"]);
  });

  it("succeeds when both test steps pass", () => {
    const steps: string[] = [];
    const result = runPanTest("/tmp/repo", {
      runStep: (_root, step) => {
        steps.push(step.id);
        return 0;
      },
    });
    expect(result).toEqual({
      command: "test",
      status: "ok",
      exitCode: 0,
    });
    expect(steps).toEqual(PAN_TEST_STEPS.map((step) => step.id));
  });
});
