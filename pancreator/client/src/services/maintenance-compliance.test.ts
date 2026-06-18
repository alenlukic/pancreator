import { describe, expect, it } from "vitest";
import {
  listComplianceDescriptors,
  parseDescriptorMetadata,
  validateDescriptorId,
} from "./maintenance-compliance";

describe("maintenance-compliance", () => {
  it("rejects shell metacharacters in descriptor ids", () => {
    expect(validateDescriptorId("json-formatting; rm -rf /")).toMatchObject({
      error: expect.stringContaining("metacharacter"),
    });
  });

  it("parses descriptor metadata from yaml", () => {
    const parsed = parseDescriptorMetadata(
      `schema_ref: "tests/compliance/schemas/latest.yaml"
id: "json-formatting"
severity: "high"
trigger_modes:
  - operator-on-demand
  - structure-change
`,
      "tests/compliance/json-formatting.yaml",
    );
    expect(parsed).toEqual({
      id: "json-formatting",
      severity: "high",
      triggerModes: ["operator-on-demand", "structure-change"],
      descriptorPath: "tests/compliance/json-formatting.yaml",
    });
  });

  it("discovers compliance descriptors from the repository", async () => {
    const descriptors = await listComplianceDescriptors();
    expect(descriptors.length).toBeGreaterThan(0);
    expect(descriptors.some((entry) => entry.id === "json-formatting")).toBe(true);
  });
});
