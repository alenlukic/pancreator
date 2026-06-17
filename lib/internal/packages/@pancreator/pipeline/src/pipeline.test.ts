import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compilePipeline, INTERVENTION_NODE_ID, serializePipelineStages } from "./compile.js";
import { executePipeline, executeStageSlice, slicePipelineDefinitionForStage } from "./execute.js";
import { loadPipelineYaml } from "./load-yaml.js";
import type { PipelineDefinition } from "./types.js";

describe("executeStageSlice", () => {
  it("ignores a full-pipeline compiled graph when entry node does not match the slice stage", async () => {
    const def: PipelineDefinition = {
      id: "test",
      stages: [
        { id: "a", persona: "coder" },
        { id: "b", persona: "coder" },
      ],
    };
    const fullCompiled = compilePipeline(def);
    const log: string[] = [];
    await executeStageSlice(
      def,
      "b",
      { n: 0 },
      (stage) => {
        log.push(stage.id);
        return { n: 1 };
      },
      { compiled: fullCompiled },
    );
    expect(log).toEqual(["b"]);
    expect(fullCompiled.entryNodeId).toBe("a");
  });

  it("runs only the requested stage through the compiled graph", async () => {
    const def: PipelineDefinition = {
      id: "test",
      stages: [
        { id: "a", persona: "coder" },
        { id: "b" },
      ],
    };
    const log: string[] = [];
    const out = await executeStageSlice(def, "b", { n: 0 }, (stage, ctx) => {
      log.push(stage.id);
      return { n: ctx.n + 1 };
    });
    expect(log).toEqual(["b"]);
    expect(out.n).toBe(1);
    expect(slicePipelineDefinitionForStage(def, "b").stages).toHaveLength(1);
  });
});

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

  it("injects a single intervention side-channel node", () => {
    const compiled = compilePipeline({
      id: "demo",
      stages: [{ id: "one" }, { id: "two" }],
    });
    const interventionNodes = compiled.nodes.filter((n) => n.kind === "intervention");
    expect(interventionNodes).toHaveLength(1);
    expect(interventionNodes[0]?.id).toBe(INTERVENTION_NODE_ID);
    expect(compiled.edges.some((e) => e.to === INTERVENTION_NODE_ID)).toBe(true);
    expect(compiled.graph).toBeDefined();
    expect(typeof compiled.graph.compile).toBe("function");
  });

  it("rejects unknown personas when knownPersonas is provided", () => {
    expect(() =>
      compilePipeline(
        { id: "x", stages: [{ id: "s", persona: "missing" }] },
        { knownPersonas: new Set(["coder"]) },
      ),
    ).toThrow(/Unknown persona/);
  });

  it("parse-compile-serialize identity preserves stage ids", () => {
    const stages = [{ id: "a", persona: "coder" }, { id: "b" }];
    const roundTrip = serializePipelineStages(stages);
    const compiled = compilePipeline({ id: "id", stages: roundTrip });
    expect(compiled.stageIds).toEqual(["a", "b"]);
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

describe("feature-delivery stage slice", () => {
  it("executes the plan stage slice from the canonical pipeline", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../../..");
    const def = loadPipelineYaml(path.join(repoRoot, "lib", "pipelines", "feature-delivery.yaml"));
    const visited: string[] = [];
    await executeStageSlice(def, "plan", { ok: true }, (stage) => {
      visited.push(stage.id);
      return { ok: true };
    });
    expect(visited).toEqual(["plan"]);
  });
});

describe("MVP pipeline structural checks", () => {
  const mvpIds = [
    "feature-delivery",
    "adopt",
    "init-greenfield",
    "knowledge-curation",
  ];

  it.each(mvpIds)("compiles %s with reachability and intervention node", async (pipelineId) => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../../..");
    const yamlPath = path.join(repoRoot, "lib", "pipelines", `${pipelineId}.yaml`);
    const def = loadPipelineYaml(yamlPath);
    const compiled = compilePipeline(def);
    expect(compiled.entryNodeId).toBe(def.stages[0]?.id);
    expect(compiled.exitNodeId).toBe(def.stages[def.stages.length - 1]?.id);
    const stageNodeIds = new Set(compiled.nodes.filter((n) => n.kind === "stage").map((n) => n.id));
    for (const id of compiled.stageIds) {
      expect(stageNodeIds.has(id)).toBe(true);
    }
    const reachable = new Set<string>([compiled.entryNodeId]);
    let frontier = [compiled.entryNodeId];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const from of frontier) {
        for (const e of compiled.edges) {
          if (e.from === from && e.kind === "next" && !reachable.has(e.to)) {
            reachable.add(e.to);
            if (e.to !== INTERVENTION_NODE_ID) next.push(e.to);
          }
        }
      }
      frontier = next;
    }
    expect(reachable.has(compiled.exitNodeId)).toBe(true);
  });
});
