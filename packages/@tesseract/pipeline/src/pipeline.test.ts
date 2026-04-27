import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compilePipeline } from "./compile.js";
import { executePipeline } from "./execute.js";
import { loadPipelineYaml } from "./load-yaml.js";
import type { PipelineDefinition } from "./types.js";

describe("executePipeline", () => {
  it("runs stages in order and threads context", async () => {
    const def: PipelineDefinition = {
      id: "test",
      stages: [
        { id: "a", persona: "p" },
        { id: "b" },
      ],
    };
    const log: string[] = [];
    const out = await executePipeline(def, { n: 0 }, (stage, ctx) => {
      log.push(stage.id);
      return { n: ctx.n + 1 };
    });
    expect(log).toEqual(["a", "b"]);
    expect(out.n).toBe(2);
  });
});

describe("compilePipeline", () => {
  it("rejects duplicate stage ids", () => {
    expect(() =>
      compilePipeline({
        id: "x",
        stages: [
          { id: "s" },
          { id: "s" },
        ],
      }),
    ).toThrow(/Duplicate pipeline stage id/);
  });
});

describe("loadPipelineYaml", () => {
  it("loads a definition from disk", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "pipe-"));
    const p = path.join(tmp, "pipe.yaml");
    await writeFile(
      p,
      `id: demo
version: "1"
stages:
  - id: one
    persona: tech-writer
  - id: two
`,
      "utf8",
    );
    const def = loadPipelineYaml(p);
    expect(def.id).toBe("demo");
    expect(def.version).toBe("1");
    expect(def.stages).toHaveLength(2);
    expect(def.stages[0]?.persona).toBe("tech-writer");
    await rm(tmp, { recursive: true, force: true });
  });
});
