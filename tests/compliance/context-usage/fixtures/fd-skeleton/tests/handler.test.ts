import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { handleHealth, handleRequest } from "../lib/internal/packages/demo-svc/handler.ts";

describe("demo handler", () => {
  it("returns ok response", () => {
    assert.equal(handleRequest(), "ok");
    assert.equal(handleHealth(), true);
  });
});
