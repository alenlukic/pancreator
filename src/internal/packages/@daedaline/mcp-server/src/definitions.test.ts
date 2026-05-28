import { describe, expect, it } from "vitest";

import { listResourceDefinitions, listToolDefinitions } from "./definitions.js";

describe("listToolDefinitions", () => {
  it("returns the MVP ddl tool set with object inputSchema", () => {
    const tools = listToolDefinitions();
    expect(tools).toHaveLength(12);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "ddl.abort",
        "ddl.approve",
        "ddl.contracts",
        "ddl.feature",
        "ddl.inbox",
        "ddl.init",
        "ddl.lint",
        "ddl.memory",
        "ddl.pause",
        "ddl.resume",
        "ddl.run",
        "ddl.status",
      ].sort(),
    );
    expect(tools.find((x) => x.name === "ddl.init")?.description).toMatch(/\[deferred: M3\]/);
    expect(tools.find((x) => x.name === "ddl.feature")?.description).toMatch(/Read-only feature memory/);
    expect(tools.find((x) => x.name === "ddl.memory")?.inputSchema).toMatchObject({
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
