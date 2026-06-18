import { describe, expect, it } from "vitest";
import { isCheckpointEnvelopeV1 } from "./envelope.js";

describe("isCheckpointEnvelopeV1", () => {
  it("rejects null and non-object values", () => {
    expect(isCheckpointEnvelopeV1(null)).toBe(false);
    expect(isCheckpointEnvelopeV1(1)).toBe(false);
  });

  it("rejects objects missing required v1 fields", () => {
    expect(isCheckpointEnvelopeV1({})).toBe(false);
  });
});
