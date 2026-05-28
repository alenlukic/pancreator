import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asTaskId } from "@daedaline/core";
import { FsCheckpointStore } from "./fs-checkpoint-store.js";
import { isCheckpointEnvelopeV1, type CheckpointEnvelopeV1 } from "./envelope.js";

let base: string;
beforeEach(() => {
  base = join(tmpdir(), `ckpt-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

function sampleEnvelope(seq: number, runLogOffset: number): CheckpointEnvelopeV1 {
  return {
    v: 1,
    task_id: asTaskId("t-1"),
    seq,
    created_ts: new Date().toISOString(),
    metadata: { run_log_offset: runLogOffset },
    channel_values: { step: 1 },
  };
}

describe("FsCheckpointStore", () => {
  it("put and get round-trips a v1 envelope", async () => {
    const s = new FsCheckpointStore(base);
    const e = sampleEnvelope(0, 0);
    await s.put(e);
    const got = await s.get(asTaskId("t-1"), 0);
    expect(got).not.toBeNull();
    expect(isCheckpointEnvelopeV1(got)).toBe(true);
    expect(got?.metadata.run_log_offset).toBe(0);
  });

  it("listSeq returns sorted seq values", async () => {
    const s = new FsCheckpointStore(base);
    await s.put(sampleEnvelope(2, 10));
    await s.put(sampleEnvelope(0, 0));
    const seqs = await s.listSeq(asTaskId("t-1"));
    expect(seqs).toEqual([0, 2]);
  });
});
