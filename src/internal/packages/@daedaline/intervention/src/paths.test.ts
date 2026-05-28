import { asTaskId } from "@daedaline/core";
import { describe, expect, it } from "vitest";

import { InvalidTaskIdForJournalError } from "./errors.js";
import {
  assertSafeTaskIdForPath,
  defaultInterventionsDir,
  interventionJournalPath,
} from "./paths.js";

describe("paths", () => {
  it("defaultInterventionsDir nests under .ddl/scheduler", () => {
    expect(defaultInterventionsDir("/repo")).toMatch(/\.ddl[/\\]scheduler[/\\]interventions$/);
  });

  it("interventionJournalPath joins task file", () => {
    const p = interventionJournalPath("/repo", asTaskId("my-task"));
    expect(p).toContain("my-task.jsonl");
  });

  it("assertSafeTaskIdForPath rejects traversal", () => {
    expect(() => assertSafeTaskIdForPath("../x")).toThrow(InvalidTaskIdForJournalError);
    expect(() => assertSafeTaskIdForPath("a/b")).toThrow(InvalidTaskIdForJournalError);
  });
});
