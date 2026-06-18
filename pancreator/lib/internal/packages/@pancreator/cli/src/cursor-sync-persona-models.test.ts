import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  setPersonaFrontmatterModel,
  syncPersonaModelsFromEscalation,
} from "./cursor-sync-persona-models.js";

const SAMPLE_PERSONA = `---
name: intake-analyst
description: Test persona
model: old-model
permissionMode: default
tools: []
disallowedTools: []
mcpServers: []
maxTurns: 30
skills: []
isolation: worktree
memory: project
effort: medium
color: slate
metadata:
  pancreator-risk-tier: low
  pancreator-pipeline-stages: [intake]
  pancreator-bootstrap-only: false
  pancreator-stability: experimental
  pancreator-required-docs: []
---

# Body
`;

const ESCALATION_YAML = `active_config: sync-test

configs:
  sync-test:
    personas:
      intake-analyst:
        default: gpt-5.4[context=272k,reasoning=high,fast=false]
`;

describe("setPersonaFrontmatterModel", () => {
  it("replaces an existing model line without rewriting the body", () => {
    const { content, changed, previousModel } = setPersonaFrontmatterModel(
      SAMPLE_PERSONA,
      "composer-2.5[fast=false]",
    );
    expect(changed).toBe(true);
    expect(previousModel).toBe("old-model");
    expect(content).toContain("model: composer-2.5[fast=false]");
    expect(content).toContain("# Body");
    expect(content).not.toContain("old-model");
  });

  it("returns changed false when the model already matches", () => {
    const { changed } = setPersonaFrontmatterModel(SAMPLE_PERSONA, "old-model");
    expect(changed).toBe(false);
  });

  it("updates model inside a sectioned persona without touching the operator block", () => {
    const sectioned = `# Operator section
- 👀 **In this file:** Persona spec for \`intake-analyst\`.
- ⚖️ **Why it matters:** Turns informal inbox specs into canonical engineering specs.
- 🧭 **See also:** N/A
---
name: intake-analyst
description: Test persona
model: old-model
permissionMode: default
tools: []
disallowedTools: []
mcpServers: []
maxTurns: 30
skills: []
isolation: worktree
memory: project
effort: medium
color: slate
metadata:
  pancreator-risk-tier: low
  pancreator-pipeline-stages: [intake]
  pancreator-bootstrap-only: false
  pancreator-stability: experimental
  pancreator-required-docs: []
---

# Body
`;
    const { content, changed } = setPersonaFrontmatterModel(
      sectioned,
      "composer-2.5[fast=false]",
    );
    expect(changed).toBe(true);
    expect(content).toMatch(/^# Operator section/m);
    expect(content).toContain("model: composer-2.5[fast=false]");
    expect(content).toContain("# Body");
  });
});

describe("syncPersonaModelsFromEscalation", () => {
  it("updates only personas listed in the active config", async () => {
    const harness = await mkdtemp(path.join(os.tmpdir(), "cursor-sync-models-"));
    await writeFile(path.join(harness, "pancreator.yaml"), 'project_root: "."\n', "utf8");
    await writeFile(path.join(harness, "pancreator-model-escalation.yaml"), ESCALATION_YAML, "utf8");
    await mkdir(path.join(harness, "lib", "personas"), { recursive: true });
    await writeFile(path.join(harness, "lib", "personas", "intake-analyst.md"), SAMPLE_PERSONA, "utf8");
    await writeFile(
      path.join(harness, "lib", "personas", "orphan-persona.md"),
      SAMPLE_PERSONA.replace("intake-analyst", "orphan-persona"),
      "utf8",
    );

    const result = syncPersonaModelsFromEscalation(harness, ".", { dryRun: false });
    expect(result.activeConfigName).toBe("sync-test");
    expect(result.written).toHaveLength(1);
    expect(result.written[0]?.path).toBe("lib/personas/intake-analyst.md");

    const updated = await readFile(path.join(harness, "lib", "personas", "intake-analyst.md"), "utf8");
    expect(updated).toContain(
      "model: gpt-5.4[context=272k,reasoning=high,fast=false]",
    );
    const orphan = await readFile(path.join(harness, "lib", "personas", "orphan-persona.md"), "utf8");
    expect(orphan).toContain("model: old-model");
  });

  it("skips persona model sync when escalation file is absent", async () => {
    const harness = await mkdtemp(path.join(os.tmpdir(), "cursor-sync-no-esc-"));
    await writeFile(path.join(harness, "pancreator.yaml"), 'project_root: "."\n', "utf8");
    await mkdir(path.join(harness, "lib", "personas"), { recursive: true });
    await writeFile(path.join(harness, "lib", "personas", "intake-analyst.md"), SAMPLE_PERSONA, "utf8");

    const result = syncPersonaModelsFromEscalation(harness, ".", { dryRun: false });
    expect(result.written).toHaveLength(0);
    expect(result.activeConfigName).toBeUndefined();
  });
});
