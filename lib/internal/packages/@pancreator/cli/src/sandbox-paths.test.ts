import { describe, expect, it } from "vitest";

import {
  assertSandboxWorkspace,
  DEFAULT_CONTEXT_REVIEW_WORKSPACE,
  sandboxDirRel,
  sandboxManifestRel,
  SANDBOXES_DIR_REL,
} from "./sandbox-paths.js";

describe("sandbox-paths", () => {
  it("defines sandboxes under .pan/sandboxes", () => {
    expect(SANDBOXES_DIR_REL).toBe(".pan/sandboxes");
    expect(DEFAULT_CONTEXT_REVIEW_WORKSPACE).toBe(".pan/sandboxes/context-review");
    expect(sandboxDirRel("38670_1315_demo-feature")).toBe(".pan/sandboxes/38670_1315_demo-feature");
    expect(sandboxManifestRel("38670_1315_demo-feature")).toBe(
      ".pan/sandboxes/38670_1315_demo-feature/manifest.json",
    );
  });

  it("accepts workspaces under .pan/sandboxes/", () => {
    expect(assertSandboxWorkspace(".pan/sandboxes/my-pass")).toBe(".pan/sandboxes/my-pass");
    expect(assertSandboxWorkspace(DEFAULT_CONTEXT_REVIEW_WORKSPACE)).toBe(
      DEFAULT_CONTEXT_REVIEW_WORKSPACE,
    );
  });

  it("rejects legacy .sandbox/ and escape paths", () => {
    expect(() => assertSandboxWorkspace(".sandbox/my-pass")).toThrow(/MUST be under .pan\/sandboxes\//u);
    expect(() => assertSandboxWorkspace(".pan/sandboxes/../work/evil")).toThrow(
      /safe repo-relative path/u,
    );
  });
});
