import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  classifyProductionFindings,
  loadRollingBaseline,
  shouldDeferFindingToInbox,
  updateRollingBaseline,
} from "../token-economy-analyzer.js";
import {
  createDeferredInboxItem,
  runBoundedRepair,
  runTokenEconomySampleAudit,
} from "./token-economy-sample-audit.js";

describe("token-economy sample-audit", () => {
  it("classifyProductionFindings detects forbidden PRD read", () => {
    const findings = classifyProductionFindings({
      task_id: "53589_test",
      tool_paths: ["docs/PRD.md"],
      trace_records: [],
    });
    expect(findings.some((f) => f.kind === "forbidden_path_read")).toBe(true);
    expect(shouldDeferFindingToInbox(findings[0]!)).toBe(true);
  });

  it("watermark scan respects --since and advances last-audit.json", async () => {
    const root = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(os.tmpdir(), "token-audit-")),
    );
    const traceDir = path.join(root, "work", "172971_06-04-26", "task-a", "sdk-traces");
    await mkdir(traceDir, { recursive: true });
    const summary = {
      schema_version: 1,
      task_id: "task-a",
      model: "composer-2.5",
      stage_id: "implement",
      persona: "coder",
      tool_paths: ["AGENTS.md"],
      turn_count: 1,
      metrics: { input_tokens: 100, output_tokens: 50 },
      trace_records: [],
    };
    await writeFile(
      path.join(traceDir, "implement-0-2026-06-04T00-00-00-000Z.summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(root, "pancreator.yaml"),
      'project_root: "."\n',
      "utf8",
    );

    const result = await runTokenEconomySampleAudit({
      repoRoot: root,
      since: "2020-01-01T00:00:00.000Z",
    });
    expect(result.report.summaries_scanned).toBe(1);
    expect(existsSync(path.join(root, ".pan/token-economy/last-audit.json"))).toBe(true);
    expect(existsSync(path.join(root, ".pan/token-economy/reports", path.basename(result.reportPath)))).toBe(
      true,
    );
  });

  it("runBoundedRepair applies low fixes and defers high-scope", async () => {
    const root = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(os.tmpdir(), "token-repair-")),
    );
    await mkdir(path.join(root, "lib/inbox/in"), { recursive: true });
    const repair = await runBoundedRepair(
      root,
      [
        {
          kind: "duplicate_read",
          complexity: "medium",
          message: "dup",
          path: "AGENTS.md",
        },
        {
          kind: "forbidden_path_read",
          complexity: "high",
          message: "forbidden",
          path: "docs/PRD.md",
        },
      ],
      () => new Date("2026-06-04T12:00:00.000Z"),
    );
    expect(repair.applied.length).toBeGreaterThan(0);
    expect(repair.deferred_inbox_slug).toBeDefined();
    expect(repair.deferred_inbox_path).toContain("token-economy-audit-forbidden_path_read.md");
    expect(repair.deferred_inbox_path?.startsWith("lib/inbox/in/")).toBe(true);
    expect(existsSync(path.join(root, repair.deferred_inbox_path!))).toBe(true);
  });

  it("createDeferredInboxItem writes inbox markdown for high-scope findings", async () => {
    const root = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(os.tmpdir(), "token-inbox-")),
    );
    const rel = await createDeferredInboxItem(
      root,
      [
        {
          kind: "forbidden_path_read",
          complexity: "high",
          message: "Read forbidden path: docs/PRD.md",
          path: "docs/PRD.md",
        },
      ],
      () => new Date("2026-06-04T12:00:00.000Z"),
    );
    expect(rel).toBeDefined();
    expect(existsSync(path.join(root, rel!))).toBe(true);
  });

  it("classifyProductionFindings flags token and turn inflation vs rolling baseline", async () => {
    const root = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(path.join(os.tmpdir(), "token-baseline-")),
    );
    const baselinesDir = path.join(root, ".pan/token-economy/baselines");
    await mkdir(baselinesDir, { recursive: true });
    const summaryBase = {
      task_id: "task-b",
      model: "composer-2.5",
      stage_id: "implement",
      persona: "coder",
      tool_paths: ["lib/memory/active/current.md"],
      trace_records: [],
    };
    await updateRollingBaseline(baselinesDir, {
      ...summaryBase,
      metrics: { input_tokens: 100, output_tokens: 50 },
      turn_count: 2,
    });
    await updateRollingBaseline(baselinesDir, {
      ...summaryBase,
      metrics: { input_tokens: 100, output_tokens: 50 },
      turn_count: 2,
    });
    const baseline = await loadRollingBaseline(baselinesDir, {
      persona: "coder",
      stage: "implement",
      model: "composer-2.5",
    });
    expect(baseline?.sample_count).toBe(2);
    const findings = classifyProductionFindings(
      {
        ...summaryBase,
        metrics: { input_tokens: 300, output_tokens: 50 },
        turn_count: 6,
      },
      { baseline, inflationFactor: 1.5 },
    );
    expect(findings.some((f) => f.kind === "token_inflation_input")).toBe(true);
    expect(findings.some((f) => f.kind === "turn_inflation")).toBe(true);
  });
});
