import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readCursorInvocationMode } from "./invocation-config.js";

describe("readCursorInvocationMode", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-invocation-config-"));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("defaults to manual when pancreator.yaml is absent", () => {
    expect(readCursorInvocationMode(tempRoot)).toBe("manual");
  });

  it("reads sdk invocation from pancreator.yaml", () => {
    fs.writeFileSync(
      path.join(tempRoot, "pancreator.yaml"),
      "runner:\n  cursor:\n    invocation: sdk\n",
    );
    expect(readCursorInvocationMode(tempRoot)).toBe("sdk");
  });
});
