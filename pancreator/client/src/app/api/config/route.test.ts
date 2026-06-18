import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/config/route";
import { loadRuntimeConfig } from "@/services/config";

describe("GET /api/config", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-config-"));
    fs.writeFileSync(
      path.join(tempRoot, "pancreator.yaml"),
      [
        "runner:",
        "  cursor:",
        "    invocation: sdk",
        "    stage_remediation: true",
        "    sdkSampling:",
        "      enabled: true",
        "      ratePercent: 10",
        "      scope: feature-delivery",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(tempRoot, "pancreator-model-escalation.yaml"),
      [
        "active_config: default",
        "configs:",
        "  default:",
        "    personas:",
        "      coder:",
        "        default: composer-2.5[fast=false]",
        "      reviewer:",
        "        default: gpt-5.4[context=272k,reasoning=high,fast=false]",
        "  auto:",
        "    personas:",
        "      coder:",
        "        default: auto",
      ].join("\n"),
    );
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("returns live runtime configuration parsed from repository yaml", async () => {
    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const snapshot = await loadRuntimeConfig(tempRoot);
      expect(snapshot).toMatchObject({
        invocationMode: "sdk",
        designStepsDefault: false,
        stageRemediation: true,
        sdkSampling: {
          enabled: true,
          ratePercent: 10,
          scope: "feature-delivery",
        },
        activeEscalationConfig: "default",
      });
      expect(snapshot.personaEscalationBadges).toEqual([
        { persona: "coder", tierLabel: "composer-2.5[fast=false]" },
        { persona: "reviewer", tierLabel: "gpt-5.4[context=272k,reasoning=high,fast=false]" },
      ]);

      const response = await GET();
      expect(response.status).toBe(200);
      const payload = (await response.json()) as Awaited<ReturnType<typeof loadRuntimeConfig>>;
      expect(payload.invocationMode).toBe("sdk");
      expect(payload.stageRemediation).toBe(true);
    } finally {
      process.chdir(originalRoot);
    }
  });
});
