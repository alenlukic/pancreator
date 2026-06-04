import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { legacyPrettyJson } from "../../../../../../tests/helpers/legacy-json-stringify.mjs";
import { describe, expect, it } from "vitest";

import { scanRepository } from "./scan.js";

describe("scanRepository", () => {
  it("detects node and vitest from package.json", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pan-adopt-"));
    writeFileSync(
      path.join(root, "package.json"),
      legacyPrettyJson({
        devDependencies: { vitest: "^3.0.0" },
      }),
      "utf8",
    );
    const r = await scanRepository(root);
    expect(r.languages.some((l) => l.id === "node")).toBe(true);
    expect(r.testFrameworks.vitest).toBe(true);
    expect(r.testFrameworks.jest).toBe(false);
  });

  it("detects GitHub Actions workflows", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pan-adopt-"));
    const wf = path.join(root, ".github", "workflows");
    mkdirSync(wf, { recursive: true });
    writeFileSync(path.join(wf, "ci.yaml"), "on: push\n", "utf8");
    const r = await scanRepository(root);
    expect(r.ci.githubWorkflows).toBe(true);
  });
});
