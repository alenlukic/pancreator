import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  COMPLIANCE_AUDIT_HISTORY_REL,
  complianceAuditPromptContext,
  ensureComplianceAuditHistoryBackfilled,
  normalizeComplianceAuditHistoryForArchivedRun,
  persistComplianceAuditHistoryForResult,
} from "./compliance-audit-history.js";
import { stringifyCliJson } from "./canonical-json-io.js";
import { deliveryReportRel, durableFeatureIndexRel } from "./feature-delivery-stage-artifacts.js";

async function writeJson(repoRoot: string, abs: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, stringifyCliJson(repoRoot, value), "utf8");
}

describe("compliance-audit-history", () => {
  let priorAbbrevLen: string | undefined;

  beforeEach(() => {
    priorAbbrevLen = process.env.PAN_JSON_FORMAT_ABBREV_LEN;
    process.env.PAN_JSON_FORMAT_ABBREV_LEN = "7";
  });

  afterEach(() => {
    if (priorAbbrevLen === undefined) {
      delete process.env.PAN_JSON_FORMAT_ABBREV_LEN;
    } else {
      process.env.PAN_JSON_FORMAT_ABBREV_LEN = priorAbbrevLen;
    }
  });

  it("backfills history from flat artifact_index paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-audit-history-backfill-flat-"));
    const resultRel = ".pan/archive/work/172996_05-10-26/38670_1315_demo-feature/compliance-result.json";
    await writeJson(root, path.join(root, resultRel), {
      taskId: "38670_1315_demo-feature",
      featureId: "demo-feature-flat",
      auditedAt: "2026-05-10T14:10:00.000Z",
      compliance_passes: true,
      findings: [{ severity: "minor" }],
      scope: {
        inputsAudited: [
          ".pan/work/172996_05-10-26/38670_1315_demo-feature/touch-set.json",
          "lib/memory/features/demo-feature/delivery-report.md",
        ],
      },
    });
    await writeJson(root, path.join(root, durableFeatureIndexRel("demo-feature-flat")), {
      feature_id: "demo-feature-flat",
      task_id: "38670_1315_demo-feature",
      indexed_at: "2026-05-10T14:20:00.000Z",
      artifact_index: {
        compliance_result: resultRel,
        run_dir: ".pan/archive/work/172996_05-10-26/38670_1315_demo-feature",
      },
    });

    const history = await ensureComplianceAuditHistoryBackfilled(root);
    expect(history.entries.some((entry) => entry.feature_id === "demo-feature-flat")).toBe(true);
  });

  it("backfills history from indexed compliance artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-audit-history-backfill-"));
    const resultRel = ".pan/archive/work/172996_05-10-26/38670_1315_demo-feature/compliance-result.json";
    await writeJson(root, path.join(root, resultRel), {
      taskId: "38670_1315_demo-feature",
      featureId: "demo-feature",
      auditedAt: "2026-05-10T14:10:00.000Z",
      compliance_passes: true,
      findings: [{ severity: "minor" }],
      scope: {
        inputsAudited: [
          ".pan/work/172996_05-10-26/38670_1315_demo-feature/touch-set.json",
          "lib/memory/features/demo-feature/delivery-report.md",
        ],
      },
    });
    await writeJson(root, path.join(root, durableFeatureIndexRel("demo-feature")), {
      feature_id: "demo-feature",
      task_id: "38670_1315_demo-feature",
      indexed_at: "2026-05-10T14:20:00.000Z",
      artifact_index: {
        pipeline_artifacts: {
          compliance_result: { path: resultRel },
          work_dir: { path: ".pan/archive/work/172996_05-10-26/38670_1315_demo-feature" },
        },
      },
    });

    const history = await ensureComplianceAuditHistoryBackfilled(root);
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]?.feature_id).toBe("demo-feature");
    expect(history.entries[0]?.artifact_paths.compliance_result).toBe(resultRel);
    await expect(readFile(path.join(root, COMPLIANCE_AUDIT_HISTORY_REL), "utf8")).resolves.toContain(
      "38670_1315_demo-feature",
    );
  });

  it("persists compliance result metadata and computes baseline delta", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-audit-history-persist-"));
    const baselineResultRel = ".pan/archive/work/172995_05-11-26/40000_1200_old/compliance-result.json";
    await writeJson(root, path.join(root, baselineResultRel), {
      taskId: "40000_1200_old",
      featureId: "old",
      auditedAt: "2026-05-11T12:00:00.000Z",
      compliance_passes: true,
      scope: { inputsAudited: ["lib/memory/features/shared.md"] },
    });
    await writeJson(root, path.join(root, durableFeatureIndexRel("old")), {
      feature_id: "old",
      task_id: "40000_1200_old",
      indexed_at: "2026-05-11T12:05:00.000Z",
      artifact_index: {
        pipeline_artifacts: {
          compliance_result: { path: baselineResultRel },
          work_dir: { path: ".pan/archive/work/172995_05-11-26/40000_1200_old" },
        },
      },
    });
    await ensureComplianceAuditHistoryBackfilled(root);

    const runDirRel = ".pan/work/172994_05-12-26/39999_1210_new";
    await writeJson(root, path.join(root, `${runDirRel}/touch-set.json`), { touched: ["x"] });
    await writeJson(root, path.join(root, `${runDirRel}/review.md`), { review: true });
    await writeJson(root, path.join(root, `${runDirRel}/test-report.md`), { qa: true });
    await writeJson(root, path.join(root, deliveryReportRel(runDirRel)), { delivered: true });
    await writeJson(root, path.join(root, `${runDirRel}/compliance-result.json`), {
      taskId: "39999_1210_new",
      featureId: "new",
      auditedAt: "2026-05-12T12:30:00.000Z",
      compliance_passes: true,
      findings: [{ severity: "block" }, { severity: "note" }],
      scope: {
        inputsAudited: [
          `${runDirRel}/touch-set.json`,
          deliveryReportRel(runDirRel),
        ],
      },
    });

    const persisted = await persistComplianceAuditHistoryForResult({
      repoRoot: root,
      taskId: "39999_1210_new",
      featureId: "new",
      runDir: runDirRel,
      complianceResultRel: `${runDirRel}/compliance-result.json`,
      defaultScopePaths: [],
      now: new Date("2026-05-12T12:31:00.000Z"),
    });
    expect(persisted.resolvedBaselineAuditId).toBeTruthy();
    expect(persisted.deltaSummary.changed_paths.length).toBeGreaterThan(0);

    const complianceResultText = await readFile(path.join(root, `${runDirRel}/compliance-result.json`), "utf8");
    expect(complianceResultText).toContain(`"audit_id": "${persisted.auditId}"`);
    expect(complianceResultText).toContain(`"baseline_audit_id": "${persisted.resolvedBaselineAuditId}"`);
    const prompt = complianceAuditPromptContext({
      repoRoot: root,
      defaultScopePaths: [`${runDirRel}/touch-set.json`],
    });
    expect(prompt?.availableAuditIds[0]).toBe(persisted.auditId);
  });

  it("rewrites run-scoped paths after close-artifacts archive move", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-audit-history-normalize-"));
    const runDirRel = ".pan/work/172994_05-12-26/39999_1210_new";
    await writeJson(root, path.join(root, COMPLIANCE_AUDIT_HISTORY_REL), {
      schema_version: "1",
      max_entries: 5,
      generated_at: "2026-05-12T12:31:00.000Z",
      entries: [
        {
          audit_id: "39999_1210_new-20260512123000",
          task_id: "39999_1210_new",
          feature_id: "new",
          recorded_at: "2026-05-12T12:30:00.000Z",
          stage_status: "passed",
          baseline_audit_id: null,
          artifact_paths: {
            compliance_result: `${runDirRel}/compliance-result.json`,
            run_dir: runDirRel,
          },
          scope_snapshot: [
            {
              path: `${runDirRel}/touch-set.json`,
              exists: true,
              sha256: "abc",
              size_bytes: 10,
            },
          ],
          delta_summary: {
            added: 1,
            removed: 0,
            modified: 0,
            changed_paths: [`${runDirRel}/touch-set.json`],
          },
          findings_summary: {
            total: 0,
            block: 0,
            major: 0,
            minor: 0,
            note: 0,
          },
        },
      ],
    });

    await normalizeComplianceAuditHistoryForArchivedRun({
      repoRoot: root,
      taskId: "39999_1210_new",
      fromRunDir: runDirRel,
      toRunDir: ".pan/archive/work/172994_05-12-26/39999_1210_new",
    });

    const text = await readFile(path.join(root, COMPLIANCE_AUDIT_HISTORY_REL), "utf8");
    expect(text).toContain(".pan/archive/work/172994_05-12-26/39999_1210_new/compliance-result.json");
    expect(text).not.toContain(`"${runDirRel}/compliance-result.json"`);
  });
});
