import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildSdkPrompt,
  type CursorSdkInvokeParams,
  type CursorSdkTransport,
} from "@pancreator/runner-cursor";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  advanceFeatureDelivery,
  startFeatureDelivery,
  panCheckRegistry,
  resolveNextStep,
  type FeatureDeliveryState,
  type PanCheckResult,
} from "./feature-delivery-run.js";
import {
  formatPanText,
  makeUtcDayBucket,
  parseAndRun,
  PAN_ACTIVE_MEMORY_CONFLICT_EXIT_CODE,
  PAN_DEFERRED_EXIT_CODE,
} from "./run.js";
import { stringifyCliJson } from "./canonical-json-io.js";
import { loadRepoEnv } from "./repo-env.js";
import { PersonaResolveError, resolvePersona } from "./persona-resolve.js";

const JSON_FORMAT_ABBREV_ENV = "PAN_JSON_FORMAT_ABBREV_LEN";
const CANONICAL_REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../..");

function findLast<T>(items: readonly T[], pred: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item !== undefined && pred(item)) {
      return item;
    }
  }
  return undefined;
}

const FEATURE_DELIVERY_PERSONAS = [
  "intake-analyst",
  "tech-lead",
  "coder",
  "reviewer",
  "qa-tester",
  "tech-writer",
  "compliance-auditor",
  "supervisor",
  "librarian",
  "pancreator-engineer",
] as const;

async function seedCanonicalPersonas(root: string): Promise<void> {
  const personasDir = path.join(root, "lib", "personas");
  await mkdir(personasDir, { recursive: true });
  for (const persona of FEATURE_DELIVERY_PERSONAS) {
    await copyFile(
      path.join(CANONICAL_REPO_ROOT, "lib", "personas", `${persona}.md`),
      path.join(personasDir, `${persona}.md`),
    );
  }
}

async function writeRunnerInvocationConfig(root: string, invocation: "manual" | "sdk"): Promise<void> {
  await writeFile(
    path.join(root, "pancreator.yaml"),
    `project_root: "."
runner:
  cursor:
    invocation: ${invocation}
`,
    "utf8",
  );
}

