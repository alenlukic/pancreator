import { describe, expect, it } from "vitest";

import { buildRegoPolicyInput, listMissingPaths } from "./rego-input.js";

describe("buildRegoPolicyInput", () => {
  it("returns a files object for OPA input", () => {
    const input = buildRegoPolicyInput({ "packages/x/package.json": "{}" });
    expect(input.files["packages/x/package.json"]).toBe("{}");
  });
});

describe("listMissingPaths", () => {
  it("lists paths not present in the file index", () => {
    const missing = listMissingPaths(
      new Set(["packages/a/package.json", "packages/b/package.json"]),
      { "packages/a/package.json": "{}" },
    );
    expect(missing).toEqual(["packages/b/package.json"]);
  });
});
