import { describe, expect, it } from "vitest";

import {
  findLayer1WeaselHits,
  findRequiredContextMissingRfc2119,
} from "./scan.js";

describe("findLayer1WeaselHits", () => {
  it("finds a banned adjective in prose", () => {
    const hits = findLayer1WeaselHits("The API is very modern.");
    expect(hits.length).toBe(1);
    expect(hits[0]?.phrase).toBe("modern");
  });

  it("returns an empty list for clean text", () => {
    expect(findLayer1WeaselHits("The API returns HTTP 200.")).toEqual([]);
  });
});

describe("findRequiredContextMissingRfc2119", () => {
  it("flags imperative required-context bullets without RFC keywords", () => {
    const hits = findRequiredContextMissingRfc2119(`
### Required context

- Resolve DOC.REGISTRY before acting.
- You MUST load stage inputs before output.
`);
    expect(hits).toEqual([{ line: 4, text: "- Resolve DOC.REGISTRY before acting." }]);
  });

  it("ignores bullets outside required context", () => {
    expect(
      findRequiredContextMissingRfc2119(`
### Responsibilities

- Resolve DOC.REGISTRY before acting.
`),
    ).toEqual([]);
  });
});
