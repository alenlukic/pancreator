import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseAndRun } from "./run.js";

async function seedFeatureDeliveryRepo(root: string): Promise<void> {
  await mkdir(path.join(root, "src", "inbox", "in"), { recursive: true });
  await mkdir(path.join(root, "src", "pipelines"), { recursive: true });
  await writeFile(
    path.join(root, "src", "pipelines", "feature-delivery.yaml"),
    `id: feature-delivery
version: "1"
stages:
  - id: intake
    persona: intake-analyst
    label: Canonicalize the human directive
  - id: plan
    persona: tech-lead
  - id: implement
    persona: coder
  - id: review
    persona: reviewer
  - id: report
    persona: tech-writer
  - id: ship
    persona: supervisor
  - id: index
    persona: librarian
`,
    "utf8",
  );
}

describe("parseAndRun", () => {
  it("lists src/inbox/in entries via FileInbox", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tess-cli-"));
    const inboxIn = path.join(root, "src", "inbox", "in");
    await mkdir(inboxIn, { recursive: true });
    await writeFile(path.join(inboxIn, "note.md"), "hello", "utf8");
    const out: string[] = [];
    const code = await parseAndRun(["inbox"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
    });
    expect(code).toBe(0);
    const line = out.join("");
    const msg = JSON.parse(line) as { entries: string[] };
    expect(msg.entries).toContain("note.md");
  });

  it("starts a feature-delivery run from an inbox directive", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tess-run-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(
      path.join(root, "src", "inbox", "in", "demo-feature.md"),
      "# Demo Feature\n\nBuild the thing.",
      "utf8",
    );
    const out: string[] = [];
    const code = await parseAndRun(["run", "feature-delivery", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    expect(code).toBe(0);
    const msg = JSON.parse(out.join("")) as {
      status: string;
      taskId: string;
      featureId: string;
      stateFile: string;
      handoffFile: string;
      runLogFile: string;
    };
    expect(msg.status).toBe("ok");
    expect(msg.featureId).toBe("demo-feature");
    expect(msg.taskId).toBe("38670_1315_demo-feature");
    const state = JSON.parse(await readFile(path.join(root, msg.stateFile), "utf8")) as {
      currentStage: string;
      transitions: unknown[];
    };
    expect(state.currentStage).toBe("intake");
    expect(state.transitions.length).toBeGreaterThan(5);
    expect(await readFile(path.join(root, msg.handoffFile), "utf8")).toContain(
      "Executor persona: intake-analyst",
    );
    expect(await readFile(path.join(root, msg.runLogFile), "utf8")).toContain(
      '"stage_id":"invoke"',
    );
  });

  it("advances one stage only with the expected stage artifact", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tess-advance-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "src", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string; stateFile: string; nextPromptFile: string };
    expect(start.nextPromptFile).toContain("next-prompt.md");

    const spec = path.join(root, "src", "memory", "features", "demo-feature", "spec.md");
    await mkdir(path.dirname(spec), { recursive: true });
    await writeFile(spec, "# Demo Feature Spec", "utf8");

    const advanceOut: string[] = [];
    const code = await parseAndRun(
      ["advance", start.taskId, "--artifact", "src/memory/features/demo-feature/spec.md"],
      { repoRoot: root, writeOut: (c) => advanceOut.push(c) },
    );
    expect(code).toBe(0);
    const advanced = JSON.parse(advanceOut.join("")) as { currentStage: string; nextPromptFile: string };
    expect(advanced.currentStage).toBe("plan");
    expect(await readFile(path.join(root, advanced.nextPromptFile), "utf8")).toContain("Use subagent/persona: tech-lead");

    const duplicateOut: string[] = [];
    const duplicateCode = await parseAndRun(
      ["advance", start.taskId, "--artifact", "src/memory/features/demo-feature/spec.md"],
      { repoRoot: root, writeOut: (c) => duplicateOut.push(c), writeErr: () => undefined },
    );
    expect(duplicateCode).toBe(1);
    expect(duplicateOut.join("")).toContain("not valid for plan");
  });

  it("repairs a stale state ledger with explicit evidence and reason", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tess-repair-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "src", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string; stateFile: string };
    const review = path.join(root, "src", "work", "172996_05-10-26", start.taskId, "review.md");
    await mkdir(path.dirname(review), { recursive: true });
    await writeFile(review, "# Review\n\nManual out-of-band review evidence.", "utf8");

    const repairOut: string[] = [];
    const code = await parseAndRun(
      [
        "repair-state",
        start.taskId,
        "--stage",
        "review",
        "--artifact",
        `src/work/172996_05-10-26/${start.taskId}/review.md`,
        "--reason",
        "manual Cursor run reached review before ledger advancement existed",
      ],
      { repoRoot: root, writeOut: (c) => repairOut.push(c) },
    );
    expect(code).toBe(0);
    const repaired = JSON.parse(repairOut.join("")) as { currentStage: string; nextPersona: string };
    expect(repaired.currentStage).toBe("review");
    expect(repaired.nextPersona).toBe("reviewer");
    const state = JSON.parse(await readFile(path.join(root, start.stateFile), "utf8")) as {
      currentStage: string;
      advanceHistory: Array<{ kind: string; reason?: string }>;
    };
    expect(state.currentStage).toBe("review");
    expect(state.advanceHistory.at(-1)?.kind).toBe("repair");
  });


  it("delegates final artifact closure to librarian for complete feature-delivery runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tess-complete-prompt-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "src", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string; nextPromptFile: string };
    const runDir = path.join(root, "src", "work", "172996_05-10-26", start.taskId);

    const spec = path.join(root, "src", "memory", "features", "demo-feature", "spec.md");
    await mkdir(path.dirname(spec), { recursive: true });
    await writeFile(spec, "# Spec", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", "src/memory/features/demo-feature/spec.md"], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    await writeFile(path.join(runDir, "plan.md"), "# Plan", "utf8");
    await writeFile(path.join(runDir, "touch-set.json"), "{}\n", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", `src/work/172996_05-10-26/${start.taskId}/touch-set.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    await writeFile(path.join(runDir, "implementation-report.md"), "# Impl", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", `src/work/172996_05-10-26/${start.taskId}/implementation-report.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    await writeFile(path.join(runDir, "review.md"), "review_passes: true", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", `src/work/172996_05-10-26/${start.taskId}/review.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    const report = path.join(root, "src", "memory", "features", "demo-feature", "delivery-report.md");
    await writeFile(report, "# Delivery", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", "src/memory/features/demo-feature/delivery-report.md"], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    await writeFile(path.join(runDir, "policy-compliance.json"), "{}\n", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", `src/work/172996_05-10-26/${start.taskId}/policy-compliance.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    const index = path.join(root, "src", "memory", "features", "demo-feature", "index.json");
    await writeFile(index, "{}\n", "utf8");
    const completeOut: string[] = [];
    await parseAndRun(["advance", start.taskId, "--artifact", "src/memory/features/demo-feature/index.json"], {
      repoRoot: root,
      writeOut: (c) => completeOut.push(c),
    });
    const complete = JSON.parse(completeOut.join("")) as { currentStage: string; nextPersona: string; nextPromptFile: string };
    expect(complete.currentStage).toBe("complete");
    expect(complete.nextPersona).toBe("librarian");

    const prompt = await readFile(path.join(root, complete.nextPromptFile), "utf8");
    expect(prompt).toContain("Use subagent/persona: librarian");
    expect(prompt).toContain("Final artifact closure is delegated to librarian");
    expect(prompt).toContain(`pnpm -w exec tess close-artifacts ${start.taskId}`);
    expect(prompt).not.toContain("Human operator action: archive active surfaces");
  });

  it("closes completed feature-delivery artifacts by archiving work and source inbox paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tess-close-artifacts-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "src", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string };
    const activeRunDirRel = `src/work/172996_05-10-26/${start.taskId}`;
    const activeRunDir = path.join(root, activeRunDirRel);

    const spec = path.join(root, "src", "memory", "features", "demo-feature", "spec.md");
    await mkdir(path.dirname(spec), { recursive: true });
    await writeFile(spec, "# Spec", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", "src/memory/features/demo-feature/spec.md"], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(activeRunDir, "plan.md"), "# Plan", "utf8");
    await writeFile(path.join(activeRunDir, "touch-set.json"), "{}\n", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", `${activeRunDirRel}/touch-set.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(activeRunDir, "implementation-report.md"), "# Impl", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", `${activeRunDirRel}/implementation-report.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(activeRunDir, "review.md"), "review_passes: true", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", `${activeRunDirRel}/review.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    const report = path.join(root, "src", "memory", "features", "demo-feature", "delivery-report.md");
    await writeFile(report, "# Delivery", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", "src/memory/features/demo-feature/delivery-report.md"], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(activeRunDir, "policy-compliance.json"), "{}\n", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", `${activeRunDirRel}/policy-compliance.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    const index = path.join(root, "src", "memory", "features", "demo-feature", "index.json");
    await writeFile(index, "{}\n", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", "src/memory/features/demo-feature/index.json"], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    const closeOut: string[] = [];
    const code = await parseAndRun(["close-artifacts", start.taskId], {
      repoRoot: root,
      writeOut: (c) => closeOut.push(c),
      clock: () => new Date("2026-05-10T14:00:00.000Z"),
    });
    expect(code).toBe(0);
    const closed = JSON.parse(closeOut.join("")) as {
      pipelineStatus: string;
      archivedRunDir: string;
      archivedInboxPath: string;
      stateFile: string;
    };
    expect(closed.pipelineStatus).toBe("closed");
    expect(closed.archivedRunDir).toBe(`src/internal/work_archive/172996_05-10-26/${start.taskId}`);
    expect(closed.archivedInboxPath).toBe(`src/inbox/archive/in/172996_05-10-26/${start.taskId}/demo-feature.md`);

    expect(existsSync(path.join(root, "src", "inbox", "in", "demo-feature.md"))).toBe(false);
    expect(existsSync(path.join(root, activeRunDirRel))).toBe(false);
    expect(existsSync(path.join(root, "src", "work", "172996_05-10-26"))).toBe(false);
    expect(existsSync(path.join(root, closed.archivedInboxPath))).toBe(true);
    expect(existsSync(path.join(root, closed.stateFile))).toBe(true);

    const statusOut: string[] = [];
    await parseAndRun(["status", start.taskId], { repoRoot: root, writeOut: (c) => statusOut.push(c) });
    const status = JSON.parse(statusOut.join("")) as { pipelineStatus: string; runDir: string };
    expect(status.pipelineStatus).toBe("closed");
    expect(status.runDir).toBe(closed.archivedRunDir);
  });

  it("refreshes prompt files for an existing feature-delivery ledger", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tess-refresh-prompt-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "src", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string; nextPromptFile: string };
    const nextPromptAbs = path.join(root, start.nextPromptFile);
    await writeFile(nextPromptAbs, "stale prompt", "utf8");

    const refreshOut: string[] = [];
    const code = await parseAndRun(["refresh-prompt", start.taskId], {
      repoRoot: root,
      writeOut: (c) => refreshOut.push(c),
    });
    expect(code).toBe(0);
    const refreshed = JSON.parse(refreshOut.join("")) as { command: string; currentStage: string };
    expect(refreshed.command).toBe("refresh-prompt");
    expect(refreshed.currentStage).toBe("intake");
    expect(await readFile(nextPromptAbs, "utf8")).toContain("Use subagent/persona: intake-analyst");
  });

  it("exposes intervention state through status", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tess-status-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "src", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const taskId = (JSON.parse(out.join("")) as { taskId: string }).taskId;
    await parseAndRun(["pause", taskId], { repoRoot: root, writeOut: () => undefined });
    const statusOut: string[] = [];
    const code = await parseAndRun(["status", taskId], {
      repoRoot: root,
      writeOut: (c) => statusOut.push(c),
    });
    expect(code).toBe(0);
    const status = JSON.parse(statusOut.join("")) as { interventionState: string; currentStage: string };
    expect(status.currentStage).toBe("intake");
    expect(status.interventionState).toBe("paused");
  });

  it("appends a pause record under .tess/scheduler/interventions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tess-cli2-"));
    const out: string[] = [];
    const code = await parseAndRun(["pause", "task-a"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
    });
    expect(code).toBe(0);
    const journal = path.join(root, ".tess", "scheduler", "interventions", "task-a.jsonl");
    const raw = await readFile(journal, "utf8");
    expect(raw).toContain('"command":"pause"');
  });

  it("returns 1 on unknown command", async () => {
    const code = await parseAndRun(["not-a-real-command"], {
      repoRoot: os.tmpdir(),
      writeOut: () => {},
      writeErr: () => {},
    });
    expect(code).toBe(1);
  });
});
