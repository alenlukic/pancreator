import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  sliceOperatorAgentSection,
  splitOperatorAgentSection,
  wrapOperatorAgentMarkdown,
} from "../lib/internal/packages/@pancreator/core/dist/index.js";

describe("operator-agent-section", () => {
  it("places frontmatter at line 1 before the operator section", () => {
    const source = wrapOperatorAgentMarkdown(
      {
        inThisFile: "Agent Document Registry",
        whyItMatters: "Quick orientation for Agent Document Registry before agents load the full contract.",
        seeAlso: ["/AGENTS.md"],
      },
      `---
slug: agent-document-registry
stability: experimental
---
# Agent Document Registry
Body
`,
    );
    assert.match(source, /^---\r?\nslug: agent-document-registry/);
    assert.ok(source.indexOf("---") < source.indexOf("# Operator section"));
    assert.doesNotMatch(source, /# Operator section[\s\S]*?\n---\r?\nslug:/);
    assert.match(sliceOperatorAgentSection(source), /^---\r?\nslug: agent-document-registry/);
  });

  it("returns unsectioned sources unchanged", () => {
    const source = "---\nname: coder\n---\n# Body\n";
    assert.equal(sliceOperatorAgentSection(source), source);
  });

  it("skips operator bullets and preserves leading frontmatter", () => {
    const source = `---
slug: demo
---
# Operator section
- 👀 **In this file:** Demo
- ⚖️ **Why it matters:** Human summary.
- 🧭 **See also:** N/A

# Demo
Body
`;
    const split = splitOperatorAgentSection(source);
    assert.ok(split);
    assert.match(split.agentBody, /^---\r?\nslug: demo/);
    assert.match(split.agentBody, /# Demo/);
  });
});
