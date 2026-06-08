import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/active-memory/route";
import { loadActiveMemory } from "@/services/active-memory";

describe("GET /api/active-memory", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-active-memory-"));
    fs.writeFileSync(path.join(tempRoot, "pancreator.yaml"), "phase: test\n");
    fs.mkdirSync(path.join(tempRoot, "lib/memory/active"), { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, "lib/memory/active/current.md"),
      [
        "# Current focus",
        "",
        "## Active Feature",
        "",
        "- `lib/inbox/in/172967_06-08-26/54352_0854_cockpit-v2-pipeline-orientation.md`",
        "",
        "## Risks and blockers",
        "",
        "- Blocker one",
        "- Blocker two",
        "- Blocker three",
        "- Blocker four",
        "",
        "## Operator notes",
        "",
        "<!-- pan:active-memory:operator-notes:auto -->",
        "",
        "- Active-memory refreshed (UTC): `2026-06-08T10:07:29.699Z`",
        "",
        "<!-- /pan:active-memory:operator-notes:auto -->",
      ].join("\n"),
    );
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("returns active feature path, blockers summary, and refresh timestamp", async () => {
    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const snapshot = await loadActiveMemory(tempRoot);
      expect(snapshot.activeFeaturePath).toBe(
        "lib/inbox/in/172967_06-08-26/54352_0854_cockpit-v2-pipeline-orientation.md",
      );
      expect(snapshot.blockersSummary).toBe("Blocker one · Blocker two · Blocker three");
      expect(snapshot.refreshTimestamp).toBe("2026-06-08T10:07:29.699Z");

      const response = await GET();
      expect(response.status).toBe(200);
      const payload = (await response.json()) as Awaited<ReturnType<typeof loadActiveMemory>>;
      expect(payload).toEqual(snapshot);
    } finally {
      process.chdir(originalRoot);
    }
  });
});
