import { describe, expect, it } from "vitest";

import { findLayer1WeaselHits } from "./scan.js";

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
