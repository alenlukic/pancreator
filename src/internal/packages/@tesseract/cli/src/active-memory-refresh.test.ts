import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  patchFeatureIndexArchivedInbox,
  readExplicitArchivedInboxPointer,
  resolveArchivedInboxPointer,
} from "./active-memory-refresh.js";

describe("resolveArchivedInboxPointer", () => {
  it("treats null delivery_report as absent without throwing", async () => {
    const rec = { delivery_report: null, status: "indexed" };
    expect(readExplicitArchivedInboxPointer(rec)).toBe("");
    expect(await resolveArchivedInboxPointer(os.tmpdir(), rec)).toBe("");
  });

  it("returns explicit delivery_report.archived_inbox_source when present", async () => {
    const rec = {
      delivery_report: {
        archived_inbox_source: "src/inbox/archive/in/day/task/item.md",
      },
    };
    expect(readExplicitArchivedInboxPointer(rec)).toBe("src/inbox/archive/in/day/task/item.md");
    expect(await resolveArchivedInboxPointer(os.tmpdir(), rec)).toBe("src/inbox/archive/in/day/task/item.md");
  });

  it("reads intake.source_inbox_item when it already points at archive", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tess-archived-intake-"));
    const archived = "src/inbox/archive/in/172981_05-25-26/task-id/directive.md";
    await mkdir(path.join(root, ...archived.split("/").slice(0, -1)), { recursive: true });
    await writeFile(path.join(root, archived), "# directive\n", "utf8");
    const rec = {
      intake: { source_inbox_item: archived },
    };
    expect(await resolveArchivedInboxPointer(root, rec)).toBe(archived);
  });

  it("resolves stale src/inbox/in paths via task_id under archive", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tess-archived-resolve-"));
    const taskId = "966_2343_demo";
    const archived = `src/inbox/archive/in/172980_05-26-26/${taskId}/2597_demo.md`;
    const stale = "src/inbox/in/172980_05-26-26/2597_demo.md";
    await mkdir(path.join(root, ...archived.split("/").slice(0, -1)), { recursive: true });
    await writeFile(path.join(root, archived), "# batch\n", "utf8");
    const rec = {
      task_id: taskId,
      source_inbox_item: { path: stale },
    };
    expect(await resolveArchivedInboxPointer(root, rec)).toBe(archived);
  });

  it("patchFeatureIndexArchivedInbox backfills archived_inbox_source and source_inbox_item.path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tess-archived-patch-"));
    const featureId = "demo-feature";
    const indexAbs = path.join(root, "src", "memory", "features", featureId, "index.json");
    const prior = "src/inbox/in/demo.md";
    const archived = "src/inbox/archive/in/172996_05-10-26/task/demo.md";
    await mkdir(path.dirname(indexAbs), { recursive: true });
    await writeFile(
      indexAbs,
      JSON.stringify(
        {
          feature_id: featureId,
          status: "indexed",
          source_inbox_item: { path: prior, content_hash: "abc" },
          intake: { source_inbox_item: prior },
        },
        null,
        2,
      ),
      "utf8",
    );

    await patchFeatureIndexArchivedInbox(root, featureId, archived, prior);
    const parsed = JSON.parse(await readFile(indexAbs, "utf8")) as Record<string, unknown>;
    expect(parsed["archived_inbox_source"]).toBe(archived);
    expect((parsed["source_inbox_item"] as Record<string, unknown>)["path"]).toBe(archived);
    expect((parsed["intake"] as Record<string, unknown>)["source_inbox_item"]).toBe(archived);
  });
});
