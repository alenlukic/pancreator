import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

test("static contract handbook docs replace per-run persona execution ledgers", () => {
  assert.equal(
    exists("lib/memory/handbook/persona-execution-contract.md"),
    false,
  );

  const registry = read("lib/memory/handbook/agent-document-registry.md");
  assert.match(registry, /DOC\.REGISTRY/u);
  assert.match(registry, /DOC\.PERSONA_CONTRACTS/u);
  assert.match(registry, /DOC\.OUTPUT_MANIFEST/u);
  assert.match(registry, /PIPE\.FEATURE_DELIVERY/u);

  const personaContracts = read("lib/memory/handbook/persona-contracts.md");
  assert.match(personaContracts, /Persona Static Contracts/u);
  assert.match(personaContracts, /pancreator-contract-key/u);
  assert.match(personaContracts, /pancreator-required-docs/u);
  assert.match(
    personaContracts,
    /Agents MUST NOT decide or rewrite\s+their own contract per invocation/u,
  );

  const outputManifest = read(
    "lib/memory/handbook/output-manifest-contract.md",
  );
  assert.match(outputManifest, /Double-write rule/u);
  assert.match(outputManifest, /## Output manifest/u);
  assert.match(outputManifest, /output_manifest/u);
});

test("AGENTS.md is a high-signal index into static contracts", () => {
  const agents = read("AGENTS.md");
  assert.match(agents, /DOC\.REGISTRY/u);
  assert.match(agents, /DOC\.PERSONA_CONTRACTS/u);
  assert.match(agents, /DOC\.OUTPUT_MANIFEST/u);
  assert.match(agents, /PIPE\.FEATURE_DELIVERY/u);
  assert.match(agents, /MUST NOT treat path enumeration as compliance/u);
  assert.doesNotMatch(agents, /persona-execution-contract/u);
  assert.doesNotMatch(agents, /Universal execution contract/u);
});

test("every persona spec declares a static contract and output manifest requirement", () => {
  const personaDir = path.join(ROOT, "lib/personas");
  const personaFiles = fs
    .readdirSync(personaDir)
    .filter((name) => name.endsWith(".md"));
  assert.ok(personaFiles.length > 0);

  for (const file of personaFiles) {
    const rel = path.posix.join("lib/personas", file);
    const persona = read(rel);
    assert.match(
      persona,
      /pancreator-contract-key:\s*PERSONA\.[A-Z0-9_]+/u,
      rel,
    );
    assert.match(persona, /pancreator-required-docs:/u, rel);
    assert.match(persona, /pancreator-output-manifest:\s*required/u, rel);
    assert.match(persona, /## Static execution contract/u, rel);
    assert.match(persona, /### Required context/u, rel);
    assert.match(persona, /### Definition of done/u, rel);
    assert.match(persona, /### Output manifest/u, rel);
    assert.doesNotMatch(persona, /persona-execution-contract/u, rel);
  }
});

test("feature-delivery pipeline declares static stage contracts and gate ownership", () => {
  const pipeline = read("lib/pipelines/feature-delivery.yaml");
  for (const stage of [
    "plan",
    "implement",
    "review",
    "test",
    "report",
    "compliance",
    "ship",
    "index",
  ]) {
    assert.match(
      pipeline,
      new RegExp(`id: ${stage}[\\s\\S]*?contract:`, "u"),
      stage,
    );
    assert.match(
      pipeline,
      new RegExp(`id: ${stage}[\\s\\S]*?definition_of_done:`, "u"),
      stage,
    );
    assert.match(
      pipeline,
      new RegExp(`id: ${stage}[\\s\\S]*?gate:`, "u"),
      stage,
    );
    assert.match(
      pipeline,
      new RegExp(`id: ${stage}[\\s\\S]*?remediation:`, "u"),
      stage,
    );
  }
  assert.match(
    pipeline,
    /implementation-report\.md records implement_gate_passes: true/u,
  );
  assert.match(pipeline, /predicate: "implement_gate_passes: true"/u);
  assert.match(pipeline, /PIPE\.FEATURE_DELIVERY\.IMPLEMENT/u);
});

test("prompt generation requires static contracts and output manifests, not ad-hoc execution contracts", () => {
  const cursorSync = read(
    "lib/internal/packages/@pancreator/cli/src/cursor-sync.ts",
  );
  assert.match(cursorSync, /buildStaticPersonaContractSection/u);
  assert.match(cursorSync, /agent-document-registry\.md/u);
  assert.match(cursorSync, /output-manifest-contract\.md/u);
  assert.match(cursorSync, /Do not invent a per-run execution contract/u);
  assert.doesNotMatch(cursorSync, /buildUniversalExecutionContractSection/u);

  const featureDelivery = read(
    "lib/internal/packages/@pancreator/cli/src/feature-delivery-run.ts",
  );
  assert.match(featureDelivery, /renderStaticContractStagePrompt/u);
  assert.match(featureDelivery, /agent-document-registry\.md/u);
  assert.match(featureDelivery, /output_manifest/u);
  assert.match(featureDelivery, /## Output manifest/u);
  assert.doesNotMatch(featureDelivery, /renderExecutionContractStagePrompt/u);

  const designSteps = read(
    "lib/internal/packages/@pancreator/cli/src/design-steps.ts",
  );
  assert.match(designSteps, /staticContractPromptLine/u);
  assert.match(designSteps, /output-manifest-contract\.md/u);
  assert.match(designSteps, /## Output manifest/u);
  assert.doesNotMatch(designSteps, /executionContractPromptLine/u);
});
