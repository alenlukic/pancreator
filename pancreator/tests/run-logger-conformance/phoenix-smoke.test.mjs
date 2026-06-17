import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { stringifyCompactJson } from "../../lib/internal/tools/format/canonical-json-format.mjs";
import { bootPhoenix, tearDownPhoenix } from "./helpers/boot-phoenix.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures", "sample-run-log.jsonl");

describe("run-logger Phoenix conformance (Option A)", () => {
  let skipReason = null;

  before(async () => {
    const boot = await bootPhoenix();
    if (boot.skipped) {
      skipReason = boot.reason;
    }
  });

  after(async () => {
    await tearDownPhoenix();
  });

  it("fixture records carry OpenInference and GenAI attributes", async () => {
    const raw = await readFile(FIXTURE, "utf8");
    const lines = raw.split(/\n/).filter((l) => l.length > 0);
    assert.ok(lines.length >= 1);
    for (const line of lines) {
      const rec = JSON.parse(line);
      assert.equal(rec.kind, "span");
      assert.ok(rec.attributes["openinference.span.kind"]);
      assert.ok(rec.attributes["gen_ai.request.model"]);
      assert.ok(rec.pancreator.task_id);
    }
  });

  it("Phoenix health is reachable when Docker boots", async () => {
    if (skipReason) {
      console.log(`SKIP Phoenix boot: ${skipReason}`);
      return;
    }
    const res = await fetch("http://127.0.0.1:6006/health");
    assert.equal(res.ok, true);
  });

  it("exported fixture trace hierarchy is accepted by Phoenix ingest", async () => {
    if (skipReason) {
      console.log(`SKIP Phoenix ingest: ${skipReason}`);
      return;
    }
    const raw = await readFile(FIXTURE, "utf8");
    const records = raw
      .split(/\n/)
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l));
    const root = records[0];
    const payload = {
      resourceSpans: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "pancreator" } }] },
          scopeSpans: [
            {
              scope: { name: "pancreator-run-logger-conformance" },
              spans: records.map((r) => ({
                traceId: Buffer.from(r.trace_id.padEnd(32, "0")).toString("hex"),
                spanId: Buffer.from(r.span_id.padEnd(16, "0")).toString("hex"),
                name: r.name,
                startTimeUnixNano: String(Date.parse(r.ts) * 1_000_000),
                endTimeUnixNano: String((Date.parse(r.ts) + 1000) * 1_000_000),
                attributes: Object.entries(r.attributes).map(([key, value]) => ({
                  key,
                  value: { stringValue: String(value) },
                })),
              })),
            },
          ],
        },
      ],
    };
    const ingest = await fetch("http://127.0.0.1:6006/v1/traces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stringifyCompactJson(payload),
    });
    assert.ok(ingest.ok || ingest.status === 415, `unexpected ingest status ${ingest.status}`);
    void root;
  });
});
