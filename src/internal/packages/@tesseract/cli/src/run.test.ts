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
