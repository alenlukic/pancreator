import { describe, expect, it } from "vitest";
import {
  buildLinesDualAnchor,
  buildSymbolDualAnchor,
  hashUtf8Content,
  verifyDualAnchor,
} from "./citation.js";

describe("hashUtf8Content", () => {
  it("returns a stable 64-hex hash", () => {
    expect(hashUtf8Content("alpha")).toBe(hashUtf8Content("alpha"));
    expect(hashUtf8Content("alpha").length).toBe(64);
  });
});

describe("verifyDualAnchor", () => {
  it("returns valid when the file body matches the citation hash", async () => {
    const body = "one\n";
    const cite = buildLinesDualAnchor("doc.md", [1, 1], body);
    const result = await verifyDualAnchor(cite, async (p) => {
      expect(p).toBe("doc.md");
      return body;
    });
    expect(result).toBe("valid");
  });

  it("returns changed when the file body differs", async () => {
    const cite = buildSymbolDualAnchor("f.ts", "X", "original");
    const result = await verifyDualAnchor(cite, async () => "changed");
    expect(result).toBe("changed");
  });

  it("returns gone when the reader returns undefined", async () => {
    const c = buildLinesDualAnchor("a.md", [1, 1], "x");
    const result = await verifyDualAnchor(c, async () => undefined);
    expect(result).toBe("gone");
  });
});
