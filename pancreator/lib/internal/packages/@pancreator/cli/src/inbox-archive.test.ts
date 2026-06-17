import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  archiveInboxPathForSource,
  findExistingArchivedInboxPath,
  pruneEmptyInboxQueueTree,
  pruneEmptyQueueParents,
} from "./inbox-archive.js";

describe("archiveInboxPathForSource", () => {
  it("archives day-bucket leaves without task-id nesting", () => {
    expect(
      archiveInboxPathForSource("lib/inbox/in/172996_05-10-26/64488_0605_demo-feature.md"),
    ).toBe(".pan/archive/inbox/in/172996_05-10-26/64488_0605_demo-feature.md");
  });

  it("flattens legacy per-task inbox folders into day-bucket leaves", () => {
    expect(
      archiveInboxPathForSource(
        "lib/inbox/in/172996_05-10-26/67055_0522_json-formatting/64488_0605_demo-feature.md",
      ),
    ).toBe(".pan/archive/inbox/in/172996_05-10-26/64488_0605_demo-feature.md");
  });

  it("uses fallback day dir for flat inbox paths", () => {
    expect(archiveInboxPathForSource("lib/inbox/in/demo-feature.md", "172996_05-10-26")).toBe(
      ".pan/archive/inbox/in/172996_05-10-26/demo-feature.md",
    );
  });
});

describe("findExistingArchivedInboxPath", () => {
  it("prefers canonical day-bucket archive paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-inbox-archive-canonical-"));
    const archived = ".pan/archive/inbox/in/172980_05-26-26/2597_demo.md";
    await mkdir(path.join(root, ...archived.split("/").slice(0, -1)), { recursive: true });
    await writeFile(path.join(root, archived), "# demo\n", "utf8");
    const hit = await findExistingArchivedInboxPath(
      root,
      "lib/inbox/in/172980_05-26-26/2597_demo.md",
    );
    expect(hit?.rel).toBe(archived);
  });

  it("falls back to legacy nested archive paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-inbox-archive-legacy-"));
    const taskId = "966_2343_demo";
    const archived = `.pan/archive/inbox/in/172980_05-26-26/${taskId}/2597_demo.md`;
    await mkdir(path.join(root, ...archived.split("/").slice(0, -1)), { recursive: true });
    await writeFile(path.join(root, archived), "# demo\n", "utf8");
    const hit = await findExistingArchivedInboxPath(
      root,
      "lib/inbox/in/172980_05-26-26/2597_demo.md",
    );
    expect(hit?.rel).toBe(archived);
  });
});

describe("pruneEmptyQueueParents", () => {
  it("removes empty day buckets under lib/inbox/in", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-inbox-prune-empty-"));
    const dayDir = path.join(root, "lib", "inbox", "in", "172996_05-10-26");
    await mkdir(dayDir, { recursive: true });
    const removed = await pruneEmptyQueueParents(
      root,
      "lib/inbox/in/172996_05-10-26",
      "lib/inbox/in",
    );
    expect(removed).toContain("lib/inbox/in/172996_05-10-26");
    expect(existsSync(dayDir)).toBe(false);
    expect(existsSync(path.join(root, "lib", "inbox", "in"))).toBe(true);
  });

  it("removes directories that contain only .DS_Store", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-inbox-prune-dsstore-"));
    const dayDir = path.join(root, "lib", "inbox", "in", "172996_05-10-26");
    await mkdir(dayDir, { recursive: true });
    await writeFile(path.join(dayDir, ".DS_Store"), "", "utf8");
    const removed = await pruneEmptyQueueParents(
      root,
      "lib/inbox/in/172996_05-10-26",
      "lib/inbox/in",
    );
    expect(removed).toContain("lib/inbox/in/172996_05-10-26");
    expect(existsSync(dayDir)).toBe(false);
  });

  it("does not remove lib/inbox/in queue root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-inbox-prune-root-"));
    const queueRoot = path.join(root, "lib", "inbox", "in");
    await mkdir(queueRoot, { recursive: true });
    const removed = await pruneEmptyQueueParents(root, "lib/inbox/in", "lib/inbox/in");
    expect(removed).not.toContain("lib/inbox/in");
    expect(existsSync(queueRoot)).toBe(true);
  });
});

describe("pruneEmptyInboxQueueTree", () => {
  it("removes nested empty day buckets and feature folders", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-inbox-prune-tree-"));
    const threadDir = path.join(
      root,
      "lib",
      "inbox",
      "threads",
      "172996_05-10-26",
      "demo-feature",
    );
    await mkdir(threadDir, { recursive: true });
    const removed = await pruneEmptyInboxQueueTree(root, "lib/inbox/threads");
    expect(removed).toContain("lib/inbox/threads/172996_05-10-26/demo-feature");
    expect(removed).toContain("lib/inbox/threads/172996_05-10-26");
    expect(existsSync(path.join(root, "lib", "inbox", "threads"))).toBe(true);
    expect(existsSync(threadDir)).toBe(false);
  });
});
