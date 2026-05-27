import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { PipelineDefinition } from "./types.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Reads UTF-8 YAML from `path` and returns a validated {@link PipelineDefinition}.
 */
export function loadPipelineYaml(path: string): PipelineDefinition {
  const text = readFileSync(path, "utf8");
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Pipeline YAML is not valid at ${path}: ${msg}`);
  }
  if (!isRecord(data)) {
    throw new Error(`Pipeline YAML at ${path} MUST be a mapping.`);
  }
  const id = data.id;
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(`Pipeline at ${path} MUST set a non-empty string "id".`);
  }
  const stages = data.stages;
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new Error(`Pipeline at ${path} MUST set a non-empty "stages" array.`);
  }
  const outStages: PipelineDefinition["stages"] = [];
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    if (!isRecord(s)) {
      throw new Error(`Pipeline stages[${i}] at ${path} MUST be a mapping.`);
    }
    const sid = s.id;
    if (typeof sid !== "string" || sid.trim() === "") {
      throw new Error(`Pipeline stages[${i}].id at ${path} MUST be a non-empty string.`);
    }
    const stage: PipelineDefinition["stages"][number] = { id: sid };
    if (typeof s.persona === "string") {
      stage.persona = s.persona;
    }
    if (typeof s.label === "string") {
      stage.label = s.label;
    }
    if (typeof s.gate === "string") {
      stage.gate = s.gate;
    }
    if (typeof s.loop === "string") {
      stage.loop = s.loop;
    }
    outStages.push(stage);
  }
  const def: PipelineDefinition = { id, stages: outStages };
  if (typeof data.version === "string") {
    def.version = data.version;
  }
  if (isRecord(data.metadata)) {
    def.metadata = data.metadata;
  }
  if (isRecord(data.circuit_breaker)) {
    const cb = data.circuit_breaker;
    def.circuit_breaker = {};
    if (typeof cb.max_iterations === "number") {
      def.circuit_breaker.max_iterations = cb.max_iterations;
    }
    if (typeof cb.max_tokens === "number") {
      def.circuit_breaker.max_tokens = cb.max_tokens;
    }
    if (typeof cb.max_tool_failures_consecutive === "number") {
      def.circuit_breaker.max_tool_failures_consecutive = cb.max_tool_failures_consecutive;
    }
  }
  return def;
}