function mockSdkTransport(onInvoke?: () => void): CursorSdkTransport {
  const mockArtifactBody = (repoRoot: string, rel: string): string => {
    const base = path.posix.basename(rel);
    if (base === "plan.md") return "# Plan\n\n## Scope\n\nBody.\n";
    if (base === "implementation-report.md") return "# Implementation report\n\n## Summary\n\nBody.\n";
    if (base === "review.md") return "review_passes: true\n";
    if (base === "test-report.md") return "qa_passes: true\n";
    if (base === "compliance-result.json") {
      return stringifyCliJson(repoRoot, {
        compliance_passes: true,
        final_gate: {
          "pnpm lint": 0,
          "pnpm typecheck": 0,
          "pnpm test": 0,
          "node --test tests/*.test.mjs": 0,
        },
      });
    }
    if (base === "ship-ratification.json") {
      return stringifyCliJson(repoRoot, {
        task_id: "mock-task",
        human_ratified_diff: true,
      });
    }
    return "mock-artifact\n";
  };
  return async (params) => {
    onInvoke?.();
    const cwd = params.cwd ?? process.cwd();
    const required =
      params.requiredArtifactPaths ??
      (params.artifactPath !== undefined ? [params.artifactPath] : []);
    for (const rel of required) {
      const abs = path.join(cwd, rel);
      if (existsSync(abs)) {
        continue;
      }
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, mockArtifactBody(cwd, rel), "utf8");
    }
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
  await copyFile(
    path.join(CANONICAL_REPO_ROOT, "pancreator-model-escalation.yaml"),
    path.join(root, "pancreator-model-escalation.yaml"),
  );
  await mkdir(path.join(root, "lib", "inbox", "in"), { recursive: true });
  await mkdir(path.join(root, "lib", "pipelines"), { recursive: true });
  const toolsDir = path.join(root, "lib", "internal", "tools");
  await mkdir(toolsDir, { recursive: true });
  for (const toolFile of ["markdown-citation-lint.mjs", "canonical-json-format.mjs"]) {
    await copyFile(
      path.join(CANONICAL_REPO_ROOT, "lib", "internal", "tools", toolFile),
      path.join(toolsDir, toolFile),
    );
  }
  await writeFile(
    path.join(root, "lib", "pipelines", "feature-delivery.yaml"),
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
  - id: compliance
    persona: compliance-auditor
  - id: ship
    persona: supervisor
  - id: index
    persona: librarian
`,
    "utf8",
  );
}

async function seedPlanStageAdvanceArtifacts(root: string, runDirRel: string): Promise<void> {
  const runDir = path.join(root, runDirRel);
  await writeFile(path.join(runDir, "plan.md"), "# Plan\n\n## Scope\n\nBody.\n", "utf8");
  await writeFile(path.join(runDir, "adr-draft.md"), "# ADR\n\n## Decision\n\nBody.\n", "utf8");
  await writeFile(path.join(runDir, "touch-set.json"), "{}\n", "utf8");
}

async function completeFeatureDeliveryRunForClose(
  root: string,
  taskId: string,
  featureId: string,
  dayDir: string,
): Promise<{ activeRunDirRel: string; inboxSourceRel: string }> {
  const activeRunDirRel = `work/${dayDir}/${taskId}`;
  const activeRunDir = path.join(root, activeRunDirRel);

  const spec = path.join(root, "lib", "memory", "features", featureId, "spec.md");
  await mkdir(path.dirname(spec), { recursive: true });
  await writeFile(spec, "# Spec", "utf8");
  await parseAndRun(["advance", taskId, "--artifact", `lib/memory/features/${featureId}/spec.md`], {
    repoRoot: root,
    writeOut: () => undefined,
  });
  await seedPlanStageAdvanceArtifacts(root, activeRunDirRel);
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
  const report = path.join(root, "lib", "memory", "features", featureId, "delivery-report.md");
  await writeFile(report, "# Delivery", "utf8");
  await parseAndRun(["advance", taskId, "--artifact", `lib/memory/features/${featureId}/delivery-report.md`], {
    repoRoot: root,
    writeOut: () => undefined,
  });
  await writeFile(
    path.join(activeRunDir, "compliance-result.json"),
    stringifyCliJson(root, {
      compliance_passes: true,
      final_gate: {
        "pnpm lint": 0,
        "pnpm typecheck": 0,
        "pnpm test": 0,
        "node --test tests/*.test.mjs": 0,
      },
    }),
    "utf8",
  );
  await parseAndRun(["advance", taskId, "--artifact", `${activeRunDirRel}/compliance-result.json`], {
    repoRoot: root,
    writeOut: () => undefined,
  });
    await writeFile(
      path.join(activeRunDir, "ship-ratification.json"),
      stringifyCliJson(root, {
        task_id: taskId,
        human_ratified_diff: true,
      }),
      "utf8",
    );
  await parseAndRun(["advance", taskId, "--artifact", `${activeRunDirRel}/ship-ratification.json`], {
    repoRoot: root,
    writeOut: () => undefined,
  });
  const inboxSourceRel = "lib/inbox/in/demo-feature.md";
  const index = path.join(root, "lib", "memory", "features", featureId, "index.json");
  await writeFile(
    index,
    stringifyCliJson(root, {
      feature_id: featureId,
      task_id: taskId,
      status: "indexed",
      indexed_at: "2026-05-10T13:30:00.000Z",
      source_inbox_item: { path: inboxSourceRel },
      delivery_report: { path: `lib/memory/features/${featureId}/delivery-report.md` },
    }),
    "utf8",
  );
  await parseAndRun(["advance", taskId, "--artifact", `lib/memory/features/${featureId}/index.json`], {
    repoRoot: root,
    writeOut: () => undefined,
  });
  expect(existsSync(activeRunDir)).toBe(true);
  expect(existsSync(path.join(root, "archive", "work", dayDir, taskId))).toBe(false);
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

  it("lists lib/inbox/in entries via FileInbox", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-cli-"));
    const inboxIn = path.join(root, "lib", "inbox", "in");
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
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-run-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(
      path.join(root, "lib", "inbox", "in", "demo-feature.md"),
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
    const runMsg = JSON.parse(raw) as { nextCommand?: string };
    expect(runMsg.nextCommand).toMatch(/^pnpm -w exec pan advance /u);
    expect(await readFile(path.join(root, msg.runLogFile), "utf8")).toContain(
      '"stage_id":"invoke"',
    );
  });

  it("run --format text includes decoded timestamp and nextCommand", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-run-text-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(
      path.join(root, "lib", "inbox", "in", "demo-feature.md"),
      "# Demo Feature\n\nBuild the thing.",
      "utf8",
    );
    const runOut: string[] = [];
    const code = await parseAndRun(["run", "feature-delivery", "demo-feature.md", "--format", "text"], {
      repoRoot: root,
      writeOut: (c) => runOut.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    expect(code).toBe(0);
    const text = runOut.join("");
    expect(text).toContain("38670_1315_demo-feature");
    expect(text).toContain("2026-05-10 13:15 UTC");
    expect(text).toContain("nextCommand: pnpm -w exec pan advance");
  });

  it("pan next returns the same nextCommand as run without mutating state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-next-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(
      path.join(root, "lib", "inbox", "in", "demo-feature.md"),
      "# Demo Feature\n\nBuild the thing.",
      "utf8",
    );
    const runOut: string[] = [];
    await parseAndRun(["run", "feature-delivery", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => runOut.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const runMsg = JSON.parse(runOut.join("")) as { taskId: string; nextCommand: string };
    const stateBefore = await readFile(
      path.join(root, "work", "172996_05-10-26", runMsg.taskId, "state.json"),
      "utf8",
    );
    const nextOut: string[] = [];
    const code = await parseAndRun(["next", runMsg.taskId], {
      repoRoot: root,
      writeOut: (c) => nextOut.push(c),
    });
    expect(code).toBe(0);
    const nextMsg = JSON.parse(nextOut.join("")) as { nextCommand: string; source: string };
    expect(nextMsg.nextCommand).toBe(runMsg.nextCommand);
    expect(nextMsg.source).toBe("derived");
    const stateAfter = await readFile(
      path.join(root, "work", "172996_05-10-26", runMsg.taskId, "state.json"),
      "utf8",
    );
    expect(stateAfter).toBe(stateBefore);
  });

  it("AC-P5b: persisted report-approval nextCommand survives pan status and pan next", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-report-next-cmd-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const runOut: string[] = [];
    await parseAndRun(["run", "feature-delivery", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => runOut.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const { taskId, stateFile } = JSON.parse(runOut.join("")) as { taskId: string; stateFile: string };
    const outboxRel = "lib/inbox/out/172996_05-10-26/38670_1315_demo-feature-report-approval.md";
    const persistedCmd = `pnpm -w exec pan advance ${taskId} --artifact ${outboxRel}`;
    const statePath = path.join(root, stateFile);
    const state = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
    state.status = "waiting_for_human_gate";
    state.currentStage = "report";
    state.nextCommand = persistedCmd;
    state.automation = { reportApprovalPending: true };
    await writeFile(statePath, stringifyCliJson(root, state), "utf8");

    const statusOut: string[] = [];
    await parseAndRun(["status", taskId], { repoRoot: root, writeOut: (c) => statusOut.push(c) });
    const statusMsg = JSON.parse(statusOut.join("")) as { nextCommand: string; source?: string };
    expect(statusMsg.nextCommand).toBe(persistedCmd);

    const nextOut: string[] = [];
    await parseAndRun(["next", taskId], { repoRoot: root, writeOut: (c) => nextOut.push(c) });
    const nextMsg = JSON.parse(nextOut.join("")) as {
      nextCommand: string;
      source: string;
      artifact: string | null;
      event: string | null;
    };
    expect(nextMsg.nextCommand).toBe(persistedCmd);
    expect(nextMsg.source).toBe("persisted");
    expect(nextMsg.artifact).toBe(outboxRel);
    expect(nextMsg.event).toBeNull();

    const nextTextOut: string[] = [];
    await parseAndRun(["next", taskId, "--format", "text"], {
      repoRoot: root,
      writeOut: (c) => nextTextOut.push(c),
    });
    const nextText = nextTextOut.join("");
    expect(nextText).toContain(`artifact: ${outboxRel}`);
    expect(nextText).toContain(persistedCmd);
  });

  it("clears stale persisted nextCommand from state.json after advance", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-clear-next-cmd-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const runOut: string[] = [];
    await parseAndRun(["run", "feature-delivery", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => runOut.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const { taskId, stateFile } = JSON.parse(runOut.join("")) as { taskId: string; stateFile: string };
    const outboxRel = "lib/inbox/out/172996_05-10-26/38670_1315_demo-feature-report-approval.md";
    const staleCmd = `pnpm -w exec pan advance ${taskId} --artifact ${outboxRel}`;
    const statePath = path.join(root, stateFile);
    const state = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
    state.nextCommand = staleCmd;
    await writeFile(statePath, stringifyCliJson(root, state), "utf8");

    const spec = path.join(root, "lib", "memory", "features", "demo-feature", "spec.md");
    await mkdir(path.dirname(spec), { recursive: true });
    await writeFile(spec, "# Spec", "utf8");

    const advanceOut: string[] = [];
    const code = await parseAndRun(
      ["advance", taskId, "--artifact", "lib/memory/features/demo-feature/spec.md"],
      { repoRoot: root, writeOut: (c) => advanceOut.push(c) },
    );
    expect(code).toBe(0);

    const persisted = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
    expect(persisted.nextCommand).toBeUndefined();

    const statusOut: string[] = [];
    await parseAndRun(["status", taskId], { repoRoot: root, writeOut: (c) => statusOut.push(c) });
    const statusMsg = JSON.parse(statusOut.join("")) as { nextCommand: string };
    expect(statusMsg.nextCommand).not.toContain(outboxRel);
    expect(statusMsg.nextCommand).toMatch(/touch-set\.json/u);

    const nextOut: string[] = [];
    await parseAndRun(["next", taskId], { repoRoot: root, writeOut: (c) => nextOut.push(c) });
    const nextMsg = JSON.parse(nextOut.join("")) as { nextCommand: string; source: string };
    expect(nextMsg.source).toBe("derived");
    expect(nextMsg.nextCommand).not.toContain(outboxRel);
    expect(nextMsg.nextCommand).toMatch(/touch-set\.json/u);
  });

  it("records content warnings on advance in run log and CLI envelope", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-advance-warnings-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const runOut: string[] = [];
    await parseAndRun(["run", "feature-delivery", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => runOut.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const { taskId, runLogFile } = JSON.parse(runOut.join("")) as { taskId: string; runLogFile: string };
    const runDirRel = `work/172996_05-10-26/${taskId}`;
    const spec = path.join(root, "lib", "memory", "features", "demo-feature", "spec.md");
    await mkdir(path.dirname(spec), { recursive: true });
    await writeFile(spec, "# Spec", "utf8");
    await parseAndRun(["advance", taskId, "--artifact", "lib/memory/features/demo-feature/spec.md"], {
      repoRoot: root,
      writeOut: () => {},
    });
    await seedPlanStageAdvanceArtifacts(root, runDirRel);
    await writeFile(path.join(root, runDirRel, "plan.md"), "# Plan only\n", "utf8");

    const advanceOut: string[] = [];
    const code = await parseAndRun(
      ["advance", taskId, "--artifact", `${runDirRel}/touch-set.json`],
      { repoRoot: root, writeOut: (c) => advanceOut.push(c) },
    );
    expect(code).toBe(0);
    const advanceMsg = JSON.parse(advanceOut.join("")) as { warningCount: number; contentWarnings?: unknown[] };
    expect(advanceMsg.warningCount).toBeGreaterThan(0);

    const logText = await readFile(path.join(root, runLogFile), "utf8");
    const logRecords = logText
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { name: string; attributes?: Record<string, unknown> });
    const advanceLine = findLast(logRecords, (record) => record.name === "pancreator.pipeline.advance");
    expect(advanceLine).toBeDefined();
    expect(advanceLine?.attributes?.["pancreator.content_warning_count"]).toBeGreaterThan(0);
    expect(Array.isArray(advanceLine?.attributes?.["pancreator.content_warnings"])).toBe(true);
  });

  it("AC-P6: pan next and pan inbox --format text show decoded timestamps", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-text-decode-"));
    await seedFeatureDeliveryRepo(root);
    await mkdir(path.join(root, "lib", "inbox", "in", "172996_05-10-26"), { recursive: true });
    await writeFile(
      path.join(root, "lib", "inbox", "in", "172996_05-10-26", "38670_1315_demo-feature.md"),
      "# Demo",
      "utf8",
    );
    const runOut: string[] = [];
    await parseAndRun(["run", "feature-delivery", "172996_05-10-26/38670_1315_demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => runOut.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const { taskId } = JSON.parse(runOut.join("")) as { taskId: string };

    const nextTextOut: string[] = [];
    await parseAndRun(["next", taskId, "--format", "text"], {
      repoRoot: root,
      writeOut: (c) => nextTextOut.push(c),
    });
    const nextText = nextTextOut.join("");
    expect(nextText).toContain(taskId);
    expect(nextText).toContain("2026-05-10 13:15 UTC");
    expect(nextText).toMatch(/^event: /m);

    const inboxTextOut: string[] = [];
    await parseAndRun(["inbox", "--format", "text"], { repoRoot: root, writeOut: (c) => inboxTextOut.push(c) });
    const inboxText = inboxTextOut.join("");
    expect(inboxText).toContain("172996_05-10-26/38670_1315_demo-feature");
    expect(inboxText).toContain("2026-05-10 13:15 UTC");
  });

  it("AC-P7: pan artifacts validate exits non-zero for missing and malformed artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-artifacts-validate-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const runOut: string[] = [];
    await parseAndRun(["run", "feature-delivery", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => runOut.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const { taskId } = JSON.parse(runOut.join("")) as { taskId: string };
    const runDirRel = `work/172996_05-10-26/${taskId}`;

    const missingOut: string[] = [];
    const missingCode = await parseAndRun(
      ["artifacts", "validate", taskId, "--stage", "review"],
      { repoRoot: root, writeOut: (c) => missingOut.push(c) },
    );
    expect(missingCode).toBe(1);
    const missingMsg = JSON.parse(missingOut.join("")) as {
      status: string;
      warningCount: number;
      missing: string[];
    };
    expect(missingMsg.status).toBe("invalid");
    expect(missingMsg.warningCount).toBe(0);
    expect(missingMsg.missing.length).toBeGreaterThan(0);

    await writeFile(
      path.join(root, runDirRel, "review.md"),
      "# review\n\nno verdict line\n",
      "utf8",
    );
    const warnOut: string[] = [];
    const warnCode = await parseAndRun(
      ["artifacts", "validate", taskId, "--stage", "review"],
      { repoRoot: root, writeOut: (c) => warnOut.push(c) },
    );
    expect(warnCode).toBe(1);
    const warnMsg = JSON.parse(warnOut.join("")) as { warningCount: number; missing: string[] };
    expect(warnMsg.warningCount).toBe(1);
    expect(warnMsg.missing).toEqual([]);

    await writeFile(path.join(root, runDirRel, "review.md"), "review_passes: true\n", "utf8");
    const cleanOut: string[] = [];
    const cleanCode = await parseAndRun(
      ["artifacts", "validate", taskId, "--stage", "review"],
      { repoRoot: root, writeOut: (c) => cleanOut.push(c) },
    );
    expect(cleanCode).toBe(0);
    const cleanMsg = JSON.parse(cleanOut.join("")) as { warningCount: number; status: string };
    expect(cleanMsg.warningCount).toBe(0);
    expect(cleanMsg.status).toBe("ok");

    await writeFile(path.join(root, runDirRel, "plan.md"), "# Plan\n\nno headings\n", "utf8");
    const planWarnOut: string[] = [];
    const planWarnCode = await parseAndRun(
      ["artifacts", "validate", taskId, "--stage", "plan"],
      { repoRoot: root, writeOut: (c) => planWarnOut.push(c) },
    );
    expect(planWarnCode).toBe(1);
    const planWarnMsg = JSON.parse(planWarnOut.join("")) as { warningCount: number };
    expect(planWarnMsg.warningCount).toBe(1);
  });

  it("status --format text includes decoded timestamp and nextCommand", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-status-text-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(
      path.join(root, "lib", "inbox", "in", "demo-feature.md"),
      "# Demo Feature\n\nBuild the thing.",
      "utf8",
    );
    const runOut: string[] = [];
    await parseAndRun(["run", "feature-delivery", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => runOut.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const { taskId } = JSON.parse(runOut.join("")) as { taskId: string };
    const statusOut: string[] = [];
    const code = await parseAndRun(["status", taskId, "--format", "text"], {
      repoRoot: root,
      writeOut: (c) => statusOut.push(c),
    });
    expect(code).toBe(0);
    const text = statusOut.join("");
    expect(text).toContain("38670_1315_demo-feature");
    expect(text).toContain("2026-05-10 13:15 UTC");
    expect(text).toContain("nextCommand: pnpm -w exec pan advance");
  });

  it("AC-P5a: resolveNextStep and pan next use review.md after must_fix with review_passes true", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-ac-p5a-reentry-"));
    await seedFeatureDeliveryRepo(root);
    const runDirRel = "work/172996_05-10-26/38670_1315_demo-feature";
    const runDir = path.join(root, runDirRel);
    await mkdir(runDir, { recursive: true });
    await writeFile(
      path.join(runDir, "review.md"),
      "review_passes: true\n",
      "utf8",
    );
    const state: FeatureDeliveryState = {
      schemaVersion: "1",
      pipelineId: "feature-delivery",
      taskId: "38670_1315_demo-feature",
      featureId: "demo-feature",
      status: "ready_for_stage_delegation",
      currentStage: "implement",
      createdAtIso: "2026-05-10T13:15:30.000Z",
      source: { inboxEntry: "demo-feature.md", inboxPath: "lib/inbox/in/demo-feature.md" },
      artifacts: {
        runDir: runDirRel,
        stateFile: `${runDirRel}/state.json`,
        handoffFile: `${runDirRel}/handoff.md`,
        runLogFile: `${runDirRel}/run-log.jsonl`,
      },
      stages: [],
      transitions: [],
      nextHumanAction: "fix review findings",
      advanceHistory: [
        {
          atIso: "2026-05-10T14:00:00.000Z",
          kind: "advance",
          from: "review",
          to: "implement",
          event: "must_fix",
          artifact: `${runDirRel}/review.md`,
        },
      ],
    };
    await writeFile(path.join(root, state.artifacts.stateFile), stringifyCliJson(root, state), "utf8");

    const step = resolveNextStep(state, { repoRoot: root });
    expect(step.nextCommand).toMatch(/--artifact work\/172996_05-10-26\/38670_1315_demo-feature\/review\.md/u);
    expect(step.nextCommand).not.toContain("implementation-report.md");

    const nextOut: string[] = [];
    const code = await parseAndRun(["next", state.taskId], { repoRoot: root, writeOut: (c) => nextOut.push(c) });
    expect(code).toBe(0);
    const nextMsg = JSON.parse(nextOut.join("")) as { nextCommand: string };
    expect(nextMsg.nextCommand).toBe(step.nextCommand);
    expect(nextMsg.nextCommand).toContain("/review.md");
  });

  it("AC-P5: advance JSON envelope includes nextCommand and text format shows task/stage/nextCommand", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-ac-p5-advance-text-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const runOut: string[] = [];
    await parseAndRun(["run", "feature-delivery", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => runOut.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const { taskId } = JSON.parse(runOut.join("")) as { taskId: string; nextCommand?: string };
    const runDirRel = `work/172996_05-10-26/${taskId}`;
    const spec = path.join(root, "lib", "memory", "features", "demo-feature", "spec.md");
    await mkdir(path.dirname(spec), { recursive: true });
    await writeFile(spec, "# Spec", "utf8");

    const advanceOut: string[] = [];
    const code = await parseAndRun(
      ["advance", taskId, "--artifact", "lib/memory/features/demo-feature/spec.md"],
      { repoRoot: root, writeOut: (c) => advanceOut.push(c) },
    );
    expect(code).toBe(0);
    const advanceMsg = JSON.parse(advanceOut.join("")) as {
      command: string;
      nextCommand?: string;
      currentStage: string;
      taskId: string;
    };
    expect(advanceMsg.command).toBe("advance");
    expect(advanceMsg.nextCommand).toMatch(/^pnpm -w exec pan advance /u);

    await seedPlanStageAdvanceArtifacts(root, runDirRel);
    const textOut: string[] = [];
    await parseAndRun(
      ["advance", taskId, "--artifact", `${runDirRel}/touch-set.json`, "--format", "text"],
      {
        repoRoot: root,
        writeOut: (c) => textOut.push(c),
      },
    );
    const text = textOut.join("");
    expect(text).toContain(taskId);
    expect(text).toContain("2026-05-10 13:15 UTC");
    expect(text).toMatch(/^stage: /m);
    expect(text).toContain("nextCommand: pnpm -w exec pan advance");
  });

  it("AC-P8: pan check registry and text summary list pass/fail counts", () => {
    const registry = panCheckRegistry();
    expect(registry).toContain("work-archive-hygiene");
    expect(registry).toContain("shipped-ledger-cap");
    expect(registry).toContain("cursorindexingignore");

    const sample: PanCheckResult = {
      command: "check",
      status: "fail",
      passCount: 2,
      failCount: 1,
      skipCount: 0,
      checks: [
        {
          id: "shipped-ledger-cap",
          label: "Shipped-ledger row cap on lib/memory/active/current.md",
          command: "rows=1 cap=10",
          status: "pass",
          exitCode: 0,
        },
        {
          id: "cursorindexingignore",
          label: ".cursorindexingignore availability",
          command: ".cursorindexingignore",
          status: "fail",
          exitCode: 1,
          remediation: "Restore .cursorindexingignore at the repository root",
        },
      ],
    };
    const text = formatPanText(sample);
    expect(text).toContain("check: fail (pass=2 fail=1 skip=0)");
    expect(text).toContain("PASS shipped-ledger-cap:");
    expect(text).toContain("FAIL cursorindexingignore:");
  });

  it("pan check fails when .cursorindexingignore is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-check-ignore-"));
    await mkdir(path.join(root, "lib", "memory", "active"), { recursive: true });
    await writeFile(
      path.join(root, "lib", "memory", "active", "current.md"),
      "## Most recent shipped Features\n\n| Feature | Shipped at (UTC) | Delivery report | Outbox artifact | Archived source |\n|---|---|---|---|---|\n| `—` | `—` | `—` | `—` | `—` |\n",
      "utf8",
    );
    const out: string[] = [];
    const code = await parseAndRun(["check", "--format", "json"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
    });
    expect(code).toBe(1);
    const result = JSON.parse(out.join("")) as PanCheckResult;
    expect(result.command).toBe("check");
    const ignoreCheck = result.checks.find((c) => c.id === "cursorindexingignore");
    expect(ignoreCheck?.status).toBe("fail");
    expect(result.checks.some((c) => c.id === "shipped-ledger-cap")).toBe(true);
    expect(result.passCount).toBeGreaterThanOrEqual(0);
    expect(result.failCount).toBeGreaterThanOrEqual(1);
    expect(result.passCount + result.failCount + result.skipCount).toBe(result.checks.length);
  });

  it("pan doctor alias warns and returns check envelope", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-doctor-alias-"));
    await mkdir(path.join(root, "lib", "memory", "active"), { recursive: true });
    await writeFile(
      path.join(root, "lib", "memory", "active", "current.md"),
      "## Most recent shipped Features\n\n| Feature | Shipped at (UTC) | Delivery report | Outbox artifact | Archived source |\n|---|---|---|---|---|\n| `—` | `—` | `—` | `—` | `—` |\n",
      "utf8",
    );
    await writeFile(path.join(root, ".cursorindexingignore"), "work/**\n", "utf8");
    const err: string[] = [];
    const out: string[] = [];
    const code = await parseAndRun(["doctor", "--format", "json"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      writeErr: (c) => err.push(c),
    });
    expect(err.join("")).toContain("pan doctor is deprecated");
    expect(code).not.toBe(0);
    const result = JSON.parse(out.join("")) as PanCheckResult;
    expect(result.command).toBe("check");
    expect(result.failCount).toBeGreaterThan(0);
  });

  it("accepts inbox entries as lib/inbox/in/... or bucket-relative paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-run-inbox-path-"));
    await seedFeatureDeliveryRepo(root);
    const bucket = "172980_05-26-26";
    await mkdir(path.join(root, "lib", "inbox", "in", bucket), { recursive: true });
    const inboxRel = `${bucket}/2597_demo-feature.md`;
    await writeFile(
      path.join(root, "lib", "inbox", "in", inboxRel),
      "# Demo Feature\n\nBuild the thing.",
      "utf8",
    );
    const out: string[] = [];
    const code = await parseAndRun(
      ["run", "feature-delivery", `lib/inbox/in/${inboxRel}`],
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
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-advance-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
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

    const spec = path.join(root, "lib", "memory", "features", "demo-feature", "spec.md");
    await mkdir(path.dirname(spec), { recursive: true });
    await writeFile(spec, "# Demo Feature Spec", "utf8");

    const advanceOut: string[] = [];
    const code = await parseAndRun(
      ["advance", start.taskId, "--artifact", "lib/memory/features/demo-feature/spec.md"],
      { repoRoot: root, writeOut: (c) => advanceOut.push(c) },
    );
    expect(code).toBe(0);
    const advanced = JSON.parse(advanceOut.join("")) as { currentStage: string; nextPromptFile: string };
    expect(advanced.currentStage).toBe("plan");
    expect(await readFile(path.join(root, advanced.nextPromptFile), "utf8")).toContain("Use subagent/persona: tech-lead");

    const duplicateOut: string[] = [];
    const duplicateCode = await parseAndRun(
      ["advance", start.taskId, "--artifact", "lib/memory/features/demo-feature/spec.md"],
      { repoRoot: root, writeOut: (c) => duplicateOut.push(c), writeErr: () => undefined },
    );
    expect(duplicateCode).toBe(1);
    expect(duplicateOut.join("")).toContain("not valid for plan");
  });

  it("reports invalid task-id format with a suggested canonical id during advance", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-advance-hint-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });

    const spec = path.join(root, "lib", "memory", "features", "demo-feature", "spec.md");
    await mkdir(path.dirname(spec), { recursive: true });
    await writeFile(spec, "# Demo Feature Spec", "utf8");

    const invalidOut: string[] = [];
    const invalidCode = await parseAndRun(
      ["advance", "000200_demo-feature", "--artifact", "lib/memory/features/demo-feature/spec.md"],
      { repoRoot: root, writeOut: (c) => invalidOut.push(c), writeErr: () => undefined },
    );
    expect(invalidCode).toBe(1);
    const payload = JSON.parse(invalidOut.join("")) as { message: string };
    expect(payload.message).toContain("task id MUST match <seconds-to-midnight>_<HHMM>_<slug>.");
    expect(payload.message).toContain("Did you mean 38670_1315_demo-feature?");
  });

  it("reports invalid task-id format without hint when no slug match exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-advance-no-hint-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: () => undefined,
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });

    const spec = path.join(root, "lib", "memory", "features", "demo-feature", "spec.md");
    await mkdir(path.dirname(spec), { recursive: true });
    await writeFile(spec, "# Demo Feature Spec", "utf8");

    const invalidOut: string[] = [];
    const invalidCode = await parseAndRun(
      ["advance", "000200_unknown-feature", "--artifact", "lib/memory/features/demo-feature/spec.md"],
      { repoRoot: root, writeOut: (c) => invalidOut.push(c), writeErr: () => undefined },
    );
    expect(invalidCode).toBe(1);
    const payload = JSON.parse(invalidOut.join("")) as { message: string };
    expect(payload.message).toBe("task id MUST match <seconds-to-midnight>_<HHMM>_<slug>.");
  });

  it("repairs a stale state ledger with explicit evidence and reason", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-repair-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string; stateFile: string };
    const review = path.join(root, "work", "172996_05-10-26", start.taskId, "review.md");
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
        `work/172996_05-10-26/${start.taskId}/review.md`,
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
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-review-reentry-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string; stateFile: string };
    const runDirRel = `work/172996_05-10-26/${start.taskId}`;
    const runDir = path.join(root, runDirRel);

    const spec = path.join(root, "lib", "memory", "features", "demo-feature", "spec.md");
    await mkdir(path.dirname(spec), { recursive: true });
    await writeFile(spec, "# Spec", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", "lib/memory/features/demo-feature/spec.md"], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await seedPlanStageAdvanceArtifacts(root, runDirRel);
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

    const handoffAfterMustFix = await readFile(path.join(root, `${runDirRel}/handoff.md`), "utf8");
    expect(handoffAfterMustFix).not.toContain("chain to test in one step");
    expect(handoffAfterMustFix).toContain("implementation-report.md");

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

  it("must_fix reentry records implement content warnings when implementation-report.md lacks ## heading", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-review-reentry-warnings-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string; stateFile: string; runLogFile: string };
    const runDirRel = `work/172996_05-10-26/${start.taskId}`;
    const runDir = path.join(root, runDirRel);

    const spec = path.join(root, "lib", "memory", "features", "demo-feature", "spec.md");
    await mkdir(path.dirname(spec), { recursive: true });
    await writeFile(spec, "# Spec", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", "lib/memory/features/demo-feature/spec.md"], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await seedPlanStageAdvanceArtifacts(root, runDirRel);
    await parseAndRun(["advance", start.taskId, "--artifact", `${runDirRel}/touch-set.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(
      path.join(runDir, "implementation-report.md"),
      "# Impl only\nno second-level heading\n",
      "utf8",
    );
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
    const code = await parseAndRun(["advance", start.taskId, "--artifact", `${runDirRel}/review.md`], {
      repoRoot: root,
      writeOut: (c) => reentryOut.push(c),
    });
    expect(code).toBe(0);
    const reentry = JSON.parse(reentryOut.join("")) as {
      reviewReentry?: boolean;
      warningCount: number;
      currentStage: string;
    };
    expect(reentry.reviewReentry).toBe(true);
    expect(reentry.warningCount).toBeGreaterThanOrEqual(1);
    expect(reentry.currentStage).toBe("test");

    const logText = await readFile(path.join(root, start.runLogFile), "utf8");
    const logRecords = logText
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { name: string; attributes?: Record<string, unknown> });
    const implementAdvanceLine = findLast(
      logRecords,
      (record) =>
        record.name === "pancreator.pipeline.advance" &&
        record.attributes?.["pancreator.transition_event"] === "implementation_complete",
    );
    expect(implementAdvanceLine).toBeDefined();
    expect(implementAdvanceLine?.attributes?.["pancreator.content_warning_count"]).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(implementAdvanceLine?.attributes?.["pancreator.content_warnings"])).toBe(true);
  });

  it("delegates final artifact closure to librarian for complete feature-delivery runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-complete-prompt-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string; nextPromptFile: string };
    const runDir = path.join(root, "work", "172996_05-10-26", start.taskId);

    const spec = path.join(root, "lib", "memory", "features", "demo-feature", "spec.md");
    await mkdir(path.dirname(spec), { recursive: true });
    await writeFile(spec, "# Spec", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", "lib/memory/features/demo-feature/spec.md"], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    await seedPlanStageAdvanceArtifacts(root, `work/172996_05-10-26/${start.taskId}`);
    await parseAndRun(["advance", start.taskId, "--artifact", `work/172996_05-10-26/${start.taskId}/touch-set.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    await writeFile(path.join(runDir, "implementation-report.md"), "# Impl", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", `work/172996_05-10-26/${start.taskId}/implementation-report.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    await writeFile(path.join(runDir, "review.md"), "review_passes: true", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", `work/172996_05-10-26/${start.taskId}/review.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    await writeFile(path.join(runDir, "test-report.md"), "qa_passes: true", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", `work/172996_05-10-26/${start.taskId}/test-report.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    const report = path.join(root, "lib", "memory", "features", "demo-feature", "delivery-report.md");
    await writeFile(report, "# Delivery", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", "lib/memory/features/demo-feature/delivery-report.md"], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(
      path.join(runDir, "compliance-result.json"),
      stringifyCliJson(root, {
        compliance_passes: true,
        final_gate: {
          "pnpm lint": 0,
          "pnpm typecheck": 0,
          "pnpm test": 0,
          "node --test tests/*.test.mjs": 0,
        },
      }),
      "utf8",
    );
    await parseAndRun(["advance", start.taskId, "--artifact", `work/172996_05-10-26/${start.taskId}/compliance-result.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    await writeFile(
      path.join(runDir, "ship-ratification.json"),
      stringifyCliJson(root, {
        task_id: start.taskId,
        human_ratified_diff: true,
      }),
      "utf8",
    );
    await parseAndRun(["advance", start.taskId, "--artifact", `work/172996_05-10-26/${start.taskId}/ship-ratification.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    const index = path.join(root, "lib", "memory", "features", "demo-feature", "index.json");
    await writeFile(index, "{}\n", "utf8");
    const completeOut: string[] = [];
    await parseAndRun(["advance", start.taskId, "--artifact", "lib/memory/features/demo-feature/index.json"], {
      repoRoot: root,
      writeOut: (c) => completeOut.push(c),
    });
    const complete = JSON.parse(completeOut.join("")) as { currentStage: string; nextPersona: string; nextPromptFile: string };
    expect(complete.currentStage).toBe("complete");
    expect(complete.nextPersona).toBe("librarian");

    const prompt = await readFile(path.join(root, complete.nextPromptFile), "utf8");
    expect(prompt).toContain("Use subagent/persona: librarian");
    expect(prompt).toContain("pipeline-close.md");
    expect(prompt).toContain(`pnpm -w exec pan close-artifacts ${start.taskId}`);
    expect(prompt).not.toContain("Human operator action: archive active surfaces");
  });

  it("closes completed feature-delivery artifacts by archiving work and source inbox paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-close-artifacts-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string };
    const activeRunDirRel = `work/172996_05-10-26/${start.taskId}`;
    const activeRunDir = path.join(root, activeRunDirRel);

    const spec = path.join(root, "lib", "memory", "features", "demo-feature", "spec.md");
    await mkdir(path.dirname(spec), { recursive: true });
    await writeFile(spec, "# Spec", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", "lib/memory/features/demo-feature/spec.md"], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await seedPlanStageAdvanceArtifacts(root, activeRunDirRel);
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
    const report = path.join(root, "lib", "memory", "features", "demo-feature", "delivery-report.md");
    await writeFile(report, "# Delivery", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", "lib/memory/features/demo-feature/delivery-report.md"], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(
      path.join(activeRunDir, "compliance-result.json"),
      stringifyCliJson(root, {
        compliance_passes: true,
        final_gate: {
          "pnpm lint": 0,
          "pnpm typecheck": 0,
          "pnpm test": 0,
          "node --test tests/*.test.mjs": 0,
        },
      }),
      "utf8",
    );
    await parseAndRun(["advance", start.taskId, "--artifact", `${activeRunDirRel}/compliance-result.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(
      path.join(activeRunDir, "ship-ratification.json"),
      stringifyCliJson(root, {
        task_id: start.taskId,
        human_ratified_diff: true,
      }),
      "utf8",
    );
    await parseAndRun(["advance", start.taskId, "--artifact", `${activeRunDirRel}/ship-ratification.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    const index = path.join(root, "lib", "memory", "features", "demo-feature", "index.json");
    const inboxSourceRel = "lib/inbox/in/demo-feature.md";
    await writeFile(
      index,
      stringifyCliJson(root, {
        feature_id: "demo-feature",
        task_id: start.taskId,
        status: "indexed",
        indexed_at: "2026-05-10T13:30:00.000Z",
        source_inbox_item: { path: inboxSourceRel },
        delivery_report: { path: "lib/memory/features/demo-feature/delivery-report.md" },
      }),
      "utf8",
    );
    await parseAndRun(["advance", start.taskId, "--artifact", "lib/memory/features/demo-feature/index.json"], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    await mkdir(path.join(root, "lib", "memory", "active"), { recursive: true });
    await writeFile(
      path.join(root, "lib", "memory", "active", "current.md"),
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
        "\n<!-- pan:active-memory:operator-notes:auto -->\n\n- Active-memory refreshed (UTC): `2020-01-01T00:00:00.000Z`\n\n<!-- /pan:active-memory:operator-notes:auto -->\n",
        "",
      ].join("\n"),
      "utf8",
    );
    await mkdir(path.join(root, "lib", "memory", "features", "compliance-tests"), { recursive: true });
    await writeFile(
      path.join(root, "lib", "memory", "features", "compliance-tests", "audit-history.json"),
      stringifyCliJson(root, {
        schema_version: "1",
        max_entries: 5,
        generated_at: "2026-05-10T13:59:00.000Z",
        entries: [
          {
            audit_id: `${start.taskId}-20260510135900`,
            task_id: start.taskId,
            feature_id: "demo-feature",
            recorded_at: "2026-05-10T13:59:00.000Z",
            stage_status: "passed",
            baseline_audit_id: null,
            artifact_paths: {
              compliance_result: `${activeRunDirRel}/compliance-result.json`,
              run_dir: activeRunDirRel,
            },
            scope_snapshot: [
              {
                path: `${activeRunDirRel}/touch-set.json`,
                exists: true,
                sha256: null,
                size_bytes: null,
              },
            ],
            delta_summary: {
              added: 0,
              removed: 0,
              modified: 0,
              changed_paths: [`${activeRunDirRel}/touch-set.json`],
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
      }),
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
    expect(closed.archivedRunDir).toBe(`archive/work/172996_05-10-26/${start.taskId}`);
    expect(closed.archivedInboxPath).toBe(`archive/inbox/in/172996_05-10-26/${start.taskId}/demo-feature.md`);
    expect(closed.activeMemoryPath).toBe("lib/memory/active/current.md");
    expect(closed.activeFeatureCleared).toBe(true);

    const indexAfterClose = JSON.parse(await readFile(index, "utf8")) as {
      archived_inbox_source: string;
      source_inbox_item: { path: string };
    };
    expect(indexAfterClose.archived_inbox_source).toBe(closed.archivedInboxPath);
    expect(indexAfterClose.source_inbox_item.path).toBe(closed.archivedInboxPath);

    const currentMd = await readFile(path.join(root, "lib", "memory", "active", "current.md"), "utf8");
    expect(currentMd).toContain("- `(none)`");
    expect(currentMd).not.toContain(inboxSourceRel);
    expect(currentMd).toContain(closed.archivedInboxPath);
    expect(currentMd).toContain("2026-05-10T14:00:00.000Z");

    expect(existsSync(path.join(root, "lib", "inbox", "in", "demo-feature.md"))).toBe(false);
    expect(existsSync(path.join(root, activeRunDirRel))).toBe(false);
    expect(existsSync(path.join(root, "work", "172996_05-10-26"))).toBe(false);
    expect(existsSync(path.join(root, closed.archivedInboxPath))).toBe(true);
    expect(existsSync(path.join(root, closed.stateFile))).toBe(true);
    const complianceHistoryAfterClose = JSON.parse(
      await readFile(path.join(root, "lib", "memory", "features", "compliance-tests", "audit-history.json"), "utf8"),
    ) as {
      entries: Array<{ artifact_paths?: { compliance_result?: string; run_dir?: string } }>;
    };
    expect(complianceHistoryAfterClose.entries[0]?.artifact_paths?.run_dir).toBe(
      `archive/work/172996_05-10-26/${start.taskId}`,
    );
    expect(complianceHistoryAfterClose.entries[0]?.artifact_paths?.compliance_result).toBe(
      `archive/work/172996_05-10-26/${start.taskId}/compliance-result.json`,
    );

    const statusOut: string[] = [];
    await parseAndRun(["status", start.taskId], { repoRoot: root, writeOut: (c) => statusOut.push(c) });
    const status = JSON.parse(statusOut.join("")) as { pipelineStatus: string; runDir: string };
    expect(status.pipelineStatus).toBe("closed");
    expect(status.runDir).toBe(closed.archivedRunDir);

    const statusTextOut: string[] = [];
    await parseAndRun(["status", start.taskId, "--format", "text"], {
      repoRoot: root,
      writeOut: (c) => statusTextOut.push(c),
    });
    expect(statusTextOut.join("")).toContain("2026-05-10 13:15 UTC");
  });

  it("close-artifacts rejects missing operator-verification.md", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-close-missing-verification-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string };
    await completeFeatureDeliveryRunForClose(root, start.taskId, "demo-feature", "172996_05-10-26");
    const activeRunDirRel = `work/172996_05-10-26/${start.taskId}`;
    await (await import("node:fs/promises")).unlink(path.join(root, activeRunDirRel, "operator-verification.md"));

    const closeOut: string[] = [];
    const code = await parseAndRun(["close-artifacts", start.taskId], {
      repoRoot: root,
      writeOut: (c) => closeOut.push(c),
      writeErr: (c) => closeOut.push(c),
    });
    expect(code).toBe(1);
    expect(closeOut.join("")).toContain("operator-verification.md");
  });

  it("reopen unarchives a closed feature-delivery run to intake", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-reopen-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string };
    const dayDir = "172996_05-10-26";
    await completeFeatureDeliveryRunForClose(root, start.taskId, "demo-feature", dayDir);
    await mkdir(path.join(root, "lib", "memory", "active"), { recursive: true });
    await writeFile(
      path.join(root, "lib", "memory", "active", "current.md"),
      "# Current focus\n\n## Active Feature\n\n- `(none)`\n\n## Most recent shipped Features\n\n| Feature | Shipped at (UTC) | Delivery report | Outbox artifact | Archived source |\n|---|---|---|---|---|\n| `—` | `—` | `—` | `—` | `—` |\n\n## Operator notes\n\n- `(none)`\n",
      "utf8",
    );
    const closeCode = await parseAndRun(["close-artifacts", start.taskId], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    expect(closeCode).toBe(0);

    const reopenOut: string[] = [];
    const code = await parseAndRun(
      ["reopen", start.taskId, "--reason", "Operator verification failed on flow one."],
      { repoRoot: root, writeOut: (c) => reopenOut.push(c), writeErr: (c) => reopenOut.push(c) },
    );
    expect(code).toBe(0);
    const reopened = JSON.parse(reopenOut.join("")) as {
      pipelineStatus: string;
      currentStage: string;
      runDir: string;
    };
    expect(reopened.pipelineStatus).toBe("reopened");
    expect(reopened.currentStage).toBe("intake");
    expect(reopened.runDir).toBe(`work/${dayDir}/${start.taskId}`);
    expect(existsSync(path.join(root, reopened.runDir, "state.json"))).toBe(true);
    expect(existsSync(path.join(root, "archive", "work", dayDir, start.taskId))).toBe(false);
  });

  it("report advance rejects JS-literal delivery-report citations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-report-citation-lint-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string };
    const activeRunDirRel = `work/172996_05-10-26/${start.taskId}`;
    const activeRunDir = path.join(root, activeRunDirRel);

    const spec = path.join(root, "lib", "memory", "features", "demo-feature", "spec.md");
    await mkdir(path.dirname(spec), { recursive: true });
    await writeFile(spec, "# Spec", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", "lib/memory/features/demo-feature/spec.md"], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await seedPlanStageAdvanceArtifacts(root, activeRunDirRel);
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

    const report = path.join(root, "lib", "memory", "features", "demo-feature", "delivery-report.md");
    await writeFile(
      report,
      "# Delivery\n\nBad citation {kind: lines, path: work/example.md, range: [1, 2], contentHash: abc}\n",
      "utf8",
    );
    const advanceOut: string[] = [];
    const code = await parseAndRun(
      ["advance", start.taskId, "--artifact", "lib/memory/features/demo-feature/delivery-report.md"],
      { repoRoot: root, writeOut: (c) => advanceOut.push(c), writeErr: () => undefined },
    );
    expect(code).toBe(1);
    const payload = JSON.parse(advanceOut.join("")) as { message: string };
    expect(payload.message).toContain("js-literal-citation");
  });

  it("routes report to compliance and blocks malformed ship policy artifact", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-report-to-compliance-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await parseAndRun(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string; currentStage: string };
    const runDirRel = `work/172996_05-10-26/${start.taskId}`;
    const runDir = path.join(root, runDirRel);

    const spec = path.join(root, "lib", "memory", "features", "demo-feature", "spec.md");
    await mkdir(path.dirname(spec), { recursive: true });
    await writeFile(spec, "# Spec", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", "lib/memory/features/demo-feature/spec.md"], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await seedPlanStageAdvanceArtifacts(root, runDirRel);
    await parseAndRun(["advance", start.taskId, "--artifact", `${runDirRel}/touch-set.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(runDir, "implementation-report.md"), "# Impl", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", `${runDirRel}/implementation-report.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(runDir, "review.md"), "review_passes: true", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", `${runDirRel}/review.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(runDir, "test-report.md"), "qa_passes: true", "utf8");
    await parseAndRun(["advance", start.taskId, "--artifact", `${runDirRel}/test-report.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    const report = path.join(root, "lib", "memory", "features", "demo-feature", "delivery-report.md");
    await writeFile(report, "# Delivery\n\nAll good.\n", "utf8");
    const reportAdvanceOut: string[] = [];
    const reportCode = await parseAndRun(
      ["advance", start.taskId, "--artifact", "lib/memory/features/demo-feature/delivery-report.md"],
      { repoRoot: root, writeOut: (c) => reportAdvanceOut.push(c) },
    );
    expect(reportCode).toBe(0);
    const reportAdvance = JSON.parse(reportAdvanceOut.join("")) as {
      currentStage: string;
      nextPersona: string | null;
    };
    expect(reportAdvance.currentStage).toBe("compliance");
    expect(reportAdvance.nextPersona).toBe("compliance-auditor");

    await writeFile(
      path.join(runDir, "compliance-result.json"),
      stringifyCliJson(root, {
        compliance_passes: true,
        final_gate: {
          "pnpm lint": 0,
          "pnpm typecheck": 0,
          "pnpm test": 0,
          "node --test tests/*.test.mjs": 0,
        },
      }),
      "utf8",
    );
    const complianceAdvanceOut: string[] = [];
    const complianceCode = await parseAndRun(
      ["advance", start.taskId, "--artifact", `${runDirRel}/compliance-result.json`],
      { repoRoot: root, writeOut: (c) => complianceAdvanceOut.push(c) },
    );
    expect(complianceCode).toBe(0);
    const complianceAdvance = JSON.parse(complianceAdvanceOut.join("")) as { currentStage: string };
    expect(complianceAdvance.currentStage).toBe("ship");

    await writeFile(path.join(runDir, "ship-ratification.json"), "{}\n", "utf8");
    const shipAdvanceOut: string[] = [];
    const shipCode = await parseAndRun(
      ["advance", start.taskId, "--artifact", `${runDirRel}/ship-ratification.json`],
      { repoRoot: root, writeOut: (c) => shipAdvanceOut.push(c), writeErr: () => undefined },
    );
    expect(shipCode).toBe(1);
    const shipFailure = JSON.parse(shipAdvanceOut.join("")) as { message: string };
    expect(shipFailure.message).toContain("Cannot advance ship");
    expect(shipFailure.message).toContain("ship_ratification_missing_key");
  });

  it("close-artifacts finalizes a prematurely archived run idempotently", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-close-artifacts-idempotent-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
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
    const archiveRunDirRel = `archive/work/${dayDir}/${start.taskId}`;
    await mkdir(path.dirname(path.join(root, archiveRunDirRel)), { recursive: true });
    await rename(path.join(root, activeRunDirRel), path.join(root, archiveRunDirRel));

    await mkdir(path.join(root, "lib", "memory", "active"), { recursive: true });
    await writeFile(
      path.join(root, "lib", "memory", "active", "current.md"),
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
        "\n<!-- pan:active-memory:operator-notes:auto -->\n\n- Active-memory refreshed (UTC): `2020-01-01T00:00:00.000Z`\n\n<!-- /pan:active-memory:operator-notes:auto -->\n",
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
      alreadyArchived?: boolean;
      archivedRunDir: string;
    };
    expect(closed.pipelineStatus).toBe("closed");
    expect(closed.alreadyArchived).toBe(true);
    expect(closed.archivedRunDir).toBe(archiveRunDirRel);
    expect(existsSync(path.join(root, activeRunDirRel))).toBe(false);
    expect(existsSync(path.join(root, archiveRunDirRel))).toBe(true);
  });

  it("rolls back archive moves when active-memory refresh fails during close-artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-close-artifacts-rollback-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
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

    await mkdir(path.join(root, "lib", "memory", "active"), { recursive: true });
    await writeFile(
      path.join(root, "lib", "memory", "active", "current.md"),
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
    const archivedRunDirRel = `archive/work/${dayDir}/${start.taskId}`;
    const archivedInboxRel = `archive/inbox/in/${dayDir}/${start.taskId}/demo-feature.md`;
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
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-close-artifacts-refresh-shipped-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
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

    await mkdir(path.join(root, "lib", "memory", "active"), { recursive: true });
    await writeFile(
      path.join(root, "lib", "memory", "active", "current.md"),
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
        "\n<!-- pan:active-memory:operator-notes:auto -->\n\n- Active-memory refreshed (UTC): `2020-01-01T00:00:00.000Z`\n\n<!-- /pan:active-memory:operator-notes:auto -->\n",
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

    const currentMd = await readFile(path.join(root, "lib", "memory", "active", "current.md"), "utf8");
    expect(currentMd).toContain("| `demo-feature` | [indexed] (`2026-05-10T13:30:00.000Z`) |");
    expect(currentMd).toContain(closed.archivedInboxPath);
    expect(currentMd).toContain("- `(none)`");
  });

  it("refreshes prompt files for an existing feature-delivery ledger", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-refresh-prompt-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
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
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-pause-log-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(
      path.join(root, "lib", "inbox", "in", "demo-feature.md"),
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
      pancreator: { intervention?: { lever: string } };
    };
    expect(last.name).toBe("pancreator.pipeline.intervention.pause");
    expect(last.pancreator.intervention?.lever).toBe("pause");
  });

  it("exposes intervention state through status", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-status-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
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

  it("appends a pause record under .pan/scheduler/interventions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-cli2-"));
    const out: string[] = [];
    const code = await parseAndRun(["pause", "task-a"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
    });
    expect(code).toBe(0);
    const journal = path.join(root, ".pan", "scheduler", "interventions", "task-a.jsonl");
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

  const emptyShippedInner =
    `\n| Feature | Shipped at (UTC) | Delivery report | Outbox artifact | Archived source |\n` +
    "|---|---|---|---|---|\n" +
    "| `—` | `—` | `—` | `—` | `—` |\n";
  const opsInnerSynced =
    `\n<!-- pan:active-memory:operator-notes:auto -->\n\n` +
    `- Active-memory refreshed (UTC): \`${refreshIso}\`\n\n` +
    "<!-- /pan:active-memory:operator-notes:auto -->\n\n" +
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
    await writeFile(path.join(root, "pancreator.yaml"), "bootstrap: phase-4\n", "utf8");
    await mkdir(path.join(root, "lib", "inbox", "in"), { recursive: true });
    await mkdir(path.join(root, "lib", "memory", "active"), { recursive: true });
    await mkdir(path.join(root, "lib", "memory", "features"), { recursive: true });
  }

  it("pan init dry-run reports planned scaffold without writes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-init-dry-"));
    const out: string[] = [];
    const code = await parseAndRun(["init", "--dry-run"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
    });
    expect(code).toBe(0);
    const msg = JSON.parse(out.join("")) as { command: string; dryRun: boolean; diffs: unknown[] };
    expect(msg.command).toBe("init");
    expect(msg.dryRun).toBe(true);
    expect(existsSync(path.join(root, "pancreator.yaml"))).toBe(false);
  });

  it("pan init --apply refuses conflicts without --force", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-init-conflict-"));
    await writeFile(path.join(root, "pancreator.yaml"), "existing\n", "utf8");
    const code = await parseAndRun(["init", "--apply"], {
      repoRoot: root,
      writeOut: () => {},
      writeErr: () => {},
    });
    expect(code).toBe(1);
  });

  it("create-pancreator scaffolds an empty project directory", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "pan-create-parent-"));
    const out: string[] = [];
    const code = await parseAndRun(["create-pancreator", "demo"], {
      repoRoot: parent,
      writeOut: (c) => out.push(c),
    });
    expect(code).toBe(0);
    const msg = JSON.parse(out.join("")) as { command: string; targetDir: string };
    expect(msg.command).toBe("create-pancreator");
    expect(existsSync(path.join(msg.targetDir, "pancreator.yaml"))).toBe(true);
  });

  it("exits 125 with deferred envelopes for stubbed verbs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-deferred-"));
    const batchTracking =
      "lib/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md";
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
      expect(code).toBe(PAN_DEFERRED_EXIT_CODE);
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
      verb: "pan memory",
      milestone: "M2",
      status: "deferred",
    });
  });

  it("writes pan intake new output with utc bucket prefixes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-intake-"));
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
    expect(msg.path).toMatch(/^lib\/inbox\/in\/\d{6}_\d{2}-\d{2}-\d{2}\/\d{1,6}_\d{4}_demo-slug\.md$/);
    expect(existsSync(path.join(root, msg.path))).toBe(true);
  });

  it("uses SID seconds-to-next-UTC-midnight across the UTC calendar-day boundary", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-intake-sid-"));
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

  it("writes pan intake new when archived and active day buckets coexist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-intake-archive-"));
    await seedMinimalWorkspace(root);
    const bucket = makeUtcDayBucket(new Date(Date.UTC(2026, 1, 2, 9, 0, 0)));
    await mkdir(path.join(root, "lib", "inbox", "in", bucket), { recursive: true });
    await mkdir(path.join(root, "archive", "inbox", "in", bucket), { recursive: true });
    const out: string[] = [];
    const code = await parseAndRun(
      ["intake", "new", "coexist-slug"],
      {
        repoRoot: root,
        clock: () => new Date(Date.UTC(2026, 1, 2, 9, 0, 0)),
        writeOut: (c) => out.push(c),
      },
    );
    expect(code).toBe(0);
    const msg = JSON.parse(out.join("")) as { status: string; path: string };
    expect(msg.status).toBe("ok");
    expect(existsSync(path.join(root, msg.path))).toBe(true);
  });

  it("hydrates pan intake new bodies from handbook contract templates when requested", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-intake-template-"));
    await seedMinimalWorkspace(root);
    const templates = path.join(root, "lib", "memory", "handbook", "contract-templates");
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

  it("rejects pan intake from-build-plan without operator prompt or plan text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-intake-build-plan-missing-"));
    await seedMinimalWorkspace(root);
    const missingPrompt: string[] = [];
    const missingPromptCode = await parseAndRun(
      ["intake", "from-build-plan", "build-mode-inbox", "--plan-text", "plan only"],
      {
        repoRoot: root,
        writeOut: (c) => missingPrompt.push(c),
        writeErr: (c) => missingPrompt.push(c),
      },
    );
    expect(missingPromptCode).toBe(1);
    expect(missingPrompt.join("")).toContain(
      "from-build-plan requires --operator-prompt or --prompt-file with non-empty content.",
    );

    const missingPlan: string[] = [];
    const missingPlanCode = await parseAndRun(
      ["intake", "from-build-plan", "build-mode-inbox", "--operator-prompt", "prompt only"],
      {
        repoRoot: root,
        writeOut: (c) => missingPlan.push(c),
        writeErr: (c) => missingPlan.push(c),
      },
    );
    expect(missingPlanCode).toBe(1);
    expect(missingPlan.join("")).toContain(
      "from-build-plan requires --plan-text or --plan-file with non-empty content.",
    );
  });

  it("writes pan intake from-build-plan with operator prompt and plan snapshot", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-intake-build-plan-"));
    await seedMinimalWorkspace(root);
    const out: string[] = [];
    await parseAndRun(
      [
        "intake",
        "from-build-plan",
        "build-mode-inbox",
        "--title",
        "Build-mode inbox scaffolding",
        "--operator-prompt",
        "implement build-mode inbox auto-create",
        "--plan-text",
        "## Plan\n\n1. CLI\n2. AGENTS.md",
      ],
      {
        repoRoot: root,
        writeOut: (c) => out.push(c),
        clock: () => new Date(Date.UTC(2026, 5, 4, 10, 15, 0)),
      },
    );
    const payload = JSON.parse(out.join("")) as { command: string; path: string; status: string };
    expect(payload.status).toBe("ok");
    expect(payload.command).toBe("intake from-build-plan");
    const body = await readFile(path.join(root, payload.path), "utf8");
    expect(body).toContain("source_channel: cursor-build-mode");
    expect(body).toContain("implement build-mode inbox auto-create");
    expect(body).toContain("## Plan snapshot");
  });

  it("writes pan intake from-build-plan from prompt-file and plan-file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-intake-build-plan-files-"));
    await seedMinimalWorkspace(root);
    const promptPath = path.join(root, "build-prompt.txt");
    const planPath = path.join(root, "build-plan.md");
    await writeFile(promptPath, "file-backed operator prompt", "utf8");
    await writeFile(planPath, "## File plan\n\n1. Scaffold\n2. Document", "utf8");
    const out: string[] = [];
    await parseAndRun(
      [
        "intake",
        "from-build-plan",
        "file-backed-slug",
        "--prompt-file",
        "build-prompt.txt",
        "--plan-file",
        "build-plan.md",
      ],
      {
        repoRoot: root,
        writeOut: (c) => out.push(c),
        clock: () => new Date(Date.UTC(2026, 5, 4, 11, 0, 0)),
      },
    );
    const payload = JSON.parse(out.join("")) as { command: string; path: string; status: string };
    expect(payload.status).toBe("ok");
    const body = await readFile(path.join(root, payload.path), "utf8");
    expect(body).toContain("file-backed operator prompt");
    expect(body).toContain("## File plan");
  });

  it("refresh-active-memory derives Archived source from indexed feature lineage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-refresh-archived-src-"));
    await seedMinimalWorkspace(root);
    const taskId = "24959_1704_ci-best-practices-batch";
    const archived =
      "archive/inbox/in/172980_05-26-26/24959_1704_ci-best-practices-batch/71701_0613_ci-best-practices-batch.md";
    const stale = "lib/inbox/in/172981_05-25-26/71701_0613_ci-best-practices-batch.md";
    await mkdir(path.join(root, ...archived.split("/").slice(0, -1)), { recursive: true });
    await writeFile(path.join(root, archived), "# batch\n", "utf8");
    const featureDir = path.join(root, "lib", "memory", "features", "ci-best-practices-batch");
    await mkdir(featureDir, { recursive: true });
    await writeFile(
      path.join(featureDir, "index.json"),
      stringifyCliJson(root, {
        feature_id: "ci-best-practices-batch",
        task_id: taskId,
        status: "indexed",
        indexed_at: "2026-05-26T18:23:19.000Z",
        intake: { source_inbox_item: stale },
        delivery_report: { path: "lib/memory/features/ci-best-practices-batch/delivery-report.md" },
      }),
      "utf8",
    );
    await writeFile(path.join(featureDir, "delivery-report.md"), "# Delivery\n", "utf8");

    const currentAbs = path.join(root, "lib", "memory", "active", "current.md");
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
    expect(code).toBe(PAN_ACTIVE_MEMORY_CONFLICT_EXIT_CODE);
    const diff = out.join("");
    expect(diff).toContain("+++ computed");
    expect(diff).toContain(archived);
    expect(diff).toMatch(
      /\| `ci-best-practices-batch` \| \[indexed\].*71701_0613_ci-best-practices-batch\.md` \|/u,
    );
  });

  it("refresh-active-memory --dry-run stays quiet once sections mirror derivation outputs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-refresh-green-"));
    await seedMinimalWorkspace(root);
    const currentAbs = path.join(root, "lib", "memory", "active", "current.md");
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
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-refresh-dry-conflict-"));
    await seedMinimalWorkspace(root);
    const currentAbs = path.join(root, "lib", "memory", "active", "current.md");
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
    expect(code).toBe(PAN_ACTIVE_MEMORY_CONFLICT_EXIT_CODE);
  });

  it("refresh-active-memory emits a conflict exit when Active Feature inbox pointer is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-refresh-conflict-"));
    await seedMinimalWorkspace(root);
    const currentAbs = path.join(root, "lib", "memory", "active", "current.md");
    await writeFile(
      currentAbs,
      `${buildSyncedCurrentMd("\n- `lib/inbox/in/missing/archived-item.md`\n").trimEnd()}\n`,
      "utf8",
    );
    const err: string[] = [];
    const code = await parseAndRun(["refresh-active-memory"], {
      repoRoot: root,
      writeOut: () => {},
      writeErr: (c) => err.push(c),
      clock: () => new Date(refreshIso),
    });
    expect(code).toBe(PAN_ACTIVE_MEMORY_CONFLICT_EXIT_CODE);
    expect(err.join("")).toContain("missing under lib/inbox/in/");
  });

  it("refresh-active-memory preserves human-curated Active Feature when inbox queue differs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-refresh-active-human-"));
    await seedMinimalWorkspace(root);
    const bucket = makeUtcDayBucket(new Date(Date.UTC(2026, 4, 25, 6, 0, 0)));
    const chosen = `lib/inbox/in/${bucket}/64489_0605_chosen-active.md`;
    await mkdir(path.join(root, ...chosen.split("/").slice(0, -1)), { recursive: true });
    await writeFile(path.join(root, chosen), "# chosen\n", "utf8");
    const newer = `lib/inbox/in/${bucket}/64500_0605_newer-backlog-stub.md`;
    await writeFile(path.join(root, newer), "# newer\n", "utf8");
    const currentAbs = path.join(root, "lib", "memory", "active", "current.md");
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
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-refresh-apply-ts-"));
    await seedMinimalWorkspace(root);
    const currentAbs = path.join(root, "lib", "memory", "active", "current.md");
    const staleIso = "2020-01-01T00:00:00.000Z";
    const clockNow = new Date("2026-06-01T12:34:56.789Z");
    const humanLine = "- Human-only note stays verbatim.\n";
    const opsStaleInner =
      `\n<!-- pan:active-memory:operator-notes:auto -->\n\n` +
      `- Active-memory refreshed (UTC): \`${staleIso}\`\n\n` +
      "<!-- /pan:active-memory:operator-notes:auto -->\n\n" +
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

    it("invokes CursorRunner once on sdk run and advance", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "pan-sdk-run-advance-"));
      await seedFeatureDeliveryRepo(root);
      await seedCanonicalPersonas(root);
      await writeRunnerInvocationConfig(root, "manual");
      await writeFile(
        path.join(root, "lib", "inbox", "in", "demo-feature.md"),
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
      });
      expect(code).toBe(0);
      expect(invokeCount).toBe(0);
      const start = JSON.parse(out.join("")) as { taskId: string; runLogFile: string };
      await writeRunnerInvocationConfig(root, "sdk");
      invokeCount = 0;
      const spec = path.join(root, "lib", "memory", "features", "demo-feature", "spec.md");
      await mkdir(path.dirname(spec), { recursive: true });
      await writeFile(spec, "# Spec\n\nfeature: demo\n", "utf8");
      const advanceCode = await parseAndRun(
        ["advance", start.taskId, "--artifact", "lib/memory/features/demo-feature/spec.md"],
        {
          repoRoot: root,
          writeOut: () => undefined,
          testHooks: { sdkTransport: transport },
        },
      );
      expect(advanceCode).toBe(0);
      expect(invokeCount).toBeGreaterThanOrEqual(1);
      const runLogAfterAdvance = await readFile(path.join(root, start.runLogFile), "utf8");
      expect(runnerInvokeLogLines(runLogAfterAdvance).length).toBeGreaterThanOrEqual(1);
    });

    it("composes representative sdk prompts for implement/review/test/compliance stages", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "pan-sdk-prompt-shape-"));
      await seedFeatureDeliveryRepo(root);
      await seedCanonicalPersonas(root);
      await writeRunnerInvocationConfig(root, "manual");
      await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo\n", "utf8");

      const invocations: CursorSdkInvokeParams[] = [];
      const baseTransport = mockSdkTransport();
      const captureTransport: CursorSdkTransport = async (params) => {
        invocations.push({
          ...params,
          requiredArtifactPaths: params.requiredArtifactPaths
            ? [...params.requiredArtifactPaths]
            : params.requiredArtifactPaths,
        });
        return baseTransport(params);
      };

      const start = await startFeatureDelivery({
        repoRoot: root,
        inboxEntry: "demo-feature.md",
        clock: () => new Date("2026-05-10T13:15:30.000Z"),
      });
      await writeRunnerInvocationConfig(root, "sdk");
      const taskId = start.taskId;
      const featureId = start.featureId;
      const runDir = start.runDir;

      const specRel = `lib/memory/features/${featureId}/spec.md`;
      await mkdir(path.dirname(path.join(root, specRel)), { recursive: true });
      await writeFile(path.join(root, specRel), "# Spec\n", "utf8");

      const artifactForStage = (stage: string): string => {
        switch (stage) {
          case "intake":
            return `lib/memory/features/${featureId}/spec.md`;
          case "plan":
            return `${runDir}/touch-set.json`;
          case "implement":
            return `${runDir}/implementation-report.md`;
          case "review":
            return `${runDir}/review.md`;
          case "test":
            return `${runDir}/test-report.md`;
          case "report":
            return `lib/memory/features/${featureId}/delivery-report.md`;
          case "compliance":
            return `${runDir}/compliance-result.json`;
          case "ship":
            return `${runDir}/ship-ratification.json`;
          case "index":
            return `lib/memory/features/${featureId}/index.json`;
          default:
            throw new Error(`No artifact mapping for stage ${stage}`);
        }
      };

      let currentStage: string = start.currentStage;
      const stopStages = new Set(["compliance", "ship", "index", "complete", "aborted", "paused"]);
      for (let i = 0; i < 9; i += 1) {
        if (stopStages.has(currentStage)) {
          break;
        }
        const next = await advanceFeatureDelivery({
          repoRoot: root,
          taskId,
          artifact: artifactForStage(currentStage),
          testHooks: { sdkTransport: captureTransport },
        });
        currentStage = next.currentStage;
      }

      const stageParams = new Map<string, CursorSdkInvokeParams>();
      for (const params of invocations) {
        const match = params.message.match(/stage ([a-z-]+) for task/iu);
        if (match !== null && !stageParams.has(match[1])) {
          stageParams.set(match[1], params);
        }
      }

      for (const stage of ["implement", "review", "test", "compliance"]) {
        expect(stageParams.has(stage)).toBe(true);
      }

      const prompts = new Map(
        [...stageParams.entries()].map(([stage, params]) => [stage, buildSdkPrompt(params)]),
      );
      const promptTokens = new Map(
        [...prompts.entries()].map(([stage, prompt]) => [stage, Math.ceil(prompt.length / 4)]),
      );

      expect(prompts.get("implement")).toContain("Persona: coder");
      expect(prompts.get("review")).toContain("Persona: reviewer");
      expect(prompts.get("test")).toContain("Persona: qa-tester");
      expect(prompts.get("compliance")).toContain("Persona: compliance-auditor");
      expect(prompts.get("implement")).toContain("Use subagent/persona: coder");
      expect(prompts.get("review")).toContain("Use subagent/persona: reviewer");
      expect(prompts.get("test")).toContain("Use subagent/persona: qa-tester");
      expect(prompts.get("compliance")).toContain("Use subagent/persona: compliance-auditor");
      expect(prompts.get("compliance")).toContain("Compliance exit bundle (all MUST pass)");
      expect(prompts.get("compliance")).toContain("pnpm lint");
      expect(promptTokens.get("compliance")).toBeGreaterThan(promptTokens.get("implement") ?? 0);
      expect(promptTokens.get("review")).toBeGreaterThan(promptTokens.get("implement") ?? 0);
    });

    it("does not call SDK transport for manual mode across run and advance", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "pan-manual-no-sdk-"));
      await seedFeatureDeliveryRepo(root);
      await seedCanonicalPersonas(root);
      await writeRunnerInvocationConfig(root, "manual");
      await writeFile(
        path.join(root, "lib", "inbox", "in", "demo-feature.md"),
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
      const specRel = "lib/memory/features/demo-feature/spec.md";
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
      const root = await mkdtemp(path.join(os.tmpdir(), "pan-persona-fail-"));
      await seedFeatureDeliveryRepo(root);
      await writeRunnerInvocationConfig(root, "sdk");
      await writeFile(
        path.join(root, "lib", "pipelines", "feature-delivery.yaml"),
        `id: feature-delivery
version: "1"
stages:
  - id: intake
    persona: missing-persona
`,
        "utf8",
      );
      await writeFile(path.join(root, "lib", "inbox", "in", "demo.md"), "# Demo", "utf8");
      const out: string[] = [];
      const code = await parseAndRun(["run", "feature-delivery", "demo.md"], {
        repoRoot: root,
        writeOut: (c) => out.push(c),
        writeErr: () => undefined,
        testHooks: { sdkTransport: mockSdkTransport() },
      });
      expect(code).toBe(1);
      expect(out.join("")).toContain("Unknown persona");
      const workRoot = path.join(root, "work");
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
      const root = await mkdtemp(path.join(os.tmpdir(), "pan-env-load-"));
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
      await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo", "utf8");
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
      const root = await mkdtemp(path.join(os.tmpdir(), "pan-persona-resolve-"));
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
      _transport: CursorSdkTransport,
    ): Promise<void> {
      const statePath = path.join(root, runDirRel, "state.json");
      const state = JSON.parse(await readFile(statePath, "utf8")) as { currentStage: string };
      const specRel = `lib/memory/features/${featureId}/spec.md`;
      if (state.currentStage === "intake") {
        await mkdir(path.dirname(path.join(root, specRel)), { recursive: true });
        await writeFile(path.join(root, specRel), "# Spec\n", "utf8");
        const specCode = await parseAndRun(["advance", taskId, "--artifact", specRel], {
          repoRoot: root,
          writeOut: () => undefined,
        });
        expect(specCode).toBe(0);
      }
      const afterSpec = JSON.parse(await readFile(statePath, "utf8")) as { currentStage: string };
      if (afterSpec.currentStage === "plan") {
        await seedPlanStageAdvanceArtifacts(root, runDirRel);
        const planCode = await parseAndRun(
          ["advance", taskId, "--artifact", `${runDirRel}/touch-set.json`],
          { repoRoot: root, writeOut: () => undefined },
        );
        expect(planCode).toBe(0);
      }
      const atImplement = JSON.parse(await readFile(statePath, "utf8")) as { currentStage: string };
      expect(atImplement.currentStage).toBe("implement");
    }

    it("sdk auto-chains review_passes to test and qa_passes to report without extra advance", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "pan-sdk-auto-chain-"));
      await seedFeatureDeliveryRepo(root);
      await seedCanonicalPersonas(root);
      await writeRunnerInvocationConfig(root, "manual");
      await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo", "utf8");
      const transport = mockSdkTransport();
      const out: string[] = [];
      const runCode = await parseAndRun(["run", "feature-delivery", "demo-feature.md"], {
        repoRoot: root,
        writeOut: (c) => out.push(c),
        clock: () => new Date("2026-05-10T13:15:30.000Z"),
      });
      expect(runCode).toBe(0);
      const start = JSON.parse(out.join("")) as { taskId: string; stateFile: string; featureId: string };
      const runDirRel = path.posix.dirname(start.stateFile);
      await advanceSdkRunToImplement(root, start.taskId, start.featureId, runDirRel, transport);
      await writeRunnerInvocationConfig(root, "sdk");
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
      await writeFile(
        path.join(root, runDirRel, "implementation-report.md"),
        "# Implementation report\n\n## Summary\n\nBody.\n",
        "utf8",
      );
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
      expect(["report", "compliance", "ship", "index", "complete"]).toContain(result.currentStage);
      const state = JSON.parse(await readFile(path.join(root, start.stateFile), "utf8")) as {
        currentStage: string;
      };
      expect(["report", "compliance", "ship", "index", "complete"]).toContain(state.currentStage);
    });

    it("sdk auto-chains review must_fix back to implement", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "pan-sdk-auto-must-fix-"));
      await seedFeatureDeliveryRepo(root);
      await seedCanonicalPersonas(root);
      await writeRunnerInvocationConfig(root, "manual");
      await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo", "utf8");
      const transport = mockSdkTransport();
      const out: string[] = [];
      await parseAndRun(["run", "feature-delivery", "demo-feature.md"], {
        repoRoot: root,
        writeOut: (c) => out.push(c),
        clock: () => new Date("2026-05-10T13:15:30.000Z"),
      });
      const start = JSON.parse(out.join("")) as { taskId: string; stateFile: string; featureId: string };
      const runDirRel = path.posix.dirname(start.stateFile);
      await advanceSdkRunToImplement(root, start.taskId, start.featureId, runDirRel, transport);
      await writeRunnerInvocationConfig(root, "sdk");
      await writeFile(
        path.join(root, runDirRel, "review.md"),
        "review_passes: false\n",
        "utf8",
      );
      await writeFile(
        path.join(root, runDirRel, "implementation-report.md"),
        "# Implementation report\n\n## Summary\n\nBody.\n",
        "utf8",
      );
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
      const root = await mkdtemp(path.join(os.tmpdir(), "pan-retry-halt-"));
      await seedFeatureDeliveryRepo(root);
      await seedCanonicalPersonas(root);
      await writeRunnerInvocationConfig(root, "sdk");
      await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo", "utf8");
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
      patched.automation = { runnerInvocation: "sdk", cumulativeRetryCount: 5 };
      await writeFile(stateAbs, stringifyCliJson(root, patched), "utf8");
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
      expect(halted.automation?.cumulativeRetryCount).toBe(6);
    });
  });
});