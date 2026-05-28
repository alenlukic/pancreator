import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { asTaskId } from "@daedaline/core";
import { afterEach, describe, expect, it } from "vitest";

import { FsInterventionStore } from "./store.js";
import { defaultInterventionsDir, interventionJournalPath } from "./paths.js";

describe("FsInterventionStore", () => {
  let tmp: string | undefined;

  afterEach(async () => {
    if (tmp !== undefined) {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("appends JSONL under .ddl/scheduler/interventions and reads back", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ddl-intervention-"));
    const repoRoot = tmp;
    const store = new FsInterventionStore(repoRoot);
    const taskId = asTaskId("dogfood-task");

    await store.appendRecord(taskId, {
      taskId,
      command: "pause",
      atIso: "2026-04-27T12:00:00.000Z",
    });

    const journalPath = interventionJournalPath(repoRoot, taskId);
    expect(journalPath.startsWith(defaultInterventionsDir(repoRoot))).toBe(true);

    const raw = await fs.readFile(journalPath, "utf8");
    expect(raw.trim().split("\n")).toHaveLength(1);

    const rows = await store.readJournal(taskId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.command).toBe("pause");

    const missing = await store.readJournal(asTaskId("other"));
    expect(missing).toEqual([]);
  });
});
