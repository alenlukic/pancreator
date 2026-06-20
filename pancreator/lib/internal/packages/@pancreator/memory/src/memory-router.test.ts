import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MemoryRouter, parseDocList, parseHandbookIndexTable } from "./memory-router.js";

const repoRoot = fileURLToPath(new URL("../../../../../../", import.meta.url));

describe("parseDocList", () => {
  it("splits two comma-separated backtick paths", () => {
    const cell = "`/lib/memory/a.md`, `/lib/memory/b.md`";
    expect(parseDocList(cell)).toEqual(["/lib/memory/a.md", "/lib/memory/b.md"]);
  });
});

describe("parseHandbookIndexTable", () => {
  it("extracts the routing table from the real handbook index", async () => {
    const md = await readFile(
      path.join(repoRoot, "lib", "memory", "handbook", "index.md"),
      "utf8",
    );
    const rows = parseHandbookIndexTable(md);
    expect(rows.length).toBeGreaterThan(4);
    const glossary = rows.find((r) => r.intent.startsWith("Resolve a term"));
    expect(glossary?.primaryPaths[0]).toBe("lib/memory/handbook/glossary.md");
  });
});

describe("MemoryRouter", () => {
  it("ranks route rows for a high-signal query", () => {
    const md = `
## Routing

| Intent or question | Primary docs | Secondary docs | Notes |
|---|---|---|---|
| Do widgets | /a.md | /b.md | n |
| Do gadgets and extras | /c.md | /d.md | n2 |
`;
    const r = new MemoryRouter(md);
    const hits = r.routeIntent("gadgets", { limit: 2 });
    expect(hits[0].intent).toContain("gadgets");
  });
});
