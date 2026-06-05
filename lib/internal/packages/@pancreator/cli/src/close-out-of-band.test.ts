import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeOutOfBandWorkspace } from "./close-out-of-band.js";
import { renderOperatorVerificationScaffold } from "./operator-verification.js";
import { stringifyCliJson } from "./canonical-json-io.js";

const JSON_FORMAT_ABBREV_ENV = "PAN_JSON_FORMAT_ABBREV_LEN";

async function mkRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "pan-close-oob-"));
  await mkdir(path.join(root, "lib", "inbox", "in"), { recursive: true });
  await mkdir(path.join(root, "work", "172971_06-04-26"), { recursive: true });
  return root;
}

describe("close-out-of-band", () => {
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

  it("archives a work directory with operator verification", async () => {
    const root = await mkRepo();
    const runDirRel = "work/172971_06-04-26/99999_manual_audit";
    const runAbs = path.join(root, runDirRel);
    await mkdir(runAbs, { recursive: true });
    await writeFile(
      path.join(runAbs, "out-of-band.manifest.json"),
      stringifyCliJson(root, { reason: "Manual audit workspace for operator verification close test." }),
      "utf8",
    );
    await writeFile(
      path.join(runAbs, "operator-verification.md"),
      renderOperatorVerificationScaffold(
        { taskId: "99999_manual_audit", featureId: "manual-audit", artifacts: { runDir: runDirRel } },
        root,
        new Date("2026-06-04T12:00:00.000Z"),
      ),
      "utf8",
    );

    const result = await closeOutOfBandWorkspace({
      repoRoot: root,
      runDirRel,
      featureId: "manual-audit",
      reason: "Ad-hoc workspace complete and ready for archival.",
    });

    expect(result.archivedRunDir).toBe("archive/work/172971_06-04-26/99999_manual_audit");
    expect(existsSync(runAbs)).toBe(false);
    expect(existsSync(path.join(root, result.archivedRunDir, "state.json"))).toBe(true);
    const state = JSON.parse(
      await readFile(path.join(root, result.archivedRunDir, "state.json"), "utf8"),
    ) as { status: string };
    expect(state.status).toBe("closed");
  });
});
