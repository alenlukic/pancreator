import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findHarnessRoot, resolveRepoPath } from "@/services/repo-paths";

describe("resolveRepoPath", () => {
  let tempRoot = "";

  afterEach(() => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = "";
    }
  });

  it("rejects notes sandbox paths", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-paths-"));
    fs.writeFileSync(path.join(tempRoot, "pancreator.yaml"), "phase: test\n");
    expect(() => resolveRepoPath("lib/inbox/notes/secret.md", tempRoot)).toThrow(
      "Operator sandbox denied",
    );
  });

  it("rejects path traversal segments", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-paths-"));
    fs.writeFileSync(path.join(tempRoot, "pancreator.yaml"), "phase: test\n");
    expect(() => resolveRepoPath("../outside.md", tempRoot)).toThrow("Path traversal denied");
  });

  it("rejects empty paths", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-paths-"));
    fs.writeFileSync(path.join(tempRoot, "pancreator.yaml"), "phase: test\n");
    expect(() => resolveRepoPath("", tempRoot)).toThrow("Path is required");
  });

  it("findHarnessRoot resolves nested self-host layout to outer harness", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-harness-"));
    const projectDir = path.join(tempRoot, "pancreator");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "pancreator.yaml"),
      'project_root: "pancreator"\n',
      "utf8",
    );
    fs.mkdirSync(path.join(projectDir, "lib", "personas"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "lib", "personas", "coder.md"), "---\nname: coder\n---\n");

    expect(findHarnessRoot(projectDir)).toBe(tempRoot);
    expect(findHarnessRoot(path.join(projectDir, "client"))).toBe(tempRoot);
  });
});
