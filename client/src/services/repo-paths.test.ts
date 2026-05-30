import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveRepoPath } from "@/services/repo-paths";

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
    expect(() => resolveRepoPath("src/inbox/notes/secret.md", tempRoot)).toThrow(
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
});
