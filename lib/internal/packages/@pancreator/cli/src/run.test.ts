import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
import {
  gateFixtureBody,
  seedPlanStageAdvanceArtifacts,
  seedTestStageAdvanceArtifacts,
  VALID_DELIVERY_REPORT_MARKDOWN,
  VALID_IMPLEMENTATION_REPORT_MARKDOWN,
  VALID_REVIEW_FAIL_MARKDOWN,
  VALID_REVIEW_MARKDOWN,
  validComplianceResultJson,
} from "./feature-delivery-gate-fixtures.js";
import { deliveryReportRel, durableFeatureIndexRel } from "./feature-delivery-stage-artifacts.js";
import { COMPLIANCE_AUDIT_HISTORY_REL } from "./compliance-audit-history.js";
import { loadRepoEnv } from "./repo-env.js";
import { PersonaResolveError, resolvePersona } from "./persona-resolve.js";

const JSON_FORMAT_ABBREV_ENV = "PAN_JSON_FORMAT_ABBREV_LEN";
const CANONICAL_REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../..");

type RunCliOptions = NonNullable<Parameters<typeof parseAndRun>[1]>;

async function runCli(args: string[], options?: RunCliOptions): Promise<number> {
  return parseAndRun(args, {
    ...options,
    testHooks: {
      ...options?.testHooks,
    },
  });
}

