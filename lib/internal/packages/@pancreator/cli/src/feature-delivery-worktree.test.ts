import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  checkoutRootFromStateFile,
  isFeatureDeliveryWorktreeCheckout,
  resolveMainRepositoryRoot,
} from "./feature-delivery-worktree.js";
import { startFeatureDelivery } from "./feature-delivery-run.js";
import { FEATURE_DELIVERY_WORKTREE_ISOLATION_ERROR } from "./feature-delivery-worktree.js";

describe("feature-delivery-worktree", () => {
  it("detects worktree slot paths under .pan/worktrees", () => {
    const main = path.join("/repo", "daedaline");
    const slot = path.join(main, ".pan", "worktrees", "task_123");
    expect(isFeatureDeliveryWorktreeCheckout(main, slot)).toBe(true);
    expect(isFeatureDeliveryWorktreeCheckout(main, main)).toBe(false);
  });

  it("resolves main repository root from a worktree slot", () => {
    const main = path.join("/repo", "daedaline");
    const slot = path.join(main, ".pan", "worktrees", "task_123");
    expect(resolveMainRepositoryRoot(slot)).toBe(main);
    expect(resolveMainRepositoryRoot(main)).toBe(main);
  });

  it("derives checkout root from a state file path", () => {
    const checkout = path.join("/repo", ".pan", "worktrees", "task_123");
    const state = path.join(checkout, ".pan", "work", "day", "task_123", "state.json");
    expect(checkoutRootFromStateFile(state)).toBe(checkout);
  });

  it("rejects startFeatureDelivery on the main checkout when worktree pool exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "fd-worktree-guard-"));
    await mkdir(path.join(root, ".pan", "worktrees"), { recursive: true });
    await mkdir(path.join(root, "lib", "inbox", "in"), { recursive: true });
    await mkdir(path.join(root, "lib", "pipelines"), { recursive: true });
    await writeFile(path.join(root, "lib", "inbox", "in", "demo.md"), "# Demo\n", "utf8");
    await writeFile(
      path.join(root, "lib", "pipelines", "feature-delivery.yaml"),
      "id: feature-delivery\nversion: \"1\"\nstages:\n  - id: intake\n    persona: intake-analyst\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "pancreator.yaml"),
      `project_root: "."
runner:
  cursor:
    invocation: manual
`,
      "utf8",
    );

    await expect(
      startFeatureDelivery({
        repoRoot: root,
        inboxEntry: "demo.md",
        clock: () => new Date("2026-06-09T12:00:00.000Z"),
      }),
    ).rejects.toThrow(FEATURE_DELIVERY_WORKTREE_ISOLATION_ERROR);
  });
});
