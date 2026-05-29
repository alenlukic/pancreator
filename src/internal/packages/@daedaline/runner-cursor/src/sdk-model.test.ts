import { describe, expect, it } from "vitest";

import { resolveSdkModelId } from "./sdk-model.js";

describe("resolveSdkModelId", () => {
  it("strips Cursor IDE bracket qualifiers for SDK transport", () => {
    expect(resolveSdkModelId("composer-2.5[fast=false]")).toBe("composer-2.5");
  });

  it("returns bare model ids unchanged", () => {
    expect(resolveSdkModelId("gpt-5.3-codex")).toBe("gpt-5.3-codex");
    expect(resolveSdkModelId("auto")).toBe("auto");
  });

  it("trims surrounding whitespace", () => {
    expect(resolveSdkModelId("  composer-2.5[fast=false]  ")).toBe("composer-2.5");
  });
});
