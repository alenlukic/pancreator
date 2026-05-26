import { describe, expect, it } from "vitest";

import { listResourceDefinitions, listToolDefinitions } from "./definitions.js";

describe("listToolDefinitions", () => {
  it("returns the MVP tess tool set with object inputSchema", () => {
    const tools = listToolDefinitions();
    expect(tools).toHaveLength(12);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "tess.abort",
        "tess.approve",
        "tess.contracts",
        "tess.feature",
        "tess.inbox",
        "tess.init",
        "tess.lint",
        "tess.memory",
        "tess.pause",
        "tess.resume",
        "tess.run",
        "tess.status",
      ].sort(),
    );
    expect(tools.find((x) => x.name === "tess.init")?.description).toMatch(/\[deferred: M3\]/);
    expect(tools.find((x) => x.name === "tess.feature")?.description).toMatch(/Read-only feature memory/);
    expect(tools.find((x) => x.name === "tess.memory")?.inputSchema).toMatchObject({
      required: ["query"],
    });
    for (const t of tools) {
      expect(t.inputSchema).toMatchObject({ type: "object" });
    }
  });
});

describe("listResourceDefinitions", () => {
  it("returns the three URI templates", () => {
    const r = listResourceDefinitions();
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.uriTemplate).sort()).toEqual(
      ["inbox://", "memory://", "work-run-log://{taskId}"].sort(),
    );
  });
});
