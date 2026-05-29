import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { CursorSdkTransport } from "@daedaline/runner-cursor";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseAndRun, DDL_ACTIVE_MEMORY_CONFLICT_EXIT_CODE, DDL_DEFERRED_EXIT_CODE } from "./run.js";
import { loadRepoEnv } from "./repo-env.js";
import { PersonaResolveError, resolvePersona } from "./persona-resolve.js";

const JSON_FORMAT_ABBREV_ENV = "DDL_JSON_FORMAT_ABBREV_LEN";
const CANONICAL_REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../..");

const FEATURE_DELIVERY_PERSONAS = [
  "intake-analyst",
  "tech-lead",
  "coder",
  "reviewer",
  "qa-tester",
  "tech-writer",
  "supervisor",
  "librarian",
] as const;

async function seedCanonicalPersonas(root: string): Promise<void> {
  const personasDir = path.join(root, "src", "personas");
  await mkdir(personasDir, { recursive: true });
  for (const persona of FEATURE_DELIVERY_PERSONAS) {
    await copyFile(
      path.join(CANONICAL_REPO_ROOT, "src", "personas", `${persona}.md`),
      path.join(personasDir, `${persona}.md`),
    );
  }
}

async function writeRunnerInvocationConfig(root: string, invocation: "manual" | "sdk"): Promise<void> {
  await writeFile(
    path.join(root, "daedaline.yaml"),
    `project_root: "."
runner:
  cursor:
    invocation: ${invocation}
`,
    "utf8",
  );
}

function mockSdkTransport(onInvoke?: () => void): CursorSdkTransport {
  return async () => {
    onInvoke?.();
    return { status: "ok", resultText: "mocked-sdk" };
  };
}

function runnerInvokeLogLines(logText: string): string[] {
  return logText
    .split("\n")
    .filter(Boolean)
    .filter(
      (line) =>
        line.includes('"gen_ai.provider.name":"cursor"') ||
        line.includes('"gen_ai.provider.name": "cursor"'),
    );
}

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
  - id: test
    persona: qa-tester
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

