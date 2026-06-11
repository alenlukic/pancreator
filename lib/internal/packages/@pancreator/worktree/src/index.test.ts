import { describe, expect, it } from "vitest";

import {
  PANCREATOR_WORKTREE_REMOVED,
  PANCREATOR_WORKTREE_STUB,
  PANCREATOR_WORKTREE_VERSION,
  worktreeStubVersion,
} from "./index.js";

describe("@pancreator/worktree stub", () => {
  it("exports removal markers instead of parallel-checkout helpers", () => {
    expect(PANCREATOR_WORKTREE_VERSION).toBe("removed");
    expect(PANCREATOR_WORKTREE_STUB).toBe("worktree-disabled");
    expect(PANCREATOR_WORKTREE_REMOVED).toBe(true);
    expect(worktreeStubVersion()).toMatch(/\d/u);
  });
});
