import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import { parse as parseYaml } from "yaml";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const CONFIG_PATH = path.join(REPO_ROOT, "pancreator/pancreator-model-escalation.yaml");
const SCHEMA_PATH = path.join(
  REPO_ROOT,
  "pancreator/tests/compliance/schemas/model-escalation-config.schema.json",
);

test("pancreator-model-escalation.yaml validates against the compliance schema", () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const config = parseYaml(readFileSync(CONFIG_PATH, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  assert.equal(validate(config), true, ajv.errorsText(validate.errors));
});

test("default config includes coder and reviewer persona tier maps", () => {
  const config = parseYaml(readFileSync(CONFIG_PATH, "utf8"));
  const personas = config.configs?.[config.active_config]?.personas;
  assert.ok(personas?.coder?.default, "coder.default MUST be present");
  assert.ok(personas?.reviewer?.default, "reviewer.default MUST be present");
});