const FEATURE_DELIVERY_PERSONAS = [
  "intake-analyst",
  "product-engineer",
  "design-engineer",
  "tech-lead",
  "coder",
  "reviewer",
  "qa-tester",
  "design-reviewer",
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
    sdkSampling:
      enabled: false
`,
    "utf8",
  );
}

function mockSdkTransport(onInvoke?: () => void): CursorSdkTransport {
  const mockArtifactBody = (repoRoot: string, rel: string): string => gateFixtureBody(repoRoot, rel);
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

function gitInTestRepo(root: string, args: string[]): void {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test Runner",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test Runner",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

function initCommittedGitRepo(root: string): void {
  gitInTestRepo(root, ["init"]);
  gitInTestRepo(root, ["add", "-A"]);
  gitInTestRepo(root, ["commit", "-m", "seed"]);
}

async function completeFeatureDeliveryRunForClose(
  root: string,
  taskId: string,
  featureId: string,
  dayDir: string,
): Promise<{ activeRunDirRel: string; inboxSourceRel: string }> {
  const activeRunDirRel = `.pan/work/${dayDir}/${taskId}`;
  const activeRunDir = path.join(root, activeRunDirRel);

  await seedPlanStageAdvanceArtifacts(root, activeRunDirRel, featureId);
  await runCli(["advance", taskId, "--artifact", `${activeRunDirRel}/touch-set.json`], {
    repoRoot: root,
    writeOut: () => undefined,
  });
  await writeFile(path.join(activeRunDir, "implementation-report.md"), VALID_IMPLEMENTATION_REPORT_MARKDOWN, "utf8");
  await runCli(["advance", taskId, "--artifact", `${activeRunDirRel}/implementation-report.md`], {
    repoRoot: root,
    writeOut: () => undefined,
  });
  await writeFile(path.join(activeRunDir, "review.md"), VALID_REVIEW_MARKDOWN, "utf8");
  await runCli(["advance", taskId, "--artifact", `${activeRunDirRel}/review.md`], {
    repoRoot: root,
    writeOut: () => undefined,
  });
  await seedTestStageAdvanceArtifacts(root, activeRunDirRel);
  await runCli(["advance", taskId, "--artifact", `${activeRunDirRel}/test-report.md`], {
    repoRoot: root,
    writeOut: () => undefined,
  });
  const deliveryReportPathRel = deliveryReportRel(activeRunDirRel);
  const report = path.join(root, ...deliveryReportPathRel.split("/"));
  await writeFile(report, VALID_DELIVERY_REPORT_MARKDOWN, "utf8");
  await runCli(["advance", taskId, "--artifact", deliveryReportPathRel], {
    repoRoot: root,
    writeOut: () => undefined,
  });
  await writeFile(
    path.join(activeRunDir, "compliance-result.json"),
    validComplianceResultJson(root),
    "utf8",
  );
  await runCli(["advance", taskId, "--artifact", `${activeRunDirRel}/compliance-result.json`], {
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
  await runCli(["advance", taskId, "--artifact", `${activeRunDirRel}/ship-ratification.json`], {
    repoRoot: root,
    writeOut: () => undefined,
  });
  const inboxSourceRel = "lib/inbox/in/demo-feature.md";
  const indexRel = durableFeatureIndexRel(featureId);
  const index = path.join(root, ...indexRel.split("/"));
  await mkdir(path.dirname(index), { recursive: true });
  await writeFile(
    index,
    stringifyCliJson(root, {
      feature_id: featureId,
      task_id: taskId,
      status: "indexed",
      indexed_at: "2026-05-10T13:30:00.000Z",
      source_inbox_item: { path: inboxSourceRel },
      delivery_report: { path: deliveryReportPathRel },
    }),
    "utf8",
  );
  await runCli(["advance", taskId, "--artifact", indexRel], {
    repoRoot: root,
    writeOut: () => undefined,
  });
  expect(existsSync(activeRunDir)).toBe(true);
  expect(existsSync(path.join(root, ".pan/archive", "work", dayDir, taskId))).toBe(false);
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
    const code = await runCli(["inbox"], {
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
    const code = await runCli(["run", "feature-delivery", "demo-feature.md"], {
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
    expect(state.currentStage).toBe("plan");
    expect(state.transitions.length).toBeGreaterThan(5);
    expect(await readFile(path.join(root, msg.handoffFile), "utf8")).toContain(
      "Executor persona: tech-lead",
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
    const code = await runCli(["run", "feature-delivery", "demo-feature.md", "--format", "text"], {
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
    await runCli(["run", "feature-delivery", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => runOut.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const runMsg = JSON.parse(runOut.join("")) as { taskId: string; nextCommand: string };
    const stateBefore = await readFile(
      path.join(root, ".pan/work", "172996_05-10-26", runMsg.taskId, "state.json"),
      "utf8",
    );
    const nextOut: string[] = [];
    const code = await runCli(["next", runMsg.taskId], {
      repoRoot: root,
      writeOut: (c) => nextOut.push(c),
    });
    expect(code).toBe(0);
    const nextMsg = JSON.parse(nextOut.join("")) as { nextCommand: string; source: string };
    expect(nextMsg.nextCommand).toBe(runMsg.nextCommand);
    expect(nextMsg.source).toBe("derived");
    const stateAfter = await readFile(
      path.join(root, ".pan/work", "172996_05-10-26", runMsg.taskId, "state.json"),
      "utf8",
    );
    expect(stateAfter).toBe(stateBefore);
  });

  it("AC-P5b: persisted report-approval nextCommand survives pan status and pan next", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-report-next-cmd-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const runOut: string[] = [];
    await runCli(["run", "feature-delivery", "demo-feature.md"], {
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
    await runCli(["status", taskId], { repoRoot: root, writeOut: (c) => statusOut.push(c) });
    const statusMsg = JSON.parse(statusOut.join("")) as { nextCommand: string; source?: string };
    expect(statusMsg.nextCommand).toBe(persistedCmd);

    const nextOut: string[] = [];
    await runCli(["next", taskId], { repoRoot: root, writeOut: (c) => nextOut.push(c) });
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
    await runCli(["next", taskId, "--format", "text"], {
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
    await runCli(["run", "feature-delivery", "demo-feature.md"], {
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

    const runDirRel = `.pan/work/172996_05-10-26/${taskId}`;
    await seedPlanStageAdvanceArtifacts(root, runDirRel);

    const advanceOut: string[] = [];
    const code = await runCli(
      ["advance", taskId, "--artifact", `${runDirRel}/touch-set.json`],
      { repoRoot: root, writeOut: (c) => advanceOut.push(c) },
    );
    expect(code).toBe(0);

    const persisted = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
    expect(persisted.nextCommand).toBeUndefined();

    const statusOut: string[] = [];
    await runCli(["status", taskId], { repoRoot: root, writeOut: (c) => statusOut.push(c) });
    const statusMsg = JSON.parse(statusOut.join("")) as { nextCommand: string };
    expect(statusMsg.nextCommand).not.toContain(outboxRel);
    expect(statusMsg.nextCommand).toMatch(/implementation-report\.md/u);

    const nextOut: string[] = [];
    await runCli(["next", taskId], { repoRoot: root, writeOut: (c) => nextOut.push(c) });
    const nextMsg = JSON.parse(nextOut.join("")) as { nextCommand: string; source: string };
    expect(nextMsg.source).toBe("derived");
    expect(nextMsg.nextCommand).not.toContain(outboxRel);
    expect(nextMsg.nextCommand).toMatch(/implementation-report\.md/u);
  });

  it("records content warnings on advance in run log and CLI envelope", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-advance-warnings-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const runOut: string[] = [];
    await runCli(["run", "feature-delivery", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => runOut.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const { taskId } = JSON.parse(runOut.join("")) as { taskId: string; runLogFile: string };
    const runDirRel = `.pan/work/172996_05-10-26/${taskId}`;
    await seedPlanStageAdvanceArtifacts(root, runDirRel);
    await writeFile(path.join(root, runDirRel, "plan.md"), "# Plan only\n", "utf8");

    const advanceOut: string[] = [];
    const code = await runCli(
      ["advance", taskId, "--artifact", `${runDirRel}/touch-set.json`],
      { repoRoot: root, writeOut: (c) => advanceOut.push(c), writeErr: () => undefined },
    );
    expect(code).toBe(1);
    const advanceMsg = JSON.parse(advanceOut.join("")) as { message: string };
    expect(advanceMsg.message).toContain("Acceptance criteria");
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
    await runCli(["run", "feature-delivery", "172996_05-10-26/38670_1315_demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => runOut.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const { taskId } = JSON.parse(runOut.join("")) as { taskId: string };

    const nextTextOut: string[] = [];
    await runCli(["next", taskId, "--format", "text"], {
      repoRoot: root,
      writeOut: (c) => nextTextOut.push(c),
    });
    const nextText = nextTextOut.join("");
    expect(nextText).toContain(taskId);
    expect(nextText).toContain("2026-05-10 13:15 UTC");
    expect(nextText).toMatch(/^event: /m);

    const inboxTextOut: string[] = [];
    await runCli(["inbox", "--format", "text"], { repoRoot: root, writeOut: (c) => inboxTextOut.push(c) });
    const inboxText = inboxTextOut.join("");
    expect(inboxText).toContain("172996_05-10-26/38670_1315_demo-feature");
    expect(inboxText).toContain("2026-05-10 13:15 UTC");
  });

  it("AC-P7: pan artifacts validate exits non-zero for missing and malformed artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-artifacts-validate-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const runOut: string[] = [];
    await runCli(["run", "feature-delivery", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => runOut.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const { taskId } = JSON.parse(runOut.join("")) as { taskId: string };
    const runDirRel = `.pan/work/172996_05-10-26/${taskId}`;

    const missingOut: string[] = [];
    const missingCode = await runCli(
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
    const warnCode = await runCli(
      ["artifacts", "validate", taskId, "--stage", "review"],
      { repoRoot: root, writeOut: (c) => warnOut.push(c) },
    );
    expect(warnCode).toBe(1);
    const warnMsg = JSON.parse(warnOut.join("")) as { warningCount: number; missing: string[] };
    expect(warnMsg.warningCount).toBe(1);
    expect(warnMsg.missing).toEqual([]);

    await writeFile(path.join(root, runDirRel, "review.md"), VALID_REVIEW_MARKDOWN, "utf8");
    const cleanOut: string[] = [];
    const cleanCode = await runCli(
      ["artifacts", "validate", taskId, "--stage", "review"],
      { repoRoot: root, writeOut: (c) => cleanOut.push(c) },
    );
    expect(cleanCode).toBe(0);
    const cleanMsg = JSON.parse(cleanOut.join("")) as { warningCount: number; status: string };
    expect(cleanMsg.warningCount).toBe(0);
    expect(cleanMsg.status).toBe("ok");

    await seedPlanStageAdvanceArtifacts(root, runDirRel);
    await writeFile(path.join(root, runDirRel, "plan.md"), "# Plan\n\nno headings\n", "utf8");
    const planWarnOut: string[] = [];
    const planWarnCode = await runCli(
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
    await runCli(["run", "feature-delivery", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => runOut.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const { taskId } = JSON.parse(runOut.join("")) as { taskId: string };
    const statusOut: string[] = [];
    const code = await runCli(["status", taskId, "--format", "text"], {
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
    const runDirRel = ".pan/work/172996_05-10-26/38670_1315_demo-feature";
    const runDir = path.join(root, runDirRel);
    await mkdir(runDir, { recursive: true });
    await writeFile(
      path.join(runDir, "review.md"),
      "review_passes: true\nscope_amendments_ratified: true\n",
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
    expect(step.nextCommand).toMatch(/--artifact \.pan\/work\/172996_05-10-26\/38670_1315_demo-feature\/review\.md/u);
    expect(step.nextCommand).not.toContain("implementation-report.md");

    const nextOut: string[] = [];
    const code = await runCli(["next", state.taskId], { repoRoot: root, writeOut: (c) => nextOut.push(c) });
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
    await runCli(["run", "feature-delivery", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => runOut.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const { taskId } = JSON.parse(runOut.join("")) as { taskId: string; nextCommand?: string };
    const runDirRel = `.pan/work/172996_05-10-26/${taskId}`;
    await seedPlanStageAdvanceArtifacts(root, runDirRel);

    const advanceOut: string[] = [];
    const code = await runCli(
      ["advance", taskId, "--artifact", `${runDirRel}/touch-set.json`, "--format", "text"],
      {
        repoRoot: root,
        writeOut: (c) => advanceOut.push(c),
      },
    );
    expect(code).toBe(0);
    const text = advanceOut.join("");
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
    const code = await runCli(["check", "--format", "json"], {
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

  it("pan check reports validation pass/fail without mutating the repo", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-check-"));
    await mkdir(path.join(root, "lib", "memory", "active"), { recursive: true });
    await writeFile(
      path.join(root, "lib", "memory", "active", "current.md"),
      "## Most recent shipped Features\n\n| Feature | Shipped at (UTC) | Delivery report | Outbox artifact | Archived source |\n|---|---|---|---|---|\n| `—` | `—` | `—` | `—` | `—` |\n",
      "utf8",
    );
    await writeFile(path.join(root, ".cursorindexingignore"), ".pan/work/**\n", "utf8");
    const out: string[] = [];
    const code = await runCli(["check", "--format", "json"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
    });
    expect(code).not.toBe(0);
    const result = JSON.parse(out.join("")) as PanCheckResult;
    expect(result.command).toBe("check");
    expect(result.failCount).toBeGreaterThan(0);
  });

  it("pan lint runs lint then typecheck and returns the failing step exit code", async () => {
    const steps: string[] = [];
    const out: string[] = [];
    const code = await runCli(["lint"], {
      repoRoot: CANONICAL_REPO_ROOT,
      writeOut: (c) => out.push(c),
      validationHooks: {
        runStep: (_root, step) => {
          steps.push(step.id);
          return step.id === "typecheck" ? 17 : 0;
        },
      },
    });
    expect(code).toBe(17);
    expect(steps).toEqual(["lint", "typecheck"]);
    const result = JSON.parse(out.join("")) as { command: string; status: string; failedStep?: string };
    expect(result.command).toBe("lint");
    expect(result.status).toBe("fail");
    expect(result.failedStep).toBe("typecheck");
  });

  it("pan test runs pnpm test then repo mjs tests", async () => {
    const steps: string[] = [];
    const out: string[] = [];
    const code = await runCli(["test"], {
      repoRoot: CANONICAL_REPO_ROOT,
      writeOut: (c) => out.push(c),
      validationHooks: {
        runStep: (_root, step) => {
          steps.push(step.id);
          return 0;
        },
      },
    });
    expect(code).toBe(0);
    expect(steps).toEqual(["test", "tests-mjs"]);
    const result = JSON.parse(out.join("")) as { command: string; status: string };
    expect(result.command).toBe("test");
    expect(result.status).toBe("ok");
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
    const code = await runCli(
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
    await runCli(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const startRaw = out.join("");
    expect(startRaw).toMatch(/^\{\n {2}"command": "feature new",\n/u);
    const start = JSON.parse(startRaw) as { taskId: string; stateFile: string; nextPromptFile: string };
    expect(start.nextPromptFile).toContain("next-prompt.md");

    const runDirRel = path.posix.dirname(start.stateFile);
    await seedPlanStageAdvanceArtifacts(root, runDirRel);

    const advanceOut: string[] = [];
    const code = await runCli(
      ["advance", start.taskId, "--artifact", `${runDirRel}/touch-set.json`],
      { repoRoot: root, writeOut: (c) => advanceOut.push(c) },
    );
    expect(code).toBe(0);
    const advanced = JSON.parse(advanceOut.join("")) as { currentStage: string; nextPromptFile: string };
    expect(advanced.currentStage).toBe("implement");
    expect(await readFile(path.join(root, advanced.nextPromptFile), "utf8")).toContain("Use subagent/persona: coder");

    const duplicateOut: string[] = [];
    const duplicateCode = await runCli(
      ["advance", start.taskId, "--artifact", `${runDirRel}/touch-set.json`],
      { repoRoot: root, writeOut: (c) => duplicateOut.push(c), writeErr: () => undefined },
    );
    expect(duplicateCode).toBe(1);
    expect(duplicateOut.join("")).toContain("not valid for implement");
  });

  it("reports invalid task-id format with a suggested canonical id during advance", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-advance-hint-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await runCli(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });

    const start = JSON.parse(out.join("")) as { taskId: string };
    const runDirRel = `.pan/work/172996_05-10-26/${start.taskId}`;
    await seedPlanStageAdvanceArtifacts(root, runDirRel);

    const invalidOut: string[] = [];
    const invalidCode = await runCli(
      ["advance", "000200_demo-feature", "--artifact", `${runDirRel}/touch-set.json`],
      { repoRoot: root, writeOut: (c) => invalidOut.push(c), writeErr: () => undefined },
    );
    expect(invalidCode).toBe(1);
    const payload = JSON.parse(invalidOut.join("")) as { message: string };
    expect(payload.message).toContain("task id MUST match <seconds-to-midnight>_<HHMM>_<slug>.");
    expect(payload.message).toContain(`Did you mean ${start.taskId}?`);
  });

  it("reports invalid task-id format without hint when no slug match exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-advance-no-hint-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    await runCli(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: () => undefined,
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });

    const runDirRel = ".pan/work/172996_05-10-26/38670_1315_demo-feature";
    await seedPlanStageAdvanceArtifacts(root, runDirRel);

    const invalidOut: string[] = [];
    const invalidCode = await runCli(
      ["advance", "000200_unknown-feature", "--artifact", `${runDirRel}/touch-set.json`],
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
    await runCli(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string; stateFile: string };
    const review = path.join(root, ".pan/work", "172996_05-10-26", start.taskId, "review.md");
    await mkdir(path.dirname(review), { recursive: true });
    await writeFile(review, "# Review\n\nManual out-of-band review evidence.", "utf8");

    const repairOut: string[] = [];
    const code = await runCli(
      [
        "repair-state",
        start.taskId,
        "--stage",
        "review",
        "--artifact",
        `.pan/work/172996_05-10-26/${start.taskId}/review.md`,
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
    await runCli(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string; stateFile: string };
    const runDirRel = `.pan/work/172996_05-10-26/${start.taskId}`;
    const runDir = path.join(root, runDirRel);
    await seedPlanStageAdvanceArtifacts(root, runDirRel);
    await runCli(["advance", start.taskId, "--artifact", `${runDirRel}/touch-set.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(runDir, "implementation-report.md"), VALID_IMPLEMENTATION_REPORT_MARKDOWN, "utf8");
    await runCli(["advance", start.taskId, "--artifact", `${runDirRel}/implementation-report.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(runDir, "review.md"), VALID_REVIEW_FAIL_MARKDOWN, "utf8");
    await runCli(
      ["advance", start.taskId, "--event", "must_fix", "--artifact", `${runDirRel}/review.md`],
      { repoRoot: root, writeOut: () => undefined },
    );

    const handoffAfterMustFix = await readFile(path.join(root, `${runDirRel}/handoff.md`), "utf8");
    expect(handoffAfterMustFix).not.toContain("chain to test in one step");
    expect(handoffAfterMustFix).toContain("implementation-report.md");

    await writeFile(path.join(runDir, "review.md"), VALID_REVIEW_MARKDOWN, "utf8");
    const reentryOut: string[] = [];
    await runCli(["advance", start.taskId, "--artifact", `${runDirRel}/review.md`], {
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

  it("must_fix reentry chains to test when gate artifacts are valid", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-review-reentry-warnings-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await runCli(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string; stateFile: string };
    const runDirRel = `.pan/work/172996_05-10-26/${start.taskId}`;
    const runDir = path.join(root, runDirRel);
    await seedPlanStageAdvanceArtifacts(root, runDirRel);
    await runCli(["advance", start.taskId, "--artifact", `${runDirRel}/touch-set.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(runDir, "implementation-report.md"), VALID_IMPLEMENTATION_REPORT_MARKDOWN, "utf8");
    await runCli(["advance", start.taskId, "--artifact", `${runDirRel}/implementation-report.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(runDir, "review.md"), VALID_REVIEW_FAIL_MARKDOWN, "utf8");
    await runCli(
      ["advance", start.taskId, "--event", "must_fix", "--artifact", `${runDirRel}/review.md`],
      { repoRoot: root, writeOut: () => undefined },
    );

    await writeFile(path.join(runDir, "review.md"), VALID_REVIEW_MARKDOWN, "utf8");
    const reentryOut: string[] = [];
    const code = await runCli(["advance", start.taskId, "--artifact", `${runDirRel}/review.md`], {
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
    expect(reentry.warningCount).toBe(0);
    expect(reentry.currentStage).toBe("test");
  });

  it("must_fix reentry rejects implementation-report without gate proof", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-review-reentry-gate-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await runCli(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string };
    const runDirRel = `.pan/work/172996_05-10-26/${start.taskId}`;
    const runDir = path.join(root, runDirRel);
    await seedPlanStageAdvanceArtifacts(root, runDirRel);
    await runCli(["advance", start.taskId, "--artifact", `${runDirRel}/touch-set.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(runDir, "implementation-report.md"), VALID_IMPLEMENTATION_REPORT_MARKDOWN, "utf8");
    await runCli(["advance", start.taskId, "--artifact", `${runDirRel}/implementation-report.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(runDir, "review.md"), VALID_REVIEW_FAIL_MARKDOWN, "utf8");
    await runCli(
      ["advance", start.taskId, "--event", "must_fix", "--artifact", `${runDirRel}/review.md`],
      { repoRoot: root, writeOut: () => undefined },
    );

    await writeFile(
      path.join(runDir, "implementation-report.md"),
      "# Impl only\nno second-level heading\n",
      "utf8",
    );
    await writeFile(path.join(runDir, "review.md"), VALID_REVIEW_MARKDOWN, "utf8");
    const reentryOut: string[] = [];
    const code = await runCli(["advance", start.taskId, "--artifact", `${runDirRel}/review.md`], {
      repoRoot: root,
      writeOut: (c) => reentryOut.push(c),
      writeErr: () => undefined,
    });
    expect(code).toBe(1);
    const failure = JSON.parse(reentryOut.join("")) as { message: string };
    expect(failure.message).toMatch(/implement_gate_passes|Automated checks/u);
  });

  it("delegates final artifact closure to librarian for complete feature-delivery runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-complete-prompt-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await runCli(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string; nextPromptFile: string };
    const runDir = path.join(root, ".pan/work", "172996_05-10-26", start.taskId);

    await seedPlanStageAdvanceArtifacts(root, `.pan/work/172996_05-10-26/${start.taskId}`);
    await runCli(["advance", start.taskId, "--artifact", `.pan/work/172996_05-10-26/${start.taskId}/touch-set.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    await writeFile(path.join(runDir, "implementation-report.md"), VALID_IMPLEMENTATION_REPORT_MARKDOWN, "utf8");
    await runCli(["advance", start.taskId, "--artifact", `.pan/work/172996_05-10-26/${start.taskId}/implementation-report.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    await writeFile(path.join(runDir, "review.md"), VALID_REVIEW_MARKDOWN, "utf8");
    await runCli(["advance", start.taskId, "--artifact", `.pan/work/172996_05-10-26/${start.taskId}/review.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    await seedTestStageAdvanceArtifacts(root, `.pan/work/172996_05-10-26/${start.taskId}`);
    await runCli(["advance", start.taskId, "--artifact", `.pan/work/172996_05-10-26/${start.taskId}/test-report.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    const runDirRel = `.pan/work/172996_05-10-26/${start.taskId}`;
    const deliveryReportPathRel = deliveryReportRel(runDirRel);

    const report = path.join(root, ...deliveryReportPathRel.split("/"));
    await writeFile(report, VALID_DELIVERY_REPORT_MARKDOWN, "utf8");
    await runCli(["advance", start.taskId, "--artifact", deliveryReportPathRel], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(
      path.join(runDir, "compliance-result.json"),
      validComplianceResultJson(root),
      "utf8",
    );
    await runCli(["advance", start.taskId, "--artifact", `.pan/work/172996_05-10-26/${start.taskId}/compliance-result.json`], {
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
    await runCli(["advance", start.taskId, "--artifact", `.pan/work/172996_05-10-26/${start.taskId}/ship-ratification.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    const indexRel = durableFeatureIndexRel("demo-feature");
    const index = path.join(root, ...indexRel.split("/"));
    await mkdir(path.dirname(index), { recursive: true });
    await writeFile(index, "{}\n", "utf8");
    const completeOut: string[] = [];
    const completeCode = await runCli(["advance", start.taskId, "--artifact", indexRel], {
      repoRoot: root,
      writeOut: (c) => completeOut.push(c),
    });
    if (completeCode !== 0) {
      throw new Error(`index advance failed (${completeCode}): ${completeOut.join("")}`);
    }
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
    await runCli(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string };
    const activeRunDirRel = `.pan/work/172996_05-10-26/${start.taskId}`;
    const activeRunDir = path.join(root, activeRunDirRel);
    await seedPlanStageAdvanceArtifacts(root, activeRunDirRel);
    await runCli(["advance", start.taskId, "--artifact", `${activeRunDirRel}/touch-set.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(activeRunDir, "implementation-report.md"), VALID_IMPLEMENTATION_REPORT_MARKDOWN, "utf8");
    await runCli(["advance", start.taskId, "--artifact", `${activeRunDirRel}/implementation-report.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(activeRunDir, "review.md"), VALID_REVIEW_MARKDOWN, "utf8");
    await runCli(["advance", start.taskId, "--artifact", `${activeRunDirRel}/review.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await seedTestStageAdvanceArtifacts(root, activeRunDirRel);
    await runCli(["advance", start.taskId, "--artifact", `${activeRunDirRel}/test-report.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    const runDirRel = `.pan/work/172996_05-10-26/${start.taskId}`;
    const deliveryReportPathRel = deliveryReportRel(runDirRel);

    const report = path.join(root, ...deliveryReportPathRel.split("/"));
    await writeFile(report, VALID_DELIVERY_REPORT_MARKDOWN, "utf8");
    await runCli(["advance", start.taskId, "--artifact", deliveryReportPathRel], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(
      path.join(activeRunDir, "compliance-result.json"),
      validComplianceResultJson(root),
      "utf8",
    );
    await runCli(["advance", start.taskId, "--artifact", `${activeRunDirRel}/compliance-result.json`], {
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
    await runCli(["advance", start.taskId, "--artifact", `${activeRunDirRel}/ship-ratification.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    const indexRel = durableFeatureIndexRel("demo-feature");
    const index = path.join(root, ...indexRel.split("/"));
    const inboxSourceRel = "lib/inbox/in/demo-feature.md";
    await mkdir(path.dirname(index), { recursive: true });
    await writeFile(
      index,
      stringifyCliJson(root, {
        feature_id: "demo-feature",
        task_id: start.taskId,
        status: "indexed",
        indexed_at: "2026-05-10T13:30:00.000Z",
        source_inbox_item: { path: inboxSourceRel },
        delivery_report: { path: deliveryReportPathRel },
      }),
      "utf8",
    );
    await runCli(["advance", start.taskId, "--artifact", indexRel], {
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
    await mkdir(path.dirname(path.join(root, COMPLIANCE_AUDIT_HISTORY_REL)), { recursive: true });
    await writeFile(
      path.join(root, COMPLIANCE_AUDIT_HISTORY_REL),
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
    const code = await runCli(["close-artifacts", start.taskId], {
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
    expect(closed.archivedRunDir).toBe(`.pan/archive/work/172996_05-10-26/${start.taskId}`);
    expect(closed.archivedInboxPath).toBe(`.pan/archive/inbox/in/172996_05-10-26/demo-feature.md`);
    expect(closed.activeMemoryPath).toBe("lib/memory/active/current.md");
    expect(closed.activeFeatureCleared).toBe(true);

    const indexAfterClose = JSON.parse(await readFile(index, "utf8")) as {
      source_inbox_item: string;
      source_inbox_item_prior?: string;
    };
    expect(indexAfterClose.source_inbox_item).toBe(closed.archivedInboxPath);

    const currentMd = await readFile(path.join(root, "lib", "memory", "active", "current.md"), "utf8");
    expect(currentMd).toContain("- `(none)`");
    expect(currentMd).not.toContain(inboxSourceRel);
    expect(currentMd).toContain(closed.archivedInboxPath);
    expect(currentMd).toContain("2026-05-10T14:00:00.000Z");

    expect(existsSync(path.join(root, "lib", "inbox", "in", "demo-feature.md"))).toBe(false);
    expect(existsSync(path.join(root, activeRunDirRel))).toBe(false);
    expect(existsSync(path.join(root, ".pan/work", "172996_05-10-26"))).toBe(false);
    expect(existsSync(path.join(root, closed.archivedInboxPath))).toBe(true);
    expect(existsSync(path.join(root, closed.stateFile))).toBe(true);
    const complianceHistoryAfterClose = JSON.parse(
      await readFile(path.join(root, COMPLIANCE_AUDIT_HISTORY_REL), "utf8"),
    ) as {
      entries: Array<{ artifact_paths?: { compliance_result?: string; run_dir?: string } }>;
    };
    expect(complianceHistoryAfterClose.entries[0]?.artifact_paths?.run_dir).toBe(
      `.pan/archive/work/172996_05-10-26/${start.taskId}`,
    );
    expect(complianceHistoryAfterClose.entries[0]?.artifact_paths?.compliance_result).toBe(
      `.pan/archive/work/172996_05-10-26/${start.taskId}/compliance-result.json`,
    );

    const statusOut: string[] = [];
    await runCli(["status", start.taskId], { repoRoot: root, writeOut: (c) => statusOut.push(c) });
    const status = JSON.parse(statusOut.join("")) as { pipelineStatus: string; runDir: string };
    expect(status.pipelineStatus).toBe("closed");
    expect(status.runDir).toBe(closed.archivedRunDir);

    const statusTextOut: string[] = [];
    await runCli(["status", start.taskId, "--format", "text"], {
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
    await runCli(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string };
    await completeFeatureDeliveryRunForClose(root, start.taskId, "demo-feature", "172996_05-10-26");
    const activeRunDirRel = `.pan/work/172996_05-10-26/${start.taskId}`;
    await (await import("node:fs/promises")).unlink(path.join(root, activeRunDirRel, "operator-verification.md"));

    const closeOut: string[] = [];
    const code = await runCli(["close-artifacts", start.taskId], {
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
    await runCli(["feature", "new", "demo-feature.md"], {
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
    const closeCode = await runCli(["close-artifacts", start.taskId], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    expect(closeCode).toBe(0);

    const reopenOut: string[] = [];
    const code = await runCli(
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
    expect(reopened.currentStage).toBe("plan");
    expect(reopened.runDir).toBe(`.pan/work/${dayDir}/${start.taskId}`);
    expect(existsSync(path.join(root, reopened.runDir, "state.json"))).toBe(true);
    expect(existsSync(path.join(root, ".pan/archive", "work", dayDir, start.taskId))).toBe(false);
  });

  it("report advance rejects JS-literal delivery-report citations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-report-citation-lint-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await runCli(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string };
    const activeRunDirRel = `.pan/work/172996_05-10-26/${start.taskId}`;
    const activeRunDir = path.join(root, activeRunDirRel);
    await seedPlanStageAdvanceArtifacts(root, activeRunDirRel);
    await runCli(["advance", start.taskId, "--artifact", `${activeRunDirRel}/touch-set.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(activeRunDir, "implementation-report.md"), VALID_IMPLEMENTATION_REPORT_MARKDOWN, "utf8");
    await runCli(["advance", start.taskId, "--artifact", `${activeRunDirRel}/implementation-report.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(activeRunDir, "review.md"), VALID_REVIEW_MARKDOWN, "utf8");
    await runCli(["advance", start.taskId, "--artifact", `${activeRunDirRel}/review.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await seedTestStageAdvanceArtifacts(root, activeRunDirRel);
    await runCli(["advance", start.taskId, "--artifact", `${activeRunDirRel}/test-report.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    const deliveryReportPathRel = deliveryReportRel(activeRunDirRel);
    const report = path.join(root, ...deliveryReportPathRel.split("/"));
    await writeFile(
      report,
      "# Delivery\n\nBad citation {kind: lines, path: .pan/work/example.md, range: [1, 2], contentHash: abc}\n",
      "utf8",
    );
    const advanceOut: string[] = [];
    const code = await runCli(
      ["advance", start.taskId, "--artifact", deliveryReportPathRel],
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
    await runCli(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string; currentStage: string };
    const runDirRel = `.pan/work/172996_05-10-26/${start.taskId}`;
    const runDir = path.join(root, runDirRel);
    await seedPlanStageAdvanceArtifacts(root, runDirRel);
    await runCli(["advance", start.taskId, "--artifact", `${runDirRel}/touch-set.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(runDir, "implementation-report.md"), VALID_IMPLEMENTATION_REPORT_MARKDOWN, "utf8");
    await runCli(["advance", start.taskId, "--artifact", `${runDirRel}/implementation-report.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await writeFile(path.join(runDir, "review.md"), VALID_REVIEW_MARKDOWN, "utf8");
    await runCli(["advance", start.taskId, "--artifact", `${runDirRel}/review.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    await seedTestStageAdvanceArtifacts(root, `.pan/work/172996_05-10-26/${start.taskId}`);
    await runCli(["advance", start.taskId, "--artifact", `${runDirRel}/test-report.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    const deliveryReportPathRel = deliveryReportRel(runDirRel);
    const report = path.join(root, ...deliveryReportPathRel.split("/"));
    await writeFile(report, VALID_DELIVERY_REPORT_MARKDOWN, "utf8");
    const reportAdvanceOut: string[] = [];
    const reportCode = await runCli(
      ["advance", start.taskId, "--artifact", deliveryReportPathRel],
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
      validComplianceResultJson(root),
      "utf8",
    );
    const complianceAdvanceOut: string[] = [];
    const complianceCode = await runCli(
      ["advance", start.taskId, "--artifact", `${runDirRel}/compliance-result.json`],
      { repoRoot: root, writeOut: (c) => complianceAdvanceOut.push(c) },
    );
    expect(complianceCode).toBe(0);
    const complianceAdvance = JSON.parse(complianceAdvanceOut.join("")) as { currentStage: string };
    expect(complianceAdvance.currentStage).toBe("ship");

    await writeFile(path.join(runDir, "ship-ratification.json"), "{}\n", "utf8");
    const shipAdvanceOut: string[] = [];
    const shipCode = await runCli(
      ["advance", start.taskId, "--artifact", `${runDirRel}/ship-ratification.json`],
      { repoRoot: root, writeOut: (c) => shipAdvanceOut.push(c), writeErr: () => undefined },
    );
    expect(shipCode).toBe(1);
    const shipFailure = JSON.parse(shipAdvanceOut.join("")) as { message: string };
    expect(shipFailure.message).toContain("Cannot advance ship");
    expect(shipFailure.message).toMatch(/ship-ratification|human_ratified_diff|task_id/u);
  });

  it("close-artifacts finalizes a prematurely archived run idempotently", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-close-artifacts-idempotent-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await runCli(["feature", "new", "demo-feature.md"], {
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
    const archiveRunDirRel = `.pan/archive/work/${dayDir}/${start.taskId}`;
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
    const code = await runCli(["close-artifacts", start.taskId], {
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
    await runCli(["feature", "new", "demo-feature.md"], {
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
    const closeCode = await runCli(["close-artifacts", start.taskId], {
      repoRoot: root,
      writeOut: (c) => closeOut.push(c),
      clock: () => new Date("2026-05-10T14:00:00.000Z"),
    });
    expect(closeCode).toBe(1);
    const payload = JSON.parse(closeOut.join("")) as { message: string };
    expect(payload.message).toContain("Heading \"## Active Feature\" is missing from current.md");
    const archivedRunDirRel = `.pan/archive/work/${dayDir}/${start.taskId}`;
    const archivedInboxRel = `.pan/archive/inbox/in/${dayDir}/demo-feature.md`;
    expect(existsSync(path.join(root, activeRunDirRel))).toBe(true);
    expect(existsSync(path.join(root, inboxSourceRel))).toBe(true);
    expect(existsSync(path.join(root, archivedRunDirRel))).toBe(false);
    expect(existsSync(path.join(root, archivedInboxRel))).toBe(false);

    const statusOut: string[] = [];
    await runCli(["status", start.taskId], { repoRoot: root, writeOut: (c) => statusOut.push(c) });
    const status = JSON.parse(statusOut.join("")) as { pipelineStatus: string; runDir: string };
    expect(status.pipelineStatus).toBe("complete");
    expect(status.runDir).toBe(activeRunDirRel);
  });

  it("refreshes shipped-feature rows on close even when active feature was already none", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-close-artifacts-refresh-shipped-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await runCli(["feature", "new", "demo-feature.md"], {
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
    const code = await runCli(["close-artifacts", start.taskId], {
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
    await runCli(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string; nextPromptFile: string };
    const nextPromptAbs = path.join(root, start.nextPromptFile);
    await writeFile(nextPromptAbs, "stale prompt", "utf8");

    const refreshOut: string[] = [];
    const code = await runCli(["refresh-prompt", start.taskId], {
      repoRoot: root,
      writeOut: (c) => refreshOut.push(c),
    });
    expect(code).toBe(0);
    const refreshed = JSON.parse(refreshOut.join("")) as { command: string; currentStage: string };
    expect(refreshed.command).toBe("refresh-prompt");
    expect(refreshed.currentStage).toBe("plan");
    expect(await readFile(nextPromptAbs, "utf8")).toContain("Use subagent/persona: tech-lead");
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
    await runCli(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const start = JSON.parse(out.join("")) as { taskId: string; runLogFile: string };
    await runCli(["pause", start.taskId], { repoRoot: root, writeOut: () => undefined });

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
    await runCli(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const taskId = (JSON.parse(out.join("")) as { taskId: string }).taskId;
    await runCli(["pause", taskId], { repoRoot: root, writeOut: () => undefined });
    const statusOut: string[] = [];
    const code = await runCli(["status", taskId], {
      repoRoot: root,
      writeOut: (c) => statusOut.push(c),
    });
    expect(code).toBe(0);
    const status = JSON.parse(statusOut.join("")) as { interventionState: string; currentStage: string };
    expect(status.currentStage).toBe("plan");
    expect(status.interventionState).toBe("paused");
  });

  it("appends a pause record under .pan/scheduler/interventions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-cli2-"));
    const out: string[] = [];
    const code = await runCli(["pause", "task-a"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
    });
    expect(code).toBe(0);
    const journal = path.join(root, ".pan", "scheduler", "interventions", "task-a.jsonl");
    const raw = await readFile(journal, "utf8");
    expect(raw).toContain('"command":"pause"');
  });

  it("returns 1 on unknown command", async () => {
    const code = await runCli(["not-a-real-command"], {
      repoRoot: os.tmpdir(),
      writeOut: () => {},
      writeErr: () => {},
    });
    expect(code).toBe(1);
  });

  it("auto-records paired-test amendments during implement advance", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-auto-amend-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await runCli(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const { taskId } = JSON.parse(out.join("")) as { taskId: string };
    const runDirRel = `.pan/work/172996_05-10-26/${taskId}`;
    const runDir = path.join(root, runDirRel);
    await seedPlanStageAdvanceArtifacts(root, runDirRel);
    await mkdir(path.join(root, "client"), { recursive: true });
    await writeFile(path.join(root, "client", "foo.ts"), "export const foo = 1;\n", "utf8");
    await runCli(["advance", taskId, "--artifact", `${runDirRel}/touch-set.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    initCommittedGitRepo(root);

    await writeFile(path.join(root, "client", "foo.ts"), "export const foo = 2;\n", "utf8");
    await writeFile(path.join(root, "client", "foo.test.ts"), "it('works', () => {});\n", "utf8");
    await writeFile(
      path.join(runDir, "implementation-report.md"),
      VALID_IMPLEMENTATION_REPORT_MARKDOWN,
      "utf8",
    );

    const code = await runCli(["advance", taskId, "--artifact", `${runDirRel}/implementation-report.md`], {
      repoRoot: root,
      writeOut: () => undefined,
      writeErr: () => undefined,
    });
    expect(code).toBe(0);

    const touchSet = JSON.parse(await readFile(path.join(runDir, "touch-set.json"), "utf8")) as {
      amendments?: Array<{ path?: string; kind?: string; reason?: string }>;
    };
    expect(touchSet.amendments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "client/foo.test.ts",
          kind: "paired-test",
        }),
      ]),
    );
    const implementationReport = await readFile(
      path.join(runDir, "implementation-report.md"),
      "utf8",
    );
    expect(implementationReport).toContain("client/foo.test.ts(paired-test:");
  });

  it("blocks review advance when undeclared repo-wide changes remain in the local diff", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-review-scope-"));
    await seedFeatureDeliveryRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "demo-feature.md"), "# Demo Feature", "utf8");
    const out: string[] = [];
    await runCli(["feature", "new", "demo-feature.md"], {
      repoRoot: root,
      writeOut: (c) => out.push(c),
      clock: () => new Date("2026-05-10T13:15:30.000Z"),
    });
    const { taskId } = JSON.parse(out.join("")) as { taskId: string };
    const runDirRel = `.pan/work/172996_05-10-26/${taskId}`;
    const runDir = path.join(root, runDirRel);
    await seedPlanStageAdvanceArtifacts(root, runDirRel);
    await mkdir(path.join(root, "client"), { recursive: true });
    await mkdir(path.join(root, "lib", "memory"), { recursive: true });
    await writeFile(path.join(root, "client", "foo.ts"), "export const foo = 1;\n", "utf8");
    await runCli(["advance", taskId, "--artifact", `${runDirRel}/touch-set.json`], {
      repoRoot: root,
      writeOut: () => undefined,
    });
    initCommittedGitRepo(root);

    await writeFile(path.join(root, "client", "foo.ts"), "export const foo = 2;\n", "utf8");
    await writeFile(
      path.join(runDir, "implementation-report.md"),
      VALID_IMPLEMENTATION_REPORT_MARKDOWN,
      "utf8",
    );
    await runCli(["advance", taskId, "--artifact", `${runDirRel}/implementation-report.md`], {
      repoRoot: root,
      writeOut: () => undefined,
    });

    await writeFile(path.join(root, "lib", "memory", "unexpected.md"), "# unexpected\n", "utf8");
    await writeFile(path.join(runDir, "review.md"), VALID_REVIEW_MARKDOWN, "utf8");
    const reviewOut: string[] = [];
    const reviewErr: string[] = [];
    const code = await runCli(["advance", taskId, "--artifact", `${runDirRel}/review.md`], {
      repoRoot: root,
      writeOut: (c) => reviewOut.push(c),
      writeErr: (c) => reviewErr.push(c),
    });
    expect(code).toBe(1);
    expect(`${reviewOut.join("")}\n${reviewErr.join("")}`).toContain("absent from touch-set.json");
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
    const code = await runCli(["init", "--dry-run"], {
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
    const code = await runCli(["init", "--apply"], {
      repoRoot: root,
      writeOut: () => {},
      writeErr: () => {},
    });
    expect(code).toBe(1);
  });

  it("create-pancreator scaffolds an empty project directory", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "pan-create-parent-"));
    const out: string[] = [];
    const code = await runCli(["create-pancreator", "demo"], {
      repoRoot: parent,
      writeOut: (c) => out.push(c),
    });
    expect(code).toBe(0);
    const msg = JSON.parse(out.join("")) as { command: string; targetDir: string };
    expect(msg.command).toBe("create-pancreator");
    expect(existsSync(path.join(msg.targetDir, "pancreator.yaml"))).toBe(true);
  });

  it("exits 125 with deferred envelopes for still-deferred verbs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-deferred-"));
    const batchTracking =
      "lib/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md";
    const matrix: Array<{ argv: string[]; tracking: string }> = [
      { argv: ["run", "not-a-pipeline"], tracking: batchTracking },
      { argv: ["status"], tracking: batchTracking },
    ];
    for (const { argv, tracking } of matrix) {
      const out: string[] = [];
      const code = await runCli(argv, { repoRoot: root, writeOut: (c) => out.push(c) });
      expect(code).toBe(PAN_DEFERRED_EXIT_CODE);
      const env = JSON.parse(out.join("")) as Record<string, unknown>;
      expect(env.status).toBe("deferred");
      expect(typeof env.manual_workaround).toBe("string");
      expect(env.milestone).toMatch(/^M[123]$/u);
      expect(env.tracking_intake).toBe(tracking);
    }
  });

  it("writes pan intake new output with utc bucket prefixes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-intake-"));
    await seedMinimalWorkspace(root);
    const stamp = new Date(Date.UTC(2026, 0, 2, 0, 3, 4));
    const out: string[] = [];
    await runCli(["intake", "new", "demo-slug"], {
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
    await runCli(["intake", "new", "late-day"], {
      repoRoot: root,
      writeOut: (c) => outLate.push(c),
      clock: () => new Date(Date.UTC(2026, 4, 10, 23, 59, 59)),
    });
    const latePath = (JSON.parse(outLate.join("")) as { path: string }).path;
    expect(latePath).toMatch(/\/1_2359_late-day\.md$/);

    const outFresh: string[] = [];
    await runCli(["intake", "new", "new-day"], {
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
    await mkdir(path.join(root, ".pan/archive", "inbox", "in", bucket), { recursive: true });
    const out: string[] = [];
    const code = await runCli(
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
    await runCli(
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
    const missingPromptCode = await runCli(
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
    const missingPlanCode = await runCli(
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
    await runCli(
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
    await runCli(
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
      ".pan/archive/inbox/in/172980_05-26-26/24959_1704_ci-best-practices-batch/71701_0613_ci-best-practices-batch.md";
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
        delivery_report: { path: "lib/memory/features/quality-governance/ci-best-practices-batch/index.json" },
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
    const code = await runCli(["refresh-active-memory", "--dry-run"], {
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
    const code = await runCli(["refresh-active-memory", "--dry-run"], {
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
    const code = await runCli(["refresh-active-memory", "--dry-run"], {
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
    const code = await runCli(["refresh-active-memory"], {
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
    const code = await runCli(["refresh-active-memory"], {
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
    const code = await runCli(["refresh-active-memory"], {
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

    it(
      "invokes CursorRunner once on sdk run and advance",
      async () => {
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
      const code = await runCli(["run", "feature-delivery", "demo-feature.md"], {
        repoRoot: root,
        writeOut: (c) => out.push(c),
        clock: () => new Date("2026-05-10T13:15:30.000Z"),
      });
      expect(code).toBe(0);
      expect(invokeCount).toBe(0);
      const start = JSON.parse(out.join("")) as { taskId: string; runLogFile: string };
      await writeRunnerInvocationConfig(root, "sdk");
      invokeCount = 0;
      const runDirRel = `.pan/work/172996_05-10-26/${start.taskId}`;
      await seedPlanStageAdvanceArtifacts(root, runDirRel);
      const advanceCode = await runCli(
        ["advance", start.taskId, "--artifact", `${runDirRel}/touch-set.json`],
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
      },
      120_000,
    );

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
        testHooks: {},
      });
      await writeRunnerInvocationConfig(root, "sdk");
      const taskId = start.taskId;
      const featureId = start.featureId;
      const runDir = start.runDir;

      await seedPlanStageAdvanceArtifacts(root, runDir, featureId);

      const artifactForStage = (stage: string): string => {
        switch (stage) {
          case "plan":
            return `${runDir}/touch-set.json`;
          case "implement":
            return `${runDir}/implementation-report.md`;
          case "review":
            return `${runDir}/review.md`;
          case "test":
            return `${runDir}/test-report.md`;
          case "report":
            return deliveryReportRel(runDir);
          case "compliance":
            return `${runDir}/compliance-result.json`;
          case "ship":
            return `${runDir}/ship-ratification.json`;
          case "index":
            return durableFeatureIndexRel(featureId);
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
        if (currentStage === "test") {
          await seedTestStageAdvanceArtifacts(root, runDir);
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
      const code = await runCli(["run", "feature-delivery", "demo-feature.md"], {
        repoRoot: root,
        writeOut: (c) => out.push(c),
        clock: () => new Date("2026-05-10T13:15:30.000Z"),
        testHooks: { sdkTransport: mockSdkTransport(() => { invokeCount += 1; }) },
      });
      expect(code).toBe(0);
      expect(invokeCount).toBe(0);
      const start = JSON.parse(out.join("")) as { taskId: string; runLogFile: string };
      const runDirRel = `.pan/work/172996_05-10-26/${start.taskId}`;
      await seedPlanStageAdvanceArtifacts(root, runDirRel);
      await runCli(["advance", start.taskId, "--artifact", `${runDirRel}/touch-set.json`], {
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
  - id: plan
    persona: missing-persona
`,
        "utf8",
      );
      await writeFile(path.join(root, "lib", "inbox", "in", "demo.md"), "# Demo", "utf8");
      const out: string[] = [];
      const code = await runCli(["run", "feature-delivery", "demo.md"], {
        repoRoot: root,
        writeOut: (c) => out.push(c),
        writeErr: () => undefined,
        testHooks: { sdkTransport: mockSdkTransport() },
      });
      expect(code).toBe(1);
      expect(out.join("")).toContain("Unknown persona");
      const workRoot = path.join(root, ".pan/work");
      if (existsSync(workRoot)) {
        const dayDirs = await readdir(workRoot);
        for (const day of dayDirs) {
          const tasks = await readdir(path.join(workRoot, day));
          for (const task of tasks) {
            expect(existsSync(path.join(workRoot, day, task, "state.json"))).toBe(true);
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
      await runCli(["run", "feature-delivery", "demo-feature.md"], {
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
      if (state.currentStage === "plan") {
        await seedPlanStageAdvanceArtifacts(root, runDirRel, featureId);
        const planCode = await runCli(
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
      const runCode = await runCli(["run", "feature-delivery", "demo-feature.md"], {
        repoRoot: root,
        writeOut: (c) => out.push(c),
        clock: () => new Date("2026-05-10T13:15:30.000Z"),
      });
      expect(runCode).toBe(0);
      const start = JSON.parse(out.join("")) as { taskId: string; stateFile: string; featureId: string };
      const runDirRel = path.posix.dirname(start.stateFile);
      await advanceSdkRunToImplement(root, start.taskId, start.featureId, runDirRel, transport);
      await writeRunnerInvocationConfig(root, "sdk");
      await writeFile(path.join(root, runDirRel, "review.md"), VALID_REVIEW_MARKDOWN, "utf8");
      await seedTestStageAdvanceArtifacts(root, runDirRel);
      await writeFile(
        path.join(root, runDirRel, "implementation-report.md"),
        VALID_IMPLEMENTATION_REPORT_MARKDOWN,
        "utf8",
      );
      const advanceOut: string[] = [];
      const advanceCode = await runCli(
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
      await runCli(["run", "feature-delivery", "demo-feature.md"], {
        repoRoot: root,
        writeOut: (c) => out.push(c),
        clock: () => new Date("2026-05-10T13:15:30.000Z"),
      });
      const start = JSON.parse(out.join("")) as { taskId: string; stateFile: string; featureId: string };
      const runDirRel = path.posix.dirname(start.stateFile);
      await advanceSdkRunToImplement(root, start.taskId, start.featureId, runDirRel, transport);
      await writeRunnerInvocationConfig(root, "sdk");
      await writeFile(path.join(root, runDirRel, "review.md"), VALID_REVIEW_FAIL_MARKDOWN, "utf8");
      await writeFile(
        path.join(root, runDirRel, "implementation-report.md"),
        VALID_IMPLEMENTATION_REPORT_MARKDOWN,
        "utf8",
      );
      const advanceOut: string[] = [];
      const advanceCode = await runCli(
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
      await runCli(["run", "feature-delivery", "demo-feature.md"], {
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
      await writeFile(path.join(root, runDir, "review.md"), VALID_REVIEW_FAIL_MARKDOWN, "utf8");
      const haltCode = await runCli(
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