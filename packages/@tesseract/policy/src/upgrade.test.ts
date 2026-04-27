import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { upgradePolicyConfig } from "./index.js";
import { loadLegacyPolicyConfig } from "./legacy.js";
import { upgradePolicyTree } from "./upgrade.js";

describe("upgradePolicyTree", () => {
  it("maps snake_case threshold fields", () => {
    const v = upgradePolicyTree({
      risk_tier: "high",
      threshold_policy: "defaults.high",
      contract_bundle: { kind: "rego", telemetry_gates: ["a"] },
    });
    expect(v.schemaVersion).toBe(1);
    expect(v.riskTier).toBe("high");
    expect(v.thresholdPolicy).toBe("defaults.high");
    expect(v.contractBundle.telemetryGates).toEqual(["a"]);
  });
});

describe("loadLegacyPolicyConfig", () => {
  it("warns once and returns parsed YAML", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tess-pol-"));
    const f = path.join(dir, "p.yaml");
    await writeFile(f, "risk_tier: low\n", "utf8");
    const lines: string[] = [];
    const doc = await loadLegacyPolicyConfig(f, {
      writeDeprecation: (c) => lines.push(c),
    });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("DEPRECATED");
    expect(lines[0]).toContain("Q23");
    expect(doc).toEqual({ risk_tier: "low" });
  });
});

describe("upgradePolicyConfig", () => {
  it("reads a file and upgrades", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tess-pol2-"));
    const f = path.join(dir, "c.json");
    await writeFile(f, JSON.stringify({ risk_tier: "low" }), "utf8");
    const v = await upgradePolicyConfig(f);
    expect(v.riskTier).toBe("low");
  });
});
