#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { stringifyRepoJson } from "../format/canonical-json-format.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
const PERSONAS_DIR = path.join(ROOT, "lib", "personas");
const PIPELINE_PATH = path.join(ROOT, "lib", "pipelines", "feature-delivery.yaml");
const OUT_DIR = path.join(ROOT, "lib", "memory", "generated", "minimal-contract-bundles");

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/u);
  if (match === null) {
    return null;
  }
  try {
    return parseYaml(match[1]);
  } catch {
    return null;
  }
}

function personaBundles() {
  const bundles = [];
  for (const entry of fs.readdirSync(PERSONAS_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    const abs = path.join(PERSONAS_DIR, entry.name);
    const rel = path.relative(ROOT, abs).replace(/\\/gu, "/");
    const frontmatter = parseFrontmatter(fs.readFileSync(abs, "utf8"));
    const requiredDocs = Array.isArray(frontmatter?.metadata?.["pancreator-required-docs"])
      ? frontmatter.metadata["pancreator-required-docs"].filter((value) => typeof value === "string")
      : [];
    bundles.push({
      kind: "persona",
      persona_id: entry.name.replace(/\.md$/u, ""),
      source: rel,
      required_docs: requiredDocs,
      generated_at: new Date().toISOString(),
    });
  }
  return bundles;
}

function stageBundles() {
  const raw = fs.readFileSync(PIPELINE_PATH, "utf8");
  const payload =
    raw.includes("# Operator section") && raw.includes("id: feature-delivery")
      ? raw.slice(raw.indexOf("id: feature-delivery"))
      : raw;
  const pipeline = parseYaml(payload);
  const stages = Array.isArray(pipeline?.stages) ? pipeline.stages : [];
  return stages.map((stage) => ({
    kind: "stage",
    pipeline_id: pipeline?.id ?? "feature-delivery",
    stage_id: stage?.id ?? "unknown",
    persona: stage?.persona ?? null,
    required_docs: Array.isArray(stage?.contract?.required_docs)
      ? stage.contract.required_docs.filter((value) => typeof value === "string")
      : [],
    generated_at: new Date().toISOString(),
  }));
}

function writeBundle(relName, payload) {
  const abs = path.join(OUT_DIR, relName);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, stringifyRepoJson(payload, ROOT), "utf8");
  return path.relative(ROOT, abs).replace(/\\/gu, "/");
}

const outputs = [];
for (const bundle of personaBundles()) {
  outputs.push(
    writeBundle(path.posix.join("personas", `${bundle.persona_id}.json`), bundle),
  );
}
for (const bundle of stageBundles()) {
  outputs.push(
    writeBundle(path.posix.join("stages", `${bundle.stage_id}.json`), bundle),
  );
}

process.stdout.write(
  stringifyRepoJson(
    {
      status: "ok",
      output_count: outputs.length,
      outputs,
    },
    ROOT,
  ),
);
