import { describe, expect, it } from "vitest";
import { SUITE_IDS, validateSuiteId } from "./maintenance-suite-presets";

describe("maintenance-test-run", () => {
  it("rejects unknown suite ids", () => {
    expect(validateSuiteId("unknown-suite")).toMatchObject({
      error: expect.stringContaining("allowlisted"),
    });
  });

  it("rejects shell metacharacters in suite ids", () => {
    expect(validateSuiteId("client; rm -rf /")).toMatchObject({
      error: expect.stringContaining("metacharacter"),
    });
  });

  it("accepts allowlisted suite ids", () => {
    for (const suiteId of SUITE_IDS) {
      expect(validateSuiteId(suiteId)).toBeNull();
    }
  });
});