async function completeFeatureDeliveryRunForClose(
  root: string,
  taskId: string,
  featureId: string,
  dayDir: string,
): Promise<{ activeRunDirRel: string; inboxSourceRel: string }> {
  const activeRunDirRel = `src/work/${dayDir}/${taskId}`;
  const activeRunDir = path.join(root, activeRunDirRel);

  const spec = path.join(root, "src", "memory", "features", featureId, "spec.md");
  await mkdir(path.dirname(spec), { recursive: true });
  await writeFile(spec, "# Spec", "utf8");
  await parseAndRun(["advance", taskId, "--artifact", `src/memory/features/${featureId}/spec.md`], {
    repoRoot: root,
    writeOut: () => undefined,
  });
  await writeFile(path.join(activeRunDir, "plan.md"), "# Plan", "utf8");
  await writeFile(path.join(activeRunDir, "touch-set.json"), "{}\n", "utf8");
  await parseAndRun(["advance", taskId, "--artifact", `${activeRunDirRel}/touch-set.json`], {
    repoRoot: root,
    writeOut: () => undefined,
  });
  await writeFile(path.join(activeRunDir, "implementation-report.md"), "# Impl", "utf8");
  await parseAndRun(["advance", taskId, "--artifact", `${activeRunDirRel}/implementation-report.md`], {
    repoRoot: root,
    writeOut: () => undefined,
  });
  await writeFile(path.join(activeRunDir, "review.md"), "review_passes: true", "utf8");
  await parseAndRun(["advance", taskId, "--artifact", `${activeRunDirRel}/review.md`], {
    repoRoot: root,
    writeOut: () => undefined,
  });
  await writeFile(path.join(activeRunDir, "test-report.md"), "qa_passes: true", "utf8");
  await parseAndRun(["advance", taskId, "--artifact", `${activeRunDirRel}/test-report.md`], {
    repoRoot: root,
    writeOut: () => undefined,
  });
  const report = path.join(root, "src", "memory", "features", featureId, "delivery-report.md");
  await writeFile(report, "# Delivery", "utf8");
  await parseAndRun(["advance", taskId, "--artifact", `src/memory/features/${featureId}/delivery-report.md`], {
    repoRoot: root,
    writeOut: () => undefined,
  });
  await writeFile(path.join(activeRunDir, "policy-compliance.json"), "{}\n", "utf8");
  await parseAndRun(["advance", taskId, "--artifact", `${activeRunDirRel}/policy-compliance.json`], {
    repoRoot: root,
    writeOut: () => undefined,
  });
  const inboxSourceRel = "src/inbox/in/demo-feature.md";
  const index = path.join(root, "src", "memory", "features", featureId, "index.json");
  await writeFile(
    index,
    `${JSON.stringify(
      {
        feature_id: featureId,
        task_id: taskId,
        status: "indexed",
        indexed_at: "2026-05-10T13:30:00.000Z",
        source_inbox_item: { path: inboxSourceRel },
        delivery_report: { path: `src/memory/features/${featureId}/delivery-report.md` },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await parseAndRun(["advance", taskId, "--artifact", `src/memory/features/${featureId}/index.json`], {
    repoRoot: root,
    writeOut: () => undefined,
  });
  return { activeRunDirRel, inboxSourceRel };
}

describe("parseAndRun", () => {
  let hadAbbrevEnv: boolean;
  let prevAbbrevEnv: string | undefined;

  beforeEach(() => {
    hadAbbrevEnv = Object.hasOwn(process.env, JSON_FORMAT_ABBREV_ENV);
    prevAbbrevEnv = process.env[JSON_FORMAT_ABBREV_ENV];
    process.env[JSON_FORMAT_ABBREV_ENV] = "7";
  });

  afterEach(() => {
    if (hadAbbrevEnv) {
      process.env[JSON_FORMAT_ABBREV_ENV] = prevAbbrevEnv;
    } else {
      delete process.env[JSON_FORMAT_ABBREV_ENV];
    }
  });

  it("lists src/inbox/in entries via FileInbox", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-cli-"));
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
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-run-"));
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
    const raw = out.join("");
    expect(raw).toMatch(/^\{\n {2}"command": "run",\n/u);
    const msg = JSON.parse(raw) as {
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

  it("accepts inbox entries as src/inbox/in/... or bucket-relative paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-run-inbox-path-"));
    await seedFeatureDeliveryRepo(root);
    const bucket = "172980_05-26-26";
    await mkdir(path.join(root, "src", "inbox", "in", bucket), { recursive: true });
    const inboxRel = `${bucket}/2597_demo-feature.md`;
    await writeFile(
      path.join(root, "src", "inbox", "in", inboxRel),
      "# Demo Feature\n\nBuild the thing.",
      "utf8",
    );
    const out: string[] = [];
    const code = await parseAndRun(
      ["run", "feature-delivery", `src/inbox/in/${inboxRel}`],
      {
        repoRoot: root,
        writeOut: (c) => out.push(c),
        clock: () => new Date("2026-05-10T13:15:30.000Z"),
      },
    );
    expect(code).toBe(0);
    const msg = JSON.parse(out.join("")) as {
      status: string;
      featureId: string;
      stateFile: string;
    };
    expect(msg.status).toBe("ok");
    expect(msg.featureId).toBe("demo-feature");
    const state = JSON.parse(await readFile(path.join(root, msg.stateFile), "utf8")) as {
      source: { inboxEntry: string };
    };
    expect(state.source.inboxEntry).toBe(inboxRel);
  });

  it("advances one stage only with the expected stage artifact", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-advance-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "src", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const startRaw = out.join("");
    expect(startRaw).toMatch(/^\{\n {2}"command": "feature new",\n/u);
    const start = JSON.parse(startRaw) as { taskId: string; stateFile: string; nextPromptFile: string };
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

  it("reports invalid task-id format with a suggested canonical id during advance", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-advance-hint-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "src", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });

    const spec = path.join(root, "src", "memory", "features", "demo-feature", "spec.md");
    await mkdir(path.dirname(spec), { recursive: true });
    await writeFile(spec, "# Demo Feature Spec", "utf8");

    const invalidOut: string[] = [];
    const invalidCode = await parseAndRun(
      ["advance", "000200_demo-feature", "--artifact", "src/memory/features/demo-feature/spec.md"],
      { repoRoot: root, writeOut: (c) => invalidOut.push(c), writeErr: () => undefined },
    );
    expect(invalidCode).toBe(1);
    const payload = JSON.parse(invalidOut.join("")) as { message: string };
    expect(payload.message).toContain("task id MUST match <seconds-to-midnight>_<HHMM>_<slug>.");
    expect(payload.message).toContain("Did you mean 38670_1315_demo-feature?");
  });

  it("reports invalid task-id format without hint when no slug match exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-advance-no-hint-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "src", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: () => undefined,
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });

    const spec = path.join(root, "src", "memory", "features", "demo-feature", "spec.md");
    await mkdir(path.dirname(spec), { recursive: true });
    await writeFile(spec, "# Demo Feature Spec", "utf8");

    const invalidOut: string[] = [];
    const invalidCode = await parseAndRun(
      ["advance", "000200_unknown-feature", "--artifact", "src/memory/features/demo-feature/spec.md"],
      { repoRoot: root, writeOut: (c) => invalidOut.push(c), writeErr: () => undefined },
    );
    expect(invalidCode).toBe(1);
    const payload = JSON.parse(invalidOut.join("")) as { message: string };
    expect(payload.message).toBe("task id MUST match <seconds-to-midnight>_<HHMM>_<slug>.");
  });

  it("repairs a stale state ledger with explicit evidence and reason", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-repair-"));
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

  it("chains implement and review advances when review.md passes after must_fix", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-review-reentry-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "src", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string; stateFile: string };
    const runDirRel = `src/work/172996_05-10-26/${start.taskId}`;
    const runDir = path.join(root, runDirRel);

    const spec = path.join(root, "src", "memory", "features", "demo-feature", "spec.md");
    await mkdir(path.dirname(spec), { recursive: true });
    await writeFile(spec, "# Spec", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", "src/memory/features/demo-feature/spec.md"], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(runDir, "plan.md"), "# Plan", "utf8");
    await writeFile(path.join(runDir, "touch-set.json"), "{}\n", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", `${runDirRel}/touch-set.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(runDir, "implementation-report.md"), "# Impl", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", `${runDirRel}/implementation-report.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(runDir, "review.md"), "review_passes: false\n\n### must fix\n- MF-01", "utf8");
    await parseAndRun(
      ["advance", start.taskId, "--event", "must_fix", "--artifact", `${runDirRel}/review.md`],
      { repoRoot: root, writeOut: () => undefined },
    );

    await writeFile(path.join(runDir, "review.md"), "review_passes: true", "utf8");
    const reentryOut: string[] = [];
    await parseAndRun(["advance", start.taskId, "--artifact", `${runDirRel}/review.md`], {
      repoRoot: root,
      writeOut: (c) => reentryOut.push(c),
    });
    const reentry = JSON.parse(reentryOut.join("")) as {
      currentStage: string;
      fromStage: string;
      event: string;
      reviewReentry?: boolean;
      nextPersona: string;
    };
    expect(reentry.reviewReentry).toBe(true);
    expect(reentry.fromStage).toBe("implement");
    expect(reentry.event).toBe("review_passes");
    expect(reentry.currentStage).toBe("test");
    expect(reentry.nextPersona).toBe("qa-tester");

    const state = JSON.parse(await readFile(path.join(root, start.stateFile), "utf8")) as {
      currentStage: string;
      advanceHistory: Array<{ event: string; from: string; to: string }>;
    };
    expect(state.currentStage).toBe("test");
    expect(state.advanceHistory.at(-2)).toMatchObject({
      from: "implement",
      to: "review",
      event: "implementation_complete",
    });
    expect(state.advanceHistory.at(-1)).toMatchObject({
      from: "review",
      to: "test",
      event: "review_passes",
    });
  });

  it("delegates final artifact closure to librarian for complete feature-delivery runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-complete-prompt-"));
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

    await writeFile(path.join(runDir, "test-report.md"), "qa_passes: true", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", `src/work/172996_05-10-26/${start.taskId}/test-report.md`], {
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
    expect(prompt).toContain(`pnpm -w exec ddl close-artifacts ${start.taskId}`);
    expect(prompt).not.toContain("Human operator action: archive active surfaces");
  });

  it("closes completed feature-delivery artifacts by archiving work and source inbox paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-close-artifacts-"));
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
    await writeFile(path.join(activeRunDir, "test-report.md"), "qa_passes: true", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", `${activeRunDirRel}/test-report.md`], {
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
    const inboxSourceRel = "src/inbox/in/demo-feature.md";
    await writeFile(
      index,
      `${JSON.stringify(
        {
          feature_id: "demo-feature",
          task_id: start.taskId,
          status: "indexed",
          indexed_at: "2026-05-10T13:30:00.000Z",
          source_inbox_item: { path: inboxSourceRel },
          delivery_report: { path: "src/memory/features/demo-feature/delivery-report.md" },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await parseAndRun(["advance", start.taskId, "--artifact", "src/memory/features/demo-feature/index.json"], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    await mkdir(path.join(root, "src", "memory", "active"), { recursive: true });
    await writeFile(
      path.join(root, "src", "memory", "active", "current.md"),
      [
        "# Current focus",
        "",
        "## Active Feature",
        `\n- \`${inboxSourceRel}\`\n`,
        "",
        "## Most recent shipped Features",
        "\n| Feature | Shipped at (UTC) | Delivery report | Outbox artifact | Archived source |\n|---|---|---|---|---|\n| `—` | `—` | `—` | `—` | `—` |\n",
        "",
        "## Operator notes",
        "\n<!-- ddl:active-memory:operator-notes:auto -->\n\n- Active-memory refreshed (UTC): `2020-01-01T00:00:00.000Z`\n\n<!-- /ddl:active-memory:operator-notes:auto -->\n",
        "",
      ].join("\n"),
      "utf8",
    );

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
      activeMemoryPath: string;
      activeFeatureCleared: boolean;
      stateFile: string;
    };
    expect(closed.pipelineStatus).toBe("closed");
    expect(closed.archivedRunDir).toBe(`src/internal/work_archive/172996_05-10-26/${start.taskId}`);
    expect(closed.archivedInboxPath).toBe(`src/inbox/archive/in/172996_05-10-26/${start.taskId}/demo-feature.md`);
    expect(closed.activeMemoryPath).toBe("src/memory/active/current.md");
    expect(closed.activeFeatureCleared).toBe(true);

    const indexAfterClose = JSON.parse(await readFile(index, "utf8")) as {
      archived_inbox_source: string;
      source_inbox_item: { path: string };
    };
    expect(indexAfterClose.archived_inbox_source).toBe(closed.archivedInboxPath);
    expect(indexAfterClose.source_inbox_item.path).toBe(closed.archivedInboxPath);

    const currentMd = await readFile(path.join(root, "src", "memory", "active", "current.md"), "utf8");
    expect(currentMd).toContain("- `(none)`");
    expect(currentMd).not.toContain(inboxSourceRel);
    expect(currentMd).toContain(closed.archivedInboxPath);
    expect(currentMd).toContain("2026-05-10T14:00:00.000Z");

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

  it("rolls back archive moves when active-memory refresh fails during close-artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-close-artifacts-rollback-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "src", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string };
    const dayDir = "172996_05-10-26";
    const { activeRunDirRel, inboxSourceRel } = await completeFeatureDeliveryRunForClose(
      root,
      start.taskId,
      "demo-feature",
      dayDir,
    );

    await mkdir(path.join(root, "src", "memory", "active"), { recursive: true });
    await writeFile(
      path.join(root, "src", "memory", "active", "current.md"),
      "# Current focus\n\n## Most recent shipped Features\n\nbad\n",
      "utf8",
    );

    const closeOut: string[] = [];
    const closeCode = await parseAndRun(["close-artifacts", start.taskId], {
      repoRoot: root,
      writeOut: (c) => closeOut.push(c),
      clock: () => new Date("2026-05-10T14:00:00.000Z"),
    });
    expect(closeCode).toBe(1);
    const payload = JSON.parse(closeOut.join("")) as { message: string };
    expect(payload.message).toContain("Heading \"## Active Feature\" is missing from current.md");
    const archivedRunDirRel = `src/internal/work_archive/${dayDir}/${start.taskId}`;
    const archivedInboxRel = `src/inbox/archive/in/${dayDir}/${start.taskId}/demo-feature.md`;
    expect(existsSync(path.join(root, activeRunDirRel))).toBe(true);
    expect(existsSync(path.join(root, inboxSourceRel))).toBe(true);
    expect(existsSync(path.join(root, archivedRunDirRel))).toBe(false);
    expect(existsSync(path.join(root, archivedInboxRel))).toBe(false);

    const statusOut: string[] = [];
    await parseAndRun(["status", start.taskId], { repoRoot: root, writeOut: (c) => statusOut.push(c) });
    const status = JSON.parse(statusOut.join("")) as { pipelineStatus: string; runDir: string };
    expect(status.pipelineStatus).toBe("complete");
    expect(status.runDir).toBe(activeRunDirRel);
  });

  it("refreshes shipped-feature rows on close even when active feature was already none", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-close-artifacts-refresh-shipped-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "src", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string };
    const dayDir = "172996_05-10-26";
    const { inboxSourceRel } = await completeFeatureDeliveryRunForClose(
      root,
      start.taskId,
      "demo-feature",
      dayDir,
    );

    await mkdir(path.join(root, "src", "memory", "active"), { recursive: true });
    await writeFile(
      path.join(root, "src", "memory", "active", "current.md"),
      [
        "# Current focus",
        "",
        "## Active Feature",
        "\n- `(none)`\n",
        "",
        "## Most recent shipped Features",
        "\n| Feature | Shipped at (UTC) | Delivery report | Outbox artifact | Archived source |\n|---|---|---|---|---|\n| `—` | `—` | `—` | `—` | `—` |\n",
        "",
        "## Operator notes",
        "\n<!-- ddl:active-memory:operator-notes:auto -->\n\n- Active-memory refreshed (UTC): `2020-01-01T00:00:00.000Z`\n\n<!-- /ddl:active-memory:operator-notes:auto -->\n",
        "",
      ].join("\n"),
      "utf8",
    );

    const closeOut: string[] = [];
    const code = await parseAndRun(["close-artifacts", start.taskId], {
      repoRoot: root,
      writeOut: (c) => closeOut.push(c),
      clock: () => new Date("2026-05-10T14:00:00.000Z"),
    });
    expect(code).toBe(0);
    const closed = JSON.parse(closeOut.join("")) as {
      archivedInboxPath: string;
      activeFeatureCleared: boolean;
    };
    expect(closed.activeFeatureCleared).toBe(false);
    expect(closed.archivedInboxPath).not.toBe(inboxSourceRel);

    const currentMd = await readFile(path.join(root, "src", "memory", "active", "current.md"), "utf8");
    expect(currentMd).toContain("| `demo-feature` | [indexed] (`2026-05-10T13:30:00.000Z`) |");
    expect(currentMd).toContain(closed.archivedInboxPath);
    expect(currentMd).toContain("- `(none)`");
  });

  it("refreshes prompt files for an existing feature-delivery ledger", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-refresh-prompt-"));
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

  it("writes an intervention pause line to feature-delivery run.log when paused", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-pause-log-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(
      path.join(root, "src", "inbox", "in", "demo-feature.md"),
      "# Demo Feature\n\nBuild the thing.",
      "utf8",
    );
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string; runLogFile: string };
    await parseAndRun(["pause", start.taskId], { repoRoot: root, writeOut: () => undefined });

    const runLogAbs = path.join(root, start.runLogFile);
    const logText = await readFile(runLogAbs, "utf8");
    const lines = logText.trim().split("\n").filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]!) as {
      name: string;
      daedaline: { intervention?: { lever: string } };
    };
    expect(last.name).toBe("daedaline.pipeline.intervention.pause");
    expect(last.daedaline.intervention?.lever).toBe("pause");
  });

  it("exposes intervention state through status", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-status-"));
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

  it("appends a pause record under .ddl/scheduler/interventions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-cli2-"));
    const out: string[] = [];
    const code = await parseAndRun(["pause", "task-a"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
    });
    expect(code).toBe(0);
    const journal = path.join(root, ".ddl", "scheduler", "interventions", "task-a.jsonl");
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

