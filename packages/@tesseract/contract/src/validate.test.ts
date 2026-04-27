import { describe, expect, it } from "vitest";

import { asContentHash } from "@tesseract/core";

import { isContractClause, isReference } from "./validate.js";
import type { ContractClause } from "./wrapper.js";

const H = asContentHash("a".repeat(64));

const sampleClause: ContractClause = {
  id: "tesseract.example.sample",
  kind: "rego",
  severity: "block",
  owner: "contract-writer",
  description: "The sample contract MUST deny empty file maps.",
  applies_to: { kind: "file-path", glob: "packages/**" },
  references: [
    {
      kind: "lines",
      path: "BOOTSTRAP.md",
      range: [1, 10],
      contentHash: H,
      note: "Bootstrap file paths.",
    },
  ],
  spec: "memory/example/example.rego",
  runtime: {
    package: "example",
    query: "data.example.deny",
  },
  metadata: {
    "tesseract.contract_id": "tesseract.example.sample",
  },
};

describe("isReference", () => {
  it("accepts a dual-anchor lines reference", () => {
    expect(
      isReference({
        kind: "lines",
        path: "PRD.md",
        range: [1, 1],
        contentHash: H,
        note: "note",
      }),
    ).toBe(true);
  });

  it("rejects an invalid content hash", () => {
    expect(
      isReference({
        kind: "lines",
        path: "PRD.md",
        range: [1, 1],
        contentHash: "not-a-hash",
        note: "note",
      }),
    ).toBe(false);
  });
});

describe("isContractClause", () => {
  it("returns true for a well-formed contract clause", () => {
    expect(isContractClause(sampleClause)).toBe(true);
  });

  it("returns false when references are empty", () => {
    expect(
      isContractClause({
        ...sampleClause,
        references: [],
      }),
    ).toBe(false);
  });
});
