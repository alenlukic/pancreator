import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { stringifyRepoJson } from "@pancreator/core";
import { describe, expect, it } from "vitest";

import { upgradePolicyConfig } from "./index.js";
import { loadLegacyPolicyConfig } from "./legacy.js";
import { upgradePolicyTree } from "./upgrade.js";

describe("upgradePolicyTree", () => {
  it("maps snake_case threshold fields and project root", () => {
    const v = upgradePolicyTree({
      project_root: ".",
      bootstrap: {
        phase: "4",
        status: "phase-4-in-progress",
        completed_phases: ["-1", "0", "1", "2", "3"],
        enforced_today: false,
        current_focus: "dogfood",
      },
      risk_tier: "high",
      threshold_policy: "defaults.high",
      contract_bundle: { kind: "rego", telemetry_gates: ["a"] },
    });
    expect(v.schemaVersion).toBe(1);
    expect(v.projectRoot).toBe(".");
    expect(v.bootstrap?.phase).toBe("4");
    expect(v.bootstrap?.status).toBe("phase-4-in-progress");
    expect(v.bootstrap?.completedPhases).toEqual(["-1", "0", "1", "2", "3"]);
    expect(v.bootstrap?.enforcedToday).toBe(false);
    expect(v.bootstrap?.currentFocus).toBe("dogfood");
    expect(v.riskTier).toBe("high");
    expect(v.thresholdPolicy).toBe("defaults.high");
    expect(v.contractBundle.telemetryGates).toEqual(["a"]);
  });

  it("defaults projectRoot to the self-hosting root", () => {
    const v = upgradePolicyTree({ risk_tier: "low" });
    expect(v.projectRoot).toBe(".");
  });
});

describe("loadLegacyPolicyConfig", () => {
  it("warns once and returns parsed YAML", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pan-pol-"));
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
    const dir = await mkdtemp(path.join(os.tmpdir(), "pan-pol2-"));
    const f = path.join(dir, "c.json");
    const prevAbbrev = process.env.PAN_JSON_FORMAT_ABBREV_LEN;
    process.env.PAN_JSON_FORMAT_ABBREV_LEN = "7";
    await writeFile(f, stringifyRepoJson({ risk_tier: "low" }, dir), "utf8");
    if (prevAbbrev === undefined) {
      delete process.env.PAN_JSON_FORMAT_ABBREV_LEN;
    } else {
      process.env.PAN_JSON_FORMAT_ABBREV_LEN = prevAbbrev;
    }
    const v = await upgradePolicyConfig(f);
    expect(v.riskTier).toBe("low");
  });
});