describe("operator tooling batch cli wiring", () => {
  const refreshIso = "2026-05-25T19:05:00.000Z";
  let hadAbbrevEnv: boolean;
  let prevAbbrevEnv: string | undefined;

  beforeEach(() => {
    hadAbbrevEnv = Object.hasOwn(process.env, JSON_FORMAT_ABBREV_ENV);
    prevAbbrevEnv = process.env[JSON_FORMAT_ABBREV_ENV];
    process.env[JSON_FORMAT_ABBREV_ENV] = "7";
  });

  afterEach(() => {
    if (hadAbbrevEnv) {
      process.env[JSON_FORMAT_ABBREV_ENV] = prevAbbrevEnv;
    } else {
      delete process.env[JSON_FORMAT_ABBREV_ENV];
    }
  });

  function makeUtcDayBucket(now: Date): string {
    const FDS_MS = Date.UTC(2500, 0, 1, 0, 0, 0, 0);
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const d = now.getUTCDate();
    const dayStart = Date.UTC(y, m, d, 0, 0, 0, 0);
    const daysToFds = Math.floor((FDS_MS - dayStart) / 86400000);
    const mm = String(m + 1).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    const yy = String(y % 100).padStart(2, "0");
    return `${daysToFds}_${mm}-${dd}-${yy}`;
  }

  const emptyShippedInner =
    `\n| Feature | Shipped at (UTC) | Delivery report | Outbox artifact | Archived source |\n` +
    "|---|---|---|---|---|\n" +
    "| `—` | `—` | `—` | `—` | `—` |\n";
  const opsInnerSynced =
    `\n<!-- ddl:active-memory:operator-notes:auto -->\n\n` +
    `- Active-memory refreshed (UTC): \`${refreshIso}\`\n\n` +
    "<!-- /ddl:active-memory:operator-notes:auto -->\n\n" +
    "- Note body.\n";

  function buildSyncedCurrentMd(activeLine: string): string {
    return [
      "# Current focus",
      "",
      "## Active Feature",
      activeLine,
      "",
      "## Most recent shipped Features",
      emptyShippedInner,
      "",
      "## Risks and blockers",
      "- Risks anchor",
      "",
      "## Operator notes",
      opsInnerSynced.trimEnd(),
      "",
    ].join("\n");
  }

  async function seedMinimalWorkspace(root: string): Promise<void> {
    await writeFile(path.join(root, "daedaline.yaml"), "bootstrap: phase-4\n", "utf8");
    await mkdir(path.join(root, "src", "inbox", "in"), { recursive: true });
    await mkdir(path.join(root, "src", "memory", "active"), { recursive: true });
    await mkdir(path.join(root, "src", "memory", "features"), { recursive: true });
  }

  it("ddl init dry-run reports planned scaffold without writes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-init-dry-"));
    const out: string[] = [];
    const code = await parseAndRun(["init", "--dry-run"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
    });
    expect(code).toBe(0);
    const msg = JSON.parse(out.join("")) as { command: string; dryRun: boolean; diffs: unknown[] };
    expect(msg.command).toBe("init");
    expect(msg.dryRun).toBe(true);
    expect(existsSync(path.join(root, "daedaline.yaml"))).toBe(false);
  });

  it("ddl init --apply refuses conflicts without --force", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-init-conflict-"));
    await writeFile(path.join(root, "daedaline.yaml"), "existing\n", "utf8");
    const code = await parseAndRun(["init", "--apply"], {
      repoRoot: root,
      writeOut: () => {},
      writeErr: () => {},
    });
    expect(code).toBe(1);
  });

  it("create-daedaline scaffolds an empty project directory", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "ddl-create-parent-"));
    const out: string[] = [];
    const code = await parseAndRun(["create-daedaline", "demo"], {
      repoRoot: parent,
      writeOut: (c) => out.push(c),
    });
    expect(code).toBe(0);
    const msg = JSON.parse(out.join("")) as { command: string; targetDir: string };
    expect(msg.command).toBe("create-daedaline");
    expect(existsSync(path.join(msg.targetDir, "daedaline.yaml"))).toBe(true);
  });

  it("exits 125 with deferred envelopes for stubbed verbs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-deferred-"));
    const batchTracking =
      "src/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md";
    const matrix: Array<{ argv: string[]; tracking: string }> = [
      { argv: ["approve"], tracking: batchTracking },
      { argv: ["memory"], tracking: batchTracking },
      { argv: ["contracts"], tracking: batchTracking },
      { argv: ["lint"], tracking: batchTracking },
      { argv: ["run", "not-a-pipeline"], tracking: batchTracking },
      { argv: ["status"], tracking: batchTracking },
    ];
    for (const { argv, tracking } of matrix) {
      const out: string[] = [];
      const code = await parseAndRun(argv, { repoRoot: root, writeOut: (c) => out.push(c) });
      expect(code).toBe(DDL_DEFERRED_EXIT_CODE);
      const env = JSON.parse(out.join("")) as Record<string, unknown>;
      expect(env.status).toBe("deferred");
      expect(typeof env.manual_workaround).toBe("string");
      expect(env.milestone).toMatch(/^M[123]$/u);
      expect(env.tracking_intake).toBe(tracking);
    }
    const seqA: string[] = [];
    const seqB: string[] = [];
    await parseAndRun(["memory"], { repoRoot: root, writeOut: (c) => seqA.push(c) });
    await parseAndRun(["memory"], { repoRoot: root, writeOut: (c) => seqB.push(c) });
    expect(seqB.join("")).toEqual(seqA.join(""));
    expect(JSON.parse(seqA.join(""))).toMatchObject({
      verb: "ddl memory",
      milestone: "M2",
      status: "deferred",
    });
  });

  it("writes ddl intake new output with utc bucket prefixes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-intake-"));
    await seedMinimalWorkspace(root);
    const stamp = new Date(Date.UTC(2026, 0, 2, 0, 3, 4));
    const out: string[] = [];
    await parseAndRun(["intake", "new", "demo-slug"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => stamp,
    });
    const msg = JSON.parse(out.join("")) as { status: string; path: string };
    expect(msg.status).toBe("ok");
    expect(msg.path).toMatch(/^src\/inbox\/in\/\d{6}_\d{2}-\d{2}-\d{2}\/\d{1,6}_\d{4}_demo-slug\.md$/);
    expect(existsSync(path.join(root, msg.path))).toBe(true);
  });

  it("uses SID seconds-to-next-UTC-midnight across the UTC calendar-day boundary", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-intake-sid-"));
    await seedMinimalWorkspace(root);
    const outLate: string[] = [];
    await parseAndRun(["intake", "new", "late-day"], {
      repoRoot: root,
      writeOut: (c) => outLate.push(c),
      clock: () => new Date(Date.UTC(2026, 4, 10, 23, 59, 59)),
    });
    const latePath = (JSON.parse(outLate.join("")) as { path: string }).path;
    expect(latePath).toMatch(/\/1_2359_late-day\.md$/);

    const outFresh: string[] = [];
    await parseAndRun(["intake", "new", "new-day"], {
      repoRoot: root,
      writeOut: (c) => outFresh.push(c),
      clock: () => new Date(Date.UTC(2026, 4, 11, 0, 0, 0)),
    });
    const freshPath = (JSON.parse(outFresh.join("")) as { path: string }).path;
    expect(freshPath).toMatch(/\/86400_0000_new-day\.md$/);
  });

  it("refuses ddl intake new when archived and active buckets collide", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-intake-archive-"));
    await seedMinimalWorkspace(root);
    const bucket = makeUtcDayBucket(new Date(Date.UTC(2026, 1, 2, 9, 0, 0)));
    await mkdir(path.join(root, "src", "inbox", "in", bucket), { recursive: true });
    await mkdir(path.join(root, "src", "inbox", "archive", "in", bucket), { recursive: true });
    const code = await parseAndRun(
      ["intake", "new", "zzz"],
      { repoRoot: root, clock: () => new Date(Date.UTC(2026, 1, 2, 9, 0, 0)), writeOut: () => {}, writeErr: () => {} },
    );
    expect(code).toBe(1);
  });

  it("hydrates ddl intake new bodies from handbook contract templates when requested", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-intake-template-"));
    await seedMinimalWorkspace(root);
    const templates = path.join(root, "src", "memory", "handbook", "contract-templates");
    await mkdir(templates, { recursive: true });
    await writeFile(path.join(templates, "ux-spec.template.md"), "## Custom body\n", "utf8");
    const out: string[] = [];
    await parseAndRun(
      ["intake", "new", "from-ux", "--from-template", "ux-spec"],
      {
        repoRoot: root,
        writeOut: (c) => out.push(c),
        clock: () => new Date(Date.UTC(2026, 2, 3, 4, 5, 6)),
      },
    );
    const payload = JSON.parse(out.join("")) as { path: string };
    expect(await readFile(path.join(root, payload.path), "utf8")).toContain("## Custom body");
  });

  it("refresh-active-memory derives Archived source from indexed feature lineage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-refresh-archived-src-"));
    await seedMinimalWorkspace(root);
    const taskId = "24959_1704_ci-best-practices-batch";
    const archived =
      "src/inbox/archive/in/172980_05-26-26/24959_1704_ci-best-practices-batch/71701_0613_ci-best-practices-batch.md";
    const stale = "src/inbox/in/172981_05-25-26/71701_0613_ci-best-practices-batch.md";
    await mkdir(path.join(root, ...archived.split("/").slice(0, -1)), { recursive: true });
    await writeFile(path.join(root, archived), "# batch\n", "utf8");
    const featureDir = path.join(root, "src", "memory", "features", "ci-best-practices-batch");
    await mkdir(featureDir, { recursive: true });
    await writeFile(
      path.join(featureDir, "index.json"),
      `${JSON.stringify(
        {
          feature_id: "ci-best-practices-batch",
          task_id: taskId,
          status: "indexed",
          indexed_at: "2026-05-26T18:23:19.000Z",
          intake: { source_inbox_item: stale },
          delivery_report: { path: "src/memory/features/ci-best-practices-batch/delivery-report.md" },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(path.join(featureDir, "delivery-report.md"), "# Delivery\n", "utf8");

    const currentAbs = path.join(root, "src", "memory", "active", "current.md");
    await writeFile(
      currentAbs,
      [
        "# Current focus",
        "",
        "## Active Feature",
        "\n- `(none)`\n",
        "",
        "## Most recent shipped Features",
        emptyShippedInner,
        "",
        "## Operator notes",
        opsInnerSynced.trimEnd(),
        "",
      ].join("\n"),
      "utf8",
    );

    const out: string[] = [];
    const code = await parseAndRun(["refresh-active-memory", "--dry-run"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      writeErr: () => {},
      clock: () => new Date(refreshIso),
    });
    expect(code).toBe(DDL_ACTIVE_MEMORY_CONFLICT_EXIT_CODE);
    const diff = out.join("");
    expect(diff).toContain("+++ computed");
    expect(diff).toContain(archived);
    expect(diff).toMatch(
      /\| `ci-best-practices-batch` \| \[indexed\].*71701_0613_ci-best-practices-batch\.md` \|/u,
    );
  });

  it("refresh-active-memory --dry-run stays quiet once sections mirror derivation outputs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-refresh-green-"));
    await seedMinimalWorkspace(root);
    const currentAbs = path.join(root, "src", "memory", "active", "current.md");
    await writeFile(
      currentAbs,
      `${buildSyncedCurrentMd("\n- `(none)`\n").trimEnd()}\n`,
      "utf8",
    );
    const out: string[] = [];
    const code = await parseAndRun(["refresh-active-memory", "--dry-run"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date(refreshIso),
    });
    expect(code).toBe(0);
    expect(out.join("")).not.toContain("+++ computed");
    expect(out.join("")).toContain('"dryRun": true');
  });

  it("refresh-active-memory --dry-run exits conflict code when shipped-feature rows mismatch", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-refresh-dry-conflict-"));
    await seedMinimalWorkspace(root);
    const currentAbs = path.join(root, "src", "memory", "active", "current.md");
    await writeFile(
      currentAbs,
      `${buildSyncedCurrentMd("\n- `(none)`\n").trimEnd()}\n`.replace(
        "| `—` | `—` | `—` | `—` | `—` |",
        "| `stale-feature` | `—` | `—` | `—` | `—` |",
      ),
      "utf8",
    );
    const code = await parseAndRun(["refresh-active-memory", "--dry-run"], {
      repoRoot: root,
      writeOut: () => {},
      writeErr: () => {},
      clock: () => new Date(refreshIso),
    });
    expect(code).toBe(DDL_ACTIVE_MEMORY_CONFLICT_EXIT_CODE);
  });

  it("refresh-active-memory emits a conflict exit when Active Feature inbox pointer is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-refresh-conflict-"));
    await seedMinimalWorkspace(root);
    const currentAbs = path.join(root, "src", "memory", "active", "current.md");
    await writeFile(
      currentAbs,
      `${buildSyncedCurrentMd("\n- `src/inbox/in/missing/archived-item.md`\n").trimEnd()}\n`,
      "utf8",
    );
    const err: string[] = [];
    const code = await parseAndRun(["refresh-active-memory"], {
      repoRoot: root,
      writeOut: () => {},
      writeErr: (c) => err.push(c),
      clock: () => new Date(refreshIso),
    });
    expect(code).toBe(DDL_ACTIVE_MEMORY_CONFLICT_EXIT_CODE);
    expect(err.join("")).toContain("missing under src/inbox/in/");
  });

  it("refresh-active-memory preserves human-curated Active Feature when inbox queue differs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-refresh-active-human-"));
    await seedMinimalWorkspace(root);
    const bucket = makeUtcDayBucket(new Date(Date.UTC(2026, 4, 25, 6, 0, 0)));
    const chosen = `src/inbox/in/${bucket}/64489_0605_chosen-active.md`;
    await mkdir(path.join(root, ...chosen.split("/").slice(0, -1)), { recursive: true });
    await writeFile(path.join(root, chosen), "# chosen\n", "utf8");
    const newer = `src/inbox/in/${bucket}/64500_0605_newer-backlog-stub.md`;
    await writeFile(path.join(root, newer), "# newer\n", "utf8");
    const currentAbs = path.join(root, "src", "memory", "active", "current.md");
    const activeLine = `\n- \`${chosen}\`\n`;
    await writeFile(currentAbs, `${buildSyncedCurrentMd(activeLine).trimEnd()}\n`, "utf8");
    const code = await parseAndRun(["refresh-active-memory"], {
      repoRoot: root,
      writeOut: () => {},
      writeErr: () => {},
      clock: () => new Date(refreshIso),
    });
    expect(code).toBe(0);
    const written = await readFile(currentAbs, "utf8");
    expect(written).toContain(chosen);
    expect(written).not.toContain("64500_0605_newer-backlog-stub");
  });

  it("refresh-active-memory apply succeeds when only managed operator-notes timestamp is stale", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ddl-refresh-apply-ts-"));
    await seedMinimalWorkspace(root);
    const currentAbs = path.join(root, "src", "memory", "active", "current.md");
    const staleIso = "2020-01-01T00:00:00.000Z";
    const clockNow = new Date("2026-06-01T12:34:56.789Z");
    const humanLine = "- Human-only note stays verbatim.\n";
    const opsStaleInner =
      `\n<!-- ddl:active-memory:operator-notes:auto -->\n\n` +
      `- Active-memory refreshed (UTC): \`${staleIso}\`\n\n` +
      "<!-- /ddl:active-memory:operator-notes:auto -->\n\n" +
      humanLine;

    await writeFile(
      currentAbs,
      [
        "# Current focus",
        "",
        "## Active Feature",
        "\n- `(none)`\n",
        "",
        "## Most recent shipped Features",
        emptyShippedInner,
        "",
        "## Risks and blockers",
        "- Risks anchor",
        "",
        "## Operator notes",
        opsStaleInner.trimEnd(),
        "",
      ].join("\n"),
      "utf8",
    );
    const out: string[] = [];
    const err: string[] = [];
    const code = await parseAndRun(["refresh-active-memory"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      writeErr: (c) => err.push(c),
      clock: () => clockNow,
    });
    expect(code).toBe(0);
    expect(err.join("")).toBe("");
    const written = await readFile(currentAbs, "utf8");
    expect(written).toContain("- Human-only note stays verbatim.");
    expect(written).toContain(clockNow.toISOString());
    expect(written).not.toContain(staleIso);
    expect(out.join("")).toContain('"status": "ok"');
  });

  describe("cursor runner harness", () => {
    it("invokes CursorRunner once on sdk run and advance", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ddl-sdk-run-advance-"));
      await seedFeatureDeliveryRepo(root);
      await seedCanonicalPersonas(root);
      await writeRunnerInvocationConfig(root, "sdk");
      await writeFile(
        path.join(root, "src", "inbox", "in", "demo-feature.md"),
        "# Demo Feature\n\nBuild the thing.",
        "utf8",
      );
      let invokeCount = 0;
      const transport = mockSdkTransport(() => {
        invokeCount += 1;
      });
      const out: string[] = [];
      const code = await parseAndRun(["run", "feature-delivery", "demo-feature.md"], {
        repoRoot: root,
        writeOut: (c) => out.push(c),
        clock: () => new Date("2026-05-10T13:15:30.000Z"),
        testHooks: { sdkTransport: transport },
      });
      if (code !== 0) {
        throw new Error(`sdk run failed: ${out.join("")}`);
      }
      expect(invokeCount).toBe(1);
      const start = JSON.parse(out.join("")) as { taskId: string; runLogFile: string };
      const runLogAfterStart = await readFile(path.join(root, start.runLogFile), "utf8");
      expect(runnerInvokeLogLines(runLogAfterStart)).toHaveLength(1);

      invokeCount = 0;
      const spec = path.join(root, "src", "memory", "features", "demo-feature", "spec.md");
      await mkdir(path.dirname(spec), { recursive: true });
      await writeFile(spec, "# Spec\n\nfeature: demo\n", "utf8");
      const advanceCode = await parseAndRun(
        ["advance", start.taskId, "--artifact", "src/memory/features/demo-feature/spec.md"],
        {
          repoRoot: root,
          writeOut: () => undefined,
          testHooks: { sdkTransport: transport },
        },
      );
      expect(advanceCode).toBe(0);
      expect(invokeCount).toBe(1);
      const runLogAfterAdvance = await readFile(path.join(root, start.runLogFile), "utf8");
      expect(runnerInvokeLogLines(runLogAfterAdvance)).toHaveLength(2);
    });

    it("does not call SDK transport for manual mode across run and advance", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ddl-manual-no-sdk-"));
      await seedFeatureDeliveryRepo(root);
      await seedCanonicalPersonas(root);
      await writeRunnerInvocationConfig(root, "manual");
      await writeFile(
        path.join(root, "src", "inbox", "in", "demo-feature.md"),
        "# Demo Feature\n\nBuild the thing.",
        "utf8",
      );
      let invokeCount = 0;
      const out: string[] = [];
      const code = await parseAndRun(["run", "feature-delivery", "demo-feature.md"], {
        repoRoot: root,
        writeOut: (c) => out.push(c),
        clock: () => new Date("2026-05-10T13:15:30.000Z"),
        testHooks: { sdkTransport: mockSdkTransport(() => { invokeCount += 1; }) },
      });
      expect(code).toBe(0);
      expect(invokeCount).toBe(0);
      const start = JSON.parse(out.join("")) as { taskId: string; runLogFile: string };
      const specRel = "src/memory/features/demo-feature/spec.md";
      await mkdir(path.dirname(path.join(root, specRel)), { recursive: true });
      await writeFile(path.join(root, specRel), "# Spec", "utf8");
      await parseAndRun(["advance", start.taskId, "--artifact", specRel], {
        repoRoot: root,
        writeOut: () => undefined,
        testHooks: { sdkTransport: mockSdkTransport(() => { invokeCount += 1; }) },
      });
      expect(invokeCount).toBe(0);
      const logText = await readFile(path.join(root, start.runLogFile), "utf8");
      expect(runnerInvokeLogLines(logText)).toHaveLength(0);
    });

    it("exits non-zero without state.json when persona resolution fails on sdk run", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ddl-persona-fail-"));
      await seedFeatureDeliveryRepo(root);
      await writeRunnerInvocationConfig(root, "sdk");
      await writeFile(
        path.join(root, "src", "pipelines", "feature-delivery.yaml"),
        `id: feature-delivery
version: "1"
stages:
  - id: intake
    persona: missing-persona
`,
        "utf8",
      );
      await writeFile(path.join(root, "src", "inbox", "in", "demo.md"), "# Demo", "utf8");
      const out: string[] = [];
      const code = await parseAndRun(["run", "feature-delivery", "demo.md"], {
        repoRoot: root,
        writeOut: (c) => out.push(c),
        writeErr: () => undefined,
        testHooks: { sdkTransport: mockSdkTransport() },
      });
      expect(code).toBe(1);
      expect(out.join("")).toContain("Unknown persona");
      const workRoot = path.join(root, "src", "work");
      if (existsSync(workRoot)) {
        const dayDirs = await readdir(workRoot);
        for (const day of dayDirs) {
          const tasks = await readdir(path.join(workRoot, day));
          for (const task of tasks) {
            expect(existsSync(path.join(workRoot, day, task, "state.json"))).toBe(false);
          }
        }
      }
    });

    it("loads repo-root .env without echoing secrets to run logs", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ddl-env-load-"));
      await seedFeatureDeliveryRepo(root);
      await seedCanonicalPersonas(root);
      await writeRunnerInvocationConfig(root, "sdk");
      await writeFile(
        path.join(root, ".env"),
        'CURSOR_API_KEY="super-secret-test-key"\n# comment\nPLAIN=value\n',
        "utf8",
      );
      delete process.env.CURSOR_API_KEY;
      loadRepoEnv(root);
      expect(process.env.CURSOR_API_KEY).toBe("super-secret-test-key");
      await writeFile(path.join(root, "src", "inbox", "in", "demo-feature.md"), "# Demo", "utf8");
      const out: string[] = [];
      await parseAndRun(["run", "feature-delivery", "demo-feature.md"], {
        repoRoot: root,
        writeOut: (c) => out.push(c),
        clock: () => new Date("2026-05-10T13:15:30.000Z"),
        testHooks: { sdkTransport: mockSdkTransport() },
      });
      const start = JSON.parse(out.join("")) as { runLogFile: string };
      const logText = await readFile(path.join(root, start.runLogFile), "utf8");
      expect(logText).not.toContain("super-secret-test-key");
      delete process.env.CURSOR_API_KEY;
    });

    it("resolves real persona markdown for runner input", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ddl-persona-resolve-"));
      await seedCanonicalPersonas(root);
      const persona = await resolvePersona(root, "coder");
      expect(persona.name).toBe("coder");
      expect(persona.tools.length).toBeGreaterThan(0);
      await expect(resolvePersona(root, "not-a-persona")).rejects.toBeInstanceOf(PersonaResolveError);
    });

    async function advanceSdkRunToImplement(
      root: string,
      taskId: string,
      featureId: string,
      runDirRel: string,
      transport: CursorSdkTransport,
    ): Promise<void> {
      const specRel = `src/memory/features/${featureId}/spec.md`;
      await mkdir(path.dirname(path.join(root, specRel)), { recursive: true });
      await writeFile(path.join(root, specRel), "# Spec\n", "utf8");
      const specCode = await parseAndRun(["advance", taskId, "--artifact", specRel], {
        repoRoot: root,
        writeOut: () => undefined,
        testHooks: { sdkTransport: transport },
      });
      expect(specCode).toBe(0);
      await writeFile(path.join(root, runDirRel, "plan.md"), "# Plan\n", "utf8");
      await writeFile(path.join(root, runDirRel, "touch-set.json"), "{}\n", "utf8");
      const planCode = await parseAndRun(
        ["advance", taskId, "--artifact", `${runDirRel}/touch-set.json`],
        { repoRoot: root, writeOut: () => undefined, testHooks: { sdkTransport: transport } },
      );
      expect(planCode).toBe(0);
    }

    it("sdk auto-chains review_passes to test and qa_passes to report without extra advance", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ddl-sdk-auto-chain-"));
      await seedFeatureDeliveryRepo(root);
      await seedCanonicalPersonas(root);
      await writeRunnerInvocationConfig(root, "sdk");
      await writeFile(path.join(root, "src", "inbox", "in", "demo-feature.md"), "# Demo", "utf8");
      const transport = mockSdkTransport();
      const out: string[] = [];
      const runCode = await parseAndRun(["run", "feature-delivery", "demo-feature.md"], {
        repoRoot: root,
        writeOut: (c) => out.push(c),
        clock: () => new Date("2026-05-10T13:15:30.000Z"),
        testHooks: { sdkTransport: transport },
      });
      expect(runCode).toBe(0);
      const start = JSON.parse(out.join("")) as { taskId: string; stateFile: string; featureId: string };
      const runDirRel = path.posix.dirname(start.stateFile);
      await advanceSdkRunToImplement(root, start.taskId, start.featureId, runDirRel, transport);
      await writeFile(
        path.join(root, runDirRel, "review.md"),
        "review_passes: true\n",
        "utf8",
      );
      await writeFile(
        path.join(root, runDirRel, "test-report.md"),
        "qa_passes: true\n",
        "utf8",
      );
      await writeFile(path.join(root, runDirRel, "implementation-report.md"), "# Impl\n", "utf8");
      const advanceOut: string[] = [];
      const advanceCode = await parseAndRun(
        ["advance", start.taskId, "--artifact", `${runDirRel}/implementation-report.md`],
        {
          repoRoot: root,
          writeOut: (c) => advanceOut.push(c),
          testHooks: { sdkTransport: transport },
        },
      );
      expect(advanceCode).toBe(0);
      const result = JSON.parse(advanceOut.join("")) as { currentStage: string };
      expect(result.currentStage).toBe("report");
      const state = JSON.parse(await readFile(path.join(root, start.stateFile), "utf8")) as {
        currentStage: string;
      };
      expect(state.currentStage).toBe("report");
    });

    it("sdk auto-chains review must_fix back to implement", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ddl-sdk-auto-must-fix-"));
      await seedFeatureDeliveryRepo(root);
      await seedCanonicalPersonas(root);
      await writeRunnerInvocationConfig(root, "sdk");
      await writeFile(path.join(root, "src", "inbox", "in", "demo-feature.md"), "# Demo", "utf8");
      const transport = mockSdkTransport();
      const out: string[] = [];
      await parseAndRun(["run", "feature-delivery", "demo-feature.md"], {
        repoRoot: root,
        writeOut: (c) => out.push(c),
        clock: () => new Date("2026-05-10T13:15:30.000Z"),
        testHooks: { sdkTransport: transport },
      });
      const start = JSON.parse(out.join("")) as { taskId: string; stateFile: string; featureId: string };
      const runDirRel = path.posix.dirname(start.stateFile);
      await advanceSdkRunToImplement(root, start.taskId, start.featureId, runDirRel, transport);
      await writeFile(
        path.join(root, runDirRel, "review.md"),
        "review_passes: false\n",
        "utf8",
      );
      await writeFile(path.join(root, runDirRel, "implementation-report.md"), "# Impl\n", "utf8");
      const advanceOut: string[] = [];
      const advanceCode = await parseAndRun(
        ["advance", start.taskId, "--artifact", `${runDirRel}/implementation-report.md`],
        {
          repoRoot: root,
          writeOut: (c) => advanceOut.push(c),
          testHooks: { sdkTransport: transport },
        },
      );
      expect(advanceCode).toBe(0);
      const result = JSON.parse(advanceOut.join("")) as { currentStage: string };
      expect(result.currentStage).toBe("implement");
      const state = JSON.parse(await readFile(path.join(root, start.stateFile), "utf8")) as {
        currentStage: string;
      };
      expect(state.currentStage).toBe("implement");
    });

    it("halts sdk automation when retry budget is exceeded via advance", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ddl-retry-halt-"));
      await seedFeatureDeliveryRepo(root);
      await seedCanonicalPersonas(root);
      await writeRunnerInvocationConfig(root, "sdk");
      await writeFile(path.join(root, "src", "inbox", "in", "demo-feature.md"), "# Demo", "utf8");
      const transport = mockSdkTransport();
      const out: string[] = [];
      await parseAndRun(["run", "feature-delivery", "demo-feature.md"], {
        repoRoot: root,
        writeOut: (c) => out.push(c),
        clock: () => new Date("2026-05-10T13:15:30.000Z"),
        testHooks: { sdkTransport: transport },
      });
      const start = JSON.parse(out.join("")) as { taskId: string; stateFile: string };
      const stateAbs = path.join(root, start.stateFile);
      const patched = JSON.parse(await readFile(stateAbs, "utf8")) as {
        currentStage: string;
        automation?: { runnerInvocation: string; cumulativeRetryCount: number };
      };
      patched.currentStage = "review";
      patched.automation = { runnerInvocation: "sdk", cumulativeRetryCount: 3 };
      await writeFile(stateAbs, `${JSON.stringify(patched, null, 2)}\n`, "utf8");
      const runDir = path.dirname(start.stateFile);
      await writeFile(path.join(root, runDir, "review.md"), "review_passes: false\n", "utf8");
      const haltCode = await parseAndRun(
        ["advance", start.taskId, "--event", "must_fix", "--artifact", `${runDir}/review.md`],
        { repoRoot: root, writeOut: (c) => out.push(c), testHooks: { sdkTransport: transport } },
      );
      expect(haltCode).toBe(1);
      expect(out.join("")).toContain("retry limit halt");
      const halted = JSON.parse(await readFile(stateAbs, "utf8")) as {
        status: string;
        automation?: { cumulativeRetryCount: number };
      };
      expect(halted.status).toBe("halted");
      expect(halted.automation?.cumulativeRetryCount).toBe(4);
    });
  });
});