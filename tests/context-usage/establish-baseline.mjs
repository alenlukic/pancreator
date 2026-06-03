#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildBudgetBaseline } from "./lib/stats.mjs";
import { HARNESS_MODEL, resolveSdkModelId } from "./lib/model.mjs";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const BASELINE_PATH = path.join(HARNESS_ROOT, "baselines", "composer-2.5.json");
const baseline = buildBudgetBaseline({
  modelId: resolveSdkModelId(HARNESS_MODEL),
});
if (fs.existsSync(BASELINE_PATH)) {
  const existing = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  if (existing.live_envelope) {
    baseline.live_envelope = existing.live_envelope;
  }
}

fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
console.log(`[context-usage] baseline written: ${BASELINE_PATH}`);
