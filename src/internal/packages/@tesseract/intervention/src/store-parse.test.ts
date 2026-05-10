import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { asTaskId } from "@tesseract/core";
import { afterEach, describe, expect, it } from "vitest";

import { MalformedJournalLineError } from "./errors.js";
import { interventionJournalPath } from "./paths.js";
import { FsInterventionStore } from "./store.js";

describe("FsInterventionStore journal parsing", () => {
  let tmp: string | undefined;

  afterEach(async () => {
    if (tmp !== undefined) {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("throws MalformedJournalLineError on invalid JSON", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tess-intervention-bad-"));
    const taskId = asTaskId("bad");
    const file = interventionJournalPath(tmp, taskId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "not-json\n", "utf8");

    const store = new FsInterventionStore(tmp);
    await expect(store.readJournal(taskId)).rejects.toThrow(MalformedJournalLineError);
  });
});
