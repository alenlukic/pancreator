import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/active-memory/route";
import { loadActiveMemory } from "@/services/active-memory";

function writeCurrentMd(
  root: string,
  options: {
    activeFeaturePath?: string | null;
    blockers?: string[];
    refreshTimestamp?: string;
  } = {},
): void {
  const activeFeaturePath =
    options.activeFeaturePath === undefined
      ? "lib/inbox/in/172967_06-08-26/54352_0854_command-center-pipeline-orientation.md"
      : options.activeFeaturePath;
  const blockers = options.blockers ?? [
    "Blocker one",
    "Blocker two",
    "Blocker three",
    "Blocker four",
  ];
  const refreshTimestamp = options.refreshTimestamp ?? "2026-06-08T10:07:29.699Z";

  const activeFeatureLines =
    activeFeaturePath === null
      ? ["- `(none)`"]
      : [`- \`${activeFeaturePath}\``];

  fs.writeFileSync(
    path.join(root, "lib/memory/active/current.md"),
    [
      "# Current focus",
      "",
      "## Active Feature",
      "",
      ...activeFeatureLines,
      "",
      "## Risks and blockers",
      "",
      ...blockers.map((blocker) => `- ${blocker}`),
      "",
      "## Operator notes",
      "",
      "<!-- pan:active-memory:operator-notes:auto -->",
      "",
      `- Active-memory refreshed (UTC): \`${refreshTimestamp}\``,
      "",
      "<!-- /pan:active-memory:operator-notes:auto -->",
    ].join("\n"),
  );
}

function writeInboxDirective(
  root: string,
  relativePath: string,
  title: string,
): void {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `# ${title}\n`);
}

describe("GET /api/active-memory", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-active-memory-"));
    fs.writeFileSync(path.join(tempRoot, "pancreator.yaml"), "phase: test\n");
    fs.mkdirSync(path.join(tempRoot, "lib/memory/active"), { recursive: true });
    writeCurrentMd(tempRoot);
    writeInboxDirective(
      tempRoot,
      "lib/inbox/in/172967_06-08-26/54352_0854_command-center-pipeline-orientation.md",
      "Command Center pipeline orientation",
    );
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("returns active feature metadata, blocker chips, and refresh timestamp", async () => {
    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const snapshot = await loadActiveMemory(tempRoot);
      expect(snapshot.activeFeaturePath).toBe(
        "lib/inbox/in/172967_06-08-26/54352_0854_command-center-pipeline-orientation.md",
      );
      expect(snapshot.activeFeatureLabel).toBe("Command Center pipeline orientation");
      expect(snapshot.activeFeatureSlug).toBe("command-center-pipeline-orientation");
      expect(snapshot.blockersSummary).toBe("Blocker one · Blocker two · Blocker three");
      expect(snapshot.blockerChips).toEqual([
        "Blocker one",
        "Blocker two",
        "Blocker three",
        "Blocker four",
      ]);
      expect(snapshot.refreshTimestamp).toBe("2026-06-08T10:07:29.699Z");

      const response = await GET();
      expect(response.status).toBe(200);
      const payload = (await response.json()) as Awaited<ReturnType<typeof loadActiveMemory>>;
      expect(payload).toEqual(snapshot);
    } finally {
      process.chdir(originalRoot);
    }
  });

  it("strips markdown emphasis and truncates blocker chips at 60 characters", async () => {
    const longBlocker = `${"A".repeat(70)} tail`;
    writeCurrentMd(tempRoot, {
      blockers: [`**${longBlocker}**`],
    });

    const snapshot = await loadActiveMemory(tempRoot);
    expect(snapshot.blockerChips).toHaveLength(1);
    expect(snapshot.blockerChips[0]).toHaveLength(60);
    expect(snapshot.blockerChips[0]?.endsWith("…")).toBe(true);
    expect(snapshot.blockerChips[0]).not.toMatch(/\*\*/u);
  });

  it("returns null label metadata when active feature is (none)", async () => {
    writeCurrentMd(tempRoot, { activeFeaturePath: null, blockers: [] });

    const snapshot = await loadActiveMemory(tempRoot);
    expect(snapshot.activeFeaturePath).toBeNull();
    expect(snapshot.activeFeatureLabel).toBeNull();
    expect(snapshot.activeFeatureSlug).toBeNull();
    expect(snapshot.blockerChips).toEqual([]);
  });

  it("falls back to filename slug when inbox directive is missing", async () => {
    const missingPath =
      "lib/inbox/in/172967_06-08-26/99999_0000_missing-directive.md";
    writeCurrentMd(tempRoot, { activeFeaturePath: missingPath, blockers: [] });

    const snapshot = await loadActiveMemory(tempRoot);
    expect(snapshot.activeFeatureLabel).toBe("missing-directive");
    expect(snapshot.activeFeatureSlug).toBe("missing-directive");
  });
});
