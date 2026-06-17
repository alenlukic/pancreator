import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertIntakeSlug,
  buildBuildPlanIntakeMarkdown,
  createIntakeDirective,
  makeUtcDayBucket,
  readOptionalTextFile,
  secondsToMidnightUtc,
  slugifyIntakeBasename,
  utcHhmm,
} from "./intake-scaffold.js";

async function seedMinimalWorkspace(root: string): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(path.join(root, "lib", "memory", "handbook"), { recursive: true });
  await writeFile(
    path.join(root, "pancreator.yaml"),
    "project_root: .\n",
    "utf8",
  );
}

describe("intake-scaffold", () => {
  it("formats utc bucket and sid tokens", () => {
    const stamp = new Date(Date.UTC(2026, 0, 2, 0, 3, 4));
    expect(makeUtcDayBucket(stamp)).toMatch(/^\d{6}_01-02-26$/);
    expect(utcHhmm(stamp)).toBe("0003");
    expect(secondsToMidnightUtc(new Date(Date.UTC(2026, 4, 10, 23, 59, 59)))).toBe(1);
    expect(secondsToMidnightUtc(new Date(Date.UTC(2026, 4, 11, 0, 0, 0)))).toBe(86400);
  });

  it("slugifies operator text into intake basenames", () => {
    expect(slugifyIntakeBasename("Build-mode inbox scaffolding")).toBe("build-mode-inbox-scaffolding");
    expect(slugifyIntakeBasename("!!!")).toBe("build-request");
  });

  it("assertIntakeSlug accepts conformant slugs and rejects invalid basenames", () => {
    expect(() => assertIntakeSlug("build-mode-inbox-scaffolding")).not.toThrow();
    expect(() => assertIntakeSlug("feature_2")).not.toThrow();
    expect(() => assertIntakeSlug("Bad Slug")).toThrow(/slug MUST use lowercase/);
    expect(() => assertIntakeSlug("-leading-hyphen")).toThrow(/slug MUST use lowercase/);
  });

  it("readOptionalTextFile reads repo-relative paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-build-intake-read-"));
    const { mkdir, writeFile } = await import("node:fs/promises");
    const rel = ".tmp/prompt.txt";
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, "operator prompt body\n", "utf8");
    await expect(readOptionalTextFile(root, rel)).resolves.toBe("operator prompt body\n");
  });

  it("creates build-plan inbox directives with canonical paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-build-intake-"));
    await seedMinimalWorkspace(root);
    const stamp = new Date(Date.UTC(2026, 5, 4, 9, 6, 0));
    const fileText = buildBuildPlanIntakeMarkdown({
      title: "Build-mode inbox scaffolding",
      featureId: "build-mode-inbox-scaffolding",
      owner: "product-engineer",
      createdIso: stamp.toISOString(),
      operatorPrompt: "implement build-mode inbox auto-create",
      planText: "## Steps\n\n1. Add CLI\n2. Update AGENTS.md",
    });
    const created = await createIntakeDirective({
      repoRoot: root,
      slug: "build-mode-inbox-scaffolding",
      now: stamp,
      fileText,
    });
    expect(created.path).toMatch(
      /^lib\/inbox\/in\/\d{6}_06-04-26\/\d+_0906_build-mode-inbox-scaffolding\.md$/,
    );
    const body = await readFile(created.abs, "utf8");
    expect(body).toContain("source_channel: cursor-build-mode");
    expect(body).toContain("implement build-mode inbox auto-create");
    expect(body).toContain("## Plan snapshot");
    expect(body).toContain("Add CLI");
  });

  it("refuses overwrite when the target inbox path already exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-build-intake-overwrite-"));
    await seedMinimalWorkspace(root);
    const stamp = new Date(Date.UTC(2026, 5, 4, 9, 6, 0));
    const fileText = buildBuildPlanIntakeMarkdown({
      title: "Overwrite test",
      featureId: "overwrite-slug",
      owner: "product-engineer",
      createdIso: stamp.toISOString(),
      operatorPrompt: "prompt",
      planText: "plan",
    });
    await createIntakeDirective({
      repoRoot: root,
      slug: "overwrite-slug",
      now: stamp,
      fileText,
    });
    await expect(
      createIntakeDirective({
        repoRoot: root,
        slug: "overwrite-slug",
        now: stamp,
        fileText,
      }),
    ).rejects.toThrow(/Refusing to overwrite existing inbox directive at lib\/inbox\/in\//);
  });

  it("refuses creation outside an initialized Pancreator workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-build-intake-no-yaml-"));
    await expect(
      createIntakeDirective({
        repoRoot: root,
        slug: "no-yaml",
        fileText: "body",
      }),
    ).rejects.toThrow(/Missing pancreator\.yaml/);
  });

  it("creates directives when archive and active day buckets coexist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-build-intake-coexist-"));
    await seedMinimalWorkspace(root);
    const stamp = new Date(Date.UTC(2026, 1, 2, 9, 0, 0));
    const bucket = makeUtcDayBucket(stamp);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(root, "lib", "inbox", "in", bucket), { recursive: true });
    await mkdir(path.join(root, ".pan/archive", "inbox", "in", bucket), { recursive: true });
    const created = await createIntakeDirective({
      repoRoot: root,
      slug: "coexist-slug",
      now: stamp,
      fileText: buildBuildPlanIntakeMarkdown({
        title: "Coexist",
        featureId: "coexist-slug",
        owner: "product-engineer",
        createdIso: stamp.toISOString(),
        operatorPrompt: "prompt",
        planText: "plan",
      }),
    });
    expect(created.path).toMatch(/coexist-slug\.md$/);
  });
});
