import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const JSON_FORMAT_ABBREV_ENV = "PAN_JSON_FORMAT_ABBREV_LEN";

import {
  deriveShippedMarkdownTable,
  patchFeatureIndexArchivedInbox,
  readExplicitArchivedInboxPointer,
  resolveArchivedInboxPointer,
  SHIPPED_LEDGER_ROW_CAP,
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
        archived_inbox_source: "archive/inbox/in/day/task/item.md",
      },
    };
    expect(readExplicitArchivedInboxPointer(rec)).toBe("archive/inbox/in/day/task/item.md");
    expect(await resolveArchivedInboxPointer(os.tmpdir(), rec)).toBe("archive/inbox/in/day/task/item.md");
  });

  it("reads intake.source_inbox_item when it already points at archive", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-archived-intake-"));
    const archived = "archive/inbox/in/172981_05-25-26/task-id/directive.md";
    await mkdir(path.join(root, ...archived.split("/").slice(0, -1)), { recursive: true });
    await writeFile(path.join(root, archived), "# directive\n", "utf8");
    const rec = {
      intake: { source_inbox_item: archived },
    };
    expect(await resolveArchivedInboxPointer(root, rec)).toBe(archived);
  });

  it("resolves stale lib/inbox/in paths via task_id under archive", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-archived-resolve-"));
    const taskId = "966_2343_demo";
    const archived = `archive/inbox/in/172980_05-26-26/${taskId}/2597_demo.md`;
    const stale = "lib/inbox/in/172980_05-26-26/2597_demo.md";
    await mkdir(path.join(root, ...archived.split("/").slice(0, -1)), { recursive: true });
    await writeFile(path.join(root, archived), "# batch\n", "utf8");
    const rec = {
      task_id: taskId,
      source_inbox_item: { path: stale },
    };
    expect(await resolveArchivedInboxPointer(root, rec)).toBe(archived);
  });
});

describe("patchFeatureIndexArchivedInbox", () => {
  let hadAbbrevEnv = false;
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

  it("preserves canonical primitive-array layout", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-archived-canonical-"));
    const featureId = "demo-feature";
    const indexAbs = path.join(root, "lib", "memory", "features", featureId, "index.json");
    const prior = "lib/inbox/in/demo.md";
    const archived = "archive/inbox/in/172996_05-10-26/task/demo.md";
    await mkdir(path.dirname(indexAbs), { recursive: true });
    await writeFile(
      indexAbs,
      [
        "{",
        '  "feature_id": "demo-feature",',
        '  "depends_on": ["P5", "P6"],',
        '  "source_inbox_item": { "path": "lib/inbox/in/demo.md" }',
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    await patchFeatureIndexArchivedInbox(root, featureId, archived, prior);
    const raw = await readFile(indexAbs, "utf8");
    expect(raw).toMatch(/"depends_on": \["P5", "P6"\]/);
  });

  it("backfills archived_inbox_source and source_inbox_item.path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-archived-patch-"));
    const featureId = "demo-feature";
    const indexAbs = path.join(root, "lib", "memory", "features", featureId, "index.json");
    const prior = "lib/inbox/in/demo.md";
    const archived = "archive/inbox/in/172996_05-10-26/task/demo.md";
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

describe("deriveShippedMarkdownTable", () => {
  it("renders at most SHIPPED_LEDGER_ROW_CAP data rows when more indexed features exist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-shipped-ledger-cap-"));
    const featuresRoot = path.join(root, "lib", "memory", "features");
    await mkdir(featuresRoot, { recursive: true });

    for (let i = 0; i < 12; i += 1) {
      const featureId = `cap-test-feature-${String(i).padStart(2, "0")}`;
      const indexAbs = path.join(featuresRoot, featureId, "index.json");
      await mkdir(path.dirname(indexAbs), { recursive: true });
      const shippedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
      await writeFile(
        indexAbs,
        JSON.stringify(
          {
            feature_id: featureId,
            status: "indexed",
            indexed_at: shippedAt,
            delivery_report: {
              path: `lib/memory/features/${featureId}/delivery-report.md`,
            },
          },
          null,
          2,
        ),
        "utf8",
      );
    }

    const tableBody = await deriveShippedMarkdownTable(root);
    const dataRows = tableBody
      .split("\n")
      .filter((line) => line.startsWith("| `cap-test-feature-"));

    expect(SHIPPED_LEDGER_ROW_CAP).toBe(10);
    expect(dataRows.length).toBeLessThanOrEqual(SHIPPED_LEDGER_ROW_CAP);
    expect(dataRows.length).toBe(10);
  });
});
