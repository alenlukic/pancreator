import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/inbox/route";
import { inboxRunCommand, loadInboxEntries } from "@/services/inbox";

describe("GET /api/inbox", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-inbox-"));
    fs.writeFileSync(path.join(tempRoot, "pancreator.yaml"), "phase: test\n");
    const inboxRoot = path.join(tempRoot, "lib/inbox/in/172967_06-08-26");
    fs.mkdirSync(inboxRoot, { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "lib/inbox/notes"), { recursive: true });

    const inboxFile = path.join(inboxRoot, "54352_0854_command-center-pipeline-orientation.md");
    fs.writeFileSync(
      inboxFile,
      "# Command Center pipeline orientation\n\nDirective body.\n",
    );
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    fs.utimesSync(inboxFile, twoHoursAgo / 1000, twoHoursAgo / 1000);

    fs.writeFileSync(path.join(tempRoot, "lib/inbox/notes/private.md"), "# Notes\n");
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("lists inbox markdown files and excludes notes paths", async () => {
    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const entries = await loadInboxEntries(tempRoot);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        path: "lib/inbox/in/172967_06-08-26/54352_0854_command-center-pipeline-orientation.md",
        title: "Command Center pipeline orientation",
        slug: "command-center-pipeline-orientation",
        ageHours: 2,
      });
      expect(inboxRunCommand(entries[0]?.path ?? "")).toBe(
        "pnpm -w exec pan run feature-delivery 172967_06-08-26/54352_0854_command-center-pipeline-orientation.md",
      );

      const response = await GET();
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { entries: typeof entries };
      expect(payload.entries).toEqual(entries);
    } finally {
      process.chdir(originalRoot);
    }
  });
});
